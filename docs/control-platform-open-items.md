# Hub ↔ 中台对接待办清单（回复后）

> 致：公司中控平台执行面智能体 / 推理服务开发同学
> 自：AEOS Hub 管理面
> 日期：2026-10-26
> 状态：**UAT 全链路已通过（2026-10-26）：自检 5/5、页面端到端 1/1；待生产 18085 放行。**
> 契约细节见 `docs/control-platform-reasoning-integration.md` 与《AEOS-Hub-推理能力接入回复-对外版-20261026》。

---

## 一、当前状态

| 项 | 状态 |
|---|---|
| 推理接口契约 | **已对齐**：3 个只读端点、HMAC 鉴权、信封响应、`task_id=runId`、cancel |
| Hub 推理适配器 | **已实现**：HMAC 三头、信封解包、取消、空结论、usage、`llm.called`；单测 41 项通过 |
| 接入方式 | 改造 Hub 的 `reasoning-adapter.js`，**不部署中台 Sidecar**（避免 8790 端口冲突与双身份） |
| 执行面路径 | **只保留统一网关** `gateway-control-platform`；中台侧直连 Agent 已移出允许列表并软注销（2026-10-26） |
| 推理接口连通 | **UAT 全链路已通**：自检 5/5 + 页面端到端 1/1（2026-10-26） |
| 借调闭环 | ✅ `borrow-8f21bcff-…` completed（29.3s，6 条结论）；用量归属 `aeos-hub`，成本 ¥0.0254 |
| 端口连通 | UAT 8000 已通；生产 18085 仍 TCP 超时 |

**结论：UAT 验收完成，剩生产端口放行。**

## 二、剩余/已完成事项

| # | 事项 | 负责方 | 状态 |
|---|---|---|---|
| 1 | 推理专用 API Key | 中台 | ✅ 已交付并配置到 `.env`（HMAC 生效） |
| 2 | 生产 18085 放行 | 中台 / 运维 | ⏳ 仍超时 |
| 3 | UAT 8000 可达 | 中台 / 运维 | ✅ 已通（openapi 200） |
| 4 | 真实大模型配置 | 中台 | ✅ `llm.called=true`，deepseek-flash |
| 5 | IP 白名单 | Hub | ✅ 试点期不启用，仅 app_key + 100 次/分钟限流 |
| 6 | 联调窗口 | 双方 | ✅ UAT 自检 5/5、页面端到端 1/1 已完成 |

## 三、15 项契约回复情况

| # | 项 | 状态 |
|---|---|---|
| 1 | 推理接口地址 | 已明确：生产 `150.158.13.110:18085`；UAT `192.168.0.178:8000`（共用同一套凭据） |
| 2 | 鉴权方式 | 已明确：HMAC-SHA256 三头，不支持 Bearer |
| 3 | 调用方 Agent ID / 应用 ID | 已明确：调用方身份以 `app_key` 为准；中台不要求创建 `runtime-control-platform-reasoning` |
| 4 | 请求参数结构 | 已明确（含 `task_id` / `request_id`） |
| 5 | 返回参数结构 | 已明确：信封 `{code,message,data}` |
| 6 | 流式输出 | 已明确：v1 不支持，一次性返回 |
| 7 | 会话与上下文 | 已明确：无多轮，仅 `businessObjectRef` + `prompt` |
| 8 | 超时 | 已明确：中台 170s / Hub 180s |
| 9 | 取消接口 | 已明确：`POST /tasks/{id}/cancel`，Hub 召回时调用 |
| 10 | 错误码表 | 已明确：HTTP 401/403/422/429 + 信封 400/404/409/490/500/503/504 |
| 11 | evidence_refs 规则 | 已明确：`control-platform://<域>/<键>`，逐条过滤 |
| 12 | 工具白名单 | 已明确：服务端内置只读域，调用方不可注入 |
| 13 | 只读保证 | 已明确：业务表仅 SELECT，仅写审计表 |
| 14 | data_as_of / confidence | 已明确：≤6h high、≤24h medium、>24h low + STALE_DATA |
| 15 | 并发与限流 | 已明确：100 次/分钟、并发 5、429 带 Retry-After |

## 四、Hub 侧已就绪

- HMAC 签名与信封解包，错误码映射到 Hub 失败码；
- `task_id=runId`，召回/超时同时调用 cancel（独立 5s 超时，失败不覆盖主流程）；
- 空结论：返回空 `conclusions` + 低置信度 + “不代表无风险”，不静默通过；
- usage 自动透传，Hub 缺成本时按模型目录补算；
- 联调自检 `npm run reasoning:check`：5 个用例、逐条判定验收标准，`--json` 可直接回传失败项。

## 五、联调步骤

1. 中台交付 `app_key/app_secret`，确认 UAT `192.168.0.178:8000` 与生产 18085 从 Hub 主机可达；
2. Hub 写入 `TARGET_REASONING_*` 并重启网关；
3. `cd aeos-execution-agent && npm run reasoning:check`；
4. 登录 Hub 执行面提问，确认结论与 evidence_refs；
5. 双方核对 `task_id`、`llm.called`、召回后的 `cancelled` 审计。

## 六、验收要点

1. 结果含 `conclusions`、`evidence_refs`、`data_as_of`，`data_confidence` 非 low（数据新鲜时）；
2. 无 `evidence_refs` 的结论被剔除或标低置信度；
3. 召回后中台任务终态为 `cancelled`；
4. 404 / 409 / 490 / 429 / 503 / 504 分别返回明确错误；
5. 中台审计 `llm_called=1`，证明实际调用大模型；
6. （可选）用量台账出现推理 Token / 成本。
