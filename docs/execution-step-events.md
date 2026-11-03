# 执行步骤事件协议（run_event）

> 版本：1.0（2026-10-19）  
> 适用：接入 AEOS Hub 执行面的系统（如公司中控平台），希望把内部执行步骤回传给 Hub。  
> 传输：复用现有 `/execution-agent` WebSocket 连接，不新增端口。

## 1. 一句话

在现有 `register / heartbeat / run_update / run_complete / run_failed` 之外，新增一种消息 `run_event`：执行方每完成一个内部环节，就发一条"工序回执"。

## 2. 消息格式

```json
{
  "type": "run_event",
  "runId": "exec-run-xxxx",
  "eventId": "evt-0007",
  "seq": 7,
  "event": "step_completed",
  "name": "查询订单列表",
  "status": "completed",
  "startedAt": "2026-10-19T05:30:00.120Z",
  "endedAt": "2026-10-19T05:30:00.300Z",
  "durationMs": 180,
  "summary": "订单接口返回 20 条，共 3253 条",
  "detail": { "path": "/external/orders/list", "page": 1, "pageSize": 20 },
  "evidenceRefs": []
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `type` | 是 | 固定为 `run_event` |
| `runId` | 是 | Hub 派单时给出的编号，必须原样带回 |
| `eventId` | 是 | 全局唯一；重复发送时 Hub 按它去重 |
| `seq` | 否 | 同一次任务内的顺序号，建议从 1 递增 |
| `event` | 是 | 见下方事件类型 |
| `name` | 否 | 步骤/工具名称，最长 100 字符 |
| `status` | 否 | `started` / `completed` / `failed` / `info`，默认 `info` |
| `startedAt` / `endedAt` | 否 | ISO 时间字符串 |
| `durationMs` | 否 | 耗时（毫秒） |
| `summary` | 否 | 给人看的摘要，最长 500 字符 |
| `detail` | 否 | 结构化详情，序列化后最大 8 KB；超出会被截断并标记 |
| `evidenceRefs` | 否 | 最多 20 条证据引用 |

### 事件类型

| 值 | 含义 |
|---|---|
| `run_received` | 收到 Hub 任务 |
| `step_started` | 开始一个内部步骤 |
| `step_completed` | 完成一个内部步骤 |
| `tool_call` | 调用内部工具/接口 |
| `tool_result` | 工具/接口返回 |
| `model_call` | 调用内部大模型 |
| `error` | 某一步失败（任务可能继续） |
| `note` | 备注 |
| `run_summary` | 任务总结 |

## 3. Hub 回执

Hub 收到后会回：

```json
{
  "type": "run_event_ack",
  "runId": "exec-run-xxxx",
  "eventId": "evt-0007",
  "accepted": true,
  "duplicate": false
}
```

拒绝时：

```json
{
  "type": "run_event_ack",
  "runId": "exec-run-xxxx",
  "eventId": "evt-0007",
  "accepted": false,
  "reason": "RUN_EVENT_LIMIT_EXCEEDED"
}
```

常见拒绝原因：

| reason | 含义 |
|---|---|
| `AGENT_NOT_REGISTERED` | 连接尚未完成 register |
| `EVENT_ID_AND_RUN_ID_REQUIRED` | 缺少 eventId 或 runId |
| `RUN_NOT_FOUND` | Hub 找不到这个 runId |
| `RUN_OWNERSHIP_MISMATCH` | 这个 run 不属于当前 Agent |
| `RUN_EVENT_LIMIT_EXCEEDED` | 单次任务超过 200 条 |
| `INVALID_EVENT: ...` | 字段不合法 |
| `STORE_WRITE_FAILED: ...` | Hub 存储失败 |

Hub 回执失败不会影响任务本身；执行方可以记录后继续。

## 4. 建议的上报顺序

```text
run_received        收到任务
step_started        开始查询 A 接口
step_completed      查询 A 完成（耗时、条数）
step_started        开始查询 B 接口
step_completed      查询 B 完成
run_summary         本次任务总结
run_complete        原有完成消息（不变）
```

失败时：

```text
error               哪一步失败、错误码、原因
run_summary         任务失败总结
run_failed          原有失败消息（不变）
```

## 5. 约束与安全

- 每条 `detail` 序列化后不超过 **8 KB**；超出会截断为 `{truncated:true,bytes,preview}`；
- 单次任务最多 **200 条**回执；
- Hub 以 WebSocket 连接身份为准，不信任消息里自报的系统名；
- 不要上报令牌、密码、连接串、完整业务数据；建议只传参数、条数、耗时、摘要；
- Hub 默认保留执行事件 **30 天**，文件超过 20 MB 自动归档。

## 6. 参考实现（Node.js / ws）

```js
const runSeq = new Map();

function reportRunEvent(ws, runId, event, name, status, summary, detail = null, timings = {}) {
  const seq = (runSeq.get(runId) ?? 0) + 1;
  runSeq.set(runId, seq);
  ws.send(JSON.stringify({
    type: 'run_event',
    runId,
    eventId: `evt-${runId}-${seq}`,
    seq,
    event,
    name,
    status,
    summary,
    detail,
    startedAt: timings.startedAt ?? null,
    endedAt: timings.endedAt ?? null,
    durationMs: timings.durationMs ?? null,
  }));
}
```

在收到 `dispatch` 后：

```js
reportRunEvent(ws, runId, 'run_received', '收到任务', 'info', `path=${path}`);
const startedAt = new Date().toISOString();
reportRunEvent(ws, runId, 'step_started', '查询中台接口', 'started', path, { path }, { startedAt });
const data = await query(path, params);
const endedAt = new Date().toISOString();
reportRunEvent(ws, runId, 'step_completed', '查询中台接口', 'completed', `返回 ${data.items?.length ?? 0} 条`, { path }, {
  startedAt,
  endedAt,
  durationMs: new Date(endedAt).getTime() - new Date(startedAt).getTime(),
});
reportRunEvent(ws, runId, 'run_summary', '任务完成', 'completed', `查询 ${path} 完成`);
ws.send(JSON.stringify({ type: 'run_complete', runId, result: data }));
```

完整参考实现见 `scripts/execution-plane-simulator.mjs`。

## 7. 兼容性

- 不上报 `run_event` 的旧 Agent：完全不受影响；
- 先升级 Hub，再让执行方开始上报；
- 断线重连后可以按原 `eventId` 重发，Hub 会去重；
- 不需要停机，不需要改现有派单/完成协议。

## 8. 在 Hub 里看什么

- 「执行面仪表盘」：任务完成后出现「查看执行步骤」，展开是时间线；
- 「跨系统借调」详情：结果下方有「执行步骤」区域，可刷新；
- 原始数据：`data/execution-events.jsonl`；
- 读取 API：`GET /api/execution/runs/:runId/events?limit=200`（登录后）。
