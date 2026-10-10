# M01 Keycloak 本地开发/测试接入

本说明为 AEOS Hub M01 身份接入提供独立、可审核的本地开发/测试栈。`deploy/m01/docker-compose.yml` 只包含 Keycloak、私有 PostgreSQL 和本机 TLS 反代；它**不修改也不替代**根目录的 Hub Compose。首次运行时 Docker 会自行创建命名卷并拉取 PostgreSQL 16 与 Keycloak 26.8.0 镜像，不需要预先手工安装数据库。

此配置使用 `start-dev` 和 Caddy `tls internal`，只允许在开发/测试机使用。生产必须由正式的 HTTPS 反向代理或负载均衡器终结 TLS，使用受管密钥、独立备份与恢复演练；不得把本配置直接作为生产方案。

## 1. 本地身份栈

从仓库根目录复制模板并替换 sentinel 管理员凭据和数据库密码（`.env` 已被忽略，绝不提交）：

```powershell
Copy-Item deploy/m01/.env.example deploy/m01/.env
docker compose --env-file deploy/m01/.env -f deploy/m01/docker-compose.yml config
docker compose --env-file deploy/m01/.env -f deploy/m01/docker-compose.yml up -d
```

必须设置的变量如下。模板中的 `__REPLACE_BEFORE_START__` 是故意不可启动的 sentinel，不是示例密码：复制后未替换时，`docker compose ... config` 会通过静态检查，但 `docker compose ... up` 会由 `m01-config-check` 故意失败，且 PostgreSQL 与 Keycloak 均不会启动。

| 变量 | 用途 |
| --- | --- |
| `M01_KEYCLOAK_HTTPS_PORT` | Caddy 在 `127.0.0.1` 上监听的 HTTPS 端口，例如 `8443`。 |
| `M01_KEYCLOAK_EXTERNAL_HOSTNAME` | Keycloak 对外 hostname；默认本机 `localhost`。 |
| `KEYCLOAK_ADMIN_USERNAME` / `KEYCLOAK_ADMIN_PASSWORD` | 仅用于 bootstrap 的 `master` realm 平台管理员。 |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | Keycloak 私有 PostgreSQL 16 数据库凭据。 |

PostgreSQL 与 Keycloak 均没有宿主机端口；只有 Caddy 的 `127.0.0.1:<M01_KEYCLOAK_HTTPS_PORT>` 可访问。Keycloak 在容器网络使用 HTTP，`KC_HOSTNAME` 固定其公开 HTTPS 地址，`KC_PROXY_HEADERS=xforwarded` 接受 Caddy 传递的代理头，因此 discovery 返回的 issuer 必须是 `https://localhost:<port>/realms/aeos`（或你明确配置的本机 hostname）。

## 2. Keycloak 人工配置契约

本试点不导入 Realm：不将任何默认账户、示例密码或不可审计的 Realm JSON 写入仓库。使用 `https://localhost:<port>/` 的 Administration Console 以 bootstrap 管理员登录，并手工完成、复核和记录以下清单。

1. 创建 Realm **`aeos`**。`master` realm 只保留平台管理员；不要在其中创建或登录 AEOS 业务用户。
2. 在 `aeos` 创建浏览器 Client **`aeos-hub-web`**：类型 confidential，启用 Client authentication 和 Standard Flow，token endpoint authentication method 为 **`client_secret_basic`**。关闭不需要的 implicit、direct grant、device 等 flow。
3. 每个部署环境的 `Valid redirect URIs` 与 `Web origins` 必须精确匹配其 Hub：本地端到端开发只填写 `http://127.0.0.1:8787/api/auth/callback` 与 `http://127.0.0.1:8787`；生产/UAT 只填写 `https://<hub-host>/api/auth/callback` 与 `https://<hub-host>`。不得用 `*`、通配域或仅主机路径。不要在生产 Client 中保留本地 HTTP 地址。
4. 为浏览器 Client 的专用 client scope 配置并加入 **ID token** 的 mapper：
   - `tenant_id`：User Attribute mapper，claim 名称 `tenant_id`，单值；同时在 Realm User Profile 中把该属性设为必填。Hub 缺少或为空时会拒绝登录。
   - `organization_id`：User Attribute mapper，claim 名称 `organization_id`，单值、可选；未设置时不要伪造值。
   - `roles`：Realm Role mapper，claim 名称 `roles`，JSON 类型 `String`、multivalued；Hub 只读取顶层 `roles` 数组。每个进入 Hub 的用户至少须拥有一个与 `AEOS_M01_ALLOWED_ROLES` 相交的角色。
   - audience：Audience mapper，把 `aeos-hub-web` 加入 ID token 的 `aud`。本接入把 `M01_AUDIENCE` 设为同一值，Hub 会同时验证 client ID 与 audience。
5. 仅对服务账号 Client 的专用 scope 添加 Hardcoded claim mapper：`aeos_actor_type=service`。不要把该 mapper 加到人类浏览器 Client；服务 token 还必须包含该 Client 的 `client_id` 或 `azp`、`tenant_id`、正确 audience 和最小 roles。

每个智能体使用一个独立 Client + Service Account + 最小角色集合；禁止共享 browser Client secret、共享服务账号或授予 realm-admin。创建/修改 mapper 后取得一个 ID token，确认顶层 claims 与上述名称、类型完全一致，再允许 Hub 接入。

## 3. Hub M01 环境变量与本地端到端开发

不要把 `M01_CLIENT_SECRET`、Keycloak bootstrap 密码或 PostgreSQL 密码提交到 `.env.example`、日志或版本库。`M01_ISSUER` 必须与 discovery 的 `issuer` 逐字一致，且 `M01_REDIRECT_URI` 的 pathname 必须精确为 `/api/auth/callback`。

### 本地端到端开发（Node Hub）

这是当前仓库唯一已说明的 M01 Hub 本地运行方式：IdP 仍通过 Caddy internal CA 使用 `https://localhost:8443/realms/aeos`（把 `8443` 替换为 `M01_KEYCLOAK_HTTPS_PORT`），而本地 Node Hub 监听其默认 loopback HTTP 地址 `http://127.0.0.1:8787`。根目录 `docker-compose.yml` 仍只支持 local-dev；它没有 M01 Hub 的 TLS、CA 挂载或 `M01_*` 变量注入，不能用于本节。

**仅在已成功启动 M01 容器、且 `m01-config-check` 已通过之后**，导出并审核 Caddy 根 CA；本任务不会执行这些操作：

```powershell
docker compose --env-file deploy/m01/.env -f deploy/m01/docker-compose.yml cp caddy:/data/caddy/pki/authorities/local/root.crt deploy/m01/caddy-root.crt
Import-Certificate -FilePath .\deploy\m01\caddy-root.crt -CertStoreLocation Cert:\CurrentUser\Root
$env:NODE_EXTRA_CA_CERTS = (Resolve-Path .\deploy\m01\caddy-root.crt)
```

第一条取得 CA，第二条令浏览器信任，第三条令随后启动的 Node Hub 信任 issuer。先核对证书来源和指纹；不得用 `NODE_TLS_REJECT_UNAUTHORIZED=0` 绕过验证。导出的证书被 `.gitignore` 忽略；若重建 `caddy-data` 命名卷，CA 会变化，需重新审核并信任新根证书。

在 Keycloak 开发 Client 中设置精确 redirect URI/web origin 后，在同一个 PowerShell 会话安全注入 Client secret 并启动 Hub：

```powershell
$env:NODE_ENV = 'development'
$env:AEOS_AUTH_MODE = 'm01'
$env:M01_ISSUER = 'https://localhost:8443/realms/aeos'
$env:M01_CLIENT_ID = 'aeos-hub-web'
$env:M01_CLIENT_SECRET = '<从 Keycloak 生成并安全保存的 client secret>'
$env:M01_REDIRECT_URI = 'http://127.0.0.1:8787/api/auth/callback'
$env:M01_AUDIENCE = 'aeos-hub-web'
$env:AEOS_M01_ALLOWED_ROLES = 'manager,analyst'
$env:AEOS_COOKIE_SECURE = '0'
npm run web
```

`AEOS_M01_ALLOWED_ROLES` 是 M01 模式的必填准入配置：逗号分隔的非空角色名列表（会 trim、去重并限制数量/长度），例如 `manager,analyst`。未设置、为空或格式无效时 Hub 拒绝启动。回调仅在 token 顶层 `roles` 非空且与该列表有交集时才创建 Hub session；失败只返回通用登录失败并清除认证 cookie，不回显 token、原始角色或配置。

此 HTTP callback 只因它是严格的 loopback 地址、且部署环境允许本地开发时才被当前认证代码允许；它绝不可用于生产、UAT、staging、局域网或任何非 loopback hostname。部署环境会同时读取 `NODE_ENV` 和遗留 `AEOS_ENV`：只有两者都缺失，或每个已提供值均为 `development`、`test`、`local` 时才是本地开发；任一变量为 `uat`、`staging`、`production`、空白或其他显式未知值，或两者一方本地一方严格时，均为严格环境。严格环境必须 `AEOS_AUTH_MODE=m01`、`AEOS_COOKIE_SECURE=1` 且使用 HTTPS redirect URI；不能回退 local-dev。迁移使用遗留 `AEOS_ENV` 的部署时，先确保其值与 `NODE_ENV` 一致或移除遗留变量，避免因配置分歧进入严格模式。首次登录前访问 discovery，确认 issuer 和所有 authorization/token/JWKS endpoint 均为预期 HTTPS URL；再以有 `tenant_id` 和允许 role 的测试用户完成登录，并确认 Hub session 的 actor、tenant、roles 不含 token 或 secret。

### 生产/UAT（HTTPS Hub）

生产与 UAT 必须使用 HTTPS Hub、正式反向代理、受控 CA/证书与受保护的密钥注入；不要把开发 Compose、`start-dev` 或 Caddy internal CA 直接上线。示例变量如下，其中 `<hub-host>` 是正式 HTTPS origin：

```text
AEOS_AUTH_MODE=m01
M01_ISSUER=https://<idp-host>/realms/aeos
M01_CLIENT_ID=aeos-hub-web
M01_CLIENT_SECRET=<从 Keycloak 生成并安全保存的 client secret>
M01_REDIRECT_URI=https://<hub-host>/api/auth/callback
M01_AUDIENCE=aeos-hub-web
AEOS_M01_ALLOWED_ROLES=manager,analyst
AEOS_COOKIE_SECURE=1
```

生产/UAT 的 Keycloak Client 只允许对应的精确 HTTPS redirect URI 与 web origin；staging、空白或未知的 `NODE_ENV`/遗留 `AEOS_ENV` 也执行相同的严格规则。根目录 Compose 未提供 M01 Hub Docker TLS/CA 挂载，必须在受控部署定义中显式、安全地完成这些注入。

`AEOS_M01_ALLOWED_ROLES` 只是在身份回调后、建立 Hub session 前的最小准入边界，避免任意已登录 M01 用户进入 Hub。它不是每条业务动作的最终细粒度 RBAC；后续应由 Hub Guard 按操作、资源、租户和审批链继续扩展授权。

## 4. 运维边界

- **密钥轮换：** 先在 Keycloak 生成新 client secret，更新 Hub 的密钥注入并滚动重启 Hub，验证登录后再撤销旧 secret；保留变更记录。服务 Client 分别轮换，不能借用浏览器 Client secret。
- **备份/恢复：** 定期以 PostgreSQL 的逻辑备份备份 `keycloak` 数据库并加密后存放到仓库外；恢复只在隔离环境先演练。同步保护 Caddy `caddy-data` 中的本地 CA；丢失它会导致已信任的开发证书失效。生产备份、RPO/RTO 和密钥恢复由正式平台流程负责。
- **回退/故障：** Keycloak 或其 TLS 不可用时，将 Hub 置于维护模式或停止对外服务，提示管理员恢复 M01；不得通过设置 `AEOS_AUTH_MODE=local-dev`、公开默认账号或关闭 secure cookie 来降级为无认证访问。

## 5. 验收清单

- [ ] `docker compose ... config` 通过，且端口映射仅为 `127.0.0.1:<port>:443`；没有 PostgreSQL/Keycloak 宿主机端口。
- [ ] 已信任本地 CA，discovery 的 issuer 为 HTTPS 且与 `M01_ISSUER` 一致。
- [ ] 正确 tenant 与 `AEOS_M01_ALLOWED_ROLES` 相交 role 的用户可完成 login；缺失/空 roles 或无交集 role 的 token 被 Hub 拒绝，未创建可用业务会话。
- [ ] logout 清除 Hub cookies，并关闭该 Hub session 关联的 WebSocket；之后不能自动重连受保护 WebSocket。
- [ ] callback 的 state、PKCE、nonce 和浏览器 binding 被篡改、过期或跨浏览器复用时登录失败且不泄露上游细节。
- [ ] 生产演练中 `AEOS_COOKIE_SECURE=1`、HTTPS redirect URI 与精确 web origin 均生效；未出现 local-dev/无认证回退。
