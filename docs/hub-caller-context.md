# Hub 调用方上下文（Caller Context）与 SPC 接入约定

> 日期：2026-10-26
> 场景：SPC 只对 Hub 暴露一个系统网关，内部“一人一个 Agent”由 SPC 管理；Hub 需要知道“这次调用代表哪个 SPC 用户/Agent/任务”。

---

## 一、定位

Hub 的执行面是**系统级**的：一个系统一个网关。SPC 的用户级 Agent 不直接连 Hub。

因此 Hub 只增加一层 **caller 上下文**，用于：

- 归属：这条 run / 用量 / 证据是哪个 SPC 用户或 Agent 发起的；
- 计费：按用户/Agent 分摊（在系统归属之下）；
- 链路：把 SPC 的 `task_id` / `trace_id` 与 Hub 的 `traceId` 串起来；
- 后续授权：为“按调用方鉴权”预留字段。

**actor token 不在这里**。caller 只是元数据，不含任何凭证。

## 二、字段

```json
{
  "caller": {
    "systemId": "control-platform",
    "agentId": "AG-000001",
    "userId": "10086",
    "taskId": "AT-000123",
    "traceId": "spc-trace-abc"
  }
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `systemId` | 是 | 必须等于借调的发起系统 / 派单方系统 |
| `agentId` | 否 | SPC 内部用户 Agent ID（一人一个 Agent） |
| `userId` | 否 | SPC 用户 ID；整数会被统一转成字符串 |
| `taskId` | 否 | SPC 任务 ID，用于挂回任务闭环 |
| `traceId` | 否 | SPC trace_id；建议与 Hub traceId 同值 |

## 三、信任模型（当前阶段）

- 系统令牌只证明 `systemId`；`agentId/userId/taskId/traceId` 目前是 SPC **自报**的元数据；
- Hub 会校验 `caller.systemId === fromSystem`，不一致直接 400；
- Hub 不校验 `userId/agentId` 是否存在、是否有权限；这些由 SPC 网关负责；
- **禁止**在 caller 里放 actor token、密码、签名等敏感信息；Hub 会持久化 caller；
- 下一阶段（P2）引入签名断言/actor token 后，Hub 再增加验签与按 caller 鉴权。

## 四、写入点

| 入口 | 行为 |
|---|---|
| `POST /api/system/borrow-orders` | body 可带 `caller`；保存到借调单，写入审计，派单时传给执行面 |
| 执行面 run | `run.caller` 持久化；dispatch WS 消息新增 `traceId` 与 `caller` |
| 用量台账 | 用量事件新增 `callerAgentId` / `callerUserId` |
| 链路追踪 | `borrowOrder.caller`、`run.caller`、`usage.caller*` 都可查；时间线显示发起人 |
| Hub 页面直接派单 | 自动填 `caller.systemId=aeos-hub` + `userId=当前 M01 用户` |

借调示例：

```json
POST /api/system/borrow-orders
{
  "requestId": "spc-task-123-1",
  "capability": "reason_control_platform",
  "toSystem": "control-platform",
  "caller": {
    "systemId": "aeos-hub",
    "agentId": "AG-000001",
    "userId": "10086",
    "taskId": "AT-000123",
    "traceId": "spc-trace-abc"
  },
  "input": { "prompt": "...", "task_type": "...", "context": { "businessObjectRef": "business://order/..." } }
}
```

> 注意：`caller.systemId` 必须等于令牌声明的系统。上面示例是从 `aeos-hub` 发起。

## 五、SPC 网关需要做什么

1. 每个用户请求在网关内部解析出 `agentId/userId/taskId/traceId`；
2. 调 Hub 借调/派单时带上 `caller`；
3. 收到 Hub 的 dispatch 消息时读取 `caller`/`traceId`，在 SPC 内部路由到对应用户 Agent；
4. 用户数据范围、能力校验仍在 SPC 内完成；
5. 不要把 actor token 放进 caller；token 走后续独立的透传通道。

## 六、第二阶段（未实现）

- SPC 对 Hub 签发短时 caller 断言（JWT/HMAC），Hub 验签后采信 `userId/agentId`；
- Hub 代表用户调用 SPC 时，透传 `X-Actor-Token`（opaque，不落日志、不入库）；
- Hub 授权/选路支持 caller 维度；
- 跨系统调用时由 Hub 签发/转发调用方断言，供目标系统校验。

在合同确定前，Hub 只做存储、归属与展示，不做 caller 级鉴权。

## 七、验收

1. 借调带 caller → 借调详情、run、用量、trace 都能看到同一用户/Agent；
2. `caller.systemId` 与发起系统不一致 → 400；
3. 不传 caller → 行为与之前完全一致（字段为 null）；
4. dispatch 消息包含 `traceId` 与 `caller`，SPC 网关可读取；
5. 单测：`npm run test:borrow`、`npm run test:execution`、`npm run test:trace`。
