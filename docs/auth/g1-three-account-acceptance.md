# G1 三账号人工验收

本指引用于首个闭环（订单交付风险或物料齐套缺口）的人工验收。Keycloak/M01 是账号、组织、租户和角色的唯一权威来源；AEOS Hub 不创建账号、不保存密码，也不提供账号管理 API。角色以 `docs/auth/role-permission-matrix.md` 为准：`owner` 已退休，业务核验由 `manager` / `supervisor` 承担。

## 前置条件

在同一个 M01 租户与组织中，由 Keycloak 管理员手动准备以下三个**不同的人工账号**：

| 用途 | 建议显示名 | 必需 Hub 角色 |
| --- | --- | --- |
| 经理 | `manager-demo` | `manager` |
| 经办人 | `operator-demo` | `operator` |
| 业务核验人 | `owner-demo` | `supervisor`（旧文档中的 `owner` 已并入 manager/supervisor） |

请按 M01 当前的租户、组织和角色映射规范完成配置，且确保三个账号都能通过 Hub 的 M01 登录准入。不要将密码、访问令牌、客户端密钥或会话 Cookie 写入本仓库、截图或测试输出。

## 记录稳定 actor ID

分别使用三个独立浏览器配置文件（或隐私窗口）登录 Hub。每个账号登录后，在已认证的浏览器会话中请求：

```text
GET /api/auth/session
```

记录响应里的 `actorId`，而不是根据用户名猜测。例如 M01 人工账号通常显示为 `m01:user:<subject>`。同时确认三人的 `tenantId` 和 `organizationId` 相同，且 `actorType` 为 `human`。不要保存或转发 Cookie、Authorization header 或任何 token。

## 登记 G0

1. 用 `manager-demo` 登录，在“系统配置 → G0 决策登记”中登记首个闭环为“订单交付风险”。
2. 使用上一步实际读取到的稳定 actor ID 填写业务 Owner、Verify 人和三账号授权安排。业务 Owner 和 Verify 人必须不同；三账号也必须互不相同。
3. 任务中心决策选择“复用现有任务中心”，G4 准入保持“G1 完成前保持阻断”。
4. 保存后确认 G0 显示已具备进入 G1 的决策条件。若没有满足，不继续任务验收。

## 三浏览器验收顺序

1. 在经理浏览器中，从带 Evidence 的订单来源经营事项创建任务。质量、齐套等非订单来源事项不应在创建下拉框中出现。
2. 经理打开“分派责任”，输入责任角色、`operator-demo` 实际 actor ID 和分派说明。请求体应只包含 `assigneeRole`、`assigneeActorId`、`reason`，不得包含当前账号、租户或角色声明。
3. 在经办人浏览器中，确认只对其 actor ID 被分派的任务显示“接受、开始、补充证据、登记待核验结果”。使用其他 operator 账号时不应显示这些变更控件。
4. 经办人提交待核验结果后，在业务核验人浏览器中确认只有 G0 登记的 `owner-demo` actor ID 才显示“业务核验”。另一个带 `supervisor` 角色的账号不得显示核验或退回控件。
5. Owner 核验通过或退回。确认任务台账显示责任角色、具体经办 actor ID 和核验后的状态。
6. 以 Agent、system 或 service 身份登录（如该环境允许此类只读会话）时，确认不显示创建、分派、接受、开始、补证、提交结果、核验或退回等变更控件。

浏览器表现仅用于减少误操作；每一步都必须以服务端返回为准。服务端应拒绝伪造 actor ID、角色、租户或错误经办人/Owner 的请求并留下安全审计记录。
