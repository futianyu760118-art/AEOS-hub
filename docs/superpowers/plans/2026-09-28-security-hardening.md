# AEOS Hub Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复实测确认的配置清空、超时结果污染、证据引用信任、数据时效伪造、审批 actor 和 HTTP 输入校验问题，并保持现有只读业务链路可用。

**Architecture:** 在现有 Node 控制面内增加服务端生成的会话 actor；对模型配置、专业 Agent 派发和 HTTP 查询参数做边界校验；超时只产生“失败/降级”通知，不进入 completed 或专业 Agent 记忆。MCP 通用适配层缺失时效直接失败关闭，与 production 适配器统一口径。

**Tech Stack:** Node.js 24、TypeScript 原生运行、WebSocket、Zod、Python MCP/Pydantic。

**Spec:** DeepSeek 实测评审交接文档（用户于 2026-09-28 提供）。

## Global Constraints

- 只读业务能力不得被修改为写操作。
- 结论必须保留真实 `evidence_refs`；缺失时效或证据不得伪装为高置信度。
- 超时、网络重连和运行失败不得标记为已完成，不得写入 Agent 结果记忆。
- 保持现有 Docker 非 root、只读根文件系统和 Guard 失败关闭行为。

## Review Focus

- 空或缺字段的 `config:save` 必须拒绝且不改写配置。
- 模型等待超时必须返回失败/降级状态，且不得沉淀专业 Agent 记忆。
- 审批和经营决策 actor 必须由服务端会话派生，忽略客户端自报 actor。
- 专业 Agent 派发的 evidence_ref 必须与当前 Dashboard 风险对象和来源匹配。
- MCP 上游缺少 freshness/confidence 时必须返回不可用或低置信度，不能填当前时间/high。

### Task 1: 配置保存与 HTTP 输入边界

**Files:**
- Modify: `src/server.ts`
- Modify: `src/http-security.ts`
- Modify: `src/harbor-store.ts`
- Modify: `src/hub-config.ts`
- Test: `test/security-hardening.test.ts`

- [x] 为 `config:save` 增加 payload 结构校验；缺少 `model`、`modelProvider` 或 `providers` 字段时拒绝，不调用 `saveModelConfig`。
- [x] 将 `/api/evidence` 参数错误返回 400；未知 `/api/*` 返回 JSON 404，不回落到 index.html。
- [x] Agent 创建接口对未知字段返回 400，避免静默忽略。
- [x] 添加纯函数/黑盒回归测试，覆盖非法 limit 和未知 Agent 字段；HTTP 路由通过静态分支复核。
- [x] 运行时配置固定 `approval_policy = "on-request"` 与 `sandbox_mode = "read-only"`，配置重写不会移除边界。

### Task 2: 服务端 actor 与证据引用校验

**Files:**
- Modify: `src/server.ts`
- Modify: `src/operating-center.ts`
- Test: `test/security-hardening.test.ts`

- [x] 为授权 HTTP/WS 连接生成并持久化 HttpOnly 会话 cookie `aeos_session`，actor 使用 `web-session:<uuid>`。
- [x] Guard 审批和经营事项决策统一使用服务端 actor；忽略请求体中的 actor。
- [x] 专业 Agent 派发前刷新 Dashboard，校验 taskType、对象标识、来源和 evidence_ref 完整匹配。
- [x] 回归测试覆盖核心边界；伪造 actor/evidence_ref 由服务端输入边界拒绝。

### Task 3: 超时状态与专业 Agent 记忆隔离

**Files:**
- Modify: `src/server.ts`
- Modify: `public/app.js`
- Test: `test/security-hardening.test.ts`

- [x] 超时分支只发送降级文本和 `turn_end: failed`，不发送 `item/completed`，不调用 `persistAgentDispatchResult`，并清除待沉淀捕获。
- [x] UI 仅在真实 `completed` 时将 Attention 转为“待责任人”；超时保持失败/重试状态。
- [x] 通过安全回归与全量测试验证 fallback 分支不影响既有状态契约。

### Task 4: MCP freshness 失败关闭

**Files:**
- Modify: `mcp-company-control/mcp_server/tool_helpers.py`
- Modify: `mcp-company-control/scripts/test_company_control.py`

- [x] `data_as_of` 缺失或 `data_confidence` 不在 high/medium/low 时返回 `UPSTREAM_UNAVAILABLE`，不使用 now/high 默认值。
- [x] 保留 stale 数据的既有 `STALE_DATA`/low-confidence 语义。
- [x] 更新通用订单、BOM、物料等测试桩携带真实 freshness，并保留生产缺 freshness 失败断言。

### Task 5: 全量验证

- [x] 运行 `npx tsc --noEmit`。
- [x] 运行 `npm test`。
- [x] 运行 `\.venv\\Scripts\\python.exe mcp-company-control/scripts/test_company_control.py`。
- [x] 已完成此前的 HTTP/WS smoke 与 Docker build/health 检查；本轮未重新部署 Docker。

