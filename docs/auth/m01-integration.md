# M01 Keycloak 本地开发/测试接入

本说明为 AEOS Hub M01 身份接入提供独立、可审核的本地开发/测试栈。`deploy/m01/docker-compose.yml` 只包含 Keycloak、私有 PostgreSQL 和本机 TLS 反代；它**不修改也不替代**根目录的 Hub Compose。首次运行时 Docker 会自行创建命名卷并拉取 PostgreSQL 16 与 Keycloak 26.8.0 镜像，不需要预先手工安装数据库。

此配置使用 `start-dev` 和 Caddy `tls internal`，只允许在开发/测试机使用。生产必须由正式的 HTTPS 反向代理或负载均衡器终结 TLS，使用受管密钥、独立备份与恢复演练；不得把本配置直接作为生产方案。

## 1. 本地身份栈

从仓库根目录复制模板并替换所有密码（`.env` 已被忽略，绝不提交）：

```powershell
Copy-Item deploy/m01/.env.example deploy/m01/.env
docker compose --env-file deploy/m01/.env -f deploy/m01/docker-compose.yml config
docker compose --env-file deploy/m01/.env -f deploy/m01/docker-compose.yml up -d
```

必须设置的变量如下。模板中的密码均为无效占位/开发示例，实际启动前必须替换。

| 变量 | 用途 |
| --- | --- |
| `M01_KEYCLOAK_HTTPS_PORT` | Caddy 在 `127.0.0.1` 上监听的 HTTPS 端口，例如 `8443`。 |
| `M01_KEYCLOAK_EXTERNAL_HOSTNAME` | Keycloak 对外 hostname；默认本机 `localhost`。 |
| `KEYCLOAK_ADMIN_USERNAME` / `KEYCLOAK_ADMIN_PASSWORD` | 仅用于 bootstrap 的 `master` realm 平台管理员。 |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | Keycloak 私有 PostgreSQL 16 数据库凭据。 |

PostgreSQL 与 Keycloak 均没有宿主机端口；只有 Caddy 的 `127.0.0.1:<M01_KEYCLOAK_HTTPS_PORT>` 可访问。Keycloak 在容器网络使用 HTTP，`KC_HOSTNAME` 固定其公开 HTTPS 地址，`KC_PROXY_HEADERS=xforwarded` 接受 Caddy 传递的代理头，因此 discovery 返回的 issuer 必须是 `https://localhost:<port>/realms/aeos`（或你明确配置的本机 hostname）。

### 信任本地开发 CA

`tls internal` 会生成一套只适用于此开发机的 Caddy 根 CA。浏览器和 Hub 必须信任它，才能安全访问 HTTPS issuer；不要跳过证书错误。先查看导出的证书来源与指纹，再按本机安全规范导入当前用户的受信任根证书存储。例如 Windows 可按以下流程操作：

```powershell
docker compose --env-file deploy/m01/.env -f deploy/m01/docker-compose.yml cp caddy:/data/caddy/pki/authorities/local/root.crt deploy/m01/caddy-root.crt
Import-Certificate -FilePath .\deploy\m01\caddy-root.crt -CertStoreLocation Cert:\CurrentUser\Root
```

导出的证书被 `.gitignore` 忽略。若重建 `caddy-data` 命名卷，CA 会变化，需重新审核并信任新根证书。生产应由受信任证书链提供 HTTPS，不得导入此开发 CA。

## 2. Keycloak 人工配置契约

本试点不导入 Realm：不将任何默认账户、示例密码或不可审计的 Realm JSON 写入仓库。使用 `https://localhost:<port>/` 的 Administration Console 以 bootstrap 管理员登录，并手工完成、复核和记录以下清单。

1. 创建 Realm **`aeos`**。`master` realm 只保留平台管理员；不要在其中创建或登录 AEOS 业务用户。
2. 在 `aeos` 创建浏览器 Client **`aeos-hub-web`**：类型 confidential，启用 Client authentication 和 Standard Flow，token endpoint authentication method 为 **`client_secret_basic`**。关闭不需要的 implicit、direct grant、device 等 flow。
3. `Valid redirect URIs` 只填写精确地址 `https://<hub-host>/api/auth/callback`；`Web origins` 只填写精确 Hub origin `https://<hub-host>`。不得用 `*`、通配域或仅主机路径。`<hub-host>` 必须与 `M01_REDIRECT_URI` 一致；生产必须为 HTTPS。
4. 为浏览器 Client 的专用 client scope 配置并加入 **ID token** 的 mapper：
   - `tenant_id`：User Attribute mapper，claim 名称 `tenant_id`，单值；同时在 Realm User Profile 中把该属性设为必填。Hub 缺少或为空时会拒绝登录。
   - `organization_id`：User Attribute mapper，claim 名称 `organization_id`，单值、可选；未设置时不要伪造值。
   - `roles`：Realm Role mapper，claim 名称 `roles`，JSON 类型 `String`、multivalued；Hub 只读取顶层 `roles` 数组。
   - audience：Audience mapper，把 `aeos-hub-web` 加入 ID token 的 `aud`。本接入把 `M01_AUDIENCE` 设为同一值，Hub 会同时验证 client ID 与 audience。
5. 仅对服务账号 Client 的专用 scope 添加 Hardcoded claim mapper：`aeos_actor_type=service`。不要把该 mapper 加到人类浏览器 Client；服务 token 还必须包含该 Client 的 `client_id` 或 `azp`、`tenant_id`、正确 audience 和最小 roles。

每个智能体使用一个独立 Client + Service Account + 最小角色集合；禁止共享 browser Client secret、共享服务账号或授予 realm-admin。创建/修改 mapper 后取得一个 ID token，确认顶层 claims 与上述名称、类型完全一致，再允许 Hub 接入。

## 3. Hub M01 环境变量

在实际运行 Hub 的受保护环境中精确设置以下变量。不要把 `M01_CLIENT_SECRET`、Keycloak bootstrap 密码或 PostgreSQL 密码提交到 `.env.example`、日志或版本库。

```text
AEOS_AUTH_MODE=m01
M01_ISSUER=https://localhost:8443/realms/aeos
M01_CLIENT_ID=aeos-hub-web
M01_CLIENT_SECRET=<从 Keycloak 生成并安全保存的 client secret>
M01_REDIRECT_URI=https://<hub-host>/api/auth/callback
M01_AUDIENCE=aeos-hub-web
AEOS_COOKIE_SECURE=1
```

将 `8443` 替换为 `M01_KEYCLOAK_HTTPS_PORT`，并让 `M01_ISSUER` 与 discovery 的 `issuer` 逐字一致。`M01_REDIRECT_URI` 的 pathname 必须精确为 `/api/auth/callback`；生产必须是 HTTPS，且生产环境固定 `AEOS_COOKIE_SECURE=1`。根目录 `docker-compose.yml` 目前没有传递 `M01_*` 变量，仍是现有 Hub 的 local-dev Compose；若将 Hub 容器化运行，必须在受控部署定义中显式、安全地注入上述完整变量，不能仅复制本仓库模板后假定已切换 M01。

首次登录前执行配置检查：

1. 从已信任开发 CA 的浏览器或 Hub 主机访问 `https://localhost:<port>/realms/aeos/.well-known/openid-configuration`，确认 `issuer` 为预期 HTTPS URL，且 authorization、token、JWKS endpoint 都为 HTTPS。
2. 确认 `aeos-hub-web` 的 redirect URI/web origin 无通配符，authentication method 为 `client_secret_basic`，并保存其 secret 到部署密钥库。
3. 使用带 `tenant_id` 和允许 role 的测试用户完整登录一次；检查 Hub session 的 actor、tenant、roles，且不记录 token 或 client secret。

## 4. 运维边界

- **密钥轮换：** 先在 Keycloak 生成新 client secret，更新 Hub 的密钥注入并滚动重启 Hub，验证登录后再撤销旧 secret；保留变更记录。服务 Client 分别轮换，不能借用浏览器 Client secret。
- **备份/恢复：** 定期以 PostgreSQL 的逻辑备份备份 `keycloak` 数据库并加密后存放到仓库外；恢复只在隔离环境先演练。同步保护 Caddy `caddy-data` 中的本地 CA；丢失它会导致已信任的开发证书失效。生产备份、RPO/RTO 和密钥恢复由正式平台流程负责。
- **回退/故障：** Keycloak 或其 TLS 不可用时，将 Hub 置于维护模式或停止对外服务，提示管理员恢复 M01；不得通过设置 `AEOS_AUTH_MODE=local-dev`、公开默认账号或关闭 secure cookie 来降级为无认证访问。

## 5. 验收清单

- [ ] `docker compose ... config` 通过，且端口映射仅为 `127.0.0.1:<port>:443`；没有 PostgreSQL/Keycloak 宿主机端口。
- [ ] 已信任本地 CA，discovery 的 issuer 为 HTTPS 且与 `M01_ISSUER` 一致。
- [ ] 正确 tenant 与允许 role 的用户可完成 login；缺失/错误 tenant、错误 role 的 token 被 Hub 拒绝或无相应权限，未创建可用业务会话。
- [ ] logout 清除 Hub cookies，并关闭该 Hub session 关联的 WebSocket；之后不能自动重连受保护 WebSocket。
- [ ] callback 的 state、PKCE、nonce 和浏览器 binding 被篡改、过期或跨浏览器复用时登录失败且不泄露上游细节。
- [ ] 生产演练中 `AEOS_COOKIE_SECURE=1`、HTTPS redirect URI 与精确 web origin 均生效；未出现 local-dev/无认证回退。
