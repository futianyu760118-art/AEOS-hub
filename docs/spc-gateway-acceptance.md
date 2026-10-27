# SPC 系统网关接入验收清单

> 适用：SPC 按“一个系统网关”接入 AEOS Hub（MVP / M01）  
> 日期：2026-10-27  
> 关联：`docs/spc-gateway-integration.md`、`docs/hub-caller-context.md`、`docs/execution-plane-agent-contract.md`

## 0. 验收前提

### Hub 侧

- M01 已启动，`https://aeos-hub.test:9444` 可登录；
- `data/systems.json` 中 `control-platform` 存在且 `status=active`；
- `config/execution-agent-allowlist.json` 允许 `control-platform → gateway-control-platform`；
- `config/execution-agent-permissions.json` 已授权：
  - `query_control_platform`
  - `reason_control_platform`
- M01 已设置 `EXECUTION_LEGACY_ROOT_ENABLED=0`（旧根令牌不可用）；
- 已为中台签发系统令牌：`node scripts/mint-system-token.ts control-platform`（输出即密钥，不贴聊天、不入库）。

### SPC 侧

- 只有一个对外网关进程；
- 只建立 **1 个** WebSocket 连接；
- 只使用 **1 个** Agent ID：`gateway-control-platform`；
- 只使用 **1 套**系统令牌：`EXECUTION_SYSTEM_ID=control-platform` + `EXECUTION_SYSTEM_TOKEN`；
- 内部“一人一 Agent”不注册到 Hub，由网关根据 `caller.agentId/userId` 在 SPC 内部分发；
- 如仍需要 `order` 能力，作为同一个网关的第三个 capability 注册，并提前在 Hub 授权，**不要新增直连 Agent**。

## 1. 身份与连接

| ID | 操作 | 预期结果 |
|---|---|---|
| T01 | 启动 SPC 网关 | Hub 执行面出现 `gateway-control-platform`，在线 |
| T02 | 查看身份 | `authMode=system-token`，`systemId=control-platform` |
| T03 | 查看连接数 | 只有 1 个网关 Agent；没有 `runtime-control-platform-*` 新注册 |
| T04 | 用旧根令牌连接 | 被拒绝（HTTP 401），Hub 不建立连接 |
| T05 | 令牌 `systemId` 与自报 `sourceSystem` 不一致 | 注册被拒绝，错误码 `SYSTEM_IDENTITY_MISMATCH` |
| T06 | 用未登记的 Agent ID 直连（模拟旧的 3 个 Agent） | 注册被拒绝，错误码 `AGENT_NOT_ALLOWED` |

Hub 侧核对：

```powershell
Get-ScheduledTask -TaskName "AEOS-Hub-ControlPlatformGateway" | Select-Object TaskName,State

node -e "const d=require('./data/execution-plane.json');const a=d.agents||d;for(const x of (Array.isArray(a)?a:Object.values(a)))console.log(x.agentId,x.authMode,x.systemId,x.runtimeStatus,x.lastSeenAt)"
```

## 2. 能力注册

| ID | 操作 | 预期结果 |
|---|---|---|
| T07 | 网关注册能力 | 至少包含 `query_control_platform`、`reason_control_platform` |
| T08 | 检查能力约束 | 两条能力均为只读；推理能力要求 `context.businessObjectRef` |
| T09 | 注册未授权能力 | 被过滤；若全部未授权，注册被拒绝（`CAPABILITY_FORBIDDEN`） |
| T10 | 注册写能力 | 被拒绝（`WRITE_FORBIDDEN`），网关不得声明写操作 |

如果增加 `order` 能力，必须先在 Hub 的权限配置中授权，再验证一次 T07-T09。

## 3. 查询链路

| ID | 操作 | 预期结果 |
|---|---|---|
| T11 | 发起一笔 `query_control_platform` 借调/派单 | 借调单 `completed`，run `completed` |
| T12 | 检查查询结果 | 有业务数据、`evidence_refs`、`data_as_of`、`data_confidence` |
| T13 | 检查归因 | 借调单、run、用量、trace 指向同一 `gateway-control-platform` |
| T14 | 上游返回 5xx 或不可达 | `run_failed` 携带 `UPSTREAM_UNAVAILABLE`，页面不得显示“没有数据/没有风险” |
| T15 | 查询数据过旧 | 结果标记 `STALE_DATA` 或 `data_confidence=low`，页面标注“数据置信度不足” |

示例（由 SPC 网关调用 Hub，令牌用环境变量，不要写进脚本）：

```bash
# 本机调试用 127.0.0.1；跨机部署请替换为实际 Hub 地址
curl -sS -X POST http://<hub-host>:8790/api/system/borrow-orders \
  -H 'content-type: application/json' \
  -H 'x-aeos-system-id: control-platform' \
  -H "x-aeos-system-token: $SPC_TOKEN" \
  -d '{
    "requestId": "acceptance-query-001",
    "capability": "query_control_platform",
    "toSystem": "control-platform",
    "caller": {
      "systemId": "control-platform",
      "agentId": "AG-ACCEPT-1",
      "userId": "accept-user-1",
      "taskId": "accept-task-1",
      "traceId": "accept-trace-1"
    },
    "input": { "path": "/external/orders/list", "params": { "page": 1, "page_size": 5 } }
  }'
```

## 4. 推理链路

| ID | 操作 | 预期结果 |
|---|---|---|
| T16 | 发起 `reason_control_platform` | 借调单、run 均 `completed` |
| T17 | 不带 `context.businessObjectRef` | 请求被拒绝（`INVALID_ARGUMENT` 或 400），不得偷偷补全 |
| T18 | 正常推理 | 返回结构化结论 + `evidence_refs`；`llm.called=true`（如上游提供） |
| T19 | 上游推理超时 | `UPSTREAM_TIMEOUT` 或 `UPSTREAM_UNAVAILABLE`，可召回，不得显示“没有风险” |
| T20 | 推理结果为空但成功 | 明确说明“无结论”，不得编造风险或金额 |

推理请求必须带业务锚点，例如：

```json
{
  "capability": "reason_control_platform",
  "input": {
    "prompt": "分析该订单的交付风险",
    "task_type": "order_risk",
    "context": { "businessObjectRef": "business://order/SO-2609-001" }
  }
}
```

## 5. caller / traceId 贯通

| ID | 操作 | 预期结果 |
|---|---|---|
| T21 | dispatch 中读取 `caller` / `traceId` | SPC 网关保留字段，并在内部路由到 `caller.agentId` 或 `caller.userId` |
| T22 | 找不到对应用户 Agent | 拒绝并审计，不回退到任意 Agent，不使用全量数据 |
| T23 | 检查 Hub 借调单 | `caller.agentId/userId/taskId/traceId` 与 SPC 发送值一致 |
| T24 | 检查 Hub run / 用量 / trace | 同一组 caller 与 traceId 可串联 |
| T25 | `caller.systemId` 与令牌系统不一致 | Hub 返回 400，不落单、不派单 |
| T26 | 不传 caller | 行为与旧系统级调用一致，字段为 null，不报错 |

Hub 页面核对：处理记录 → 借调详情 → 链路追踪；应能看到同一个用户/Agent/任务/trace。

## 6. 取消、断线与错误

| ID | 操作 | 预期结果 |
|---|---|---|
| T27 | 页面取消或调用系统召回 | Hub run=`recalled`，借调单=`cancelled`；SPC 侧任务 `task_id` 同步取消 |
| T28 | 杀掉网关进程 | Hub 1 分钟内显示离线；Keeper 拉起后自动重连并重新注册 |
| T29 | Hub 重启 | 网关自动重试，恢复后只出现 1 个 `gateway-control-platform` |
| T30 | 重复 `run_event` | Hub 按 `eventId` 去重，不重复显示步骤 |
| T31 | 非法输入 / 未知能力 | `INVALID_ARGUMENT` / `CAPABILITY_UNSUPPORTED`，不得静默成功 |

## 7. 观测与用量

| ID | 操作 | 预期结果 |
|---|---|---|
| T32 | 查询/推理完成后看用量页 | 出现真实 Token/成本记录，归属 `gateway-control-platform` |
| T33 | 带 caller 的调用 | 用量可按 `callerAgentId` / `callerUserId` 聚合 |
| T34 | 上游未提供 usage | 显示“未上报”，不能记 0 冒充真实用量 |
| T35 | 看处理记录时间线 | 能看到 `run_event` 步骤；没有上报也不影响主流程 |
| T36 | 看审计/证据 | 注册、借调、召回、失败均有 evidence；不包含令牌/密码 |

## 8. 通过标准

全部满足才算验收通过：

- T01-T10 全部通过（身份、准入、能力）；
- T11-T15 至少各通过一次真实查询；
- T16-T20 至少各通过一次真实推理；
- T21-T26 caller/trace 全链路一致；
- T27 取消链路双端一致；
- T28-T29 断线/重启可自愈；
- T32-T34 用量归属正确，缺失时明确“未上报”；
- 没有任何直连 Agent 替代网关；
- 旧根令牌无法连接。

## 9. 失败记录模板

```text
用例：
时间：
发起方 / 用户：
runId / borrowOrderId / traceId：
实际结果：
预期结果：
错误码 / HTTP 状态：
Hub 日志/证据：
SPC 日志：
责任方（Hub / SPC / 网络 / 数据）：
```

## 10. 验收后仍需确认的外部项

- SPC `duration_ms` 类型、成本字段、usage 完整性；
- actor token / caller 断言合同（第二阶段）；
- 生产端口 18085 与正式环境地址；
- PLM 远端执行面恢复（不属于 SPC 网关验收范围）。
