# AEOS Agent 控制平面架构 v1

**状态：** M03 最小可用实施设计  
**范围：** 本机 AEOS Hub 试点；只读业务分析基础上，为后续 HRM、ERP、MES、WMS、CRM 等系统接入准备可治理的多级 Agent 注册底座。

## 1. 本阶段要解决的问题

后续系统 Agent 不能只靠名称或提示词被临时调用。决策者需要回答：某个 Agent 属于哪个系统、谁负责、当前是否允许启用、能使用哪些运行能力、由谁管理，以及停止它会影响什么。

M03 只先建立这份可验证的“Agent 身份档案”和组织层级；它不改变当前 AEOS Hub 的只读业务分析、登录、经营看板、Agent 小队协作或已有任务下发逻辑。

## 2. 当前本地控制平面

```text
用户 / 管理者
       │  M01 身份与审计（已有）
       ▼
AEOS Hub 控制平面
  ├─ AI Harbor：Agent Definition（M03）
  │    ├─ Hub Agent（唯一根节点）
  │    ├─ 系统主 Agent（HRM / ERP / MES …）
  │    ├─ 专业 Agent（订单、质量、考核 …）
  │    └─ Tool Agent（受限的末端工具代理）
  ├─ Harbor Runtime：执行环境引用（已有）
  ├─ allowedRuntimeCapabilities：每个 Agent 的显式能力白名单（M03）
  ├─ Capability Registry：已接入 MCP 业务能力的展示目录（已有）
  └─ Evidence：身份、工具和结果的证据记录（已有）
       │
       ▼
受控 Runtime / MCP / Adapter
       │
       ▼
业务系统（当前仅 demo-ERP；其它系统后续接入）
```

## 3. M03 的四类对象映射

| 目标对象 | M03 落地位置 | 当前职责 |
|---|---|---|
| Agent Definition | `HarborAgent.registration` | 编码、类型、所属组织、业务域、生命周期、能力白名单 |
| Runtime | `HarborRuntime` | Agent 可使用的本机/远程执行环境与其声明能力 |
| Binding | `parentAgentId`、`runtimeId`、`allowedRuntimeCapabilities` | 组织从属、执行环境绑定、受限能力绑定 |
| Capability | Runtime 的已声明能力；MCP 的 `Capability Registry` | M03 仅允许绑定已声明能力；统一业务契约以后续目录模块落地 |

`status` 仍仅表示运行活动状态（例如 idle、working、offline），而 `registration.lifecycle` 表示治理状态（draft、active、suspended、retired）。两者不得混用。

## 4. 固定组织层级

本地组织树只有一个 Hub 根节点，且不允许循环：

```text
Hub / L0
└─ System master / L1
   └─ Specialist / L2
      └─ Tool / L3
```

- **Hub（L0）**：唯一根节点，负责跨域治理与后续路由；不归属其他 Agent。
- **System master（L1）**：一个业务系统的任务入口，例如 `hrm-master`、`erp-master`。
- **Specialist（L2）**：系统内明确数据域或业务域的专业 Agent，例如考核、订单、质量。
- **Tool（L3）**：执行最小受限工具任务的代理；必须归属某个 Specialist。

这种树只表示责任与治理归属。未来“谁可调用谁”将采用独立的有向调用图，不能因为上下级关系自动继承全部能力。

## 5. 安全与可追溯边界

- Agent 只能使用其 `runtimeId` 对应 Runtime 已声明、且被 `allowedRuntimeCapabilities` 明确许可的能力。
- 不登记“任意 SQL”“任意 URL”或隐含写入权的能力。
- 新登记的非 Hub Agent 默认处于 `draft`，后续启用必须经过版本、策略与审批能力建设。
- M01 的用户身份和 Evidence 审计仍是调用链基础；未来路由、工具调用、审批和工作流记录必须带上用户、Agent、Capability、策略与版本标识。
- 旧本地数据在读取时补齐安全默认注册信息；读取本身不改写用户数据，下一次正常写入才持久化迁移结果。

## 6. 明确留给后续模块的能力

| 后续模块 | 需要增加的内容 | 前置条件 |
|---|---|---|
| Agent Version | 不可变版本、提示词/模型/Schema/白名单快照、发布与回滚 | M03 Definition |
| Capability Contract | 版本化输入输出 Schema、读写级别、数据分类、SLA | M03 Binding |
| Agent Invocation Graph | `delegates_to`、`supervises`、`fallback_to` 有向边与影响分析 | M03 组织树 |
| Routing & Workflow | 路由理由、工作流状态机、幂等与补偿 | Capability Contract |
| Policy & Approval | RBAC/ABAC、审批、脱敏、风险分级 | M01 身份与审计 |
| System Connection | 连接引用、令牌交换、健康检查、外部 Adapter | Capability Contract + Policy |

因此，M03 是后续能力的稳定边界，不是提前实现所有 Agent 功能。每个后续模块仍需按“小步实现 → 自检 → 单独审查 → 可回退提交”的方式推进。
