# 中控平台网关（单 Agent 兼容模式）

> 范围：只针对公司中控平台（control-platform）。PLM、ERP 和通用标准网关不在本期。
> 形态：一条 WebSocket、一个网关身份、两个能力（查询 + 推理）。

## 1. 它是什么

这是“统一网关型”的第一步，但不是完整的多 Agent 网关：

```
Hub
 ▲ 一条 WS
 │
中控平台网关（gateway-control-platform）
 ├─ query_control_platform   → 中台只读查询适配器
 └─ reason_control_platform  → 中台推理适配器（未接通时明确返回未接通）
```

对 Hub 来说，它就是一个执行面 Agent：名称是“公司中控平台网关”，能力是查询/推理。
对中台来说，它是直连执行体的替代入口，能力实现完全复用 `company-control-query.js` 和 `reasoning-adapter.js`。

**与直连执行体的区别：**

| 项 | 直连执行体 | 中控平台网关 |
|---|---|---|
| 身份 | `runtime-control-platform-query` / `reasoning` | `gateway-control-platform` |
| 连接 | 每个执行体一条 WS | 一条 WS |
| 能力 | 分开注册 | 同一网关注册两条 |
| 后续扩展 | — | 可扩展 roster / 多 Agent / `servedBy` |
| 本期状态 | ✅ 可用 | 🟡 单 Agent 兼容模式 |

## 2. 怎么启动

### 2.1 签发中台系统令牌

在仓库根目录执行：

```bash
node scripts/mint-system-token.ts control-platform
```

把输出填入 `aeos-execution-agent/.env` 的 `EXECUTION_SYSTEM_TOKEN`。
令牌是敏感信息，不要提交、不要发群、不要写进日志。

### 2.2 配置

```bash
cd aeos-execution-agent
cp .env.gateway.example .env
# 填入 EXECUTION_SYSTEM_TOKEN、TARGET_QUERY_APP_KEY/SECRET
npm install
```

### 2.3 干跑检查

不连接 Hub，只校验配置和能力：

```bash
node src/gateway-main.js --check
```

预期输出包含 `gateway-control-platform`、`system-gateway`、`query_control_platform`、`reason_control_platform`。

### 2.4 启动

```bash
npm run gateway
```

### 2.5 Docker

```bash
docker compose -f docker-compose.gateway.yml up -d
```

网关主动出方向连接 Hub，通常不需要映射入站端口。

## 3. 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `EXECUTION_WS_URL` | 是 | Hub 执行面 WS 地址 |
| `EXECUTION_SYSTEM_ID` | 是 | 固定 `control-platform` |
| `EXECUTION_SYSTEM_TOKEN` | 是 | 中台系统令牌，与 Hub 侧一致 |
| `EXECUTION_AGENT_ID` | 否 | 默认 `gateway-control-platform` |
| `EXECUTION_AGENT_NAME` | 否 | 默认 `公司中控平台网关` |
| `EXECUTION_SOURCE_SYSTEM` | 否 | 默认 `control-platform` |
| `EXECUTION_GATEWAY_VERSION` | 否 | 默认 `1.0.0` |
| `TARGET_QUERY_BASE_URL` | 是 | 中台只读查询地址 |
| `TARGET_QUERY_APP_KEY` | 是 | 只读应用 Key |
| `TARGET_QUERY_APP_SECRET` | 是 | 只读应用 Secret |
| `TARGET_REASONING_URL` | 否 | 中台推理地址；留空则返回“未接通” |

## 4. Hub 侧会看到什么

- 一个执行面 Agent：`gateway-control-platform`；
- 两条能力：`query_control_platform`、`reason_control_platform`；
- 心跳、派单、召回、用量回传与直连执行体一致；
- 借调白名单仍按 `control-platform` 放行这两条能力，无需改配置。

## 5. 本期明确不做

- 多 Agent roster / `roster_delta`；
- `servedBy`（实际岗位回传）；
- PLM / ERP 适配；
- 标准网关打包与“发给其他系统”；
- Hub 侧把 `kind: 'system-gateway'` 落库/展示。

这些等中台双轨验证通过后再做。

## 6. 双轨验证建议

1. 保留现有直连执行体，不要停。
2. 启动网关，确认 Hub 出现 `gateway-control-platform`。
3. 用同一批问题分别走直连和网关：订单、齐套、质量、生产各 1~2 个。
4. 对比：结果一致、`evidence_refs` 一致、耗时接近、失败可归因。
5. 重点验证 PLM 登录过期以外的中台失败：JSON 解析、不可达、401。
6. 验证通过后再决定是否下线直连执行体。

## 7. 验收

- Hub 执行面仪表盘出现一个在线网关，能力两条；
- 借调查询能成功，结果与直连一致；
- 网关断线后 Hub 显示该系统离线，不出现假在线岗位；
- 失败时能看到 `error.code` / `message`，不返回“没有数据”。
