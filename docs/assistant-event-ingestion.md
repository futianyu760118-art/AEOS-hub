# 中台助手观测上报协议（assistant-events）

> 版本：1.0（2026-10-19）  
> 适用：中台自有智能助手（`backend/app/api/v1/assistant` + `services/assistant`）希望把会话与工具调用摘要留痕到 AEOS Hub。  
> 注意：这条链路**不经过 Hub 派单**，没有 `runId`；与 `run_event` 是两套协议。

## 1. 传输与鉴权

- HTTP：`POST /api/system/assistant-events`
- 鉴权：P2 的每系统 HMAC 令牌
  ```
  x-aeos-system-id: <systemId>
  x-aeos-system-token: HMAC-SHA256(EXECUTION_PLANE_TOKEN, "aeos-system-token:<systemId>")
  ```
- 非 ASCII 系统 ID 需先 `encodeURIComponent` 再放进请求头。

## 2. 上报内容

| 字段 | 必填 | 说明 |
|---|---|---|
| `eventId` | 是 | 全局唯一；重复发送按 `systemId + eventId` 去重 |
| `traceId` | 是 | 中台自己的会话/请求 ID，用于把一次对话串起来 |
| `event` | 是 | 见下方事件类型 |
| `name` | 否 | 工具名/环节名，≤100 字 |
| `status` | 否 | `started` / `completed` / `failed` / `info`，默认 `info` |
| `summary` | 否 | 一句话摘要，≤500 字；**不要放完整问答原文** |
| `detail` | 否 | 结构化摘要（工具参数、条数、耗时等），≤8 KB；超出截断 |
| `startedAt` / `endedAt` | 否 | ISO 时间 |
| `durationMs` | 否 | 毫秒 |
| `usage` | 否 | 模型用量：`{ modelId, tokensIn, cachedTokens, tokensOut, cost }`；`cost` 可空，Hub 会按模型目录补算 |

> **用量必须填真实值**：`tokensIn` / `tokensOut` 两项都为 0 时，Hub 视为"未上报"，不会写入用量台账；请从大模型返回的 usage 字段中取值。

### 事件类型

| 值 | 含义 |
|---|---|
| `conversation_started` | 会话开始 |
| `message` | 用户发了一条消息（summary 写"用户询问…"，不写原文） |
| `tool_call` | 助手调用内部工具/接口 |
| `tool_result` | 工具/接口返回 |
| `model_call` | 调用大模型 |
| `assistant_reply` | 助手给出回复（summary 写摘要） |
| `error` | 某一步失败 |
| `conversation_ended` | 会话结束 |
| `note` | 备注 |

### 示例

```json
{
  "eventId": "cp-assistant-20261019-0001",
  "traceId": "chat-session-8891",
  "event": "assistant_reply",
  "name": "库存问答",
  "status": "completed",
  "summary": "用户询问 JFX27 可用库存，助手返回 3 个物料的可用量摘要",
  "startedAt": "2026-10-19T06:10:00.000Z",
  "endedAt": "2026-10-19T06:10:02.400Z",
  "durationMs": 2400,
  "detail": { "tools": ["inventory_availability"], "items": 3 },
  "usage": { "modelId": "deepseek-flash", "tokensIn": 1200, "cachedTokens": 800, "tokensOut": 180 }
}
```

## 3. 响应

首次写入：

```json
{ "accepted": true, "duplicate": false, "eventId": "cp-assistant-20261019-0001", "committed": true }
```

重复发送：HTTP 200，`duplicate: true`。  
拒绝：HTTP 400/429，`{ "error": "<reason>", "code": "INVALID_EVENT" }`。

| reason | 含义 |
|---|---|
| `EVENT_ID_AND_TRACE_ID_REQUIRED` | 缺少 eventId 或 traceId |
| `TRACE_EVENT_LIMIT_EXCEEDED` | 单个会话超过 200 条 |
| `INVALID_EVENT: ...` | 字段不合法 |
| `STORE_WRITE_FAILED: ...` | Hub 存储异常 |

鉴权失败返回 401 `AUTH_REQUIRED`。

## 4. 读取

系统查询自己的记录：

```
GET /api/system/assistant-events?traceId=&limit=200
```

返回 `{ events, traces, count }`。浏览器端另有只读页面「助手观测」。

## 5. 中台最小改造

在助手后端的关键位置加一次 HTTP POST：

| 位置 | 建议事件 |
|---|---|
| 会话开始 | `conversation_started` |
| 收到用户消息 | `message`（只写摘要） |
| 每次工具/接口调用前/后 | `tool_call` / `tool_result` |
| 调用大模型后 | `model_call`（带 usage） |
| 生成回复后 | `assistant_reply`（只写摘要） |
| 异常 | `error` |
| 会话结束 | `conversation_ended` |

建议封装一个 `reportAssistantEvent(traceId, event, name, status, summary, detail, usage)`，内部失败只记日志，不影响助手主流程。

## 6. 约束与隐私

- **只存元数据与摘要**：不要求、也不建议上报完整问答原文；
- 每条 `detail` ≤8 KB，单会话 ≤200 条；
- 单文件 20 MB 自动归档，默认保留 30 天；
- Hub 以令牌的 `systemId` 为归属，不信任消息里自报的系统名；
- 上报失败不影响中台助手本身。

## 7. 与 run_event 的区别

| | run_event | assistant-events |
|---|---|---|
| 触发 | Hub 通过 WS 派单给执行面 Agent | 中台助手后端主动 HTTP 上报 |
| 是否有 runId | 有 | 无，用 `traceId` |
| 传输 | 现有 `/execution-agent` WS | HTTP `/api/system/assistant-events` |
| 适用 | Hub 发起的跨系统任务 | 中台自己的助手聊天 |
