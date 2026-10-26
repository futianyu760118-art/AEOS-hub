# 执行面选路策略（Routing Policy）

> 日期：2026-10-26
> 目的：在已通过 allowlist 准入的 Agent 中，按「系统 × 能力」优先级选路，替代“第一个在线”
> 配置：`config/execution-routing-policy.json`（可用 `AEOS_EXECUTION_ROUTING_POLICY_FILE` 覆盖）

---

## 一、和 allowlist 的分工

| 配置 | 作用 | 回答的问题 |
|---|---|---|
| `execution-agent-allowlist.json` | **准入** | 哪个 Agent 可以连接/注册 |
| `execution-routing-policy.json` | **选路** | 连上之后优先派给谁 |

allowlist 负责安全边界，routing policy 负责流量分配；以后新增/切换 Agent 只改策略，不碰代码。

## 二、配置格式

```json
{
  "version": 1,
  "revision": 1,
  "updatedAt": "2026-10-26T06:10:00.000Z",
  "fallback": "first-online",
  "rules": [
    { "systemId": "control-platform", "capability": "*", "agents": ["gateway-control-platform"] },
    { "systemId": "hengjian-plm", "capability": "*", "agents": ["runtime-execution-query"] }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `rules[].systemId` | 系统 ID；`*` 表示任意系统 |
| `rules[].capability` | 能力名；`*` 表示该系统任意能力 |
| `rules[].agents` | 按优先级排列的 Agent ID；不在列表中的 Agent 交给 `fallback` |
| `fallback` | `first-online`（默认，规则内都不可用时回退到第一个在线）或 `deny`（严格只允许规则内 Agent） |

匹配优先级：精确系统+能力 > 系统+`*` > `*`+能力 > `*`+`*`；同优先级取先声明的一条。

## 三、生效范围

| 位置 | 行为 |
|---|---|
| 中枢意图路由 `selectAgentForIntent` | 查询/推理意图先按策略排序，再做在线/注销/能力过滤 |
| 中枢推理选择 `selectHubReasoningAgent` | 控制平台的推理 Agent 按策略排序 |
| 跨系统借调 `resolveProvider` | 策略内 Agent 优先；同优先级再按空闲、最近心跳排序 |
| 最高风险编排 | 同系统查询 Agent 仍按“不同 Agent 优先、否则复用统一网关”规则 |

配置按 mtime 热加载，改完不需要重启 Hub。配置损坏时回落默认值（无规则 + first-online），不阻断派单。

准入 / 授权 / 选路三张配置都由 Hub 的文件哈希监听器监控，变更会写入 evidence（`execution-policy-changed`，含 revision 与前后哈希）。

## 四、当前策略

- `control-platform`：优先 `gateway-control-platform`（统一网关，兼查询与推理）；
- `hengjian-plm`：优先 `runtime-execution-query`；
- `fallback=first-online`：规则内 Agent 离线时仍可回退，避免单点。

## 五、生效验证

1. 两个匹配 Agent 同时在线时，中枢意图路由应选中规则内 Agent；
2. 规则内 Agent 离线时，按 fallback 回退到其余在线 Agent；
3. 改配置后无需重启，下一次选路即生效（mtime 热加载）。

单测：`npm run test:routing`、`npm run test:execution`、`npm run test:borrow`。

## 六、后续可扩展

- 按租户/业务域加规则（`tenantId`、`domain` 维度）；
- 权重与灰度（同一能力多 Agent 按比例分流）；
- 健康度/成本参与排序（当前策略优先，健康度次之）；
- 策略变更审计（把每次命中的规则写入 evidence）。
