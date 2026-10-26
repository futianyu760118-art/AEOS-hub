# 中台执行面推理智能体接入任务书

> 存档：2026-10-16 发出的任务书。2026-10-26 中台已回复 15 项契约，最新契约与 Hub 实现见 `docs/control-platform-reasoning-integration.md`。

致：公司中控平台（目标系统）团队
自：AEOS Hub 管理面

## 一、背景与目标

AEOS Hub 需要通过中台执行面智能体完成两类只读能力：

1. `query_control_platform`：精确查询中台只读业务数据 —— **已联通**（HMAC 只读 REST，18 个白名单端点）。
2. `reason_control_platform`：调用中台自有大模型 / 推理智能体完成只读分析 —— **待中台提供接口契约**。

本任务书只针对第 2 项（推理能力）。第 1 项（查询）已经可用，无需中台改动。

## 二、中台需提供的信息（15 项，缺一不可）

| # | 项 | 说明 |
|---|---|---|
| 1 | 推理智能体调用地址 | 完整 URL（生产/UAT 各一份） |
| 2 | 鉴权方式 | Token / HMAC / OAuth2 / 其他 |
| 3 | 中台 Agent ID / 应用 ID | 调用方身份 |
| 4 | 请求参数结构 | 字段、类型、必填、长度限制 |
| 5 | 返回参数结构 | 字段、类型、嵌套、示例 |
| 6 | 是否支持流式输出 | SSE / 分块 / 一次性返回 |
| 7 | 会话 ID 和上下文规则 | 是否多轮、上下文保留时长 |
| 8 | 超时时间 | 请求超时、推理超时 |
| 9 | 任务取消接口 | 如何中止一个进行中的推理 |
| 10 | 错误码 | 完整错误码表及含义 |
| 11 | evidence_refs 生成规则 | 结论如何附带可验证证据引用 |
| 12 | 中台智能体可调用的工具清单 | 允许调用的只读工具白名单 |
| 13 | 是否保证只读 | 明确声明不会执行写操作 |
| 14 | data_as_of / data_confidence 返回规则 | 数据时间与置信度如何返回 |
| 15 | 并发限制和频率限制 | QPS、并发上限、限流策略 |

## 三、推理能力契约（期望）

### 输入（`dispatch.input`）

```json
{
  "prompt": "分析订单 HJY20260903-261 的交付风险",
  "task_type": "order_delivery_analysis",
  "context": { "businessObjectRef": "business://order/HJY20260903-261" },
  "constraints": { "read_only": true, "require_evidence": true }
}
```

- `prompt`：分析问题（≤2000 字符）。
- `task_type`：任务类型（order_delivery_analysis / material_kitting_analysis / quality_analysis / production_analysis 等）。
- `constraints.read_only` 必须为 `true`；`require_evidence` 要求结论带证据。

### 输出（`run_complete.result`）

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

## 四、安全与业务边界（强制）

1. 试点阶段只允许只读能力，禁止写操作。
2. 不得直接修改订单、库存、质量、生产或供应数据。
3. 所有业务结论必须引用 `evidence_refs`；无证据结论将被拒绝或标记低置信度。
4. 金额、承诺、质量、法律类判断必须标注需人工确认。
5. 中台模型回答不能直接当作业务事实。
6. `STALE_DATA`、`UPSTREAM_UNAVAILABLE`、空结果必须分别处理；**上游不可用不得解释为"没有数据/没有风险"**。
7. 推理能力不得绕过查询接口白名单和只读限制。
8. 保留 Agent、能力、任务、工具调用和证据审计记录。

## 五、验收标准

1. 中台提供完整接口契约（第二节 15 项）。
2. 中台日志能证明推理任务**实际调用了中台大模型/推理智能体**，而非直查 REST 后伪装。
3. 返回结果含结构化结论、evidence_refs、data_as_of、data_confidence。
4. 无 evidence_refs 的结论被拒绝或标低置信度。
5. Hub 召回任务时，中台推理任务同步取消。
6. 超时、失败、上游不可用分别返回明确错误。

## 六、对接方式与交接物

- 对接方式：独立 Sidecar 容器（推荐）或 SDK 嵌入，均通过 AEOS WebSocket 执行面协议。
- 交接物：
  - AEOS 执行面通信协议：`docs/execution-plane-agent-contract.md`（AEOS Hub 仓库）。
  - 独立执行面 Agent 包：`aeos-execution-agent/`（含查询适配器 + 推理适配器占位 + Docker 部署 + 接入说明）。
  - 中台只需：提供接口契约，并在 `aeos-execution-agent/src/adapters/reasoning-adapter.js` 填入真实调用实现（其余核心代码不变）。

## 七、说明

- 在接口契约确认前，推理适配器保持"未接通"占位，**不会伪造已联通中台大模型**。
- 本任务书与 AEOS Hub 的 `docs/execution-plane-agent-contract.md` §4.6 一致。
