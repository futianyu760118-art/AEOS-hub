# 写操作平面（P0 · 订单备注/状态）

> 日期：2026-10-28  
> 范围：Hub 页面发起 + 其他系统经 Hub 发起；每次写操作必须人工审批  
> 首个试点：订单备注、订单状态

## 1. 原则

- **默认拒绝**：写能力必须显式声明、显式授权；未授权一律拒绝。
- **人工审批**：所有写操作在 Hub 由 manager / supervisor 批准后才派单；审批人、时间、载荷留痕。
- **提供方执行**：Hub 只负责鉴权、审批、派单与审计；写操作由业务系统自己执行并返回 before/after。
- **幂等**：每个写请求带唯一 `idempotencyKey`；提供方必须保证同一 key 只执行一次。
- **入口统一**：Hub 页面与其他系统 Agent 都通过写请求进入；不允许绕过 Hub 直连写（后续如开放，必须上报审计）。

## 2. 流程

```text
提交（Hub 页面 / 系统 token）
  → pending_approval
  → manager/supervisor 批准 → dispatched（执行面派单，writeApproved）
  → completed / failed
  → 拒绝 → rejected
```

- 提交不派单；审批通过才派单。
- 审批只发生在 Hub；外部系统无法自行批准。
- 执行回执通过 `run_complete` / `run_failed` 回填写请求状态。

## 3. Hub API

### 3.1 浏览器会话（manager / supervisor）

- `GET /api/write-requests/capabilities`：可用写能力（在线 Agent 声明）
- `GET /api/write-requests?status=&limit=`：本租户写请求
- `POST /api/write-requests`：
  ```json
  {
    "capability": "write_control_platform",
    "systemId": "control-platform",
    "input": {
      "operation": "order.update_note",
      "orderNo": "HJ202602-0009-0028",
      "changes": { "remark": "客户要求改期到 11-10" }
    },
    "reason": "客户邮件确认改期",
    "idempotencyKey": "可选；缺省由服务端生成"
  }
  ```
- 交付日期示例：
  ```json
  {
    "operation": "order.update_delivery_date",
    "orderNo": "HJ202602-0009-0028",
    "changes": { "deliveryDate": "2026-11-10" }
  }
  ```
- `POST /api/write-requests/{id}/approve`：`{ "note": "可选" }`
- `POST /api/write-requests/{id}/reject`：`{ "reason": "必填" }`
- `GET /api/write-requests/{id}`

### 3.1.1 对话内发起（Hub 用户）

用户直接在智能助手里说：

> 改写订单 HJ202602-0009-0028 的交付日期为 2026-11-10

Hub 会解析写意图并回复：

> 即将执行：改写订单 HJ202602-0009-0028 的交付日期为 2026-11-10。
> 回复“确认”执行，回复“取消”放弃。

用户回复“确认”后，Hub 才创建已批准的写请求并派单；回复“取消”不会修改任何数据。独立的「写操作」页面已隐藏，但接口与台账保留。

### 3.2 系统 token（其他系统的 Agent）

- `POST /api/system/write-requests`：
  ```json
  {
    "requestId": "spc-task-123-write-1",
    "capability": "write_control_platform",
    "toSystem": "control-platform",
    "input": { "operation": "order.update_status", "orderNo": "HJ...", "changes": { "status": "confirmed" } },
    "reason": "客户确认后更新状态",
    "caller": {
      "systemId": "control-platform",
      "agentId": "AG-000001",
      "userId": "10086",
      "taskId": "AT-000123",
      "traceId": "trace-abc"
    }
  }
  ```
  - `requestId` 即幂等键；重复提交返回同一请求。
  - `caller.systemId` 必须等于令牌系统。
- `GET /api/system/write-requests/{id}`：只能查看自己发起或作为目标系统的请求。
- **没有**系统级审批接口：审批必须在 Hub 页面完成。

## 4. 提供方能力契约（SPC 侧）

能力名：`write_control_platform`（与查询/分析并列，同一个网关 Agent 注册）

```json
{
  "name": "write_control_platform",
  "description": "中台受控写操作（订单备注/状态）",
  "inputSchema": {
    "type": "object",
    "properties": {
      "operation": { "type": "string", "enum": ["order.update_note", "order.update_status", "order.update_delivery_date"] },
      "orderNo": { "type": "string" },
      "changes": { "type": "object" },
      "idempotencyKey": { "type": "string" }
    },
    "required": ["operation", "orderNo", "changes"]
  },
  "constraints": {
    "readOnly": false,
    "approvalRequired": true,
    "riskLevel": "low",
    "idempotent": true,
    "dryRun": true
  },
  "operations": [
    {
      "name": "order.update_note",
      "title": "修改订单备注",
      "keywords": ["备注", "说明"],
      "changesField": "changes",
      "fields": [{ "name": "remark", "label": "备注", "type": "string", "required": true }]
    },
    {
      "name": "order.update_status",
      "title": "修改订单状态",
      "keywords": ["状态"],
      "changesField": "changes",
      "fields": [{ "name": "status", "label": "状态", "type": "string", "required": true }]
    },
    {
      "name": "order.update_delivery_date",
      "title": "修改交付日期",
      "keywords": ["交付日期", "交期"],
      "changesField": "changes",
      "fields": [{ "name": "deliveryDate", "label": "交付日期", "type": "date", "required": true }]
    }
  ]
}
```

派单消息（Hub → 网关）新增：

```json
{
  "type": "dispatch",
  "runId": "exec-run-...",
  "capability": "write_control_platform",
  "input": { ... },
  "traceId": "write-write-...",
  "request_id": "write-...",
  "caller": { ... }
}
```

结果（`run_complete.result`）要求：

```json
{
  "ok": true,
  "operation": "order.update_note",
  "target": { "orderNo": "HJ..." },
  "before": { "remark": "" },
  "after": { "remark": "客户要求改期到 11-10" },
  "appliedAt": "2026-10-28T05:00:00+08:00",
  "idempotent_replay": false,
  "handled_by": { "agentId": "spc-agent-order-risk", "agentName": "订单风险分析 Agent", "model": "deepseek-flash" },
  "request_id": "write-..."
}
```

错误码：
- 未授权的操作：`CAPABILITY_UNSUPPORTED` / `INVALID_ARGUMENT`
- 幂等冲突：`IDEMPOTENCY_CONFLICT`
- 提供方忙碌：`AGENT_BUSY`
- 目标不存在：`TARGET_NOT_FOUND`
- 上游不可用/超时：`UPSTREAM_UNAVAILABLE` / `UPSTREAM_TIMEOUT`

**提供方必须自行校验**：操作白名单、订单存在、状态机合法、权限；Hub 审批不能替代系统自身校验。

## 5. Hub 侧已实现的保护

- 写能力必须 `constraints.readOnly=false` 且经权限表授权
- 未经审批的写能力派单直接 `WRITE_FORBIDDEN`（执行面层兜底）
- 审批角色仅限 manager / supervisor
- 租户隔离；外部系统只能看自己发起/自己作为目标的请求
- 幂等键去重；内容不同返回 `IDEMPOTENCY_CONFLICT`
- 审计：提交、批准、拒绝、完成、失败各一条 evidence，含请求号、操作、系统、审批人

## 6. 验收用例（P0）

1. 无写能力时页面提示“提供方尚未注册写能力”，提交按钮禁用。
2. 提交写请求 → 状态 `pending_approval`，执行面没有派单。
3. manager 批准 → 状态 `dispatched`，run 完成 → `completed`，结果包含 before/after。
4. 拒绝 → `rejected`，不派单，审计有拒绝原因。
5. operator 提交/审批 → 403。
6. 同一 `idempotencyKey` 重复提交 → 返回同一请求；内容不同 → 409。
7. 外部系统提交 → Hub 页面可见并审批；外部系统轮询到最终状态。
8. 写能力被直接派单（不经审批）→ `WRITE_FORBIDDEN`。
9. 对话内说“改写某订单的交付日期为 …” → 助手只回复确认提示；回复“确认”后才派单，回复“取消”不产生任何修改。

## 7. 中台确认规则（2026-10-28）

中台已完成 `write_control_platform` 的 operations 元数据与本地 smoke，规则如下：

| 操作 | 规则 |
|---|---|
| `order.update_delivery_date` | 写 `promised_date`；`YYYY-MM-DD`；允许过去日期用于纠错；`erp_status=3` 或已删除订单拒绝；P0 不联动出货计划/下游任务 |
| `order.update_status` | 目标值仅 `open` / `closed`，同时写 `status` + `is_closed`；ERP 已关闭/已删除拒绝；ERP 未关闭时允许手工 `closed→open` |
| `order.update_note` | 覆盖写，≤2000 字符；空串/null 清空；允许已关闭订单，禁止已删除订单 |

其他确认：

- `orderNo` trim 后精确匹配，不含行号，≤64；
- 幂等键保留 30 天；同 key 同内容返回首次结果并置 `idempotent_replay=true`；内容不一致返回 `IDEMPOTENCY_CONFLICT`；
- 写操作 `handled_by` 返回 `spc-agent-order-write` / 订单写操作 Agent / `order_write`；写操作不调用大模型，`model` 省略；
- `constraints.dryRun=false`；Hub 不依赖 `dryRun=true` 展示或派单，无需补实现；
- `target_agent_ref` 已支持，Hub 当前未使用；
- 生产部署前需为中台订单写 AppKey 授权 `orders.write`。

Hub 侧已按此复跑：备注、状态、交付日期三类自然语言命令均可由 operations 元数据确定性解析（无需模型）。
