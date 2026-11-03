# 执行面智能体升级说明（中台侧）

> 2026-10-21 更新：连接认证推荐使用 `EXECUTION_SYSTEM_ID` + `EXECUTION_SYSTEM_TOKEN`（每系统令牌）；legacy `EXECUTION_PLANE_TOKEN` 仅作兼容。详见 `docs/execution-plane-identity.md`。

## 背景

管理面（AEOS Hub）已升级为「能力自描述」校验：派单前要求能力声明 `readOnly`（只读约束），并按 `inputSchema`/`outputSchema` 校验输入输出。

**旧版 Agent 注册的能力不含这些字段，会「连得上但派不了单」——派单时被管理面拒绝（错误码 `WRITE_FORBIDDEN`）。** 请按下面升级。

## 升级步骤

1. 拉取最新代码（AEOS Hub 仓库提交 `127b013`），更新执行面 Agent 目录 `aeos-execution-agent/`。
2. 重建镜像或重装依赖：
   - Docker：`docker compose build aeos-execution-agent && docker compose up -d`
   - 直接运行：`npm install && npm start`
3. 更新 `.env` 中的以下变量：

| 变量 | 改为 | 说明 |
|---|---|---|
| `EXECUTION_AGENT_NAME` | `公司中台执行面智能体` | 功能名，替代原「aeos-execution-agent」 |
| `EXECUTION_AGENT_ID` | `runtime-control-platform-agent` | 对齐管理面约定的 Agent ID，替代原「runtime-execution-query」；**G1 任务派单靠它桥接**，聊天查询不受影响但建议统一 |
| `EXECUTION_WS_URL` | `ws://192.168.0.23:8788/execution-agent` | 保持不变（确认指向管理面） |
| `EXECUTION_PLANE_TOKEN` | （不变） | 必须与管理面 `deploy/m01/.env` 一致 |
| `EXECUTION_SOURCE_SYSTEM` | （不变） | 如 `公司中控平台（UAT）` |
| `TARGET_QUERY_*` | （不变） | 中台只读查询凭据 |
| `TARGET_REASONING_*` | （按中台契约填写） | 推理接口地址 / Agent ID / Token |

4. 确认能力注册带 `constraints`（**关键，缺这个派单会被 `WRITE_FORBIDDEN` 拒绝**）：

   在 `aeos-execution-agent/src/main.js` 两个能力里加：

   ```js
   // query_control_platform 里加：
   constraints: { readOnly: true },

   // reason_control_platform 里加：
   constraints: { readOnly: true, requireEvidence: true },
   ```

   （最新代码 `127b013` 的 `main.js` 已带这两个字段；若你在旧代码上自行适配，请确认没有漏掉。）

5. 重启 Agent。

## 验证

- 管理面「执行面」列表里**只有 1 个在线 Agent**：ID `runtime-control-platform-agent`、名称「公司中台执行面智能体」。
- 派一个只读查询能正常返回（不再报 `WRITE_FORBIDDEN`）。
- 推理能力：若中台推理接口已就绪，需在 `aeos-execution-agent/src/adapters/reasoning-adapter.js` 填入真实调用实现（当前为占位，返回「未接通」）。
