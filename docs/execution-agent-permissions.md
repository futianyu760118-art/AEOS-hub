# 执行面能力授权表（Identity / Permissions）

> 日期：2026-10-26
> 目的：确认“谁在调、哪个 Agent 被授权调用哪个能力”，把权限从自报能力升级为可配置授权
> 配置：`config/execution-agent-permissions.json`（可用 `AEOS_EXECUTION_AGENT_PERMISSIONS_FILE` 覆盖）

---

## 一、三张配置的分工

| 配置 | 作用 | 回答的问题 |
|---|---|---|
| `execution-agent-allowlist.json` | **准入** | 哪个 Agent 可以连接/注册 |
| `execution-agent-permissions.json` | **授权** | 连上后能调用哪些能力 |
| `execution-routing-policy.json` | **选路** | 连上后优先派给哪个 Agent |

三者按顺序生效：准入 → 授权 → 选路。

## 二、配置格式

```json
{
  "version": 1,
  "revision": 1,
  "updatedAt": "2026-10-26T06:20:00.000Z",
  "enforcement": "enforce",
  "defaultPolicy": "deny",
  "grants": [
    {
      "systemId": "control-platform",
      "agentId": "gateway-control-platform",
      "tenantId": "tenant-demo",
      "capabilities": ["query_control_platform", "reason_control_platform"]
    }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `grants[].systemId` / `agentId` | 授权主体；必须与令牌声明的系统一致 |
| `grants[].tenantId` | 限定租户；`null` 或缺省表示任意租户 |
| `grants[].capabilities` | 允许调用的能力清单（精确匹配） |
| `defaultPolicy` | 没有命中 grant 时：`deny`（默认）或 `allow` |
| `enforcement` | `observe` 只告警不拦截；`enforce` 拦截未授权派单 |

配置按 mtime 热加载，改完无需重启 Hub；配置损坏时回落 `observe + deny`，不阻断派单。

## 三、生效点

`ExecutionPlaneRegistry.dispatch` 是所有派单的唯一入口，因此授权检查覆盖：

- Hub 执行面直接提问；
- 中枢意图路由（查询 / 推理）；
- 最高风险订单编排（查询 + 推理）；
- 跨系统借调（`borrow-order-service` 派单）；
- 能力模板调用。

未授权时：

- `enforce`：抛 `CAPABILITY_FORBIDDEN`，借调单落 `failed`，错误码 `CAPABILITY_FORBIDDEN`（HTTP 403）；
- `observe`：控制台告警，仍允许派单，用于灰度观察。

## 四、当前授权

| 系统 | Agent | 租户 | 能力 |
|---|---|---|---|
| control-platform | `gateway-control-platform` | tenant-demo | `query_control_platform`、`reason_control_platform` |
| hengjian-plm | `runtime-execution-query` | tenant-demo | `query_plm`、`reason_plm`、`query_local_files` |

当前 `enforcement = enforce`：两个在线 Agent 均已覆盖，未授权派单会被拦截。

## 五、上线与运维

1. **新增 Agent/能力**：先在 allowlist 加 Agent，再在这里加 grant，最后按需在 routing policy 排优先级；
2. **灰度**：把 `enforcement` 改成 `observe`，观察日志中的未授权告警，补齐 grant 后再切 `enforce`；
3. **租户隔离**：给 grant 填 `tenantId` 即只对该租户生效；`null` 表示共享能力；
4. **审计**：enforce 下的拒绝会体现在 run 失败 / 借调单失败中；observe 告警目前写控制台。

单测：`npm run test:permissions`、`npm run test:execution`、`npm run test:borrow`。

## 六、后续可扩展

- 注册时校验能力子集（未授权能力在注册阶段直接剔除/拒绝）；
- 权限变更审计写入 evidence；
- 管理页面（按系统/Agent 查看与编辑授权）；
- 与借调白名单合并，避免两套能力清单；
- 支持通配能力（如 `query_*`）与按业务域授权。
