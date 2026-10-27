# 注册 AEOS Hub 每周数据清理任务（每周日 03:00，以 SYSTEM 身份运行，无需保持登录）
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register-cleanup-task.ps1
[CmdletBinding()]
param(
  [string]$TaskName = 'AEOS Hub Data Cleanup',
  [string]$At = '03:00'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$cleanupScript = Join-Path $PSScriptRoot 'cleanup-data.ps1'
if (-not (Test-Path -LiteralPath $cleanupScript -PathType Leaf)) {
  throw "清理脚本不存在：$cleanupScript"
}

$powershellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$cleanupScript`" -Apply"
$create = @(
  '/Create',
  '/TN', $TaskName,
  '/TR', "`"$powershellExe`" $arguments",
  '/SC', 'WEEKLY',
  '/D', 'SUN',
  '/ST', $At,
  '/RU', 'SYSTEM',
  '/RL', 'HIGHEST',
  '/F'
)

$output = & schtasks.exe @create 2>&1
if ($LASTEXITCODE -ne 0) {
  throw ("注册计划任务失败：{0}" -f ($output -join ' '))
}

Write-Output ("已注册计划任务：{0}，每周日 {1} 执行清理（-Apply）。" -f $TaskName, $At)
Write-Output ("查询：schtasks /Query /TN `"{0}`" /V /FO LIST" -f $TaskName)
