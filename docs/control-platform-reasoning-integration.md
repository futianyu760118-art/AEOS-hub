# 中台推理能力接入说明（reason_control_platform）

> 日期：2026-10-26（中台回复版）
> 发送对象：公司中控平台执行面智能体 / 推理服务开发同学
> Hub 侧状态：**UAT 全链路已通过（2026-10-26）**：自检 5/5、页面端到端 1/1；待生产 18085 放行
> 中台回复原文：`AEOS-Hub-推理能力接入回复-对外版-20261026.md`

---

## 一、结论

1. 中台提供 3 个只读端点：`analyze` / `cancel` / `task`，HMAC-SHA256 鉴权，信封响应 `{code,message,data}`。
2. **接入方式：改造 Hub 自己的 `reasoning-adapter.js`，不部署中台 Sidecar。**
   - 现有 `gateway-control-platform` 单网关已同时承载查询与推理，减少一个进程与一套身份；
   - 中台 Sidecar 的 `HEALTH_CHECK_PORT=8790` 与 Hub UI 端口冲突；
   - **MVP 分支只保留统一网关路径**：中台侧直连 Agent（`runtime-control-platform-query` / `runtime-control-platform-reasoning`）已于 2026-10-26 从执行面允许列表移除并软注销，之后的重连会被拒绝。
3. 按中台回复第 3 节完成 4 处改造：HMAC 三头、`task_id=runId`、信封解包、召回同时调用 cancel。
4. 额外处理：空结论、`usage` 透传、`llm.called` 元信息、404/409/490/429 错误映射。
5. 未配置 URL 时仍返回“未接通”占位，不伪造结论。

---

## 二、接口契约（中台回复版）

### 2.1 地址

| 环境 | URL |
|---|---|
| 生产（main 主机，端口 18085） | `http://150.158.13.110:18085/api/v1/external/reasoning/analyze` |
| UAT / 联调（dev compose，端口 8000） | `http://192.168.0.178:8000/api/v1/external/reasoning/analyze`（**与生产共用同一套 `app_key/app_secret`**） |
| 取消 | `POST {BASE}/api/v1/external/reasoning/tasks/{task_id}/cancel` |
| 状态 | `GET {BASE}/api/v1/external/reasoning/tasks/{task_id}` |
| OpenAPI | `GET {BASE}/api/v1/external/openapi.json` |

生产端口 18085 需放行；UAT 的 8000 端口同样需要从 Hub 主机可达。
截至 2026-10-26：从 Hub 主机（192.168.0.23）访问 UAT `192.168.0.178:8000` 与生产 `150.158.13.110:18085` 均 TCP 超时（UAT 主机可 ping 通），需中台确认服务启动与防火墙放行。

### 2.2 鉴权（HMAC-SHA256）

```text
X-App-Key:    <app_key>
X-Timestamp:  <整数秒级时间戳，与服务端偏差 ≤ 300s>
X-Signature:  hex(HMAC-SHA256(app_secret, timestamp + app_key + endpoint_code + query_string))
```

- `endpoint_code`：`reasoning.analyze` / `reasoning.cancel` / `reasoning.task`；
- POST body 不参与签名；`query_string` 为空；`task_id` 是路径参数，不参与签名；
- 中台**不接受** `Authorization: Bearer`。

### 2.3 请求

```json
{
  "prompt": "分析订单 HJY20260903-261 的交付风险",
  "task_type": "order_delivery_analysis",
  "context": { "businessObjectRef": "business://order/HJY20260903-261" },
  "constraints": { "read_only": true, "require_evidence": true },
  "task_id": "exec-run-<uuid>",
  "request_id": "req-abc"
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `prompt` | 是 | ≤2000；空/超长 → HTTP 422 |
| `task_type` | 是 | `order_delivery_analysis` / `material_kitting_analysis` / `quality_analysis` / `production_analysis` |
| `context.businessObjectRef` | 是 | `business://<order\|product\|batch>/<键>` |
| `constraints.read_only` | 否 | 必须为 true（缺省 true） |
| `constraints.require_evidence` | 否 | 缺省 true：无有效证据的结论被剔除 |
| `task_id` | 否 | **Hub 传 runId**（`exec-run-<uuid>`，45 字符 ≤64）；同 id 幂等 |
| `request_id` | 否 | ≤128，响应回显；Hub 有则透传 |

`model` / `reasoning_effort` 不属于契约，由中台服务端配置；Hub 已不再发送。多余字段被忽略。

### 2.4 响应

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "task_id": "exec-run-...",
    "status": "succeeded",
    "summary": "存在缺料导致的延期风险",
    "conclusions": [
      {
        "matter": "关键物料尚未齐套",
        "evidence_refs": ["control-platform://kitting/result/HJY20260903-261:1"],
        "risk": "预计影响交付3天",
        "recommendation": "建议采购负责人核实到货承诺，需人工确认",
        "confidence": "high"
      }
    ],
    "dropped_conclusions": 0,
    "evidence_refs": ["control-platform://order/HJY20260903-261/line/1"],
    "data_as_of": "2026-10-26T14:30:00+08:00",
    "data_confidence": "high",
    "stale": false,
    "warnings": [],
    "llm": { "called": true, "provider": "openai", "model": "deepseek-flash", "latency_ms": 4200 },
    "usage": { "modelId": "deepseek-flash", "tokensIn": 1234, "cachedTokens": 0, "tokensOut": 456 },
    "duration_ms": 5300,
    "idempotent_replay": false,
    "request_id": "req-abc"
  }
}
```

- `code=0` 时 `data` 即 `run_complete.result`；
- `conclusions` 可能为空（全部被证据校验剔除），看 `dropped_conclusions` 与 `warnings`，**不得解释为“无风险”**；
- `data_as_of` 为 ISO 8601，带 `+08:00`；≤6h high、≤24h medium、>24h low + `STALE_DATA`。

### 2.5 错误码

| 层 | 返回 | 含义 | Hub 映射 |
|---|---|---|---|
| HTTP | 401 | 缺认证头 | `UPSTREAM_AUTH_FAILED` |
| HTTP | 403 | 签名错 / 未授权 endpoint / IP | `FORBIDDEN` |
| HTTP | 422 | 参数校验失败 | `INVALID_ARGUMENT` |
| HTTP | 429 | 频率或并发超限（带 `Retry-After`） | `RATE_LIMITED` |
| 信封 | 400 | `INVALID_REQUEST` | `INVALID_ARGUMENT` |
| 信封 | 404 | `EMPTY_RESULT` / `NOT_FOUND`（不代表无风险） | `NOT_FOUND` |
| 信封 | 409 | `TASK_IN_PROGRESS` | `TASK_IN_PROGRESS` |
| 信封 | 490 | `TASK_CANCELLED` | `TASK_CANCELLED` |
| 信封 | 503 | 大模型未配置 / 调用失败 | `UPSTREAM_UNAVAILABLE` |
| 信封 | 504 | 服务端推理超时（170s） | `UPSTREAM_TIMEOUT` |
| 信封 | 500 | 服务端内部错误 | `INTERNAL_ERROR` |

注意：`400/404/409/490/503/504/500` 是 **HTTP 200 + 信封 code**。

### 2.6 取消

- Hub 召回或超时时：先 Abort 本地请求，**同时** `POST /tasks/{task_id}/cancel`（HMAC，`reasoning.cancel`）；
- cancel 是尽力而为，失败不覆盖主流程；
- 只 Abort 本地请求不会终止中台服务端任务。

---

## 三、Hub 侧实现（已完成）

`aeos-execution-agent/src/adapters/reasoning-adapter.js`：

| 改造 | 实现 |
|---|---|
| HMAC 三头 | 有 `app_key/app_secret` 时自动签名；无则回退 Bearer（仅兼容非中台上游） |
| `task_id` | 取 `ctx.runId`；`request_id` 有则透传 |
| 信封解包 | `code=0` 取 `data`；非 0 按错误码表抛错；兼容裸结果 |
| 取消 | `ctx.signal` 中止或超时时调用 cancel 端点，独立 5s 超时 |
| 空结论 | 返回空 `conclusions`、`data_confidence: low`，附“不代表无风险”校验说明，不抛错 |
| usage | 从 `data.usage` 提取并随 `run_complete` 回传，Hub 缺成本时按目录补算 |
| 元信息 | 通过 `ctx.onUpstreamMeta` 暴露 `llm.called` / `duration_ms` / `idempotent_replay` / `stale` |
| 模型 | 请求不再携带 `model` / `reasoning_effort`，由中台服务端配置 |

配置项：

```dotenv
TARGET_REASONING_URL=<中台 analyze 地址>
TARGET_REASONING_APP_KEY=<中台发放>
TARGET_REASONING_APP_SECRET=<中台发放>
TARGET_REASONING_TIMEOUT_MS=180000
```

`TARGET_REASONING_TOKEN` 仅保留给非中台上游；`TARGET_REASONING_MODEL/EFFORT` 保留兼容但不再发送。

---

## 四、验收标准

| # | 标准 | 验证方式 | Hub 侧状态 |
|---|---|---|---|
| 1 | 结果含 `conclusions` / `evidence_refs` / `data_as_of`，`data_confidence` 非 low | `npm run reasoning:check` | 已实现 |
| 2 | 无 `evidence_refs` 的结论被标记低置信度 | 单测 + 自检 | 已实现 |
| 3 | Hub 召回时中台任务被真正中止 | 单测（cancel 请求）+ 中台审计 `cancelled` | 已实现 |
| 4 | 超时/失败/上游不可用分别返回明确错误 | 单测（403/429/信封 404/409/490/503/504） | 已实现 |
| 5 | 中台日志能证明实际调用大模型 | 自检检查 `llm.called=true` + 审计 `llm_called=1` | 已实现 |
| 6 | 用量台账出现 Token/成本 | 自检展示 usage；Hub 台账记 `reported` | 已实现 |
| 7 | 执行步骤时间线出现模型调用过程 | 中台 Sidecar 场景；Hub 直连模式暂为部分 | 部分 |

### 2026-10-26 UAT 自检实测

- **5/5 通过**：订单交付 20.3s、齐套缺口 32.7s、质量异常 9.3s、生产协同 30.7s、不存在订单 1.0s；
- 每个用例 5–6 条结论，全部带 `evidence_refs`；`data_confidence=high`，`data_as_of=2026-10-26T13:21:53+08:00`；
- `llm.called=true`，模型 `deepseek-flash`，`usage` 正常返回（如订单用例 in=5540 / cached=384 / out=3495）；
- 不存在订单返回信封 `404`，明确“不代表无风险”；
- **页面端到端（13:28）**：Hub 执行面提问 → 路由 `gateway-control-platform` → 中台 UAT；run `exec-run-f05288cc-…`，6 条结论、`data_confidence=high`、25.2s；用量台账 `reported`，`deepseek-flash` in=5533 / cached=384 / out=4445，Hub 补算成本 ¥0.0229；
- **最高风险编排（13:41）**：查询 run 0.28s → 推理 run 21.6s，同网关先查后推，6 条结论、high，成本 ¥0.0198；
- **借调闭环（13:44）**：`borrow-8f21bcff-…` 由 `aeos-hub` 发起 → `control-platform`，29.3s 完成，6 条结论、high；用量台账带 `consumerSystemId=aeos-hub` + `borrowOrderId`，成本 ¥0.0254；evidence 的 created/dispatched/completed 均带 runId；
- **观察**：质量用例中，中台证据集未包含检验记录/不良率等质量数据，模型明确说明证据不足而非编造；建议中台补该订单的质量证据覆盖。

---

## 五、联调步骤

1. 中台创建推理专用 API Key（勾选 3 个 endpoint），安全渠道交付 `app_key/app_secret`；
2. 中台配置真实大模型（`REASONING_MODEL=deepseek-flash`）并放行 18085；
3. Hub 侧写入 `TARGET_REASONING_*`，重启网关（守护任务自动拉起）；
4. `cd aeos-execution-agent && npm run reasoning:check`，按项核对，失败项用 `--json` 回传；
5. 登录 Hub → 执行面问分析类问题 → 确认页面出现结论与 evidence_refs；
6. 双方核对：`task_id` 等于 Hub `runId`、`llm.called=true`、召回时中台审计为 `cancelled`。

---

## 六、待确认

1. ~~UAT 最终地址~~：已提供 `http://192.168.0.178:8000/api/v1/external/reasoning/analyze`，与生产共用同一套 `app_key/app_secret`；**当前从 Hub 主机访问 8000 端口超时，待中台确认服务与防火墙**；
2. 生产 18085 放行时间（当前从 Hub 主机访问超时）；
3. `app_key/app_secret` 交付方式与生效时间；
4. 试点期是否启用 IP 白名单（Hub 建议先不启用，仅用 app_key + 默认 100 次/分钟限流）；
5. 联调窗口（日期/时间段）。

---

## 七、配套文档

- 对接待办一页版：`docs/control-platform-open-items.md`
- 对中台确认稿：`docs/control-platform-reasoning-reply-confirmation.md`
- 联调自检与验收集：`docs/reasoning-acceptance-cases.md`
- 执行面通信协议：`docs/execution-plane-agent-contract.md`
- 执行步骤上报（可选）：`docs/execution-step-events.md`
- 适配器实现：`aeos-execution-agent/src/adapters/reasoning-adapter.js`
