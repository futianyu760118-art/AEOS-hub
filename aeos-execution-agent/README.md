# AEOS 执行面智能体（aeos-execution-agent）

独立部署、可嵌入的执行面智能体。它通过 WebSocket **反向连接** AEOS Hub，承载两类能力：

- `query_control_platform`：精确查询目标系统只读业务数据（HMAC 只读 REST）。
- `reason_control_platform`：调用目标系统自有大模型 / 推理智能体完成只读分析。

本包**不是 AEOS Hub 的复制品**，不含 Hub 前端、数据库、任务中心、项目、管理后台。它只依赖公开的「执行面通信协议」（见 AEOS Hub 仓库 `docs/execution-plane-agent-contract.md`）。

## 快速启动

```bash
cp .env.example .env          # 填入真实配置，不要提交 .env
npm install
npm start
```

启动后自动完成：读取配置 → 连接 Hub → 身份认证 → 注册 Agent → 注册查询与推理能力 → 心跳 → 待命 → 断线自动重连（指数退避）。

## Docker 独立部署（推荐企业方式）

```bash
docker compose -f docker-compose.example.yml up -d aeos-execution-agent
```

停止：`docker compose -f docker-compose.example.yml down`

## 配置（全部走环境变量，不硬编码）

见 `.env.example`。每个接入系统必须使用独立的 `EXECUTION_AGENT_ID`、`EXECUTION_PLANE_TOKEN`、来源系统标识、目标系统凭证与能力白名单。

## 安全边界

- 默认只读；不修改订单、库存、质量、生产、供应数据。
- 令牌、HMAC secret、中台密钥绝不写入代码、镜像、前端、日志或示例文件。
- 日志输出到 stdout/stderr；关键事件（注册/派单/完成/失败/召回）留痕。
- 推理能力：默认只读，要求结论带 evidence_refs；无证据结论标记低置信度；`STALE_DATA` / `UPSTREAM_UNAVAILABLE` / 空结果分别处理，不返回“没有风险 / 没有问题”。

## 能力扩展

新增能力 = `registerCapability({ name, description, handler })`，不改 WebSocket 核心：

```js
import { registerCapability } from './src/capabilities.js';
registerCapability({ name: 'query_oa', description: '查询 OA 数据', handler: oaQueryAdapter });
```

以后接入 `query_mes` / `reason_erp` / `query_autonomous_system` 等，只替换 `src/adapters/` 下的适配器。

## 适配接口

- 查询：`query(request, abortSignal)`，`request = { path, params }`。
- 推理：`reason(request, abortSignal, onProgress)`，`request = { prompt, task_type, context, constraints }`。

## 健康检查 / 故障排查

- 健康检查：容器 `HEALTHCHECK`（进程存活）+ Hub 心跳（业务健康）。
- 断线重连：指数退避，最大 30s；重启自动恢复。
- 排查：`npm start` 前台运行看日志；确认 `EXECUTION_WS_URL`、`EXECUTION_PLANE_TOKEN` 与 Hub 一致。

## 升级与回滚

- 升级：重新构建镜像 `docker compose build aeos-execution-agent` 后 `up -d`。
- 回滚：回退镜像版本（版本化制品），Agent 会因断线自动重连恢复。

## 推理能力现状（重要）

中台推理接口契约尚未提供，`src/adapters/reasoning-adapter.js` 当前返回明确「未接通」结果，**未伪造已联通中台大模型**。契约确认后只替换该文件。
