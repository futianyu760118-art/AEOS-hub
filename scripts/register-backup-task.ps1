# 注册 AEOS Hub 每日数据备份任务（每天 02:00，以 SYSTEM 身份运行，无需保持登录）
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register-backup-task.ps1
[CmdletBinding()]
param(
  [string]$TaskName = 'AEOS Hub Data Backup',
  [string]$At = '02:00'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$backupScript = Join-Path $PSScriptRoot 'backup-data.ps1'
if (-not (Test-Path -LiteralPath $backupScript -PathType Leaf)) {
  throw "备份脚本不存在：$backupScript"
}

$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$backupScript`""
$create = @(
  '/Create',
  '/TN', $TaskName,
  '/TR', "powershell.exe $arguments",
  '/SC', 'DAILY',
  '/ST', $At,
  '/RU', 'SYSTEM',
  '/RL', 'HIGHEST',
  '/F'
) | ForEach-Object { $_ }

$output = & schtasks.exe @create 2>&1
if ($LASTEXITCODE -ne 0) {
  throw ("注册计划任务失败：{0}" -f ($output -join ' '))
}

Write-Output ("已注册计划任务：{0}，每天 {1} 执行。" -f $TaskName, $At)
Write-Output '查询：schtasks /Query /TN "AEOS Hub Data Backup" /V /FO LIST'
