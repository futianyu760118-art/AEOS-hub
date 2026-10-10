# M01 本机启动与停止

本说明只针对本机 M01 演示环境：Hub 位于 `http://127.0.0.1:8790`，Keycloak 位于 `https://localhost:9443`。它不开放局域网访问，也不创建第二个数据库；账号、密码和身份数据仍由现有的 Keycloak PostgreSQL 容器管理。

## 使用前检查

在仓库根目录、以普通 PowerShell 执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-m01-demo.ps1 -WhatIf
```

该命令只检查 Docker、本机证书、运行配置和端口状态，且不会显示 `.env` 内的值，更不会启动或停止任何服务。

## 启动

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-m01-demo.ps1
```

脚本会确认 `deploy/m01/.env` 和本机 CA 证书存在，启动已存在的 Docker 身份栈，等待 Keycloak discovery 可用，然后启动本机 8790 端口的 Hub。若已是本脚本启动的 Hub，重复运行不会再开一个实例。浏览器访问 `http://127.0.0.1:8790` 后按登录页面进入即可。

预演而不做任何修改：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-m01-demo.ps1 -WhatIf
```

## 停止

停止 Hub 和身份栈，但保留用户、Realm、PostgreSQL 数据卷及 Caddy 本机 CA：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-m01-demo.ps1
```

仅停止 Hub、继续保留 Keycloak：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-m01-demo.ps1 -KeepIdentityStack
```

请勿执行 `docker compose down -v`。它会删除 Keycloak 的数据库卷和 Caddy 本机 CA，导致已有账号、Realm 或本机信任链丢失。

## 故障恢复

若 Docker Desktop 未启动，先从 Windows 启动 Docker Desktop，等它显示运行中后再次执行 `start-m01-demo.ps1`。若 8790 已被非 AEOS 程序占用，脚本会拒绝停止该程序；请先确认占用来源后自行释放端口。运行日志需要排障时，可在仓库根目录直接执行 `scripts\run-m01-hub.ps1`，不要把 `.env` 内容复制到终端或聊天中。

## 后续可选：登录后自动启动（未执行）

当前脚本**不会**创建 Windows Scheduled Task。待本机运行稳定、且你明确批准后，可以在“任务计划程序”创建任务：

- 任务名称：`AEOS Hub M01 Local Start`
- 触发器：`At log on`
- 程序：`powershell.exe`
- 参数：`-NoProfile -ExecutionPolicy Bypass -File "G:\PyCharm\aeos-hub\scripts\start-m01-demo.ps1" -NoBrowser`
- 起始于：`G:\PyCharm\aeos-hub`
- 权限：默认无需最高权限；仅在你的 Docker Desktop 安装策略要求时才选择“使用最高权限运行”。

创建计划任务属于持续性的 Windows 配置变更，必须单独获得你的确认。若将来要让局域网其他机器访问，应另行实施 HTTPS、证书、域名和防火墙方案，不能直接把当前 8790 HTTP 服务暴露出去。
