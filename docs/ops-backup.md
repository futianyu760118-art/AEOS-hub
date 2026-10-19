# 数据备份运维说明（A1）

> 落地日期：2026-10-19  
> 目标目录：`G:\PyCharm\data\aeos-hub-backup`  
> 保留：最近 **3 天**（3 个每日压缩包）  
> 执行时间：每天 **02:00**（Windows 计划任务，SYSTEM 身份）

## 备份内容

- `data/` 下的业务数据：智能体台账、Agent 小队、执行面状态、用量台账、借调单、审计日志与归档、模型目录、任务/项目/经营事项等；
- 自动排除：`access-token.txt`（密钥/令牌）、`*.tmp-*`、`*.corrupt-*`、`*.bak`、`*.bak-*`；
- 不备份 `.env` 等明文密钥配置。

## 文件与位置

| 项目 | 位置 |
|---|---|
| 备份脚本 | `scripts/backup-data.ps1` |
| 计划任务注册 | `scripts/register-backup-task.ps1` |
| 备份目录 | `G:\PyCharm\data\aeos-hub-backup` |
| 每日压缩包 | `aeos-hub-data-YYYY-MM-DD.zip` |
| 运行日志 | `G:\PyCharm\data\aeos-hub-backup\backup.log` |

## 手动执行

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup-data.ps1
```

可选参数：

```powershell
# 自定义源目录 / 目标目录 / 保留天数
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup-data.ps1 `
  -SourceDir "G:\PyCharm\aeos-hub\data" `
  -DestinationRoot "G:\PyCharm\data\aeos-hub-backup" `
  -RetentionDays 3
```

## 注册/更新计划任务

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register-backup-task.ps1
```

检查：

```powershell
Get-ScheduledTask -TaskName "AEOS Hub Data Backup"
Get-ScheduledTaskInfo -TaskName "AEOS Hub Data Backup"
```

## 恢复步骤

1. 停止 Hub（避免恢复时旧进程继续写文件）：
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stop-m01-demo.ps1 -KeepIdentityStack
   ```
2. 解压目标日期的备份到临时目录，确认文件：
   ```powershell
   Expand-Archive -Path "G:\PyCharm\data\aeos-hub-backup\aeos-hub-data-2026-10-19.zip" -DestinationPath "$env:TEMP\aeos-restore" -Force
   ```
3. 备份当前 `data/`（防止恢复错版本），再把需要的文件复制回 `G:\PyCharm\aeos-hub\data\`；
4. 启动 Hub：
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-m01-demo.ps1
   ```
5. 检查登录、用量台账、借调单是否正常。

> 2026-10-19 已做恢复演练：从压缩包还原 `usage-ledger.json`，SHA-256 与源文件一致。

## 注意事项

- 脚本文件是 **UTF-8 带 BOM + CRLF**；用编辑器修改后请保持编码，否则 PowerShell 5.1 可能按 ANSI 解析导致中文报错。
- 备份采用先复制到临时目录再压缩，避免直接读取正在写入的文件；但 `evidence.jsonl` 仍在持续追加，极端情况下最后一行可能不完整，不影响历史记录。
- 告警暂未接企业微信（按当前决定）；备份失败会写入 `backup.log` 并以非零码退出，后续接入监控时可以据此告警。
- 如果备份目录改到网络盘，SYSTEM 账户可能没有访问权限，需要改用有权限的账户运行计划任务。
