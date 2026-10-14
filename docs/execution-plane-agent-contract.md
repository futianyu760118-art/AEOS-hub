# 执行面智能体接入契约（交接文档）

本文档给**执行面团队**：执行面（目标系统里的查询智能体）要接入管理面（AEOS Hub），
必须满足本契约。满足后，管理面就能像遥控器下发查询任务、像仪表盘看到执行面心跳与状态、并能召回它。

本文档分两段：

- **A 通用传输协议**（§1–§3、§5–§7）：所有执行面智能体**一律遵守**，接入新智能体无需改动。
- **B 能力注册表**（§4）：每个智能体对外提供的能力在此声明；**接新智能体 = 新增一条能力定义**，其余不动。

## 1. 目标与形态

- 执行面智能体 = **可迁移、可召回、每步都汇报的确定性工作单元**（本阶段是「简单查询智能体」）。
- 运行形态：独立进程/容器，**反向连接**管理面（执行面主动连管理面），穿透 NAT/防火墙，目标系统无需暴露端口。
- 管理面地址与端口由部署方给出：控制通道默认 `ws://<hub-host>:8788/execution-agent`（独立控制端口，与浏览器界面端口 8787 分开）。

## 2. 通信与鉴权

| 项 | 值 |
|---|---|
| 传输 | WebSocket，JSON 文本帧 |
| 路径 | `/execution-agent`（控制端口默认 8788） |
| 鉴权 | 连接握手时带请求头 `x-aeos-execution-token: <token>`；token 由管理面下发（环境变量 `EXECUTION_PLANE_TOKEN`）。**未配置或不匹配，管理面直接拒绝连接**。 |
| 心跳 | 注册成功后按 `heartbeatIntervalMs`（默认 5000ms）周期发送 |

> 生产将升级为管理面签发的短时效凭证（证书/Token），本阶段为预共享 token 的最小实现。

## 3. 消息协议

### 3.1 执行面 → 管理面

| type | 字段 | 说明 |
|---|---|---|
| `register` | `agentId, name, version, protocolVersion, sourceSystem, capabilities:[{name,description,version?,inputSchemaVersion?,outputSchemaVersion?}]` | 连接建立后立即发送；`sourceSystem` 为来源业务系统名称，`capabilities` 非空；`protocolVersion` 当前支持 `1.0` |
| `heartbeat` | `status(idle/working/error), currentRunId?` | 周期心跳 |
| `run_update` | `runId, state:'running'` | 开始执行时的进度上报（可选） |
| `run_complete` | `runId, result` | 查询成功，`result` 为结构化结果 |
| `run_failed` | `runId, error:{code,message}` | 查询失败 |

`sourceSystem` 是每个新接入智能体的必填身份信息（最长 160 字符），例如“公司中控平台”或“供应链系统”。
“本机 / 远程”不由执行面上报：管理面根据控制通道的回环地址自动判定并展示，防止客户端伪造身份。
`protocolVersion` 当前仅支持 `1.0`；执行面上报不兼容版本时，管理面会拒绝注册并返回明确错误（`PROTOCOL_VERSION_UNSUPPORTED`），不会静默失败。

### 3.2 管理面 → 执行面

| type | 字段 | 说明 |
|---|---|---|
| `registered` | `agentId, heartbeatIntervalMs` | 注册确认，收到后开始心跳 |
| `dispatch` | `runId, capability, input` | 下发查询或推理任务（`capability` 决定 `input` 结构） |
| `recall` | `runId?` | 停止当前任务；执行面应中止执行，**无需再回报结果**（管理面已标记 recalled） |
| `error` | `message` | 协议错误 |

## 4. 能力注册表（扩展点）

管理面通过 `register.capabilities` 与 `dispatch.capability` 识别能力。每条能力契约包含：

| 字段 | 说明 |
|---|---|
| `name` | 能力标识（如 `query_control_platform`） |
| `input` | `dispatch.input` 结构，由管理面从 G1 任务自动推导 |
| `output` | `run_complete.result` 结构，由执行面回传 |

**接新智能体 = 新增一条能力定义**（执行面在 `register.capabilities` 声明新能力 + 管理面注册一个新解析器），
通用传输协议（§1–§3、§5–§7）不动。下面 §4.1–§4.5 是当前唯一内置能力 `query_control_platform` 的完整契约。

- 能力名：`query_control_platform`（中台只读查询）。
- `input` 结构：`{ path: string, params: object }`，其中 `path` 必须是下表白名单之一。
- `output`：中台统一信封的 `data` 字段（结构化查询结果）。
- 执行面据此调用**目标系统（公司中控）只读上游接口**并回传结果。

### 4.1 签名（HMAC-SHA256）

- 待签名串 = `timestamp + app_key + endpoint_code + query_string`（字符串直接拼接）。
- `signature = HMAC-SHA256(app_secret, 待签名串)` 的 hex。
- `timestamp` 为 Unix 秒；`query_string` 为 URL 编码后的查询串（与请求 URL 中的原始 query string 一致，空格用 `+`）。
- 请求头：`X-App-Key`、`X-Timestamp`、`X-Signature`。
- 认证优先级：HMAC API Key → 静态 Bearer TOKEN → OAuth2 client_credentials（本阶段用 HMAC）。

### 4.2 端点白名单（path → endpoint_code）

| path | endpoint_code |
|---|---|
| `/common/ping` | `int:health.ping` |
| `/external/orders/list` | `orders.list` |
| `/external/order-details/list` | `order_details.list` |
| `/external/boms/tree` | `boms.tree` |
| `/external/materials/list` | `materials.list` |
| `/external/suppliers/list` | `suppliers.list` |
| `/external/material-kitting/results` | `kitting.results` |
| `/external/material-kitting/shortages` | `kitting.shortages` |
| `/external/material-kitting/demands` | `kitting.demands` |
| `/external/inventory/availability` | `inventory.availability` |
| `/external/material-supplies/list` | `material.supplies` |
| `/external/quality-issues/list` | `quality_issues.list` |
| `/external/quality-trace/list` | `quality_trace.list` |
| `/external/production/work-orders/list` | `production.work_orders.list` |
| `/external/production/operations/list` | `production.operations.list` |
| `/external/production/order-links/list` | `production.order_links.list` |
| `/external/production/reports/list` | `production.reports.list` |
| `/external/production/capacity/list` | `production.capacity.list` |

### 4.3 响应信封

统一信封 `{ code, message, data }`：`code == 0` 成功，回传 `data`；否则视为失败，`run_failed` 携带错误码。
错误码（§12）：`INVALID_ARGUMENT / UNAUTHORIZED / FORBIDDEN / NOT_FOUND / RATE_LIMITED / UPSTREAM_TIMEOUT / UPSTREAM_UNAVAILABLE / INTERNAL_ERROR`。

### 4.4 权威参考实现

- 签名 + 端点 + 信封：`mcp-company-control/mcp_server/upstream_client.py`（**Python 为权威参考**）。
- 最小查询调用示例：`scripts/company-control-query.py`（复用上游客户端直查一个 path）。

### 4.5 G1 受控任务接入（管理面派单）

管理面把经营事项（如「物料齐套状态 BLOCKED」）建成 G1 受控任务并分派给执行面 Agent 后，
`dispatch.input` 由管理面从任务的 `businessObjectRef` **自动推导**，执行面无需关心推导逻辑：

- `business://kitting/HJY20260903-261%3A18` → `{ path: "/external/material-kitting/results", params: { demand_no: "HJY20260903-261", demand_line_no: "18" } }`
- `business://order/SO-2609-001` → `{ path: "/external/orders/list", params: { keyword: "SO-2609-001" } }`

**桥接约定（重要）**：执行面 `register.agentId` 必须等于管理面 AI 港湾里对应 Runtime 的 `id`
（本试点固定为 `runtime-control-platform-agent`），否则管理面的 `resolveRuntime` 无法把任务解析到该执行面运行时。

结果回传后，管理面把任务推进到 `AWAITING_VERIFY`；运行中被 `recall` 则推进到 `AWAITING_DECISION`。

### 4.6 能力 `reason_control_platform`（中台推理）

调用中台自有大模型 / 推理智能体完成**只读**分析，返回结构化结论 + 证据 + 数据时间 + 置信度。

**`dispatch.input` 结构**：

```json
{
  "prompt": "分析订单 HJY20260903-261 的交付风险",
  "task_type": "order_delivery_analysis",
  "context": {},
  "constraints": { "read_only": true, "require_evidence": true }
}
```

- `prompt`：分析问题（由管理面从任务派生或按受控入口下发，最长 2000 字符）。
- `task_type`：任务类型（`order_delivery_analysis` / `material_kitting_analysis` / `quality_analysis` / `production_analysis` 等）。
- `constraints.read_only` 必须为 `true`；`require_evidence` 要求结论必须带证据。

**`run_complete.result` 结构**：

```json
{
  "summary": "存在缺料导致的延期风险",
  "conclusions": [
    {
      "matter": "关键物料尚未齐套",
      "evidence_refs": ["control-platform://..."],
      "risk": "预计影响交付3天",
      "recommendation": "建议采购负责人核实到货承诺，需人工确认",
      "confidence": "high"
    }
  ],
  "data_as_of": "2026-10-14T14:30:00+08:00",
  "data_confidence": "high"
}
```

**安全与校验要求**：

- 每条 `conclusion` 必须携带非空 `evidence_refs`；管理面会校验，缺失则标记 `data_confidence: "low"` 并附加 `validation_note`。
- `STALE_DATA` / `UPSTREAM_UNAVAILABLE` / 空结果必须分别处理，**不得**返回“没有风险 / 没有问题”。
- 金额、承诺、质量、法律类结论必须标注需人工确认。
- 默认只读，禁止写操作；模型不得自行扩大权限或调用未授权工具。
- 中台模型回答不能直接当作业务事实，必须附证据。

> 中台推理接口契约（地址/鉴权/参数/返回/错误码/evidence 规则等）尚未提供时，执行面 `reasoning-adapter` 应返回明确的“未接通”结果，**不得伪造已联通中台大模型**。

## 5. 召回与生命周期

- `recall`（冷召回）：执行面立即中止当前查询、释放资源；管理面已把该 run 标记为 `recalled`，执行面不回报。
- 心跳超时（> 3 × 心跳间隔）管理面自动标记 `offline`，不再派单。
- 断线重连：执行面应主动重连；重连后重新 `register` 即可恢复在线。
- 后续可扩展：`pause/resume`（热召回/断点续跑），本阶段不要求。

## 6. 安全边界（执行面侧）

- 只读：`path` 白名单外一律拒绝；不直连数据库/文件系统，只走只读上游接口。
- 权限最小化：只读凭证（app_key/secret）仅能查，不能写。
- 日志：关键事件（收到派单/完成/失败/被召回）输出到 stdout/stderr，便于采集审计。
- 不盲信目标系统返回数据（信封 `code!=0` 一律按失败处理）。

## 7. 打包与部署

- 打包为容器镜像：明确入口、健康检查、日志走 stdout/stderr。
- 启动参数：`EXECUTION_WS_URL`（管理面 `/execution-agent` 地址）、`EXECUTION_PLANE_TOKEN`、`EXECUTION_AGENT_ID`（G1 接入时固定为 `runtime-execution-query`）、`EXECUTION_SOURCE_SYSTEM`（来源系统名称）、目标系统凭据。
- 网络：执行面 → 管理面出方向连接；目标系统无需暴露端口。

## 8. 最小实现骨架（参考）

管理面侧已提供可运行模拟桩 `scripts/execution-plane-simulator.mjs`（Node）与 `scripts/company-control-query.py`（Python），
二者合起来即完整演示：Node 负责 WS 协议与心跳，Python 负责 HMAC 真查中台。执行面团队可对照这两份文件实现真实智能体。

接入 G1 时：管理面启动会自动注册执行面 Agent（`scripts/ensure-execution-query-agent.ts`，幂等），
模拟器以 `EXECUTION_AGENT_ID=runtime-execution-query` 连接即可被 G1 任务分派。
