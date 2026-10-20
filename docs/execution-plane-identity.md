# 执行面每系统身份（P1）

## 目标

Hub 不再相信执行面注册消息里自报的 `sourceSystem`。连接建立时先认证「你是哪个系统」，注册归属以认证结果为准；旧共享根令牌在兼容期内继续可用，但会被审计并归一。

## WebSocket 鉴权

控制通道：`ws://<host>:8788/execution-agent`

### 系统令牌（推荐）

```
x-aeos-system-id: control-platform
x-aeos-system-token: <deriveSystemToken(EXECUTION_PLANE_TOKEN, "control-platform")>
```

- 令牌由 `src/system-token.ts` 派生，发放命令：`node scripts/mint-system-token.ts <systemId>`
- 系统必须已在 `data/systems.json` 登记且 `status: active`
- 出现任一系统令牌头时，必须同时提供 systemId 和 token；校验失败直接拒绝，**不会回退** legacy 根令牌
- `systemId` 含非 ASCII 字符时需百分号编码（当前种子系统均为 ASCII）

### legacy 根令牌（兼容期）

```
x-aeos-execution-token: <EXECUTION_PLANE_TOKEN>
```

- 默认允许；设置 `EXECUTION_LEGACY_ROOT_ENABLED=0` 后拒绝
- 每次注册写一条审计 Evidence：`correlation_id = execution-register-legacy`
- 自报名称能通过 `sourceSystemAliases` 匹配系统登记时，自动归一到 `systemId`

## 注册归属

| 连接方式 | `sourceSystem` | `systemId` | `sourceSystemName` | `authMode` |
|---|---|---|---|---|
| 系统令牌 | 令牌 `systemId` | 令牌 `systemId` | 系统登记显示名 | `system-token` |
| legacy，自报可解析 | 解析出的 `systemId` | 解析出的 `systemId` | 系统登记显示名 | `legacy-root` |
| legacy，自报不可解析 | 保留自报值 | `null` | 自报值 | `legacy-root` |

系统令牌模式下如果消息里的 `sourceSystem` 指向另一个系统，注册被拒绝：

```json
{ "type": "error", "code": "SYSTEM_IDENTITY_MISMATCH", "message": "执行面自报系统「恒剑PLM」与令牌系统「公司中控平台」不一致" }
```

拒绝会写审计：`correlation_id = execution-register-rejected`。

## 下游影响

- 用量台账、借调单、执行事件里的 `systemId` 统一取规范 `systemId`，不再混入显示名
- 系统控制面 `GET /api/system/agents` 与注册记录使用同一套 `systemId`，修复此前自报名与令牌 ID 不一致导致的列表为空
- 目录树执行面 Agent 优先按 `systemId` 匹配系统登记；`sourceSystemName` 仅用于页面展示
- 历史持久化记录加载时补 `systemId: null`、`authMode: 'unknown'`，下一次注册自动纠正

## 上线步骤

1. 停 Hub。
2. 为各系统发放令牌：`node scripts/mint-system-token.ts control-platform`（PLM 同理）。
3. 各执行面改为发送 `x-aeos-system-id` + `x-aeos-system-token`。
4. 启动 Hub，检查执行面记录：
   - 系统令牌连接：`authMode = system-token`，`sourceSystem = <systemId>`
   - legacy 连接：`authMode = legacy-root`，能在 Evidence 中看到注册审计
5. 观察 2 周后设置 `EXECUTION_LEGACY_ROOT_ENABLED=0`，只允许系统令牌。

开发环境模拟器：

```bash
EXECUTION_PLANE_TOKEN=... EXECUTION_SYSTEM_ID=control-platform node scripts/execution-plane-simulator.mjs
EXECUTION_PLANE_TOKEN=... EXECUTION_USE_LEGACY_TOKEN=1 node scripts/execution-plane-simulator.mjs
```

## 验收

- 系统 A 令牌携带系统 B 的自报名称 → 注册被拒，Evidence 可见
- legacy 根令牌 → 注册成功，Evidence 可见，自报名归一到 systemId
- 现有中台/PLM 连接不受影响
- `EXECUTION_LEGACY_ROOT_ENABLED=0` 后 legacy 被拒，系统令牌正常
- `npm run check:types`、`npm run test:execution` 通过

## 已知限制

- 根密钥持有者仍可派生任意系统令牌；真正的密钥隔离属于后续密钥管理阶段
- 系统令牌无吊销列表，停用系统依赖 `systems.json` 的 `status: disabled`
- 执行面记录中的 `authMode` 只表示最近一次连接方式，不构成完整审计链
