# 数据清理与保留策略（A1）

> 落地日期：2026-10-27  
> 脚本：`scripts/cleanup-data.ps1`（默认只预览，`-Apply` 才删除）  
> 计划任务：`AEOS Hub Data Cleanup`，每周日 **03:00**，SYSTEM 身份  
> 日志：`data/cleanup.log`

## 保留策略

| 对象 | 匹配规则 | 默认保留 | 说明 |
|---|---|---|---|
| 原子写残留 | `data/*.tmp-*` | 24 小时 | 进程崩溃或中断后留下的临时文件，不影响正式数据 |
| 历史备份/隔离文件 | `*.bak`、`*.bak-*`、`*.corrupt-*` | 30 天 | 数据迁移、修复前的本地副本；正式备份见 `docs/ops-backup.md` |
| 证据归档 | `data/evidence-archive/*.jsonl` | 180 天 | 按文件名时间戳判断，且始终保留最新 **7** 个归档 |
| 每日备份压缩包 | `aeos-hub-backup/aeos-hub-data-*.zip` | 3 天 | 由备份任务单独管理，不在本清理脚本范围内 |

> 证据归档是审计依据。缩短保留期前，先确认公司合规/审计要求；需要长期留存时，应先导出到公司数据库或归档存储，再清理本地文件。

## 手动执行

默认只预览，不删除：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/cleanup-data.ps1
```

确认预览结果后执行删除：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/cleanup-data.ps1 -Apply
```

自定义保留期（示例）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/cleanup-data.ps1 -Apply `
  -TmpRetentionHours 12 `
  -BackupRetentionDays 60 `
  -EvidenceRetentionDays 365 `
  -KeepMinEvidenceFiles 14
```

## 注册/更新计划任务

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register-cleanup-task.ps1
```

检查：

```powershell
Get-ScheduledTask -TaskName "AEOS Hub Data Cleanup"
Get-ScheduledTaskInfo -TaskName "AEOS Hub Data Cleanup"
```

任务动作（已注册）：

```
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "G:\PyCharm\aeos-hub\scripts\cleanup-data.ps1" -Apply
```

## 首次执行记录（2026-10-27）

- 预览：211 个 `*.tmp-*`，共 197.89 MB；无超过 30 天的 bak，无超过 180 天的证据归档。
- 执行：211 个文件全部删除，`data/` 从约 722 MB 降到约 524 MB。
- 计划任务手动触发：`LastTaskResult = 0`；无候选时写入 `cleanup: no candidates; apply=True`。
- 当前仍保留 4 个 24 小时内的 `*.tmp-*`，属于正常写入残留。

## 注意事项

- 脚本只按上述文件名规则匹配，不会删除 `execution-plane.json`、`usage-ledger.json`、`borrow-orders.json` 等正式数据文件。
- **不要**删除最近 24 小时内的 `*.tmp-*`：Hub 正在写入时可能短暂存在同名文件。
- 证据归档至少保留最新 7 个，即使它们都已超过保留期。
- 脚本文件必须保持 **UTF-8 带 BOM**；PowerShell 5.1 会把无 BOM 的中文脚本按 ANSI 解析并报语法错误。
- 删除后需要追溯时，从最近 3 天的每日备份恢复；超过 3 天的数据只能依赖公司数据库/外部归档。
