# Hub 人员与权限管理（Personnel Administration）

> 面向试点（G0 → G1）的 Hub「系统配置 → 人员与权限」操作说明。**Keycloak 始终是账号、密码、租户、组织与角色的唯一权威数据源**；Hub 只是受约束的管理入口，不保存、不缓存、不回显任何账号凭据。

## 定位与边界

- 仅 **已登录、M01 身份为 `human` 且含 `manager` 角色** 的用户可用。
- 仅开放给 **G0 ready 且 `firstScenario = order_delivery_risk`**、且当前 actor 的 `tenantId` / `organizationId` 与 G0 `scope` **精确匹配** 的会话。
- 可管理的对象范围**永远来自服务端认证会话**，浏览器请求里的 `actorId`、`tenantId`、`organizationId`、`roles` 一律不采信。
- 只能分配 `manager` / `operator` / `owner` 三种角色；不提供 realm-admin、客户端、组、mapper、协议映射等任何 Keycloak 配置管理。
- Hub **不保存、不回显、不记录** 密码、Token、Client Secret 或 Keycloak 原始错误；密码仅在创建/重置时转发给 Keycloak，并强制 `temporary`。
- 跨 scope 的用户对外表现为**不存在**（不泄露信息）。

## 一次性开通（provisioning）

前提：`deploy/m01/.env` 已按模板配置完成，M01 Keycloak 容器已在运行（`scripts/start-m01-demo.ps1`）。

```powershell
# 演练（只打印计划，不写入、不打印密钥）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/provision-m01-personnel-admin.ps1 -WhatIf

# 正式开通（会提示确认；在 .env 生成/复用被忽略的 Client Secret，并重建 keycloak 容器后执行 kcadm）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/provision-m01-personnel-admin.ps1
```

该脚本只会：

- 创建或收敛机密客户端 `aeos-hub-personnel-admin`（`serviceAccountsEnabled=true`、`publicClient=false`、关闭标准流/直连授权）；
- 写入 `deploy/m01/.env` 中被忽略的 `M01_PERSONNEL_ADMIN_CLIENT_SECRET`；
- 授予其服务账号**最小** `realm-management` 权限：`query-users`、`manage-users`、`view-realm`（只读角色查找）。

它**不会**创建业务用户、修改浏览器 OIDC 客户端 `aeos-hub-web`、授予 `realm-admin`。

### 启用 Hub 侧入口

在 `deploy/m01/.env` 中设置：

```bash
M01_PERSONNEL_ADMIN_ENABLED=1
```

然后重启 Hub（`scripts/run-m01-hub.ps1` 会 fail-closed：仅当 flag 为真**且** Client Secret 非哨兵值时才注入 `M01_PERSONNEL_ADMIN_*`，否则强制 `M01_PERSONNEL_ADMIN_ENABLED=0`）。

## 日常操作

在 Hub 进入「系统配置 → 人员与权限」：

- **查询**：按用户名搜索当前 G0 试点租户 + 组织范围内的用户。
- **创建**：设置用户名 + 临时密码（必填，强制 `temporary`）与 `manager/operator/owner` 角色；租户/组织固定为当前 G0 scope。
- **启用/停用**：停用需二次确认。
- **角色**：替换为目标用户的 pilot 角色集合；替换需二次确认。
- **重置临时密码**：弹窗确认后转发给 Keycloak，`temporary=true`；Hub 不显示、不保存密码。

每次成功/拒绝的人员变更都会写入脱敏 Evidence；若 Keycloak 已提交但 Evidence 追加失败，响应会明确返回 `committed: true` 与 `auditStatus: 'failed'`。

## 保护规则

- manager 不能停用自己、不能移除自身的 `manager` 角色。
- 不能停用或降权本 scope 的**最后一位有效 manager**（避免把试点租户锁死成无 manager 状态）。

## 应急恢复（在 Keycloak 侧）

人员管理入口依赖 `aeos-hub-personnel-admin` 服务账号。若该客户端被误删、Secret 丢失或权限被误改：

1. 用 Keycloak bootstrap 管理员登录 Keycloak 管理台（realm `aeos`）。
2. 删除/重建客户端 `aeos-hub-personnel-admin`（机密、启用 service account），或直接修正其 `realm-management` 角色。
3. 重新运行 `scripts/provision-m01-personnel-admin.ps1` 完成幂等收敛。

密码、账号启用状态、租户/组织属性与角色分配始终以 Keycloak 为准；Keycloak 管理台是最终兜底入口。
