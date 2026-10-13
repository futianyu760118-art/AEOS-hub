# 角色权限映射表（三级：总经理 / 主管 / 普通用户）

> 状态：已实现（2026-10-13）
> 数据权威：角色分配与权限边界是 Hub/Keycloak 权威，不依赖 OA；OA 只同步显示名/部门/岗位等人员属性（见 `oa-identity-sync-contract.md`）。

## 1. 角色模型

三级角色，采用「保留现有 code、改显示名、新增中间层 code」的方式落地。

| 层级 | 显示名 | role code | 状态 | 定位 |
|---|---|---|---|---|
| L1 | 总经理 Boss | `manager` | 现有 code，改显示名 | 全量：用户/角色/权限 + 业务 + 核验 + G0/G1 |
| L2 | 主管 | `supervisor` | 新增 code | 业务管理：建/分派/核验，不管人 |
| L3 | 普通用户 | `operator` | 现有 code，改显示名 | 执行被分派的任务、只读分析 |
| （并入 L3） | — | `analyst` | 现有，暂并入 | 只读分析（不单独设角色） |
| （退休） | 业务负责人 | `owner` | 现有，退休 | 核验职责并入 L1+L2 |

## 2. 菜单可见性

| 菜单/视图 | L1 总经理 | L2 主管 | L3 普通用户 |
|---|:-:|:-:|:-:|
| 管理者首页 dashboard | ✅ | ✅ | ❌ |
| 中枢 Agent（只读分析） | ✅ | ✅ | ✅ |
| Attention 中心 | ✅ | ✅ | ✅ 仅自己负责项 |
| 任务 tasks | ✅ 全量 | ✅ 全量 | ✅ 仅自己相关 |
| 项目 projects | ✅ 全量 | ✅ 全量 | ✅ 只读成员视角 |
| AI 港湾 harbor | ✅ | ✅ | ❌ |
| Agent 小队 squad | ✅ | ✅ | ❌ |
| Evidence 证据中心 | ✅ | ✅ | ✅ 自己相关 |
| Capability Registry | ✅ | ✅ | ❌ |
| 系统配置 config | ✅ | ❌ | ❌ |
| 用户管理 | ✅ | ❌ | ❌ |
| 入职引导 | ✅ | ❌ | ❌ |
| 角色管理 | ✅ | ❌ | ❌ |
| 权限管理 | ✅ | ❌ | ❌ |

## 3. 动作权限

| 动作 | L1 总经理 | L2 主管 | L3 普通用户 |
|---|:-:|:-:|:-:|
| 建项目 | ✅ | ✅ | ❌ |
| 建协同任务 | ✅ | ✅ | ❌ |
| 建受控任务（从经营事项） | ✅ | ✅ | ❌ |
| 分派任务 | ✅ | ✅ | ❌ |
| 编辑协同任务（标题/优先级/截止） | ✅ | ✅ | ✅ 仅自己负责 |
| 任务状态流转 | ✅ | ✅ | ✅ 仅自己负责 |
| 核验任务（待核验） | ✅ | ✅ | ❌ |
| G0/G1 决策 | ✅ | ❌ | ❌ |
| 管理用户/角色/权限 | ✅ | ❌ | ❌ |
| 配置系统（模型提供商） | ✅ | ❌ | ❌ |
| 自建 Agent | ✅ | ✅ | ❌（方案 A：用现成 Agent） |
| 只读 Agent 分析 | ✅ | ✅ | ✅ |

## 4. 关键决策记录（2026-10-13）

1. `analyst` 并入普通用户，维持 3 级。
2. `owner`（业务负责人/核验）退休，核验职责并入 L1 总经理 + L2 主管。
3. 主管可见「AI 港湾 / Agent 小队」。
4. 系统配置（模型提供商）仅 Boss 可改，主管不碰。
5. 普通用户不自建 Agent（方案 A）：用中枢 Agent 做只读分析，用主管/Boss 建好的业务 Agent。

## 5. 实现要点

- **角色 code**：`manager` → 总经理、`operator` → 普通用户；新增 `supervisor`（主管）。`owner` 已从可分配 pilot 角色移除（核验归 `manager`+`supervisor`）；`analyst` 保留登录准入但不参与分配。
- **受保护角色**：`manager`、`operator` 维持 protected；`supervisor` 作为可分配 pilot 角色加入（待定是否 protected）。
- **菜单级显隐**：新增 `viewVisibleForRole(view, session)`，在导航渲染与 `showView` 处按 §2 裁剪。
- **动作级门禁**：现有 `collaborationManager()`（建/分派/核验）扩展到 `manager` + `supervisor`；用户/角色/权限管理仅 `manager`。
- **环境变量**：`AEOS_M01_ALLOWED_ROLES` 增补 `supervisor`，Keycloak 端同步建对应 realm role。
