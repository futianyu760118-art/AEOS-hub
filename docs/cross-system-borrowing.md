# 跨系统借调（P3）API 契约

> 状态：已实现（2026-10-19）  
> 相关代码：`src/borrow-order-store.ts`、`src/borrow-order-service.ts`、`src/borrow-order-api.ts`

## 1. 概述

跨系统借调让系统 A 的 Agent 通过 Hub 借用系统 B 的只读能力。Hub 是唯一中介：

```
请求方系统 → Hub（能力目录 + 借调单 + 派单 + 记账）→ 提供方执行面 Agent
```

- 只读：只有 `constraints.readOnly === true` 的能力可被借调；
- 异步：创建后立即派单，请求方轮询结果；
- 可审计：创建、派单、运行、完成、失败、对账都会写 Evidence；
- 计费：执行方记录真实用量，请求方作为 `consumerSystemId` 归属。

## 2. 身份

所有 `/api/system/borrow-orders*` 请求使用 P2 的每系统 HMAC 令牌：

```
x-aeos-system-id: <systemId>
x-aeos-system-token: HMAC-SHA256(EXECUTION_PLANE_TOKEN, "aeos-system-token:<systemId>")
```

生成令牌：

```bash
node scripts/mint-system-token.ts erp
```

> 系统 ID 含非 ASCII 字符（如「公司中控平台（本机演示）」）时，HTTP 头必须使用 `encodeURIComponent` 后的值；Hub 会先解码再校验令牌。ASCII 系统 ID 不受影响。

`fromSystem` 只取自已验证的 `x-aeos-system-id`；请求体里出现 `fromSystem`、`tenantId`、`tenant` 会被拒绝。

## 3. 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/system/borrow-orders` | 创建借调单并立即派单 |
| GET | `/api/system/borrow-orders` | 列表；`direction=outgoing|incoming|all`、`status=`、`limit=` |
| GET | `/api/system/borrow-orders/capabilities` | 只读能力目录（排除本系统） |
| GET | `/api/system/borrow-orders/:orderId` | 详情；仅发起方或提供方可看 |

浏览器只读监控（cookie 登录）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/borrow-orders` | 摘要列表 + 状态计数 |
| GET | `/api/borrow-orders/:orderId` | 完整详情（含输入/结果） |

### 3.1 创建请求

```json
{
  "requestId": "purchase-20261019-0001",
  "capability": "query_control_platform",
  "input": { "path": "/external/orders/list", "params": { "page": 1, "page_size": 5 } },
  "toSystem": "公司中控平台（本机演示）",
  "toAgent": "runtime-control-platform-agent",
  "fromAgentId": "purchase-assistant"
}
```

- `requestId`：必填，请求方生成的幂等键，同一系统内唯一；
- `capability`：必填；
- `input`：可选，JSON 对象，最大 64 KiB；
- `toSystem` / `toAgent`：可选；指定则只在指定范围解析，不允许回退；
- `fromAgentId`：可选，仅作展示与计费归属，不参与鉴权。

成功：`201`（首次）/ `200`（幂等重放，`idempotent: true`）：

```json
{
  "order": { "orderId": "borrow-...", "status": "dispatched", "runId": "exec-run-...", "...": "..." },
  "dispatch": { "runId": "exec-run-...", "state": "dispatched" },
  "idempotent": false,
  "committed": true,
  "auditStatus": "recorded"
}
```

### 3.2 目标解析

1. 能力不存在 → `CAPABILITY_NOT_FOUND`；
2. 能力存在但无人声明只读 → `NO_PROVIDER`；
3. `toSystem === fromSystem` 或指定本系统 Agent → `SELF_BORROW_FORBIDDEN`；
4. 候选必须：在线、未注销、声明该能力且 `readOnly=true`、`sourceSystem !== fromSystem`；
5. 排序：空闲优先 → `lastSeenAt` 降序 → `registeredAt` 升序 → `agentId` 升序；
6. 指定目标不可用 → `TARGET_NOT_ELIGIBLE`，附 `reasons`（`offline`/`deregistered`/`capability_missing`/`not_read_only`/`same_system`/`target_system_mismatch`）。

### 3.3 状态机

```
pending → dispatched → running → completed
   │           │          │
   └───────────┴──────────┴──→ failed
                              cancelled（提供方召回）
```

- 执行态映射：`running→running`、`completed→completed`、`failed→failed`、`recalled→cancelled`；
- 终态不可回退；
- 提供方断线 → `failed / PROVIDER_DISCONNECTED`；
- Hub 重启时仍在途的任务无法续跑，对账后标记失败（见 §6）。

## 4. 错误码

| HTTP | code | 含义 |
|---|---|---|
| 400 | `INVALID_ARGUMENT` | 参数/字段/状态值非法 |
| 401 | `AUTH_REQUIRED` | 令牌缺失或不匹配 |
| 403 | `SELF_BORROW_FORBIDDEN` | 向本系统借调 |
| 403 | `WRITE_FORBIDDEN` | 能力非只读 |
| 404 | `CAPABILITY_NOT_FOUND` | 无人声明该能力 |
| 404 | `ORDER_NOT_FOUND` | 借调单不存在或无权查看 |
| 409 | `REQUEST_CONFLICT` | 同一 requestId 对应不同内容 |
| 409 | `NO_PROVIDER` | 无其他系统在线只读提供方 |
| 409 | `TARGET_NOT_ELIGIBLE` | 指定目标不可用 |
| 409 | `DISPATCH_AGENT_OFFLINE` | 派单瞬间提供方离线 |
| 409 | `DISPATCH_CAPABILITY_UNSUPPORTED` | 派单瞬间能力发生变化 |
| 413 | `PAYLOAD_TOO_LARGE` | 输入超过 64 KiB |
| 429 | `TOO_MANY_OPEN_ORDERS` | 未完成借调单达到每系统上限（50） |
| 502 | `DISPATCH_FAILED` | 派单失败 |
| 503 | `NOT_CONFIGURED` | 未配置根令牌 |

## 5. 计费归属

一次借调对应一条 `usage_event`：

- `agentId` / `systemId`：执行方 Agent 与系统；
- `consumerSystemId`：请求方系统（来自令牌）；
- `consumerAgentId`：请求方声明的 Agent；
- `borrowOrderId`：借调单号；
- `metering`：`reported`（提供方上报）或 `missing`（未上报，成本按 0 记但明确标注）。

`GET /api/usage/summary` 新增 `byConsumerSystem` 聚合；旧账本自动兼容为 `null`。

## 6. 重启与对账

Hub 启动时对非终态借调单执行对账：

| 情况 | 结果 |
|---|---|
| 没有 runId | `failed / INTERRUPTED_BEFORE_DISPATCH` |
| runId 查不到 | `failed / ORPHANED_RUN_NOT_FOUND` |
| run 已完成/失败/召回 | 同步为对应终态 |
| run 仍在 dispatched/running | `failed / ORPHANED_AFTER_RESTART` |

执行面协议不支持续跑；请求方应使用新的 `requestId` 重新发起。

## 7. 限制（试点期）

- `sourceSystem` 由执行面自报（共享根令牌），自借调排除是协作式约束；
- 系统令牌不带租户，借调单统一归 Hub 配置租户（`AEOS_TENANT_ID || pilot-default`）；
- 浏览器视图对所有已登录运营角色可见；
- 本期不做：提供方审批、回调推送、TTL 自动过期、失败重试、取消端点、链式借调、跨系统写入。

## 8. 快速验证

```bash
# 1. 请求方令牌
ERP_TOKEN=$(node scripts/mint-system-token.ts erp)

# 2. 确保提供方在线（示例：中台模拟器）
#    scripts/execution-plane-simulator.mjs

# 3. 创建借调单
curl -sS -X POST http://127.0.0.1:8790/api/system/borrow-orders \
  -H 'content-type: application/json' \
  -H 'x-aeos-system-id: erp' \
  -H "x-aeos-system-token: $ERP_TOKEN" \
  -d '{
    "requestId": "e2e-borrow-001",
    "capability": "query_control_platform",
    "input": { "path": "/external/orders/list", "params": { "page": 1, "page_size": 5 } },
    "fromAgentId": "purchase-assistant"
  }'

# 4. 轮询详情
curl -sS http://127.0.0.1:8790/api/system/borrow-orders/<orderId> \
  -H 'x-aeos-system-id: erp' \
  -H "x-aeos-system-token: $ERP_TOKEN"
```
