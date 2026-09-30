# AEOS Hub 局域网 Docker 部署

此部署仅支持单容器单副本。不要同时启动多个副本：当前会话、Evidence、每日问题和 Agent 小队使用本地文件存储。

## 部署前准备

1. 复制 `docker-compose.env.example` 为根目录 `.env`，填写 `DEEPSEEK_API_KEY`。首次启动时会自动建立 DeepSeek 模型配置；已有模型配置也可以在启动后通过系统配置界面维护。
2. 配置 `mcp-company-control/.env` 的中控地址及凭据。容器以只读方式挂载此文件；容器内的 `127.0.0.1` 是容器自身，中控在其他主机时必须填写该主机的局域网地址或可访问域名。
3. 不要把两个 `.env` 文件、`data` 或 `.codex-home` 提交到 Git。

## 首次部署前迁移现有状态

本机已创建的 AI 港湾 Agent、Agent 小队、会话与 Evidence 位于 `data/`，不会自动进入新的 Docker 数据卷。首次部署前运行：

```powershell
.\docker\seed-state.ps1
```

脚本只会在目标 Docker 数据卷为空时导入，若卷中已有内容会拒绝覆盖，避免误删运行中数据。模型认证默认不导入；已在根目录 `.env` 配置 `DEEPSEEK_API_KEY` 时无需额外操作。若需迁移既有 Codex 登录状态，才显式执行：

```powershell
.\docker\seed-state.ps1 -IncludeCodexHome
```

若旧版容器仍在运行、其 DeepSeek Key 已注入但根目录 `.env` 遗失，可在重建前恢复该部署配置（不会输出密钥）：

```powershell
.\docker\seed-state.ps1 -AdoptRunningDeepSeekKey
```

Compose 会先运行一次初始化容器，为数据卷设置应用账号权限；这是新建数据卷正常启动所必需的步骤。

## 启动

```powershell
Copy-Item docker-compose.env.example .env
docker compose up -d
docker compose ps
docker compose logs -f aeos-hub
```

默认仅绑定 Docker 主机本机地址 `127.0.0.1:8787`。确认本机可访问后，才将 `.env` 的 `AEOS_BIND_ADDRESS` 改为 `0.0.0.0` 并重启：

```powershell
docker compose up -d
```

局域网开放前，必须在宿主机防火墙仅放行可信办公网段访问 `AEOS_PORT`；保持应用访问口令开启，严禁设置 `HUB_NO_AUTH=1`。

首次访问时，管理员从运行数据卷读取一次访问口令并通过受控渠道分享；服务日志不会打印口令：

```powershell
docker compose exec aeos-hub cat /app/data/access-token.txt
```

## 数据与密钥

- `aeos-data`：会话、Evidence、访问口令、每日问题和 Agent 小队数据。
- `aeos-codex-home`：Codex 会话、模型配置和认证状态。
- 中控凭据以只读方式挂载为宿主机 `mcp-company-control/.env`，未写入镜像或容器环境变量。

备份前先停止容器，并同时备份两个 Docker volume。不要执行 `docker compose down -v`，除非明确要删除全部运行数据和模型配置。
