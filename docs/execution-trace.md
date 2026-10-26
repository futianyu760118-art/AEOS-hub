# 执行链路追踪（Trace）

> 日期：2026-10-26
> 目的：把借调单、执行 run、用量与审计按同一组标识串成一条可查询链路
> 页面：Hub → 执行面 → 链路追踪

---

## 一、能追什么

输入任意一个标识即可：

| 标识 | 例子 | 能带出 |
|---|---|---|
| 借调单号 | `borrow-8f21bcff-…` | 借调单、执行 run、用量（含请求方归属）、审计、证据引用 |
| 执行 runId | `exec-run-ffa09c8b-…` | run 详情、反查借调单、用量、审计 |
| 编排 requestId | `orch-e562e337-…` | 查询 run + 推理 run、用量、证据引用 |
| 推理 task_id | 与 runId 相同 | 同 runId |

关联键：

```
borrowOrderId ─┬─ requestId（借调请求）
               ├─ runId（= 推理 task_id）
               ├─ queryRunId / reasoningRunId（编排）
               └─ evidence.payload 中的 orderId / requestId / runId / queryRunId / reasoningRunId
```

## 二、API

| 端点 | 鉴权 | 作用域 |
|---|---|---|
| `GET /api/trace/{id}` | 登录用户（M01 会话） | 限当前租户；跨租户 run 返回 404 |
| `GET /api/system/trace/{id}` | 系统令牌（`x-aeos-system-id` + `x-aeos-system-token`） | 仅当该系统是借调发起方/提供方、run 所属系统或用量归属方，否则 403 |

返回结构（节选）：

```json
{
  "traceId": "borrow-8f21bcff-…",
  "resolvedBy": "borrow-order",
  "borrowOrder": { "orderId": "…", "status": "completed", "fromSystem": "aeos-hub", "providerSystem": "control-platform", "runId": "exec-run-…" },
  "runs": [{ "runId": "exec-run-…", "taskId": "exec-run-…", "capability": "reason_control_platform", "state": "completed", "dataConfidence": "high", "conclusions": 6, "evidenceRefs": ["control-platform://…"] }],
  "usage": [{ "runId": "exec-run-…", "consumerSystemId": "aeos-hub", "borrowOrderId": "borrow-…", "cost": 0.02535968 }],
  "evidence": [{ "occurredAt": "…", "summary": "borrow order completed", "payload": { "orderId": "borrow-…", "runId": "exec-run-…" } }],
  "evidenceRefs": ["control-platform://…"],
  "timeline": [{ "at": "…", "kind": "borrow", "title": "借调单创建：aeos-hub → control-platform", "detail": "reason_control_platform" }]
}
```

`timeline.kind` 取值：`borrow` / `run` / `usage` / `evidence`，按时间升序。

## 三、数据来源

| 数据 | 来源 |
|---|---|
| 借调单 | `data/borrow-orders.json` |
| 执行 run | `data/execution-plane.json` |
| 用量 | `data/usage-ledger.json` |
| 审计 | `data/evidence.jsonl`（按 mtime 缓存，只读最后 2 万行） |

只读聚合，不改写入链路。

## 四、实测

| 输入 | 结果 |
|---|---|
| `borrow-8f21bcff-…` | 1 条推理 run（6 条结论、high）、用量归属 `aeos-hub`、成本 ¥0.0254、3 条审计、6 个 evidence_refs |
| `orch-e562e337-…` | 查询 run + 推理 run、2 条用量、15 个 evidence_refs |

## 五、traceId 的写入

2026-10-26 起，链路 ID 在写入时就已落到各存储，不再只靠事后拼接：

| 入口 | traceId 取值 |
|---|---|
| 跨系统借调 | 借调单号 `borrow-…` |
| 最高风险编排 | 编排 `requestId`（`orch-…`），查询与推理 run 共用 |
| 直接派单 / 意图路由 | 默认等于该次 `runId` |
| 历史数据 | run / 用量没有 `traceId` 时按 `runId` 回退 |

落点：

- `execution-plane.json` 的 run 记录新增 `traceId`；
- `usage-ledger.json` 的用量事件新增 `traceId`；
- evidence payload 新增 `traceId`（借调、编排审计）；
- trace 查询可直接用 `traceId`，也可继续用借调单号 / runId / requestId。

## 六、模块分工（避免重复）

| 模块 | 职责 | 与其他模块的关系 |
|---|---|---|
| 跨系统借调 | 业务台账：谁向谁要了什么、回单、失败原因 | 详情页保留输入/结果，执行步骤已移除；提供「查看运行详情」「查看链路」 |
| AI 观测 | 运行观测：全部 run 的列表、状态、耗时、执行步骤；各系统助手会话 | run 详情提供「查看链路」 |
| 链路追踪 | 单笔因果链：借调 → run → 用量 → 审计，带 `task_id` 与 evidence_refs | 支持「最近链路」入口，也可从借调/AI 观测跳入 |

执行步骤（`run_event`）只在 AI 观测保留一份，避免三处重复渲染。

## 七、边界与下一步

- **上限**：evidence 只读最后 2 万行；更早的审计被轮转后不会出现在 trace 里；
- **下一步**：给借调详情/AI 观测的「查看链路」增加一键复制 traceId；可选的取消链路验收复用同一视图，借调单取消后 `timeline` 会显示 `cancelled` 与对应审计。
