# Attention 主动搜索 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Attention 中心现有的“仅筛选已加载待关注事项”升级为一个不与顶部全局跳转搜索重复的业务搜索入口：默认跨 Attention、Evidence 和 Agent 小队动作/记忆检索；用户显式打开“实时核查中台”后，针对关键词发起新的只读 MCP 核查，并按来源分组展示可追溯结果。

**Architecture:** 保留顶部“搜索或跳转”作为导航命令面，不修改其行为。Attention 视图新增一个本地聚合索引和一个受查询词、长度、并发锁保护的 `/api/attention/search` 接口。服务端接口只调用 `company-control` 已注册且标为只读的列表/查询 Capability，统一标准化为包含 `evidenceRefs`、数据时间、置信度、部分失败警告的搜索结果。前端在输入时即时渲染本地命中；启用实时核查并按 Enter 后请求后端，将“实时中台核查”结果合并展示。空搜索时继续显示原有看板，避免把搜索结果和工作流卡片混在一起。

**Tech Stack:** Node.js 24、TypeScript、Zod、现有 MCP Access Gateway、原生 HTML/CSS/JavaScript、Node test runner。

## Product Boundary

- 顶部全局“搜索或跳转”仍只负责页面/命令跳转；Attention 中的输入框明确为“搜索经营事项、证据或 Agent 动作”。
- 默认本地搜索不访问中台：检索当前 Attention 风险、最近 Evidence 记录，以及 `agent-squad.json` 中的活动、记忆和消息摘要。
- 仅用户主动开启“实时核查中台”且以 Enter 发起时，才创建 Runtime session 调用 MCP。请求必须为空时拒绝、去除首尾空格、限制关键词长度和同一客户端并发，绝不把输入当作指令执行。
- 实时查询只允许 `company-control` 已登记且 `readOnly` 的 `detail_orders_list`、`material_shortages_list`、`material_kitting_results_list`、`quality_issues_list` 与生产相关只读查询；Capability 不可用、分页受限、上游失败或数据过旧时必须以“数据置信度不足”/失败原因呈现，不能显示为“无结果”。
- 搜索结果仅供查看和跳转到既有详情/研判流程，不新增任何中台写操作，也不把自由文本搜索词写入 Evidence。

## File Structure

- Create: `src/attention-search.ts` — 本地索引、查询校验、MCP 结果标准化和纯函数检索逻辑。
- Create: `test/attention-search.test.ts` — 本地分组、关键词匹配、证据绑定、上游失败与置信度降级测试。
- Modify: `src/server.ts` — 受保护的 `POST /api/attention/search`、只读 MCP 调用编排及响应边界。
- Modify: `public/index.html` — Attention 搜索说明、实时核查开关、状态与三组结果容器。
- Modify: `public/app.js` — 本地索引装载、Enter 触发实时检索、安全渲染、跳转与加载/错误状态。
- Modify: `public/style.css` — 搜索工具条、结果分组、结果卡和小屏响应式样式（只作用于 Attention）。
- Modify: `package.json` — 新增 `test:attention-search` 并纳入总测试命令。
- Modify: `README.md` — 说明主动搜索范围、实时读取边界与证据/置信度语义。

## Review Focus

- 本地搜索命中 Evidence 或小队记录时，必须将文本转义；不得把日志、记忆、消息摘要直接插入 `innerHTML`。
- 用户未开启实时开关时，输入不得创建 Runtime session 或访问 MCP；空关键词不得触发全量中台扫描。
- MCP 被拒绝、超时、分页不完整或没有任何可用 Capability 时，结果区必须显示核查失败/数据置信度不足，不能将它误标为“0 项”。
- 每个实时中台结果都保留其 `evidence_ref(s)`、来源、数据时间与置信度；无法取得证据的项目只能作为“证据待补”显示，不得伪造引用。
- 原有 Attention 看板、筛选器、拖拽状态、详情弹窗、Agent 派发与顶部搜索均保持现有行为。

---

## Task 1: 可测试的 Attention 搜索模型

**Files:**
- Create: `src/attention-search.ts`
- Create: `test/attention-search.test.ts`
- Modify: `package.json`

- [ ] **Step 1: 先写失败测试**

为纯函数建立固定样本：Attention 风险、`EvidenceEntry`、小队活动/记忆/消息及中台列表响应。断言中文/订单号/证据 ID 的大小写无关匹配；空关键词返回空搜索态；本地结果严格分为“已关注事项”“Evidence 与 Agent 动作”；结果按相关度与时间排序；所有可追溯项保留原始 evidence ref。再断言中台响应缺少 evidence、返回 `STALE_DATA`、部分工具 rejected 时，标准化结果有明确警告和低置信度，而不是被吞掉。

- [ ] **Step 2: 运行失败测试**

Run: `node --test test/attention-search.test.ts`

Expected: FAIL，因为搜索模型尚未实现。

- [ ] **Step 3: 实现 `src/attention-search.ts`**

定义严格的 `AttentionSearchRequest`（`query` 最大 160 字符、`live` 布尔值）与面向前端的 `AttentionSearchResult`。实现：

- `searchLocalAttention(query, { risks, evidenceRows, squad })`：只读地构建三类本地结果，返回安全的纯数据，而不是 HTML；
- `normaliseLiveSearchResponses(query, responses)`：从订单、缺料/齐套、质量、生产响应中按通用字段和关键词筛选，保留 `source`、`title`、`summary`、`evidenceRefs`、`dataAsOf`、`confidence`、`partial`/`warnings`；
- 统一的字符串规范化和结果上限，防止搜索一个关键词就向浏览器返回不受限制的数据。

不得在该模块中调用网络、写 Evidence 或修改 Agent/Attention 状态。

- [ ] **Step 4: 验证模型**

Run: `node --test test/attention-search.test.ts && npm run check:types`

Expected: PASS。

- [ ] **Step 5: 接入测试脚本**

添加 `test:attention-search` 并将其放入 `npm test` 聚合脚本。

## Task 2: 显式触发的只读中台核查 API

**Files:**
- Modify: `src/server.ts`
- Test: `test/attention-search.test.ts`

- [ ] **Step 1: 为路由边界补充失败用例**

覆盖请求体严格校验、空/超长 query 的 400、`live: false` 只返回本地组且不会调用 MCP、`company-control` 未注册/Capability 不可用的可解释结果、以及一个工具失败不遮蔽其他工具结果。确认服务端不将 query 原文写入 `appendEvidence`。

- [ ] **Step 2: 在 `src/server.ts` 增加 `POST /api/attention/search`**

将路由置于通用 API 404 前。读取最近的 `readRecentEvidence`、`loadAgentSquad()` 和当前决策快照，用 `searchLocalAttention` 生成本地组。若 `live` 为 false，立即返回；若为 true，则：

1. 读取当前 MCP Registry/Runtime inventory，核对所选工具已注册且只读；
2. 创建短生命周期 `manager-attention-search-readonly` session；
3. 通过现有 `mcpAccessGateway.callReadOnly` 与 `collectMcpPages` 并行发起受限的订单、齐套/缺料、质量和生产核查；对日期范围、页数和返回数量设置上限；
4. 使用 Task 1 标准化结果，最后删除 session；
5. 对每个拒绝/超时单独返回 warning，HTTP 200 中的 `live.status` 只能是 `complete`、`partial` 或 `unavailable`，不得以空数组代表失败。

请求输入、MCP 原始载荷和错误堆栈都不得写入 Evidence；原有 `/api/dashboard` 刷新策略不得改变。

- [ ] **Step 3: 运行服务端相关验证**

Run: `node --test test/attention-search.test.ts && npm run test:mcp-policy && npm run test:dashboard && npm run check:types`

Expected: PASS。

## Task 3: Attention 中心的单一业务搜索体验

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`

- [ ] **Step 1: 调整 Attention 工具条结构**

保留现有来源/状态/等级筛选。将 `#attention-search` 的占位提示改为“搜索经营事项、证据或 Agent 动作”；在它旁边增加 `#attention-live-check` 开关与简短说明“实时核查中台（按 Enter）”，以及 `#attention-search-status`。新增位于看板前的 `#attention-search-results`，默认隐藏。结果容器按：`#attention-result-attention`、`#attention-result-live`、`#attention-result-history` 三组布局。

- [ ] **Step 2: 实现本地搜索与实时搜索状态机**

在 `app.js`：

- 加载 dashboard、Evidence 或 agent squad 后刷新内存本地索引；
- 输入时仅运行本地聚合检索，非空关键词显示搜索结果区，清空关键词恢复原始看板；
- 开关开启后，只有在输入框按 Enter 才 POST `{ query, live: true }`；阻止重复请求、显示“正在读取中台”，并在响应到达后替换实时组；
- 未开启时 Enter 不发 MCP 请求，只保持本地检索；
- 使用现有 `esc()` 显示所有外部文本；结果卡点击已关注事项时复用既有风险详情，证据/动作点击时跳转或聚焦到既有 Evidence、AI 港湾/小队视图；无法稳定定位的条目只展示引用，不伪造可点击行为；
- `live.status` 为 `partial`/`unavailable` 时固定展示告警与数据时间/置信度，toast 只作为补充，不替代页面信息。

不改变现有 `renderAttention` 的看板筛选与拖拽逻辑，只在搜索词非空时在看板上方提供独立结果区，从而避免同一项目在工作流列和搜索卡中产生歧义。

- [ ] **Step 3: 添加受限样式**

在 `style.css` 新增 `.attention-active-search*` 命名空间：在桌面端将开关、状态和筛选项清晰分层；结果分组带标题、数量、来源/置信度/时间元信息和证据 chip；低置信度与部分失败使用现有 warn token；小屏时堆叠工具条和卡片。不得修改全局 `input`、`select`、modal 或其它模块选择器。

- [ ] **Step 4: 浏览器手工验收**

1. 顶部“搜索或跳转”仍正常跳转页面；
2. Attention 输入订单号、摘要、Evidence ID、Agent 动作关键词，分别出现正确本地分组；
3. 清空输入框后原 Kanban、筛选、拖拽和“查看/派发研判”恢复原样；
4. 关闭实时开关按 Enter 不产生 MCP 请求；打开后按 Enter 仅调用只读 API，并可显示 complete、partial、unavailable 三种状态；
5. 断开 company-control 或让一个工具失败，页面明确报告“数据置信度不足”，不显示“没有事件”；
6. 在窄屏下检查结果不会与看板、下拉筛选或顶部菜单重叠。

## Task 4: 全量回归与运维说明

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 记录操作边界**

在 README 的 Web 控制台说明 Attention 主动搜索：默认范围、触发实时读取的方法、只读限制、证据与置信度提示，以及“实时核查失败不等于没有数据”。不记录真实中台 URL、令牌或用户搜索内容。

- [ ] **Step 2: 全量验证与差异检查**

Run: `npm test && npm run check:types && git diff --check`

Expected: PASS 且没有空白错误。

- [ ] **Step 3: Docker 验证**

在不改变现有 LAN 无令牌访问配置的前提下重建镜像，确认容器健康、`http://<局域网IP>:8787/` 无 query token 可打开，并按 Task 3 的手工清单复验。若静态资源缓存导致旧 JS/CSS，检查响应 `cache-control` 与镜像构建产物，而不是要求用户先猜测性重启 Docker。

