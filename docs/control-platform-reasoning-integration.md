# 中台推理能力接入说明（reason_control_platform）

> 日期：2026-10-23  
> 发送对象：公司中控平台执行面智能体 / 推理服务开发同学  
> Hub 侧状态：能力声明、派单、结果校验、用量台账、执行步骤均已就绪；推理适配器已按期望契约实现  
> 当前状态：**未配置真实推理 URL 时仍返回“未接通”；等待中台提供接口契约并填入 `TARGET_REASONING_*`**

---

## 当前进展（2026-10-23）

Hub 侧已完成：

- `reasoning-adapter.js` 支持按期望契约 POST 真实推理接口；
- 支持 `TARGET_REASONING_URL` / `TARGET_REASONING_TOKEN` / `TARGET_REASONING_AGENT_ID`；
- 支持 `TARGET_REASONING_MODEL`（默认 `deepseek-flash`）、`TARGET_REASONING_EFFORT`（默认 `high`）、`TARGET_REASONING_TIMEOUT_MS`（默认 `180000`）；
- 支持 `AbortSignal`：Hub 召回/超时会中止上游请求；
- 校验 `evidence_refs` / `data_as_of`：缺失时降为 `data_confidence: low` 并返回 `validation_warnings`；
- 5xx / 401 分别映射为 `UPSTREAM_UNAVAILABLE` / `UPSTREAM_AUTH_FAILED`；
- 本地 mock 测试覆盖：契约请求、缺证据降级、5xx、超时、调用方中止。

真实链路已在网关验证：

- 查询能力：借调单 `borrow-ede5ab15...` 状态 `completed`；
- 推理能力（未配置 URL）：借调单 `borrow-e72eee0e...` 状态 `completed`，返回“未接通”且 `data_confidence: low`，未伪造结论。

**中台仍需提供：** 第四节 15 项接口契约；填入 `TARGET_REASONING_*` 后即可联调真实推理。

---

## 一、一句话结论

Hub 已经准备好接推理能力，适配器也已按期望契约实现；缺的是中台提供真实推理接口地址、鉴权、请求/返回结构和错误码，并填入 `TARGET_REASONING_*`。

在**未配置 `TARGET_REASONING_URL`** 时，Hub 发起“分析”类问题链路会走通，但返回的是：

```
推理能力尚未接通中台大模型（占位实现）
data_confidence: low
```

这不是真实分析结论。

---

## 二、先分清两条链路

| | **推理能力（本文档）** | **中台智能助手（另一条）** |
|---|---|---|
| 谁发起 | Hub 派单给中台执行面 Agent | 中台自己的用户在中台界面聊天 |
| 路径 | Hub → WS dispatch → 中台执行面 Agent → 中台大模型 | 中台前端 → 中台后端 assistant → 大模型直连 |
| 能力名 | `reason_control_platform` | 无（用 `assistant-events` 留痕） |
| 返回什么 | 结构化结论 + evidence_refs | 会话/工具调用摘要 |
| Hub 能否看到 | 能，作为任务结果 | 只能看到中台主动上报的摘要 |

**中台智能助手已经有大模型，但它不会自动变成执行面的推理能力。** 需要在执行面 Agent 的推理适配器里调用它，或者调用中台自己的推理服务。

**本次统一口径：推理能力使用 DeepSeek V4.1-Flash，不使用 V4-Pro。**

| 项目 | 约定 |
|---|---|
| 模型 ID（推荐） | `deepseek-flash` |
| 旧模型名 | `deepseek-v4-flash`（仍可用，Hub 也能计价） |
| 价格（高峰） | 输入 ¥2/百万、缓存命中 ¥0.04/百万、输出 ¥8/百万 |
| 空闲时段 | 高峰价的一半 |
| 上下文 | 1,048,576 tokens |
| 思考强度 | `reasoning_effort` 可用 `low/high/max`，默认 `high` |

---

## 三、Hub 侧已经准备好的

- `reason_control_platform` 能力声明与输入/输出 schema；
- Hub 派单、召回、超时控制；
- 结果校验：没有 `evidence_refs` 的结论会被标记 `data_confidence: low` 并附校验说明，不会静默通过；
- 用量台账：`run_complete.usage` 可记录 Token/成本（可选）；
- 执行步骤：`run_event` 可记录内部步骤（可选）；
- 浏览器里能看到任务结果与分析结论。

---

## 四、中台需要提供的信息（15 项）

### 接口与身份

| # | 项 | 说明 |
|---|---|---|
| 1 | 推理接口地址 | 生产/UAT 各一份完整 URL |
| 2 | 鉴权方式 | Token / HMAC / OAuth2 / 其他 |
| 3 | 调用方 Agent ID / 应用 ID | 中台侧身份 |

### 请求与返回

| # | 项 | 说明 |
|---|---|---|
| 4 | 请求参数结构 | 字段、类型、必填、长度限制 |
| 5 | 返回参数结构 | 字段、类型、嵌套、示例 |
| 6 | 是否支持流式输出 | SSE / 分块 / 一次性返回 |
| 7 | 会话 ID 与上下文规则 | 是否多轮、保留多久 |

### 运行与治理

| # | 项 | 说明 |
|---|---|---|
| 8 | 超时时间 | 请求超时、推理超时 |
| 9 | 取消接口 | 如何中止进行中的推理 |
| 10 | 错误码表 | 完整错误码及含义 |
| 11 | evidence_refs 生成规则 | 结论如何附带可验证证据 |
| 12 | 可调用的工具白名单 | 只读工具清单 |
| 13 | 只读保证 | 明确声明不会执行写操作 |
| 14 | data_as_of / data_confidence 规则 | 数据时间与置信度如何返回 |
| 15 | 并发与限流 | QPS、并发上限、限流策略 |

---

## 五、期望的输入 / 输出契约

### 输入（Hub 派单的 `input`）

```json
{
  "prompt": "分析订单 HJY20260903-261 的交付风险",
  "task_type": "order_delivery_analysis",
  "context": { "businessObjectRef": "business://order/HJY20260903-261" },
  "constraints": { "read_only": true, "require_evidence": true }
}
```

### 输出（`run_complete.result`）

```json
{
  "summary": "存在缺料导致的延期风险",
  "conclusions": [
    {
      "matter": "关键物料尚未齐套",
      "evidence_refs": ["control-platform://material-kitting/shortages/HJY20260903-261"],
      "risk": "预计影响交付 3 天",
      "recommendation": "建议采购负责人核实到货承诺，需人工确认",
      "confidence": "high"
    }
  ],
  "data_as_of": "2026-10-19T16:30:00+08:00",
  "data_confidence": "high"
}
```

**硬性要求：**

- 每条结论必须有 `evidence_refs`，不能为空；
- 金额、承诺、质量、法律类判断必须标注"需人工确认"；
- 上游不可用 / 数据过期 / 空结果要分别说明，**不得解释为"没有风险"**；
- 只读，不得执行写操作；
- 中台模型回答不能直接当作业务事实。

---

## 六、中台需要改哪里

### 位置

```
aeos-execution-agent/src/adapters/reasoning-adapter.js
```

把现在的占位实现替换成真实调用；`agent-core.js`、WebSocket 协议、Hub 都不需要改（最小路径）。

### 参考实现（Node.js）

```js
export function createReasoningAdapter(config) {
  return async function reason(input, ctx) {
    const controller = new AbortController();
    const watcher = setInterval(() => {
      if (ctx.aborted) controller.abort();
    }, 500);

    try {
      const response = await fetch(config.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.token}`,
        },
        body: JSON.stringify({
          prompt: input.prompt,
          task_type: input.task_type,
          context: input.context ?? {},
          constraints: input.constraints ?? { read_only: true, require_evidence: true },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`推理接口返回 ${response.status}: ${detail.slice(0, 200)}`);
      }

      const data = await response.json();
      return {
        summary: data.summary ?? '',
        conclusions: (data.conclusions ?? []).map((item) => ({
          matter: item.matter ?? '',
          evidence_refs: item.evidence_refs ?? [],
          risk: item.risk ?? '',
          recommendation: item.recommendation ?? '',
          confidence: item.confidence ?? 'low',
        })),
        data_as_of: data.data_as_of ?? new Date().toISOString(),
        data_confidence: data.data_confidence ?? 'low',
      };
    } finally {
      clearInterval(watcher);
    }
  };
}
```

要点：

- 第二个参数是 `ctx`，用 `ctx.aborted` 判断是否被 Hub 召回；
- 上游请求要传 `AbortController`，保证召回能真正中止；
- 出错直接抛异常，Hub 会回 `run_failed`；
- 不要伪造没有证据的结论。

### 可选增强

| 增强 | 改哪里 | 效果 |
|---|---|---|
| 上报 Token/成本 | `agent-core.js` 的 `sendComplete(result)` 增加 `usage` 参数，`run_complete` 带上 `usage` | 用量台账出现推理调用成本 |
| 上报执行步骤 | 在 adapter 里按 `docs/execution-step-events.md` 发 `run_event` | Hub 时间线看到模型调用/工具调用 |
| 自定义错误码 | 扩展 `agent-core.js` 的失败映射 | Hub 显示更精确的失败原因 |

---

## 七、验证与验收

### 联调步骤

1. 中台把真实推理接口配置到执行面 Agent；
2. 启动后，Hub 执行面显示 `reason_control_platform` 在线；
3. 在 Hub 执行面问一句分析类问题，例如"分析订单交付风险"；
4. Hub 意图解析为 reasoning，派单给中台；
5. 返回结果出现在 Hub 会话中。

### 验收标准

1. 结果包含 `conclusions` 和 `evidence_refs`，`data_confidence` 不是 low；
2. 无 `evidence_refs` 的结论被 Hub 标记低置信度；
3. Hub 召回时，中台上游推理请求被真正中止；
4. 超时、失败、上游不可用分别返回明确错误；
5. 中台日志能证明**实际调用了中台大模型/推理智能体**，而不是直查 REST 后伪装；
6. （可选）用量台账出现推理 Token/成本；
7. （可选）执行步骤时间线出现模型调用过程。

---

## 八、工作量与分工

| 工作 | 负责方 | 预计 |
|---|---|---|
| 提供 15 项接口契约 | 中台 | 0.5 天 |
| 替换 reasoning-adapter 占位实现 | 中台 | 0.5–1 天 |
| 只读/证据/超时/召回校验 | 中台 | 0.5 天 |
| 联调与验收 | 中台 + Hub | 0.5 天 |
| Hub 侧改动 | Hub | 最小路径无需改动 |
| 合计 | | **1–2 天 + 半天联调** |

---

## 九、常见问题

| 问题 | 回答 |
|---|---|
| 能直接复用中台智能助手吗？ | 可以，但要在**执行面推理适配器**里调用它；Hub 不会直接调中台内部 assistant 接口 |
| 中台大模型用 V4-Flash，Hub 能计价吗？ | 能。模型 ID 用 `deepseek-flash`；旧名 `deepseek-v4-flash` 也已加入价目，两者都能记成本 |
| 不上报 usage 行不行？ | 行，推理能力仍可用，但用量台账不会记录这次推理的费用 |
| 不上报 run_event 行不行？ | 行，Hub 仍能看到任务结果，只是看不到内部步骤 |
| 现在能先联调吗？ | 可以先用模拟器验证链路；真实推理要等中台适配器接入 |
| 返回格式不对会怎样？ | Hub 不会丢弃结果，但会标记 `data_confidence: low` 并附校验说明 |

---

## 十、配套文档

- 推理任务书（15 项明细）：`docs/control-platform-reasoning-task.md`
- 执行面通信协议：`docs/execution-plane-agent-contract.md`
- 执行步骤上报（可选）：`docs/execution-step-events.md`
- 参考实现：`aeos-execution-agent/src/adapters/reasoning-adapter.js`（当前为占位）
