# AEOS Hub · M01 阶段交接报告（供后续 Agent / Codex 继续）

> 生成时间：2026-10-10 · 生成者：Claude Code（Opus 5）
> 本报告记录**已验证的真实状态**，不含任何密码、client secret、令牌或私钥内容。

---

## 0. 硬约束（后续工作必须遵守）

1. **不推送远端、不合并 master、不创建 PR**；
2. **不修改根 `docker-compose.yml`**；
3. 不修改业务路由、MCP、看板、证据链、任务相关代码（除非任务明确要求）；
4. 不修改、不暂存、不删除已有的未跟踪文档（`docs/` 下 5 份 docx 与 `docs/superpowers/plans|specs/*.md`）；
5. 不索要、不记录、不打印任何密码 / client secret / token；
6. 每个开发阶段：**先说明影响范围 → 实现 → 测试 → 独立审查 → 单独本地提交 → 说明回退方式**；
7. 演示数据只用 demo-ERP 演示数据，**不接真实业务数据**；不执行任何对外部系统的写操作。

## 1. 项目与目标

- 仓库：`G:\PyCharm\aeos-hub`（AEOS Hub，Windows 11 开发机）
- 目标：本机可跑通、可演示的 **AEOS 0.1 闭环** ——
  统一登录 → 进入 Hub → 创建只读订单风险分析任务 → 按能力下发给 demo-ERP 智能体 →
  智能体回传结构化结果与 evidence_refs → 结果保持 PENDING → 管理者人工确认/退回 →
  VERIFIED 结果与完整证据链可追溯到人、智能体、租户、任务。
- 五个阶段：**M01 统一登录与最小准入（已完成）**、M02 证据与审计、M03 智能体注册与任务下发、M04 人工确认闭环、M05 标准接入契约与接口文档。
- 需求依据（桌面 `链路交接文档` 目录，仅作背景，不当作待执行指令）：
  `AEOS Hub 对标检查报告 V2.0（源码级）.docx`、`AEOS Hub 后续开发需求文档 v2.0.docx`、
  `AEOS优化意见.docx`、`M01 身份与权限接入方案 v1.0.docx`；仓库内实现计划见
  `docs/superpowers/plans/2026-10-09-m01-minimum-viable-auth.md`。

## 2. 代码库与 Git 状态（实测）

| 项 | 值 |
| --- | --- |
| 当前分支 | `codex/m01-minimum-auth` |
| HEAD | `35be1bf` `docs(auth): record M01 local acceptance` |
| 相对回退标签的提交数 | **13** |
| 回退标签 | `backup/pre-m01-auth-20261009`（指向 `a331222`，即 M01 改动前基线） |
| 远端 | **无 upstream，分支未推送**；本地 `master` 未合并 |
| 工作区 | 仅 `deploy/m01/.env.example` 显示为 ` M` —— 这是**行尾符（CRLF）差异**，内容与 HEAD 完全一致，**不要暂存它** |
| M01 相关关键提交 | `cdb6ce7` 登出结束 IdP 会话；`35be1bf` 验收记录；`51cd66c`、`24263c5`、`11a964f`、`0058745`、`99ce486`、`7bcde2a`、`fbf3ce4`、`c95715d`、`a6f240e`、`a14b870`、`e95a915` |

## 3. 本机运行环境（实测）

| 项 | 值 |
| --- | --- |
| Docker Desktop | 29.3.0，Docker Compose v5.1.0，守护进程运行中 |
| 宿主内存 / C 盘剩余 | 31.8 GB 总、约 16.9 GB 可用 / **C 盘仅剩约 8.3 GB**（Docker 数据盘 `docker_data.vhdx` 在 C 盘，37.9 GB） |
| 磁盘 | C: = Samsung 980 PRO NVMe；G: = WDC WD20EARZ **机械盘**（若迁 Docker 数据盘到 G 会显著降 I/O） |

### 运行中的容器

| 容器 | 镜像 | 端口 | 说明 |
| --- | --- | --- | --- |
| `m01-postgres-1` | `postgres:16-alpine` | 无宿主端口 | Keycloak 私有数据库，healthy |
| `m01-keycloak-1` | `quay.io/keycloak/keycloak:26.8.0` | 无宿主端口 | `start-dev --http-enabled=true` |
| `m01-caddy-1` | `caddy:2.10.2-alpine` | **`127.0.0.1:9443→443`** | TLS 入口；仅回环，符合既定安全基线 |
| `AEOS` | `aeos-hub:local` | `0.0.0.0:8787` | **旧 local-dev 模式 Hub，与 M01 无关**，验收期间保持运行 |

### AEOS Hub（M01 模式）**不是容器**

- 它是**宿主机上的 Node 进程**：`node src/server.ts`，监听 `127.0.0.1:8790`。
- 原因（已实测）：M01 的 Hub 必须访问 `https://localhost:9443` 且 issuer 字符串必须与 Keycloak 声明逐字一致。
  Docker Desktop 下 `--network host` 的容器**虽然能访问 9443**（Caddy 由 Docker 发布），但**它监听的端口 Windows 访问不到**（实测：host 网络容器监听 8799，Windows 侧 `127.0.0.1:8799` 与 `localhost:8799` 全部连不上）；
  普通 bridge 容器里的 `localhost` 又是容器自身，解析不到 9443。因此不能简单把 Hub 容器化。
- 结论：**"只打开 Docker"不足以进入 M01 模式的 AEOS**，Hub 必须另外启动（命令见 §6）。

### 命名卷

`m01_keycloak-postgres`、`m01_caddy-data`、`m01_caddy-config`

> ⚠️ **`m01_caddy-data` 不可删**：它保存 Caddy 内部 CA 私钥。删掉会重新生成 CA，已导入 Windows 的根证书立即失效。

## 4. 已完成的工作（M01）

1. **真实部署 M01 身份栈**：Keycloak + PostgreSQL + Caddy，数据落命名卷，数据库不暴露宿主机端口。
2. **本地 CA 信任**：导出 Caddy 根 CA → 核对指纹 → 导入 `Cert:\CurrentUser\Root`（仅当前用户）。
   - Subject：`CN=Caddy Local Authority - 2026 ECC Root`
   - SHA-256 指纹：`30:A0:56:73:6E:A9:59:E4:B8:6F:06:2B:69:E2:00:8C:DA:19:D0:34:C7:23:25:D0:30:C8:76:CD:E1:87:CC:58`
   - 导出文件：`deploy/m01/caddy-root.crt`（被 `deploy/m01/.gitignore` 忽略）
   - 验证方式：`SslStream` 默认策略握手通过（等价于 Edge 的校验路径）
3. **Keycloak 配置**（经容器内官方 CLI `kcadm.sh` 完成，非控制台 —— 这是与 `docs/auth/m01-integration.md` 记录的唯一偏差，已记入验收文档）：
   Realm `aeos`、角色 `manager`/`analyst`、Client `aeos-hub-web`（confidential、Standard Flow、`client_secret_basic`）、
   redirect URI `http://127.0.0.1:8790/api/auth/callback`、web origin `http://127.0.0.1:8790`、
   4 个 Mapper（`tenant_id`、`organization_id`、`roles` 多值顶层数组、`audience`，均写入 ID token）、
   User Profile 声明 `tenant_id`（必填）与 `organization_id`、测试用户 `manager` 与 `user`。
4. **Hub M01 模式运行**与**登录/拒绝/登出/重登录**全链路验收通过。
5. **登出改为真正的登出**（提交 `cdb6ce7`）：Hub 登出后返回 Keycloak 的 RP-Initiated Logout URL 交由浏览器跳转，结束 IdP 会话。
   - **不发送 `id_token_hint`** → Hub 内存中**零令牌**；代价是 Keycloak 多显示一次登出确认页。
   - 客户端属性 `post.logout.redirect.uris = http://127.0.0.1:8790/?logged_out=1` 是**该功能的依赖**，重建 realm 时必须重建。
6. **验收记录**：`docs/auth/m01-local-acceptance.md`（提交 `35be1bf`），含环境、命令、人工与自动化验收结果、已知问题、停止与回退命令、从零复现步骤。

## 5. 关键配置事实（不含任何密钥值）

- 密钥只存在于 `deploy/m01/.env`（被 `deploy/m01/.gitignore:3` 忽略，未入库），包含：
  `KEYCLOAK_ADMIN_USERNAME` / `KEYCLOAK_ADMIN_PASSWORD`、`POSTGRES_DB/USER/PASSWORD`、
  `M01_CLIENT_SECRET`、`M01_KEYCLOAK_HTTPS_PORT=9443`、`M01_KEYCLOAK_EXTERNAL_HOSTNAME=localhost`。
- Keycloak 的 SSO 会话默认：闲置 30 分钟、最长 10 小时（未调整）。
- realm 安全设置现状：`bruteForceProtected=false`（**暴力破解防护关闭**）、无密码策略、`sslRequired=external`。
- 端口选择背景：8443 被 `CLodopPrint64.exe`（打印控件）占用，故 Keycloak 用 **9443**；Hub 用 **8790**（8787 被旧容器占用）。

## 6. 当前运行状态与启停命令

**启动身份栈**
```bash
docker compose --env-file deploy/m01/.env -f deploy/m01/docker-compose.yml up -d
```

**启动 Hub（M01 模式）** —— 在仓库根目录，独立终端窗口：
```bash
SECRET=$(awk -F= '/^M01_CLIENT_SECRET=/{print substr($0, index($0,"=")+1)}' deploy/m01/.env)
NODE_EXTRA_CA_CERTS='G:/PyCharm/aeos-hub/deploy/m01/caddy-root.crt' \
NODE_ENV=development AEOS_AUTH_MODE=m01 AEOS_COOKIE_SECURE=0 PORT=8790 \
M01_ISSUER='https://localhost:9443/realms/aeos' M01_CLIENT_ID='aeos-hub-web' \
M01_CLIENT_SECRET="$SECRET" \
M01_REDIRECT_URI='http://127.0.0.1:8790/api/auth/callback' M01_AUDIENCE='aeos-hub-web' \
AEOS_M01_ALLOWED_ROLES='manager,analyst' \
npm run web
```

**停止**
```bash
docker compose --env-file deploy/m01/.env -f deploy/m01/docker-compose.yml stop   # 安全，保留数据
# Hub：结束监听 8790 的 node 进程
```

**回退**
```bash
git revert cdb6ce7                            # 仅撤销登出改动
git checkout backup/pre-m01-auth-20261009     # 回到 M01 改动前基线
```

**危险操作（Keycloak 数据全丢，需重配 Realm/Client/Mapper/用户）**
```bash
docker compose --env-file deploy/m01/.env -f deploy/m01/docker-compose.yml down -v
docker volume rm m01_keycloak-postgres
```

## 7. 🔴 当前待决事项（最高优先级）

**用户需要"局域网内其它主机也能访问 Hub 并登录"**，且**不希望每台演示机都导入一次根 CA**。
以下是实测出的约束与可选路线（尚未实施，等待用户提供 3 个信息）。

### 局域网访问的硬约束（已实测）

1. `M01_REDIRECT_URI` 只允许 **HTTPS 或 loopback HTTP**：实测 `http://192.168.1.50:8790/api/auth/callback` 会被拒绝启动，报
   `M01_REDIRECT_URI must use HTTPS or loopback HTTP`（`src/auth/m01-oidc.ts:55-74`）。→ **局域网必须走 HTTPS**，需要给 Hub 加 TLS 终止（可由 Caddy 兼管），并设 `AEOS_COOKIE_SECURE=1`。
2. **issuer 必须等于浏览器访问的地址**：必须把 `M01_KEYCLOAK_EXTERNAL_HOSTNAME` 改成局域网可达的名字/IP，
   否则其它机器的浏览器会把 `localhost` 解析成它自己。→ 本机也必须改用同一地址访问，**不能"本机 localhost + 别人 IP"混用**。
3. Caddy 当前只发布 `127.0.0.1:9443`，局域网访问需改为发布到局域网接口（**这是安全基线变更**：`docs/auth/m01-integration.md` 明确要求仅回环）。
4. Keycloak Client 需追加局域网回调与 web origin。
5. 需要放行 Windows 防火墙（9443 与 Hub 的 HTTPS 端口）。
6. **Caddy 内部 CA 不会自动被其它机器信任** —— 这正是用户想避免的"每台机器导入一次"。

### 不装 CA 的替代路线（需用户确认可行性）

| 方案 | 前提 | 客户端配置 |
| --- | --- | --- |
| A. 公司企业 CA 签发证书 | 演示机在域内、企业根证书已下发 | **零配置**（推荐） |
| B. 公网 CA 签发（DNS-01） | 有域名且内网 DNS 能解析到演示机 | **零配置** |
| C. 沿用 Caddy 自签 CA | 无 | 每台机器导一次，或每次点"继续访问"跳过警告（不推荐） |

> 注意：A/B 需要**域名**，公网/企业 CA 通常不给 `192.168.x.x` 这类私有 IP 签证书。

### 危害评估（已向用户说明，供后续 Agent 复用）

- 最高危：管理控制台与 token 端点对整网段开放，管理员口令若弱/泄漏可导致身份域被完全接管；
- 实测 `bruteForceProtected=false` + 无密码策略 → **在线爆破无阻力**；
- 跑的是 `start-dev` 开发模式，不适合对外；
- 数据面风险可控：realm 内只有 2 个演示用户、无联邦源、无真实数据；
- 建议默认加：**防火墙白名单（只允许演示机 IP）**、打开暴力破解锁定、配最小密码策略、演示结束恢复仅回环、使用专用管理员口令。

### 需要用户回答的 3 个信息

1. 演示机是否都在同一个 Windows 域内？公司是否有企业 CA（根证书已下发）？
2. 是否有可用域名（内网可解析）或现成的内网 HTTPS 反向代理/网关？
3. 演示结束后是否允许直接恢复为"仅回环"？

## 8. 后续路线（M01 之后）

| 阶段 | 内容 |
| --- | --- |
| **M02 证据与审计** | ① 登录成功/失败、准入拒绝写入 Evidence；② Evidence 增加可检索的 `actor` / `actor_type`（契约向后兼容扩展）；③ 任务维度事件统一（创建/下发/回传/确认）并支持按 `correlation_id`/任务查完整证据链；④ **Back-Channel Logout**（补完 M01 遗留：多标签页/多浏览器/他处登出时回收 Hub 会话） |
| **M03 智能体与任务下发** | 启用 `demo-erp`（当前 `mcp/registry.json` 中 `enabled:false`）；建立智能体目录（agentId/所属系统/能力/允许租户/运行状态/负责人）；最小 Task 模型与任务路由；demo-ERP 适配器回传结构化结果（evidence_refs、置信度、建议动作）；不依赖真实数据、不写业务 |
| **M04 人工确认闭环** | 让 PENDING Result 在页面可见；管理者确认/退回；仅人工确认后转 VERIFIED；校验租户、角色与证据链（`src/operating-center.ts` 已有 store 层能力，`createPendingResult`/`verifyResult` **目前只有测试调用，缺 HTTP 路由与页面**） |
| **M05 接入契约** | 智能体注册、能力声明、任务下发、状态回传、结果回传、证据引用的 JSON Schema；接口文档；为 ERP/MES/质量/采购/供应链等未来智能体提供独立身份与最小权限接入模板 |

## 9. 已知问题与风险

| 级别 | 事项 |
| --- | --- |
| 中 | 登出未覆盖：其它标签页/浏览器已建立的 Hub 会话、跳转被中断、在其它应用登出（需 Back-Channel Logout；client 已有 `backchannel.logout.session.required=true`，条件现成） |
| 中 | **M01 契约未与 M01 Owner 确认**：当前假设 OIDC + `client_secret_basic` + claim 名 `tenant_id`/`organization_id`/`roles` + 以 `sub` 作稳定 user_id。生产接入前必须确认字段与角色编码 |
| 中 | `AEOS_M01_ALLOWED_ROLES` 只是**登录准入**，不是动作级 RBAC（方案 AUTH-02/03 未实现） |
| 低 | `docs/auth/m01-integration.md` 的 Client 配置清单**未包含** `post.logout.redirect.uris`，不补的话重建 realm 会使登出静默降级（**已询问用户是否允许补这一行，尚未答复**） |
| 低 | Hub 启动横幅在 M01 模式下文案不准（`src/server.ts:1821` 无条件打印"密码来自 AEOS_LOGIN_PASSWORD"） |
| 低 | `E:\`→ 无；C 盘仅剩约 8.3 GB，Docker 数据盘在 C 盘 |
| 待办 | 登录成功/失败无审计事件（属 M02） |

## 10. 环境坑与注意事项（实测踩过，务必注意）

1. **Git Bash 路径转换**：`docker exec <c> /opt/keycloak/bin/kcadm.sh ...` 会把 `/opt/...` 转成 `C:/Program Files/Git/opt/...`。
   → 先 `export MSYS_NO_PATHCONV=1`。
2. **Node 收到的是 Windows 程序路径**：给 `node` 传 Git Bash 风格路径（如 `/c/Users/...`）会解析成 `G:\c\Users\...`。
   → 给 node 传 `C:/Users/...` 风格的 Windows 路径。
3. **`docker compose config` 会原样打印环境变量值（含密码）** → 只做校验时用 `config --quiet`，或严格过滤输出。
4. **停 Hub 时**：启动命令是 `npm run web`，直接杀外层 shell 只停掉 npm 包装层，**node 子进程仍在监听 8790** → 需按端口找到 PID 用 `Stop-Process -Id <pid> -Force`。
5. **`kcadm.sh` 会话会过期**（约 1 小时后报 `Session has expired`）→ 重新 `config credentials` 即可。
6. **Keycloak 26 的坑**：
   - `realm.editUsernameAllowed=false`（默认）会让 `username` 对管理 API 也变成只读，报 `error-user-attribute-read-only`；改名需临时打开该开关再关回去；
   - 自定义属性**必须先在 User Profile 中声明**（`unmanagedAttributePolicy` 默认 DISABLED），否则会被静默丢弃；
   - `kcadm update users/<id>` 的**局部 PUT 会清空未提供的字段**（如 email/firstName/lastName）；
   - `get users --fields attributes`（列表查询）**不返回 attributes**，必须按 ID 直查。
7. **`node -e` 取参数不可靠**：用 `process.argv[1]` 传参实测失败（返回 undefined），改用内联常量或独立脚本文件。
8. **Node 的 fetch 走 `NODE_EXTRA_CA_CERTS`**；而本机 `curl` 是 **Schannel 后端、会忽略 `--cacert`** —— 验证 TLS 请用 Node 或 PowerShell，不要用 curl 下结论。

## 11. 如何验证（回归与验收）

```bash
npm run test:auth        # 47 条认证用例（含 M01 OIDC、登出、准入）
npm test                 # 全量 16 个子套件（最近一次：退出码 0）
npm run check:types      # tsc --noEmit
```

无头验收（Hub 在 8790 运行时）：
- 未认证访问受保护 API（`/api/harbor`、`/api/operating-center`、`/api/dashboard`、`/api/capability-registry`、`/api/evidence`、`/api/agent-squad`、`/api/inbox`、`/api/runtime-image`）→ 全部 **401**；
- 静态白名单（`/`、`/index.html`、`/app.js`、`/style.css`、`/daily-questions.js`）→ 200；`/private.css`、`/data/evidence.jsonl`、`/src/server.ts` → **401**；
- 未认证 WebSocket `/ws` → 被拒（401）；
- `NODE_ENV=production` 下 6 种不合规配置必须**拒绝启动**（local-dev / HTTP callback / `AEOS_COOKIE_SECURE=0` / 缺 `AEOS_M01_ALLOWED_ROLES` / 缺 `M01_CLIENT_SECRET` / 未知 `AEOS_AUTH_MODE`）。

浏览器验收（最近一次：用户确认全部通过）：`manager` 登录成功 → 登出（Keycloak 确认页）→ 再次登录**必须重新输密码** → `user` 被拒绝。

## 12. 参考资料

- 本仓库：`docs/auth/m01-local-acceptance.md`（验收记录）、`docs/auth/m01-integration.md`（接入说明）、
  `deploy/m01/{docker-compose.yml,.env.example,Caddyfile,.gitignore}`、`src/auth/{actor-context.ts,m01-oidc.ts}`、
  `src/web-auth.ts`、`src/server.ts`、`test/m01-oidc.test.ts`、`test/m01-auth-integration.test.ts`；
- 需求与设计背景：桌面 `链路交接文档` 目录下 4 份文档；
- 实现计划：`docs/superpowers/plans/2026-10-09-m01-minimum-viable-auth.md`。

## 13. 建议的下一步动作（给后续 Agent）

1. **先确认 §7 的三个信息**，再决定局域网方案；在此之前不要改 Caddy 的端口绑定或 Keycloak 的 hostname（会破坏当前已验收的仅回环基线）；
2. 若用户选择"先本机演示"，可先做一个一键启动脚本（`scripts/start-m01-demo.ps1`：检查 Docker → 拉起身份栈 → 等 discovery 就绪 → 注入环境变量启动 Hub → 打开浏览器），**新增文件、不改现有配置**；
3. 局域网方案确定后再实施，并作为**独立提交**，同时更新 `docs/auth/m01-local-acceptance.md` 的安全基线描述；
4. 之后按 §8 顺序推进 M02（建议先做证据侧的 ①②，再做 ③④）。
