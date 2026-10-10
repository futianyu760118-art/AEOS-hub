# M01 本机验收记录

记录 AEOS Hub 接入 M01 统一身份后，在开发机上的真实部署与验收结果。
本文件只记录**环境、命令、结果与偏差**，不含任何密码、client secret、令牌或私钥。

- 验收日期：2026-10-10
- 分支：`codex/m01-minimum-auth`（未推送、未合并 `master`）
- 分支起点回退标签：`backup/pre-m01-auth-20261009`
- 本次验收相关提交：`cdb6ce7`（登出结束 IdP 会话）；此前基线 `51cd66c`

---

## 1. 环境快照

| 项 | 值 |
| --- | --- |
| Hub（M01 模式） | 本机 Node 进程 `node src/server.ts`，监听 `127.0.0.1:8790`（**不是容器**） |
| Hub（local-dev 旧实例） | 容器 `AEOS`（`aeos-hub:local`），监听 `8787`，与 M01 无关，验收期间保持运行 |
| 身份入口 | `https://localhost:9443` → 容器 `m01-caddy-1`（`caddy:2.10.2-alpine`） |
| 身份服务 | 容器 `m01-keycloak-1`（`quay.io/keycloak/keycloak:26.8.0`，`start-dev`） |
| 身份数据库 | 容器 `m01-postgres-1`（`postgres:16-alpine`，宿主机**不暴露端口**） |
| 命名卷 | `m01_keycloak-postgres`、`m01_caddy-data`、`m01_caddy-config` |
| Keycloak HTTPS 端口 | 由 `deploy/m01/.env` 的 `M01_KEYCLOAK_HTTPS_PORT` 决定，本次为 **9443**（8443 被 `CLodopPrint64.exe` 占用） |
| Caddy 本地 CA | 自签根证书 `CN=Caddy Local Authority - 2026 ECC Root`，SHA-256 指纹 `30:A0:56:73:6E:A9:59:E4:B8:6F:06:2B:69:E2:00:8C:DA:19:D0:34:C7:23:25:D0:30:C8:76:CD:E1:87:CC:58` |
| Windows 信任 | 上述根证书已导入 `Cert:\CurrentUser\Root`（仅当前用户），浏览器不再提示证书错误 |

## 2. Keycloak 配置清单

| 对象 | 值 |
| --- | --- |
| Realm | `aeos` |
| Realm 角色 | `manager`、`analyst` |
| Client | `aeos-hub-web`（confidential、Standard Flow、`client_secret_basic`；Implicit / Direct grant / Service account 均关闭） |
| Redirect URI | `http://127.0.0.1:8790/api/auth/callback`（精确，无通配） |
| Web Origins | `http://127.0.0.1:8790` |
| **Post logout redirect URI** | `http://127.0.0.1:8790/?logged_out=1`（client 属性 `post.logout.redirect.uris`）——**RP-Initiated Logout 依赖它；重建 realm 时必须重建** |
| Mapper | `tenant_id`（用户属性→顶层 claim，String，单值）、`organization_id`（同）、`roles`（Realm Role，`multivalued=true`、JSON `String`、顶层 `roles`）、`audience`（`included.client.audience=aeos-hub-web`）；四者均写入 **ID token** |
| User Profile | 声明 `tenant_id`（**必填**）与 `organization_id`（可选）——未声明的自定义属性会被 Keycloak 静默丢弃 |
| 测试用户 `manager` | `tenant_id=tenant-demo`、`organization_id=org-demo`、角色 `manager`、已设密码 |
| 测试用户 `user` | `tenant_id=tenant-demo`、**无允许角色**、已设密码（负向用例） |
| Realm 会话设置 | `ssoSessionIdleTimeout=1800`、`ssoSessionMaxLifespan=36000`（Keycloak 默认值，未调整） |
| 密码策略 | 未配置（realm 默认） |

**与 `docs/auth/m01-integration.md` 的一处偏差**：文档要求用 Administration Console 手工配置，本次改用容器内官方 CLI `kcadm.sh` 执行（Realm / 角色 / Client / Mapper / User Profile / 用户）。原因：避免在控制台反复摸索。配置效果一致，且**命令可复核、未导入任何 Realm JSON、未把密码写入仓库**。测试用户密码由测试者本人在控制台设置。

## 3. Hub 启动方式

```bash
# 在仓库根目录执行；M01_CLIENT_SECRET 从 .env 读取，不进命令行历史
SECRET=$(awk -F= '/^M01_CLIENT_SECRET=/{print substr($0, index($0,"=")+1)}' deploy/m01/.env)
NODE_EXTRA_CA_CERTS='G:/PyCharm/aeos-hub/deploy/m01/caddy-root.crt' \
NODE_ENV=development AEOS_AUTH_MODE=m01 AEOS_COOKIE_SECURE=0 PORT=8790 \
M01_ISSUER='https://localhost:9443/realms/aeos' M01_CLIENT_ID='aeos-hub-web' \
M01_CLIENT_SECRET="$SECRET" \
M01_REDIRECT_URI='http://127.0.0.1:8790/api/auth/callback' M01_AUDIENCE='aeos-hub-web' \
AEOS_M01_ALLOWED_ROLES='manager,analyst' \
npm run web
```

要点：`NODE_EXTRA_CA_CERTS` 必须指向导出的 Caddy 根证书，否则 Hub 无法通过 HTTPS 访问 issuer；`M01_CLIENT_SECRET` 存在 `deploy/m01/.env`（已被 `deploy/m01/.gitignore:3` 忽略）。M01 模式下**不需要** `AEOS_LOGIN_PASSWORD`。

## 4. 验收结果

### 4.1 人工浏览器验收（测试者确认通过）

| # | 用例 | 结果 |
| --- | --- | --- |
| 1 | `manager` + 密码统一登录，回到 Hub 并显示身份 | ✅ 通过 |
| 2 | 退出登录 → Keycloak 登出确认 → 回到 Hub 登录页 | ✅ 通过 |
| 3 | 退出后再次点「统一登录」**必须重新输入密码** | ✅ 通过（本次修复的核心） |
| 4 | `user` + 密码登录被拒绝，提示"统一登录未完成，请重新登录" | ✅ 通过 |
| 5 | 前端 Local Storage / Network 中不含令牌或 secret | ✅ 通过 |

### 4.2 自动化验收（本次实测）

| 组 | 检查 | 结果 |
| --- | --- | --- |
| A | 未认证访问 `/api/harbor`、`/api/operating-center`、`/api/dashboard`、`/api/capability-registry`、`/api/evidence`、`/api/agent-squad`、`/api/inbox`、`/api/runtime-image` | ✅ 全部 **401** |
| B | 静态资源白名单：`/`、`/index.html`、`/app.js`、`/style.css`、`/daily-questions.js` 公开（200）；`/private.css`、`/data/evidence.jsonl`、`/src/server.ts` 受保护（**401**） | ✅ 符合预期 |
| C | 未认证 WebSocket 连接 `/ws` | ✅ 被拒（HTTP 401） |
| C2 | 未登录时 `/api/auth/session` 仅返回 `{"authenticated":false,"authMode":"m01"}`，无 token/secret 字样 | ✅ |
| D | 严格环境拒绝启动 | ✅ 6/6 退出码 1：production+local-dev、production+HTTP callback、production+`AEOS_COOKIE_SECURE=0`、production+缺 `AEOS_M01_ALLOWED_ROLES`、development+缺 `M01_CLIENT_SECRET`、未知 `AEOS_AUTH_MODE` |
| E | 合规严格环境（production + HTTPS callback + `AEOS_COOKIE_SECURE=1`）可正常启动并响应 | ✅ 启动成功，会话摘要为 m01 |
| F | Hub 运行日志不含 `access_token` / `id_token` / `client_secret` / 私钥 | ✅ 无 |
| G | `npm run test:auth` | ✅ **47/47** |
| H | `npm test`（全量 16 个子套件） | ✅ 退出码 0 |
| I | `npm run check:types` | ✅ 无错误 |

### 4.3 登出链路（本次新增能力）

- 登出时 Hub **先撤销自己的会话**，再构造 Keycloak 的 RP-Initiated Logout URL 交给浏览器跳转；
- 实测在真实 Keycloak 上构造出的地址为
  `https://localhost:9443/realms/aeos/protocol/openid-connect/logout?client_id=aeos-hub-web&post_logout_redirect_uri=http%3A%2F%2F127.0.0.1%3A8790%2F%3Flogged_out%3D1`；
- **不发送 `id_token_hint`**：Hub 内存中不保留任何令牌，代价是 Keycloak 会多一次登出确认页；
- 外部来源的 post-logout 地址被拒绝（返回 `null`），防止被当作开放重定向；
- IdP 不可达时登出仍然成功（只结束 Hub 会话）。

## 5. 已知问题与后续事项

| 级别 | 事项 | 说明 / 建议 |
| --- | --- | --- |
| 中 | **登出未覆盖：其它标签页/浏览器已建立的 Hub 会话、跳转被中断、在其它应用登出** | 需要 Back-Channel Logout 才能解决。client 上已具备 `backchannel.logout.session.required=true`，实现条件现成。建议列入 **M02**（与登出审计事件一起做） |
| 低 | Hub 启动横幅文案在 M01 模式下不准确 | `src/server.ts:1821` 无条件打印"登录保护: 已启用（账号: demo；密码来自 AEOS_LOGIN_PASSWORD）"，M01 模式实际不用账号密码。纯文案问题 |
| 待办 | `docs/auth/m01-integration.md` 的 Client 配置清单**未包含** `post.logout.redirect.uris` | 不补的话，将来重建 realm 会导致登出静默降级为"只清 Hub 会话"。待确认后补一行 |
| 待办 | 登录成功/失败、拒绝准入均无审计事件 | 属 M02 范围 |
| 风险 | M01 契约未与 M01 Owner 确认 | 当前假设：OIDC + `client_secret_basic` + claim 名 `tenant_id` / `organization_id` / `roles` + 以 `sub` 作稳定 user_id。角色名未写死（由 `AEOS_M01_ALLOWED_ROLES` 配置）。生产接入前必须确认字段与角色编码 |
| 风险 | `AEOS_M01_ALLOWED_ROLES` 只是登录准入，不是动作级 RBAC | 方案 AUTH-02/03 尚未实现 |
| 风险 | 演示数据源为本地 demo-ERP；`company-control` 才使用真实凭据 | 本阶段不接真实业务数据 |
| 提示 | realm 未配置密码策略 | 生产应在 M01 侧统一管理 |

## 6. 停止、重启与回退

```bash
# 停止身份栈（保留数据卷，安全）
docker compose --env-file deploy/m01/.env -f deploy/m01/docker-compose.yml stop

# 重新启动
docker compose --env-file deploy/m01/.env -f deploy/m01/docker-compose.yml up -d

# 停止 Hub（本机进程）
# 找到监听 8790 的 node 进程并结束，或直接 Ctrl+C

# 回退代码
git revert cdb6ce7              # 仅回退登出改动
git checkout backup/pre-m01-auth-20261009   # 回到 M01 改动之前的基线
```

**危险操作（会导致 Keycloak 数据全丢，需重新配置 Realm/Client/Mapper/用户）：**

```bash
docker compose --env-file deploy/m01/.env -f deploy/m01/docker-compose.yml down -v
docker volume rm m01_keycloak-postgres
```

`m01_caddy-data` 卷**不可删**：删掉会重新生成 CA，已导入 Windows 的根证书随即失效，需重新导出与导入。

## 7. 复现顺序（从零到可登录）

1. `Copy-Item deploy/m01/.env.example deploy/m01/.env`，替换其中三个凭据 sentinel，设置 `M01_KEYCLOAK_HTTPS_PORT=9443`；
2. `docker compose --env-file deploy/m01/.env -f deploy/m01/docker-compose.yml up -d`，确认 `m01-config-check` 退出码 0、postgres healthy；
3. 导出 Caddy 根 CA，核对指纹后导入 `Cert:\CurrentUser\Root`；
4. 用 `kcadm.sh` 或控制台创建 Realm `aeos`、角色、Client（含 `post.logout.redirect.uris`）、四个 Mapper、User Profile 的 `tenant_id`（必填）与 `organization_id`、两个测试用户并设置密码；
5. 按第 3 节命令启动 Hub（`NODE_EXTRA_CA_CERTS` + `PORT=8790`）；
6. 浏览器打开 `http://127.0.0.1:8790` → 点「统一登录」→ 用 `manager` 登录；
7. 验证第 4.1 节的五条用例。
