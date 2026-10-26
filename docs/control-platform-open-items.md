# Hub ↔ 中台对接待办清单（回复后）

> 致：公司中控平台执行面智能体 / 推理服务开发同学
> 自：AEOS Hub 管理面
> 日期：2026-10-26
> 状态：**中台已回复 15 项契约（2026-10-26），Hub 适配器已按回复实现；剩 4 项等待中台/运维。**
> 契约细节见 `docs/control-platform-reasoning-integration.md` 与《AEOS-Hub-推理能力接入回复-对外版-20261026》。

---

## 一、当前状态

| 项 | 状态 |
|---|---|
| 推理接口契约 | **已对齐**：3 个只读端点、HMAC 鉴权、信封响应、`task_id=runId`、cancel |
| Hub 推理适配器 | **已实现**：HMAC 三头、信封解包、取消、空结论、usage、`llm.called`；单测 41 项通过 |
| 接入方式 | 改造 Hub 的 `reasoning-adapter.js`，**不部署中台 Sidecar**（避免 8790 端口冲突与双身份） |
| 推理接口连通 | **未接通**：`TARGET_REASONING_URL`、`app_key/app_secret` 尚未配置 |
| 生产 18085 | **待放行**；UAT 地址待中台确认 |

**结论：Hub 侧代码已就绪，只差中台交付凭据与地址。**

## 二、剩余阻塞项

| # | 事项 | 负责方 | 完成标准 |
|---|---|---|---|
| 1 | 推理专用 API Key | 中台 | 勾选 `reasoning.analyze/cancel/task`，安全渠道交付 `app_key/app_secret` |
| 2 | 生产 18085 放行 | 中台 / 运维 | Hub 能访问 `150.158.13.110:18085` |
| 3 | UAT 最终地址 | 中台 | 提供 UAT analyze 地址（端口 8000 或最终对外地址） |
| 4 | 真实大模型配置 | 中台 | `REASONING_MODEL=deepseek-flash`，响应 `llm.called=true` |
| 5 | 联调窗口 | 双方 | 约定时间，Hub 侧半天内可完成 |

## 三、15 项契约回复情况

| # | 项 | 状态 |
|---|---|---|
| 1 | 推理接口地址 | 已明确（生产 18085；UAT 待确认） |
| 2 | 鉴权方式 | 已明确：HMAC-SHA256 三头，不支持 Bearer |
| 3 | 调用方 Agent ID / 应用 ID | 已明确：`runtime-control-platform-reasoning` + app_key |
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

1. 中台交付 `app_key/app_secret`、UAT 地址并放行 18085；
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
