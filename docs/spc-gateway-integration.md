# AEOS Hub 调用方上下文接入说明（SPC 网关改造）

> 致：公司中控平台（SPC-v2）团队
> 自：AEOS Hub 管理面
> 日期：2026-10-26
> 关联：《多智能体层级与主管任务闭环设计（2026-10-26）》

---

## 一、结论

Hub 已完成第一轮同步：**调用方上下文（caller）已贯通借调、执行 run、用量、审计与链路追踪**。

SPC 只需在**系统网关**做 5 处改动，不需要改 SPC 的业务模型：

- 一人一个 Agent 仍留在 SPC 内部；
- Hub 不注册、不感知 SPC 用户 Agent；
- Hub 只接收 caller 元数据，用于归属、计费与链路。

## 二、接入形态

```text
SPC 用户 → SPC 助手 → SPC 个人 Agent（内部）
                          │
                          ▼
                    SPC 系统网关  ──WS/HTTP──▶  AEOS Hub
                          │
                          └─ caller: systemId / agentId / userId / taskId / traceId
```

- SPC 对 Hub 只暴露**一个系统网关**，保持现有 Agent 注册身份；
- 用户级 Agent 由 SPC 网关内部分发，Hub 不建 per-user 执行面；
- Hub 的准入、授权、选路仍按系统/网关粒度生效。

## 三、SPC 网关需要改的 5 处

### 3.1 读取 Hub 派单消息里的 `caller` / `traceId`

Hub 的 dispatch 消息新增两个字段：

```json
{
  "type": "dispatch",
  "runId": "exec-run-...",
  "capability": "reason_control_platform",
  "input": { "prompt": "...", "task_type": "...", "context": { "businessObjectRef": "business://order/..." } },
  "traceId": "borrow-...",
  "caller": {
    "systemId": "control-platform",
    "agentId": "AG-000001",
    "userId": "10086",
    "taskId": "AT-000123",
    "traceId": "spc-trace-abc"
  }
}
```

- `caller` 可能为 `null`（系统级调用）；
- `agentId` / `userId` / `taskId` 也可能为 `null`，网关需容忍缺省。

### 3.2 在 SPC 内路由到对应用户 Agent

- 优先用 `caller.agentId`，其次 `caller.userId`；
- 两者都为空时按系统级调用处理（现有行为）；
- 找不到对应用户 Agent 时：**拒绝并审计**，不要回退到“任意 Agent”或全量数据。

### 3.3 调 Hub 借调时带上 `caller`

`POST /api/system/borrow-orders`：

```json
{
  "requestId": "spc-task-123-1",
  "capability": "query_control_platform",
  "toSystem": "control-platform",
  "caller": {
    "systemId": "control-platform",
    "agentId": "AG-000001",
    "userId": "10086",
    "taskId": "AT-000123",
    "traceId": "spc-trace-abc"
  },
  "input": { "path": "/external/orders/list", "params": { "keyword": "..." } }
}
```

约束：

- `caller.systemId` **必须等于发起系统**（令牌声明的 systemId），不一致 Hub 直接返回 400；
- caller 是元数据，不是鉴权凭证；Hub 当前不校验 `userId/agentId` 是否存在。
- 不传 caller 时行为与现在完全一致。

### 3.4 不要把 actor token 放进 `caller`

- caller 会被 Hub 持久化并展示（借调单、run、用量、trace），**禁止放 token、密码、签名**；
- actor token 属于第二阶段：由 SPC 签发短时断言，Hub 单独透传/验签，不落库、不进日志。

### 3.5 traceId 对齐

- `caller.traceId` 请填 SPC 的 `trace_id`；
- Hub 的 `traceId` 字段与它保持一致，后续跨系统链路可直接拼接；
- 没有 traceId 时 Hub 仍可用 runId / 借调单号追踪。

## 四、Hub 侧已经提供什么

| 落点 | 字段 |
|---|---|
| 借调单 | `caller`（系统/Agent/用户/任务/traceId） |
| 执行 run | `traceId`、`caller` |
| 用量台账 | `traceId`、`callerAgentId`、`callerUserId`、`consumerSystemId`、`borrowOrderId` |
| 审计 evidence | `caller`、`traceId` |
| 链路追踪 | 借调、run、用量、时间线均展示调用方 |
| Hub 页面直接派单 | 自动填 `caller.systemId=aeos-hub` + 当前登录用户 |

实测（Hub 侧）：

- 借调 `borrow-0035b128-…` 携带 `caller.userId=10086`、`agentId=AG-DEMO-1`，借调单、run、用量、trace 全部一致；
- `caller.systemId` 与发起系统不一致 → 400。

## 五、信任模型与阶段

| 阶段 | caller 的来源 | Hub 的处理 |
|---|---|---|
| 现在 | SPC 自报的元数据 | 校验 `systemId`，其余只存储与归属 |
| 第二阶段 | SPC 签名的 caller 断言（JWT/HMAC） | 验签后采信 `userId/agentId`，用于按调用方授权与计费 |
| 第二阶段 | actor token（opaque） | 单独通道透传，不落库、不进日志 |

SPC 需要准备：

1. caller 断言的签名字段、算法、有效期（建议 ≤5 分钟）；
2. actor token 的签发方、接收方、透传方式；
3. 用户 Agent 的 ID 规则（`agentId` 与 `userId` 的映射）。

## 六、验收清单

1. 借调带 caller → 借调单、run、用量、trace 显示同一 `userId/agentId/taskId/traceId`；
2. `caller.systemId` 与发起系统不一致 → 400；
3. 不传 caller → 行为与之前一致；
4. SPC 网关能读取 dispatch 消息中的 `caller` / `traceId`，并路由到对应用户 Agent；
5. traceId 与 SPC `trace_id` 一致；
6. 网关找不到用户 Agent 时拒绝并审计，不回退全量。

## 七、身份与配置（重要）

如果 SPC 网关使用**新的 Agent ID**（替换现有 `gateway-control-platform`），需要同步 Hub 三张配置：

| 配置 | 作用 |
|---|---|
| `config/execution-agent-allowlist.json` | 准入：允许哪个 Agent ID 注册 |
| `config/execution-agent-permissions.json` | 授权：该 Agent 可调用哪些能力 |
| `config/execution-routing-policy.json` | 选路：优先派给哪个 Agent |

能力名请保持稳定：

- `query_control_platform`
- `reason_control_platform`

## 八、下一步

1. SPC 确认网关 Agent ID 与部署形态（沿用一个系统网关）；
2. SPC 确认 actor token / caller 断言的合同；
3. 双方联调：一笔带 caller 的借调 + 一次页面查询；
4. 再进行第二阶段的验签、token 透传与按调用方授权。

---

AEOS Hub 管理面 · 2026-10-26
