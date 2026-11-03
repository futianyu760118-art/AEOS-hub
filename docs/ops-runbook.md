# AEOS Hub 运行手册（试点）

> 适用：MVP 分支、M01 认证模式、统一网关接入公司中控平台  
> 更新：2026-10-27  
> 读者：Hub/网关值守人员、后续接手开发的同事

## 1. 运行拓扑

```
浏览器
  └─ https://aeos-hub.test:9444   Caddy（TLS）
       ├─ /             → Hub UI / API 127.0.0.1:8790
       └─ /realms/...   → Keycloak 9443
Hub 127.0.0.1:8790
  ├─ 执行面 WebSocket 127.0.0.1:8788/execution-agent
  └─ data/（JSON/JSONL 文件存储）
网关 gateway-control-platform（Windows 计划任务）
  ├─ → ws://127.0.0.1:8788/execution-agent（系统令牌）
  └─ → 公司中控平台 SPC（HMAC，只读查询 + 推理）
```

- 中台只通过 **一个统一网关** `gateway-control-platform` 接入；中台新增智能体时先在网关侧声明能力，再在 Hub 的 `config/execution-agent-allowlist.json` 放行。
- 执行面身份：M01 默认只接受每系统令牌，旧共享根令牌已关闭（2026-10-27 起）。
- 数据目前是本地文件存储，尚未迁公司数据库。

## 2. 日常检查（建议每天一次）

```powershell
# 1) 端口与运行时配置（只读）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-m01-demo.ps1 -WhatIf

# 2) 计划任务
Get-ScheduledTask -TaskName "AEOS-Hub-ControlPlatformGateway","AEOS-Hub-ControlPlatformGateway-Keeper","AEOS Hub Data Backup","AEOS Hub Data Cleanup" |
  Select-Object TaskName,State

# 3) 执行面身份（应只有 gateway-control-platform 在线，authMode=system-token）
node -e "const d=require('./data/execution-plane.json');const a=d.agents||d;for(const x of (Array.isArray(a)?a:Object.values(a)))console.log(x.agentId,x.authMode,x.systemId,x.lastSeenAt)"
```

预期：

| 项目 | 正常表现 |
|---|---|
| Hub | 9444 可打开登录页，8790 在监听 |
| Keycloak | 9443 在监听，能完成 M01 登录 |
| 网关任务 | `Running` |
| Keeper 任务 | `Ready`（每分钟短跑一次，这是正常的） |
| `gateway-control-platform` | 在线，`authMode=system-token`，`lastSeenAt` 在最近几分钟内 |
| 备份/清理任务 | `Ready`，最近一次 `LastTaskResult=0` |

> 页面上“离线”的旧 Agent（如 `runtime-control-platform-agent`、`runtime-control-platform-order`）是 2026-10-20 的历史记录，不影响当前网关；不要把它们当成当前在线岗位。

## 3. 启停

### 3.1 Hub（M01）

```powershell
# 启动（同时确保 Keycloak/Postgres/Caddy 运行）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-m01-demo.ps1

# 停止 Hub，但保留 Keycloak/Postgres/Caddy
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stop-m01-demo.ps1 -KeepIdentityStack

# 全部停止（保留 Docker 卷和本地 CA）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stop-m01-demo.ps1
```

重启 Hub 会短暂断开执行面；网关会自动重试并重新注册（日志里会先出现 `ECONNREFUSED`，随后 `register` 成功）。

### 3.2 网关

网关由两个计划任务守护：

| 任务 | 作用 |
|---|---|
| `AEOS-Hub-ControlPlatformGateway` | 前台运行网关进程；退出后每分钟重试 |
| `AEOS-Hub-ControlPlatformGateway-Keeper` | 每分钟检查，没有网关进程时拉起 |

```powershell
# 重启网关
Stop-ScheduledTask  -TaskName "AEOS-Hub-ControlPlatformGateway"
Start-ScheduledTask -TaskName "AEOS-Hub-ControlPlatformGateway"

# 维护暂停：暂停期间网关不启动，页面显示离线
New-Item aeos-execution-agent\gateway.pause -ItemType File
# 恢复
Remove-Item aeos-execution-agent\gateway.pause
```

暂停/恢复后最多等 1 分钟。恢复后确认执行面出现 `gateway-control-platform`，且 `authMode=system-token`。

## 4. 常见故障

### 4.1 打不开 https://aeos-hub.test:9444

1. 看 Docker：`docker ps` 应有 postgres、keycloak、caddy。
2. 看 8790：`Get-NetTCPConnection -LocalPort 8790 -State Listen`。
3. 起 Hub：`scripts/start-m01-demo.ps1`；失败时前台跑 `scripts/run-m01-hub.ps1` 看启动错误。
4. 浏览器证书：本机需信任 `deploy/m01/caddy-root.crt`。

### 4.2 登录失败 / 没有权限

- 确认 Keycloak 地址使用 `https://<域名>:9443`，不是 8080。
- 确认账号在 `aeos` realm，且角色属于 `manager/supervisor/operator/owner/analyst` 之一。
- M01 日志只输出通用失败，不暴露 IdP 细节；需要时查 Keycloak 容器日志：
  ```powershell
  docker logs --tail 100 m01-keycloak-1
  ```

### 4.3 网关离线 / 不注册

按顺序检查：

1. `Get-ScheduledTask -TaskName "AEOS-Hub-ControlPlatformGateway"` 是否为 `Running`。
2. 是否有 `aeos-execution-agent\gateway.pause`；有就删除并等 1 分钟。
3. 看 `aeos-execution-agent\gateway.out.*.log`、`gateway.err.*.log`、`gateway-watchdog.log`。
4. 手动重启网关任务（见 3.2）。
5. 仍失败时前台启动看完整错误：
   ```powershell
   cd aeos-execution-agent
   node --env-file=.env src/gateway-main.js
   ```
   注意：前台启动前先停掉计划任务，避免两个网关同时连接。

### 4.4 网关被 401 / 身份不匹配

- 2026-10-27 起 M01 拒绝旧根令牌，这是预期行为。
- 网关必须配置 `EXECUTION_SYSTEM_ID=control-platform` 和 `EXECUTION_SYSTEM_TOKEN`；只有其中一项会拒绝启动。
- 重新签发令牌（在仓库根执行，输出是密钥，不要贴到聊天/工单）：
  ```powershell
  node scripts/mint-system-token.ts control-platform
  ```
- 系统必须已在 `data/systems.json` 登记且 `status=active`；停用的系统会被拒绝。
- 自报系统与令牌系统不一致会被拒绝（`SYSTEM_IDENTITY_MISMATCH`）。

### 4.5 查询/推理失败

| 现象 | 先看什么 | 处理 |
|---|---|---|
| `UPSTREAM_UNAVAILABLE` | 网关是否能访问 SPC、SPC 是否停服 | 这是上游不可用，不等于“没有数据”；保留错误码，联系中台 |
| 502/504 | 网关日志里的上游 URL、耗时 | 确认 SPC 地址/网络/超时；必要时用只读 ping 验证 |
| 400 缺少 `context.businessObjectRef` | 是否从订单/物料等业务对象发起推理 | 补齐业务锚点后再试；不要手改请求绕过 |
| 推理 `data_confidence` 低 / `STALE_DATA` | 结果里的 `data_as_of` | 页面上明确标注“数据置信度不足”，不要据此做金额/承诺判断 |
| 中台取消后仍显示运行中 | 执行面事件、Hub run 状态 | 用页面“取消分析”或系统召回；确认中台 `task_id` 已取消 |

### 4.6 PLM 断连

PLM 是外部执行面，Hub 不主动重连它。检查：

```powershell
node -e "const d=require('./data/execution-plane.json');const a=d.agents||d;for(const x of (Array.isArray(a)?a:Object.values(a)))if(x.systemId==='hengjian-plm')console.log(x.agentId,x.lastSeenAt,x.runtimeStatus)"
```

- `lastSeenAt` 很旧：PLM 侧 Agent/主机/网络问题，需要 PLM 负责人恢复。
- Host 能 ping 通但没有注册：看 PLM 侧执行面进程、令牌、`sourceSystem`。
- 不要因为 PLM 离线就删除其系统登记或执行面记录。

### 4.7 磁盘增长

```powershell
# 数据目录大小
"{0:N1} MB" -f ((Get-ChildItem data -Recurse -File | Measure-Object Length -Sum).Sum / 1MB)

# 预览可清理文件（默认不删）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/cleanup-data.ps1
```

- 立即释放空间：确认预览后加 `-Apply`。
- 证据归档默认保留 180 天，且始终保留最新 7 个；缩短前先确认审计要求。
- 备份在 `G:\PyCharm\data\aeos-hub-backup`，默认保留 3 天；磁盘紧张时先看这里。

### 4.8 备份/清理任务失败

```powershell
Get-ScheduledTaskInfo -TaskName "AEOS Hub Data Backup"
Get-ScheduledTaskInfo -TaskName "AEOS Hub Data Cleanup"
```

- `LastTaskResult` 非 0：看 `G:\PyCharm\data\aeos-hub-backup\backup.log` 或 `data\cleanup.log`。
- 计划任务动作必须是完整 `powershell.exe` 路径，且 WorkingDirectory 为 `G:\PyCharm\aeos-hub`（0x80070002 通常是这个问题）。
- 修改 PowerShell 脚本后保持 **UTF-8 带 BOM**，否则 PowerShell 5.1 会按 ANSI 解析中文并报语法错误。

## 5. 变更与回滚

### 发布前

1. 确认最近一次备份 `LastTaskResult=0`。
2. `git status` 确认没有把 `.env`、`deploy/m01/.env`、`data/` 纳入提交。
3. 跑完整测试：`npm test`。
4. 记录当前提交：`git rev-parse --short HEAD`。

### 发布

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stop-m01-demo.ps1 -KeepIdentityStack
git pull
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-m01-demo.ps1
```

启动后按第 2 节检查：登录、执行面在线、一次只读查询、一次推理（如中台可用）。

### 回滚

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stop-m01-demo.ps1 -KeepIdentityStack
git checkout <上一个稳定提交>
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-m01-demo.ps1
```

数据文件不随代码回滚；如果新版本写坏了数据，按 `docs/ops-backup.md` 从备份恢复，恢复前先停 Hub。

## 6. 安全与数据

- `.env`、`deploy/m01/.env`、`aeos-execution-agent/.env` 含密钥，不提交、不截图、不贴聊天。
- `node scripts/mint-system-token.ts` 会打印令牌；只在受控终端执行，用完清理历史。
- 所有结论必须带 `evidence_refs`；没有证据或数据过旧时标注“数据置信度不足”，不编造。
- Hub 只有建议权，没有执行权；页面输出是“建议动作 + 需谁审批”，不要口头承诺“已处理”。
- 证据归档和审计日志按 `docs/ops-data-retention.md` 保留；清理前确认合规要求。

## 7. 交接清单

- [ ] 能登录 9444，知道 Keycloak 管理入口 9443
- [ ] 知道网关两个计划任务、`gateway.pause` 的用法
- [ ] 能执行第 2 节全部检查命令并解释预期结果
- [ ] 知道备份/清理任务、日志位置和保留策略
- [ ] 知道回滚命令和数据恢复流程
- [ ] 知道 PLM/SPC 是外部系统，Hub 侧只能观测和报警，不能替对方恢复

## 8. 相关文档

| 主题 | 文档 |
|---|---|
| 备份与恢复 | `docs/ops-backup.md` |
| 数据清理与保留 | `docs/ops-data-retention.md` |
| 网关部署与守护 | `aeos-execution-agent/GATEWAY.md` |
| 执行面身份 | `docs/execution-plane-identity.md` |
| 执行面契约 | `docs/execution-plane-agent-contract.md` |
| SPC 网关接入 | `docs/spc-gateway-integration.md` |
| 链路追踪 | `docs/execution-trace.md` |
| 业务视图 | `docs/business-view.md` |
