<div align="center">

# AEOS Hub · 企业自治中枢

**AEOS 企业自治操作系统的本机控制台与运行时编排试点**

中枢 Agent · Runtime 抽象 · Guard 审批 · Evidence 证据链 · AI 港湾

![Node](https://img.shields.io/badge/Node.js-24-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-原生剥离运行-3178c6?logo=typescript&logoColor=white)
![Codex](https://img.shields.io/badge/Runtime-Codex%20app--server-000000?logo=openai&logoColor=white)
![MCP](https://img.shields.io/badge/Tooling-MCP%20stdio-6E56CF)
![WebSocket](https://img.shields.io/badge/Transport-WebSocket-010101?logo=socketdotio&logoColor=white)
![Isolated](https://img.shields.io/badge/CODEX__HOME-隔离运行-4BAE7B)
![License](https://img.shields.io/badge/license-内部试点项目-important)

</div>

---

## 📖 项目简介

AEOS Hub 是 [AEOS（Autonomous Enterprise Operating System）](../../) 的第一阶段落地工程：把「中枢 Agent → Capability → Evidence → Guard」这条闭环从方案变成可运行的系统。

它用 **OpenAI Codex 开源 harness（app-server）** 作为第一个 Agent Runtime，通过 **MCP** 把业务系统能力接给中枢 Agent，并在其上自建企业级控制面：运行时登记与健康验证、会话与运行记录、Guard 人审网关、Evidence 事件流、以及面向管理者的 Web 控制台。

| | |
|---|---|
| **产品形态** | 单机控制台 + Web 工作区（登录 → 引导 → 管理者首页 / 中枢 Agent / Attention / Evidence / AI 港湾） |
| **Agent Runtime** | Codex app-server（项目内固定版本，经 Runtime Adapter 抽象为 Session / Run / Event） |
| **工具面** | MCP（stdio）——每个业务系统/自治中心 = 一个 MCP server（当前试点：demo-ERP 只读） |
| **前端** | 原生 HTML/CSS/JS，无构建链；WebSocket 实时事件流 |
| **数据** | Evidence JSONL + 会话元数据 + AI 港湾快照（后续对接 EDP） |
| **部署** | 单机 Node.js ≥ 24，可一键切换局域网共享模式（服务端账号密码保护） |

## ✨ 功能特性

- **中枢对话**：流式输出 agent 文本、可展开的思考过程、工具调用卡片（✓/✗/✋ + 结果详情）
- **Guard 人审网关**：Agent 请求调用工具或执行敏感动作时，页面顶部弹出授权条；全部决策落 Evidence；无人值守时自动拒绝，超时 5 分钟自动拒绝
- **模型可切换**：会话级模型选择（OpenAI 账号默认 / 自定义提供商如 DeepSeek），配置页可编辑提供商、密钥（只写隔离目录）、可切换模型清单
- **会话管理**：新建 / 切换 / **归档**（可恢复）/ **删除**（同步清理 codex 线程），列表按 Codex 风格排版，悬停浮现操作
- **Evidence 证据链**：每个 turn 的完整 item 流（消息、推理、工具调用、审批决策、结果）结构化落库，页面内可查看最近条目
- **AI 港湾**：Agent / Runtime / Project 三类资源的登记与绑定，Runtime 健康验证走真实探针（`POST /api/harbor/runtimes/:id/verify`），不伪装成已连通
- **局域网共享**：`--lan` 一键开放给同事，服务端账号密码验证；关闭浏览器或重启服务后需要重新登录
- **完全隔离**：与机器上其他 Codex 安装（桌面版等）零接触，详见下文

## 🏗 架构

```
AEOS 控制面（本工程）              Runtime 层                        业务系统
┌──────────────────────┐  Session/Run/Event  ┌──────────────────┐   MCP/stdio   ┌────────────┐
│ Web 控制台 / 登录引导  │◄──── Adapter ──────►│ Codex app-server │◄─────────────►│ demo-erp   │
│ 会话 · Guard · Evidence│                     │ （第一个 Runtime） │   工具调用      │ (只读演示)  │
│ AI 港湾（登记/验证）    │◄─── Guard/Evidence ─│                  │               └────────────┘
└──────────────────────┘                     └──────────────────┘
```

控制面**不直接暴露** Codex 的 Thread/Turn 概念，而是经 `src/runtime/` 映射为 Runtime 中立的
**Session / Run / Event**：未来接入 Responses、Workflow、MCP Agent、RPA 或专业系统 Runtime 时，控制面与前端无需改动。

完整领域模型与演进阶段见 [`AI_HARBOR_ARCHITECTURE.md`](AI_HARBOR_ARCHITECTURE.md)。

## 🔒 隔离与安全

本工程与机器上现有的 **Codex 桌面版 / 其他 codex 安装完全隔离**：

1. **状态目录隔离**：每次运行强制 `CODEX_HOME = <repo>/.codex-home`，codex 的会话、日志、sqlite、配置只写项目内，**不读写 `~/.codex`**；
2. **二进制隔离**：codex CLI 以 **devDependency 固定版本**装在项目内（`node_modules/.bin/codex`），不改 PATH、不动全局安装；升级 = 改 `package.json` 版本号；
3. **凭证隔离**：`auth.json` / `.env` 只存在于 `.codex-home/`（已被 `.gitignore` 排除）。可用隔离目录内独立 `codex login`（OAuth 设备流）或 API key，与桌面版账号彻底解耦；
4. **首次运行零配置**：缺失的 `config.toml` 由 `ensureConfigFile()` 自动生成（含 demo-ERP MCP 注册，路径按当前仓库位置计算）；
5. **Guard 默认安全**：MCP 工具授权按白名单放行、命令/文件写类审批默认拒绝；`--auto-approve` 仅建议在演示环境使用。

> ⚠️ 公开仓库说明：本仓库**不含任何密钥**。`.codex-home/`（凭证/会话）、`.env`（部署密码）与 `data/`（证据/会话元数据）均已忽略，不会入库。

## 🚀 快速开始

```bash
# 1) 安装（项目内 codex 0.153.0 + MCP SDK）
npm install

# 2) 模型凭证（二选一）
#    a. 隔离目录内独立登录（推荐，与桌面版解耦）
CODEX_HOME="$PWD/.codex-home" ./node_modules/.bin/codex login
#    b. 或使用 API key：在 Web 配置页填写自定义提供商与密钥

# 3) 离线自检（不消耗模型额度）
npm run test:mcp        # MCP 链路
npm test                # Harbor 存储 + Runtime 健康 + MCP 全量测试

# 4) 设置 Web 登录密码（账号固定为 demo；不要提交或发送该密码）
#    PowerShell 示例：$env:AEOS_LOGIN_PASSWORD = '请替换为强密码'

# 5) 启动 Web 控制台（默认仅本机）
npm run web             # → http://127.0.0.1:8787   账号: demo；密码来自 AEOS_LOGIN_PASSWORD

# 6) 局域网共享（同事仍需输入账号密码）
npm run web:lan         # 首次不通请在管理员 PowerShell 放行端口：
                        # netsh advfirewall firewall add rule name="AEOS Hub 8787" dir=in action=allow protocol=TCP localport=8787
```

CLI 无头模式（不经 Web，审批默认自动拒绝）：

```bash
npm run demo                                    # 默认分析指令
npm run demo -- "检查 MO-8821 的供应缺口"          # 自定义指令
npm run demo -- --auto-approve                  # 放行所有审批（仅演示环境）
```

退出码：`0`=agent 完整回复；`2`=协议链路通但缺模型凭证；`1`=失败。

## 🖥 Web 控制台

| 区域 | 说明 |
|---|---|
| 登录 / 引导 | 服务端验证固定账号 `demo` 与部署密码；登录会话只在当前浏览器会话有效，关闭浏览器或重启服务后需重新登录 |
| 管理者首页 | 目标条、经营指标、System Registry、Runtime 状态 |
| 中枢 Agent | 会话列表（归档/删除/恢复）、流式对话、工具卡片、Guard 授权条、模型下拉 |
| Attention 中心 | 需人关注事项（示例数据），一键生成决策材料 |
| Evidence 中心 | evidence.jsonl 事件流浏览与刷新 |
| 系统配置 | 模型提供商 / 模型 / 密钥 / MCP 清单 / 证据速览 |
| AI 港湾 | Agent、Runtime、Project 登记与绑定；Runtime 真实健康验证 |

**模型切换说明**：新会话在创建线程时按所选模型生效；已有会话的模型版本保持不变（切换时提示新建会话，保证运行记录可追溯）。codex 0.153 起自定义提供商仅支持 `wire_api = "responses"`（DeepSeek 官方已支持 `/v1/responses`）。

## 🗂 目录结构

```
hub/
├── package.json              # 固定版本 codex devDependency；npm scripts（web / web:lan / demo / test）
├── AGENTS.md                 # 注入中枢 Agent 的职责、边界与输出格式
├── AI_HARBOR_ARCHITECTURE.md # AI 港湾领域模型与演进设计
├── mcp/demo-erp.mjs          # 业务能力示例：demo-ERP 只读 MCP server
├── public/                   # Web 前端（index.html / app.js / style.css，无构建）
├── src/
│   ├── server.ts             # Web 控制台服务端（静态页 + WebSocket + Harbor API + 登录网关）
│   ├── web-auth.ts           # demo 账号、密码校验与浏览器会话 Cookie
│   ├── codex-client.ts       # app-server JSON-RPC 客户端（initialize / thread / turn / 事件流 / 审批应答）
│   ├── runtime/              # Runtime 中立契约 + Codex Adapter + Supervisor + 健康测试
│   ├── harbor-store.ts       # AI 港湾快照、关联校验、锁、备份、Runtime 验证状态
│   ├── hub-config.ts         # 模型配置读写（config.toml 区段 + .env 密钥）+ 首次运行自动生成
│   ├── conversations.ts      # 会话元数据（data/threads.json，归档/删除）
│   ├── evidence.ts           # Evidence 落库（JSONL，后续替换为 EDP）
│   ├── demo-run.ts           # CLI 编排演示入口
│   └── generated/            # 官方 app-server 协议类型（可重新生成）
├── scripts/                  # test-mcp / smoke-web / smoke-conversation 冒烟脚本
├── test/                     # Harbor 存储测试
├── .codex-home/              # 隔离 CODEX_HOME（git 忽略；首次运行自动生成 config.toml）
└── data/                     # 运行数据（git 忽略；evidence.jsonl / threads.json）
```

重新生成协议类型（升级 codex 版本后）：

```bash
./node_modules/.bin/codex app-server generate-ts --out src/generated
```

## 🛣 后续二开路线

1. **对接真实自治系统**：每个系统一个 MCP server（参照 `mcp/demo-erp.mjs`），注册进 `config.toml` + 在 `AGENTS.md` 声明能力边界 → 中枢 Agent 即获得该 Capability；
2. **Guard 策略中心化**：白名单从代码迁至 Policy 存储，对应 AEOS 权限等级（READ_ONLY / AUTO_INTERNAL / APPROVAL_REQUIRED / HUMAN_ONLY / PROHIBITED_FOR_AI）；
3. **Evidence 对接 EDP**：`evidence.ts` 落库替换为事件生产者（Outbox 语义）；
4. **多线程 = 多岗位**：每岗位/每自治中心一个 Session，编排服务负责路由与汇总；
5. **Runtime 扩展**：按 `src/runtime/types.ts` 契约接入第二种 Runtime，验证控制面中立性。

## ⚠️ 已知限制（试点阶段）

- 历史消息回放未实现：重启后会话保留在列表，完整消息流可在 Evidence 中追溯；
- 同一会话同时只执行一个 Run，可点「停止」中断；
- 登录为演示账号（demo/demo），未接企业身份源；
- Windows 下 `.cmd` 启动器会触发 Node 的 `shell option` 弃用告警，不影响功能。

---

<div align="center">
<sub>AEOS Pilot · 目标向下，事实向上</sub>
</div>
