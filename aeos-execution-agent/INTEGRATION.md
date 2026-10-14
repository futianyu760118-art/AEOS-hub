# 新系统接入说明

要把 AEOS 执行面智能体接入一个**新系统**（如 OA、ERP、MES、供应链），只需实现该系统的两个适配器，其余核心代码不变。

## 两种集成方式

### 方式一：独立容器 / Sidecar（推荐）

业务系统 → 本地接口或内网 → AEOS Execution Agent 容器 → 主动 WSS 连接 AEOS Hub。

- 不侵入业务系统代码；不受业务系统语言限制；独立升级/回滚/故障隔离。
- 业务系统无需向 Hub 开放入站端口。

### 方式二：SDK / 模块嵌入

目标系统技术栈兼容时，把 `src/agent-core.js` + `src/capabilities.js` 作为依赖嵌入，但须保证：
- 连接生命周期由宿主管理（`core.start()/core.stop()`）。
- 不污染宿主全局；不强制占用固定端口；不硬编码 Hub 配置。
- 嵌入模式与容器模式使用同一套协议和适配接口。

## 步骤

1. 复制本目录，改 `.env`（独立 `EXECUTION_AGENT_ID`、`EXECUTION_PLANE_TOKEN`、`EXECUTION_SOURCE_SYSTEM`）。
2. 实现 `src/adapters/query-adapter.js`：`query(request, abortSignal)` 查本系统只读数据。
3. 实现 `src/adapters/reasoning-adapter.js`：`reason(request, abortSignal, onProgress)` 调本系统推理智能体（契约未定则保持占位）。
4. 若能力不同，改 `src/main.js` 里的 `registerCapability` 调用（能力名/描述/处理器）。
5. 启动 → 自动连接 Hub → 注册 → 待命。

## 验收清单

- [ ] 启动后自动连接 Hub，Hub 能识别其来源系统与能力。
- [ ] Hub 能下发查询任务，返回进度/结果/数据时间/置信度。
- [ ] Hub 能下发推理任务，返回进度/结论/证据/置信度。
- [ ] Hub 能召回任务，Agent 同步取消。
- [ ] Agent 或 Hub 重启后自动恢复连接。
- [ ] 一个系统故障不影响其他智能体。
- [ ] 不重新编译/修改 Hub 主体代码；不携带任何 Hub 前端、数据库或业务模块。
