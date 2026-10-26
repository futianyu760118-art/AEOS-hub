# 中台推理联调自检（reasoning:check）

> 日期：2026-10-26
> 适用：中台提供真实推理接口地址后，Hub 侧在**联调当天**用它逐条核对验收标准
> 关联：`docs/control-platform-reasoning-integration.md`（第七节验收标准）、`aeos-execution-agent/reasoning-acceptance-cases.json`

---

## 一、它做什么

`reasoning:check` 用**和网关完全相同的推理适配器**调用中台真实接口，按 Hub 侧验收标准逐条判定，不需要启动 Hub、不需要登录页面：

1. 接口可达并返回可解析结果；
2. `conclusions` 非空；
3. 每条结论都有 `evidence_refs`；
4. `data_as_of` 存在且可解析；
5. 没有 `validation_warnings`；
6. `data_confidence` 不是 `low`（边界用例除外）；
7. 附带展示上游返回的 `usage`（可选，未返回时提示 Hub 会记 `missing`）。

任何一条不满足都会指出具体是哪条结论、缺什么字段，便于直接反馈给中台。

## 二、怎么跑

```bash
cd aeos-execution-agent

# 1. 先看会发什么，不产生调用
npm run reasoning:check -- --dry-run

# 2. 跑全部用例（需要 .env 里已填 TARGET_REASONING_URL）
npm run reasoning:check

# 3. 只跑单个用例
npm run reasoning:check -- --case order-delivery-risk

# 4. 机器可读，便于存档或贴给中台
npm run reasoning:check -- --json

# 5. 中台推理较慢时覆盖超时
npm run reasoning:check -- --timeout-ms 240000
```

退出码：

| 退出码 | 含义 |
|---|---|
| 0 | 全部必测用例通过 |
| 1 | 有必测用例失败（接口返回不符合验收标准） |
| 2 | 配置/参数问题——`TARGET_REASONING_URL` 未填或参数错误，还没到联调阶段 |

## 三、用例

用例在 `aeos-execution-agent/reasoning-acceptance-cases.json`，默认 5 条：

| id | 名称 | task_type | 必测 | 说明 |
|---|---|---|---|---|
| `order-delivery-risk` | 订单交付风险 | `order_delivery_analysis` | 是 | 主链路，订单 `HJY20260903-261` |
| `material-kitting-shortage` | 物料齐套缺口 | `material_kitting_analysis` | 是 | 要求指出缺料项与影响 |
| `quality-issue` | 质量异常影响 | `quality_analysis` | 是 | 要求引用质量数据证据 |
| `production-impact` | 生产协同影响 | `production_analysis` | 是 | 要求说明数据时间与置信度 |
| `unknown-order-boundary` | 不存在订单（边界） | `order_delivery_analysis` | 否 | 人工核对：必须说明查无此单/数据不足，不得回答“无风险” |

新增用例只需在 JSON 里追加一项：`id`、`name`、`required`、`expect_confidence`（`not-low` / `low` / `any`）、`input`（与 Hub 派单 `input` 同构）。

## 四、没覆盖的部分

以下三项无法只靠一次 HTTP 调用证明，仍按原验收方式执行：

| 项 | 验证方式 |
|---|---|
| Hub 召回时上游请求被真正中止 | 单元测试（`reasoning-adapter.test.js`）+ 中台日志确认请求被取消 |
| 中台确实调用了自己的大模型/推理智能体 | 中台日志与调用链，而不是直查 REST 后伪装 |
| 超时 / 5xx / 401 的错误映射 | 单元测试；真实环境由中台压测或故障注入验证 |

## 五、拿到结果后

- 全部通过：按 `docs/control-platform-reasoning-integration.md` 第七节做一次页面端到端（登录 Hub → 执行面问分析问题 → 确认结论与证据）。
- 有失败：把 `--json` 输出直接发给中台，逐条对应到缺失字段或证据规则，避免口头描述。
