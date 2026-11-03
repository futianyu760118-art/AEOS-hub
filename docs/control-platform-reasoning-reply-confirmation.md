# AEOS Hub 对中台推理接入回复的确认

> 致：公司中控平台执行面智能体 / 推理服务开发同学
> 自：AEOS Hub 管理面
> 日期：2026-10-26
> 回复对象：《AEOS-Hub-推理能力接入回复-对外版-20261026》

---

## 一、接入方式

**采用回复第 3 节的最小改造方案，不部署中台 Sidecar。** 原因：

1. 现有 `gateway-control-platform` 单网关已同时承载 `query_control_platform` / `reason_control_platform`，再部署 Sidecar 会多一套进程与身份；
2. Sidecar 的 `HEALTH_CHECK_PORT=8790` 与 Hub UI 端口冲突。

Hub 侧已按第 3 节完成 4 处改造（HMAC 三头、`task_id=runId`、信封解包、召回同时 cancel），并补充空结论、usage、`llm.called` 与错误码映射；单测 41 项全部通过。

## 二、对第 7 节 8 个待确认项的确认

| # | 待确认项 | Hub 确认 |
|---|---|---|
| 1 | 鉴权 | **按 HMAC 接入**，使用 `X-App-Key/X-Timestamp/X-Signature`（`reasoning.analyze` / `reasoning.cancel`）；不使用 Bearer |
| 2 | 部署方式 | **改造 Hub 的 `reasoning-adapter.js`**，不部署 Sidecar |
| 3 | task_id | **传 Hub `runId`**（格式 `exec-run-<uuid>`，45 字符，≤64）；接受幂等回放语义（同 id 重试返回首次结果或 409） || 4 | 取消 | **召回时同时调用 cancel**：先 Abort 本地请求，再 `POST /tasks/{task_id}/cancel`；cancel 独立 5s 超时，失败不覆盖主流程 |
| 5 | 超时 | 确认 **Hub 180s / 中台 170s**，留 10s 余量 |
| 6 | 模型/思考强度 | **接受服务端配置**，Hub 请求不携带 `model/reasoning_effort`；后续若需按次指定再提 |
| 7 | 地址 | 生产按 `http://150.158.13.110:18085/api/v1/external/reasoning/analyze`；**请确认 UAT 地址并放行 18085** |
| 8 | 响应扩展 | **Hub 能容忍 `data` 额外字段**：契约字段进入结果，`llm` / `duration_ms` / `idempotent_replay` / `stale` 仅用于诊断展示 |

**身份说明：** Hub 不部署 Sidecar，执行面 WS 注册身份仍是 `gateway-control-platform`；中台回复中的 `runtime-control-platform-reasoning` 不需要在 Hub 侧创建。调用方身份以 `app_key` 为准，如需在请求头携带 Agent ID 可再约定。

## 三、需要中台完成的事项

1. 创建推理专用 API Key（勾选 `reasoning.analyze` / `reasoning.cancel` / `reasoning.task`），通过安全渠道交付 `app_key` / `app_secret`；
2. 放行生产 18085 端口，并提供 UAT 最终地址；
3. 配置真实大模型：`REASONING_MODEL=deepseek-flash`，确认 `llm.called=true`；
4. 约定联调窗口（预计 Hub 侧半天内可完成）。

## 四、Hub 侧已就绪

- HMAC 签名、信封解包、`task_id`、取消、超时、错误码映射；
- 空结论处理：返回空 `conclusions` + 低置信度 + “不代表无风险”校验说明，不静默通过；
- usage 透传：`data.usage` 自动记入 Hub 用量台账，缺 `cost` 时按模型目录补算；
- 联调自检：5 个用例覆盖 4 类分析任务 + 不存在订单边界，逐条核对验收标准。

## 五、联调验收要点

| 项 | 通过标准 |
|---|---|
| 任务关联 | 中台 `task_id` 与 Hub `runId` 一致 |
| 真实模型 | 响应 `llm.called=true`；中台审计 `llm_called=1` |
| 证据 | 结论均有 `evidence_refs`；无证据结论被剔除或标低置信度 |
| 召回 | Hub 召回后中台审计终态为 `cancelled` |
| 空结果 | 订单不存在返回 404 信封，双方均不表述为“无风险” |
| 用量（可选） | 用量台账出现推理 Token/成本 |

---

Hub 侧代码与文档已提交到 AEOS Hub 仓库；收到 `app_key/app_secret` 与地址后即可联调。
