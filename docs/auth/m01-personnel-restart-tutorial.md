# M01 人员与权限：开通与重启教程

本教程用于启用 AEOS Hub 的“系统配置 → 用户管理 / 角色管理 / 权限管理”功能。该功能仅在 **M01/Keycloak 模式**下可用。

> 适用目录：`G:\PyCharm\aeos-hub`  
> 不要将 `.env`、密码、Client Secret、浏览器 Cookie 或 Token 发到聊天、截图或 Git 仓库。

## 0. 这次操作会做什么

- 创建或收敛 Keycloak 的专用服务客户端 `aeos-hub-personnel-admin`；它不是浏览器登录 Client，也不会拥有 `realm-admin`。
- 在被 Git 忽略的 `deploy\m01\.env` 中生成或复用服务客户端密钥。
- 开启 Hub 的人员管理功能，并重启 Hub 进程加载新代码与配置。

不会做什么：

- 不会创建业务用户；
- 不会删除既有用户、数据库卷或 Caddy 本地 CA；
- 不会打印密码、Token 或 Client Secret；
- 不会修改 `aeos-hub-web` 浏览器登录 Client。

## 1. 前置条件

1. 在运行 Hub 的 Windows 机器上操作，不是在普通用户目录或其他电脑的终端中操作。
2. Docker Desktop 已启动并处于运行状态。
3. 项目目录存在：`G:\PyCharm\aeos-hub`。
4. 已存在 `deploy\m01\.env` 和 `deploy\m01\caddy-root.crt`。
5. Keycloak 身份栈可正常运行，且你具备执行本机脚本的权限。

打开 PowerShell 后，先进入项目目录并检查文件：

```powershell
Set-Location G:\PyCharm\aeos-hub

Test-Path .\scripts\provision-m01-personnel-admin.ps1
Test-Path .\deploy\m01\.env
Test-Path .\deploy\m01\caddy-root.crt
```

三条命令都应输出 `True`。若第一条是 `False`，说明当前机器的代码尚未包含该功能；先同步代码，再继续。

## 2. 先进行只读演练

先运行 M01 状态检查：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-m01-demo.ps1 -WhatIf
```

然后演练人员管理服务客户端开通：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\provision-m01-personnel-admin.ps1 -WhatIf
```

预期结果包含类似下面的文字：

```text
WhatIf: would reconcile Keycloak confidential client 'aeos-hub-personnel-admin' ...
```

`-WhatIf` 不会修改 Keycloak，也不会写入 `.env`。如果出现“脚本不存在”，请确认 PowerShell 当前目录是 `G:\PyCharm\aeos-hub`。

## 3. 正式开通 Keycloak 服务客户端

确认演练正常后，运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\provision-m01-personnel-admin.ps1
```

PowerShell 会要求确认。确认后，脚本会：

1. 在 `deploy\m01\.env` 生成或复用服务客户端密钥；
2. 只重建/启动 Keycloak 容器以读取该密钥；
3. 在 Keycloak 中创建或更新 `aeos-hub-personnel-admin`；
4. 确保 `manager`、`operator`、`owner` 三个 Hub 保护角色存在；
5. 为其服务账号授予 `query-users`、`manage-users`、`view-realm`、`manage-realm`；不授予 `realm-admin`。
6. 收敛员工 User Profile：员工不能查看或修改邮箱、姓名、租户、组织和 OA 同步属性；新账号首次登录只修改临时密码。

成功后会提示将 `M01_PERSONNEL_ADMIN_ENABLED` 设为 `1`。不要复制、打印或查看生成的密钥值。

## 4. 启用功能开关

以文本编辑器打开被忽略的运行时配置：

```powershell
notepad .\deploy\m01\.env
```

新增或修改以下一行：

```text
M01_PERSONNEL_ADMIN_ENABLED=1
```

保存并关闭编辑器。不要更改 `M01_PERSONNEL_ADMIN_CLIENT_SECRET`，不要把该文件加入 Git。

## 5. 重启 Hub（保留 Keycloak 数据）

停止 Hub，但保留 Keycloak、PostgreSQL 数据卷和 Caddy CA：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-m01-demo.ps1 -KeepIdentityStack
```

再启动 Hub：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-m01-demo.ps1 -NoBrowser
```

等待几秒后访问：

- 局域网演示：`https://aeos-hub.test:9444`
- 本机配置：使用 `deploy\m01\.env` 中配置的 Hub HTTPS 地址和端口。

不要执行 `docker compose down -v`；该命令会删除 Keycloak 数据卷和 Caddy CA。

## 6. 登录后的验收

使用一个拥有 `manager` 角色的 **M01 人工账号** 登录。确认：

1. `GET /api/auth/session` 返回 `authenticated: true`、`actorType: "human"`，且 `roles` 中包含 `manager`。
2. 当前会话的 `tenantId`、`organizationId` 与 G0 已登记并就绪的试点范围一致。
3. 打开“系统配置”，可以看到“用户管理”“角色管理”“权限管理”三个入口。
4. 创建测试用户时，只能选择 `manager`、`operator`、`owner` 三种角色。
5. 重置密码后，密码输入框会被清空；页面、审计记录和接口响应均不应显示该密码。
6. 用新建账号登录时只会看到临时密码修改页面，不应看到“更新账户信息”或 `tenant_id`、`organization_id` 输入项。

如果 G0 未就绪，或当前 manager 的租户/组织与 G0 scope 不一致，人员管理应保持不可用/只读。这是预期的安全行为。

## 7. 常见问题

### 脚本提示“文件不存在”

通常是当前目录不在仓库根目录。执行：

```powershell
Set-Location G:\PyCharm\aeos-hub
```

然后重新运行命令；也可改用脚本完整路径。

### Hub 重启后看不到三个管理入口

依次确认：

1. `.env` 包含 `M01_PERSONNEL_ADMIN_ENABLED=1`；
2. 已成功运行 provisioning 脚本；
3. 是通过 M01 模式而非 local-dev 模式启动；
4. 当前登录账号是 `human` 且含 `manager` 角色；
5. G0 已 ready，且 tenant/organization 与当前会话完全匹配；
6. Hub 已在修改配置后重启。

### `operator` 或 `owner` 无法登录

确认 Keycloak 的 ID Token 顶层 `roles` claim 含有对应角色。当前 Hub M01 启动脚本会允许 `manager`、`operator`、`owner`、`analyst` 进入 Hub；但具体任务操作仍由服务端 RBAC 决定。

### 需要临时关闭人员管理

将 `.env` 中的开关改回：

```text
M01_PERSONNEL_ADMIN_ENABLED=0
```

然后按第 5 节重启 Hub。Keycloak 中既有用户和服务客户端会被保留，但 Hub 不再提供人员管理接口和界面。

## 8. 应急恢复

如果人员管理服务客户端被误删、密钥丢失或权限被改坏：

1. 临时把 `M01_PERSONNEL_ADMIN_ENABLED` 改为 `0`，重启 Hub；
2. 使用 Keycloak bootstrap 管理员进行紧急恢复，或重新运行第 3 节 provisioning 脚本；
3. 完成后重新启用开关并重启 Hub。

Keycloak 管理台始终是人员身份数据的最终兜底入口；Hub 只是安全受限的日常管理界面。
