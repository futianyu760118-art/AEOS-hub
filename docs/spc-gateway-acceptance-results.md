# SPC 系统网关接入验收记录

> 日期：2026-10-27（下午续测）
> 环境：M01 本机 Hub `https://aeos-hub.test:9444`（进程 `npm run web`，HTTP 8790 / WS 8788）；SPC 系统网关工作机 `192.168.0.178` 经 WebSocket 接入
> 清单：`docs/spc-gateway-acceptance.md`

## 结论速览

- 身份、准入、查询、推理、caller 贯通、召回、用量归因、审计均已通过真实链路验证。
- 待补：故障注入类（T14/T15/T19/T20/T22）、进程/服务重启类（T28/T29）、重复事件注入（T30）、注册能力过滤的真实注册（T09）。
- 本轮修正了清单中 3 处与实现不一致的写法（自借调、`task_type` 枚举、写能力拒绝时机）。

## 结果明细

| ID | 结果 | 证据 |
|---|---|---|
| T01 | 通过 | 执行面存在 `gateway-control-platform`，`connectionStatus=online`（远端 192.168.0.178 连接） |
| T02 | 通过 | `authMode=system-token`，`systemId=control-platform` |
| T03 | 通过 | 仅 1 个中控网关 Agent；无 `runtime-control-platform-*`；`runtime-execution-query`（PLM）离线 |
| T04 | 通过 | 旧根令牌（`x-aeos-execution-token`）WS 升级返回 HTTP 401 |
| T05 | 通过 | 令牌 `aeos-hub` 自报 `control-platform` → `SYSTEM_IDENTITY_MISMATCH` |
| T06 | 通过 | control-platform 令牌 + 未登记 Agent `runtime-control-platform-1` → `AGENT_NOT_ALLOWED` |
| T07 | 通过 | 能力含 `query_control_platform`、`reason_control_platform` |
| T08 | 通过 | 两条能力均 `constraints.readOnly=true`；推理 `requireEvidence=true` 且 schema 必填 `context.businessObjectRef` |
| T09 | 代码核对 | 注册按授权表过滤（`src/server.ts` 注册段）；真实注册未做，避免顶掉线上网关连接 |
| T10 | 代码核对 | 写能力不会进入授权表；`WRITE_FORBIDDEN` 在派单时抛出（`src/execution-plane.ts`） |
| T11 | 通过 | 查询借调 `borrow-fe9777b7-…`：借调单 `completed`，run `exec-run-483c6d39-…` `completed` |
| T12 | 通过 | 结果含 `items/total/data_as_of=2026-10-27T16:19:04Z/data_confidence=high`；查询结果不含 `evidence_refs` |
| T13 | 通过 | 借调单、run、用量、trace 同指 `gateway-control-platform` |
| T14 | 待 SPC 侧注入 | 需上游 5xx/不可达，Hub 侧已按 `UPSTREAM_UNAVAILABLE` 处理 |
| T15 | 待 SPC 侧注入 | 需上游返回旧数据；页面已按 `STALE_DATA`/低置信度标注（`src/dashboard.ts`） |
| T16 | 通过 | 推理借调 `borrow-c2ab661e-…`，run `exec-run-3d4a9a20-…` |
| T17 | 通过 | 缺 `context` → `INVALID_ARGUMENT`；`context={}` → `INVALID_ARGUMENT`（缺 `businessObjectRef`） |
| T18 | 通过 | 6 条结论 + `evidence_refs`（`control-platform://order/…`）；`llm.called=true`，`deepseek-flash`，19.7s |
| T19 | 待 SPC 侧注入 | 需上游超时 |
| T20 | 待 SPC 侧注入 | 需上游返回空结论 |
| T21 | 通过 | 调用方 `caller` 原样写入借调单与 run |
| T22 | 待 SPC 侧确认 | SPC 内部找不到用户 Agent 的拒绝路径，Hub 侧不可观测 |
| T23 | 通过 | 借调单 `caller` 为 `AG-ACCEPT-1 / accept-user-1 / accept-task-1 / accept-trace-t18-…` |
| T24 | 通过 | `/api/system/trace/borrow-c2ab661e-…` 串起借调单、run、用量、4 条 evidence_refs |
| T25 | 通过 | `caller.systemId≠令牌系统` → HTTP 400 `INVALID_ARGUMENT`，不落单 |
| T26 | 通过 | 不传 caller：借调单 `completed`，`caller=null` |
| T27 | Hub 侧通过 | 召回 `run exec-run-2d0e66c5-…`：run `recalled`，借调单 `cancelled`（`PROVIDER_RECALLED`），审计 `execution-run-recalled`；SPC 内部 `task_id` 取消待确认 |
| T28 | 待执行 | 需停止远端 SPC 网关进程，验证 1 分钟内离线与 Keeper 拉起 |
| T29 | 待执行 | 需重启 Hub（当前为前台进程，避免直接杀掉用户的终端） |
| T30 | 代码+数据核对 | 事件存储按 `eventId` 去重；`data/execution-events.jsonl` 324 条无重复 ID；未做重复注入 |
| T31 | 通过 | 未知能力 → `CAPABILITY_NOT_FOUND`（404）；`task_type` 枚举外 → `INVALID_ARGUMENT` |
| T32 | 通过 | 推理用量：in 1450 / cached 384 / out 3493 / ¥0.03009，`metering=reported`，归属 `gateway-control-platform` |
| T33 | 通过 | 用量记录带 `callerAgentId=AG-ACCEPT-1`、`callerUserId=accept-user-1` |
| T34 | 通过 | 查询用量 `metering=missing`、`tokens=0`，UI 显示“未上报”而非真实 0（`public/app.js`） |
| T35 | 通过 | run 事件已入库（如 `exec-run-3d4a9a20-…` 4 条：收到任务/中台推理分析×2/任务完成） |
| T36 | 通过 | 借调创建/派单/运行/完成/取消、召回、注册拒绝均落 `data/evidence.jsonl`；无令牌类字段 |

## 本轮发现

1. **清单示例自借调会被拒**：`toSystem` 等于令牌系统返回 403 `SELF_BORROW_FORBIDDEN`。已把 §3 示例改为由 `aeos-hub` 作调用方。
2. **`task_type` 枚举**：注册 schema 只接受 `order_delivery_analysis` / `material_kitting_analysis` / `quality_analysis` / `production_analysis`；清单原示例 `order_risk` 会 `INVALID_ARGUMENT`。已更正 §4。
3. **写能力拦截时机**：注册时按授权表过滤，`WRITE_FORBIDDEN` 在派单时生效。已更正 T10 预期。
4. **Hub 页面派单的 caller**：`caller.systemId=aeos-hub`、`agentId=null`，SPC 网关需按外部调用处理（已写入清单 §5 边界说明）。

## 建议下一步

1. SPC 侧排期做 T14/T15/T19/T20/T22/T27 的故障注入与内部取消确认。
2. Hub 侧择机做 T28/T29（停网关、重启 Hub），建议在无人使用时段执行并提前告知。
3. T09 若要真跑，需临时新增一个可注册的探针 Agent（不占用 `gateway-control-platform`）。

## 2026-10-28 中台契约补齐复验

中台部署后复跑真实链路，结果：

| 项 | 结果 |
|---|---|
| `handled_by` · 订单 | `spc-agent-order-risk`（订单风险分析 Agent，model=deepseek-flash） |
| `handled_by` · 齐套 | `spc-agent-kitting-risk`（齐套风险分析 Agent） |
| `handled_by` · 质量 | `spc-agent-quality-risk`（质量风险分析 Agent） |
| `request_id` | Hub 派单已携带，中台原样回显（如 `verify-rid-1793157972`） |
| 并发忙碌 | 第二笔返回 `AGENT_BUSY`（不再是 `INTERNAL_ERROR`） |
| 校验说明 | `validation_note` 不再出现 |

未覆盖：
- `TARGET_AGENT_UNAVAILABLE` / 显式 `target_agent_ref`：Hub 暂无该入口，待需要时再加。
- `AGENT_NOT_FOUND`：需要中台内部构造无匹配 Agent 的场景。

Hub 侧配套：派单消息新增 `request_id`；处理记录/分发报告展示“实际处理 Agent”。

观察到的 Hub 侧问题：并发创建借调单时偶发 `borrow-orders.json` rename `EPERM`（一次 Kitting 请求 500，重试成功），待加写重试/串行化。

## 2026-10-28 全能力覆盖（查询/分析/写入）

### 查询 `query_control_platform`：18/18

| 端点 | 结果 | 备注 |
|---|---|---|
| `/common/ping` | 通过 | |
| `/external/orders/list` | 通过 | 3269 条 |
| `/external/order-details/list` | 通过 | 需 `order_no` |
| `/external/boms/tree` | 通过 | 需 `bom_id`；`order_no`/`product_code`/`bom_no` 会 422 |
| `/external/materials/list` | 通过 | 数据置信度 medium |
| `/external/suppliers/list` | 通过 | |
| `/external/material-kitting/results` | 通过 | 数据置信度 low（快照 10-25） |
| `/external/material-kitting/shortages` | 通过 | 数据置信度 low（快照 10-25） |
| `/external/material-kitting/demands` | 通过 | |
| `/external/inventory/availability` | 通过 | |
| `/external/material-supplies/list` | 通过 | |
| `/external/quality-issues/list` | 通过 | |
| `/external/quality-trace/list` | 通过 | 需 `order_no` |
| `/external/production/work-orders/list` | 通过 | 78910 条 |
| `/external/production/operations/list` | 通过 | 按订单查询返回 0 条 |
| `/external/production/order-links/list` | 通过 | 需 `order_no` |
| `/external/production/reports/list` | 通过 | 需 `work_order_no` |
| `/external/production/capacity/list` | 通过 | 需 `date_start` + `date_end` |

### 分析 `reason_control_platform`：4/4

| task_type | 结果 | 耗时 | handled_by |
|---|---|---|---|
| `order_delivery_analysis` | 完成，6 条结论 | 20.4s | `spc-agent-order-risk` |
| `material_kitting_analysis` | 完成，6 条结论 | 20.3s | `spc-agent-kitting-risk` |
| `quality_analysis` | 完成，6 条结论 | 68.3s | `spc-agent-quality-risk` |
| `production_analysis` | 完成，6 条结论 | 12.1s | `spc-agent-production-risk` |

`request_id` 均原样回显；`data_confidence=high`、`stale=false`。

### 写入 `write_control_platform`：3/3 创建校验

- `order.update_note`、`order.update_status`、`order.update_delivery_date` 均通过 schema/权限校验并进入 `pending_approval`；
- 实际派单需要 Hub 人工确认（验收后清理了测试请求，未修改数据）；
- 写入端到端依赖中台 `resolve-caller` 修复后的手工确认测试。

### 其他

- `AGENT_BUSY` 已验证（并发第二笔）；
- `AGENT_NOT_FOUND` / `TARGET_AGENT_UNAVAILABLE` 未触发（Hub 暂无 `target_agent_ref` 入口）。

## 2026-10-28 写操作全链路验收通过

用户在智能助手对话内完成三个写操作的真实写入（点确认执行）：

| 操作 | 结果 | before → after | handled_by |
|---|---|---|---|
| `order.update_note` | 完成 | `""` → `"中台修复后复测"` | `spc-agent-order-write` |
| `order.update_status` | 完成 | `open/is_closed=0` → `closed/is_closed=1`（后由用户恢复为 open） | 同上 |
| `order.update_delivery_date` | 完成 | `2026-05-15` → `2026-11-15`（后由用户恢复为 05-15） | 同上 |

- 对话流程：自然语言发起 → 确认按钮 → 派单 → 完成消息展示实际处理方；
- `resolve-caller` 修复后未再出现；`AGENT_BUSY` 已验证；
- 写操作不记录 0 用量事件（已清理历史 7 条 0 记录）；
- 台账/审计：创建 16、批准 9、拒绝 7、完成 8、失败 1。

写平面 P0 验收通过。
