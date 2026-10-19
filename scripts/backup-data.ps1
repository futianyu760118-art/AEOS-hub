# AEOS Hub 业务数据备份
# 目标：每天把 data/ 下的业务数据打包到 G:\PyCharm\data\aeos-hub-backup，保留 3 天。
# 不备份：access-token.txt、*.tmp-*、*.corrupt-*、*.bak / *.bak-*
[CmdletBinding()]
param(
  [string]$SourceDir = '',
  [string]$DestinationRoot = 'G:\PyCharm\data\aeos-hub-backup',
  [int]$RetentionDays = 3
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($scriptDir)) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if ([string]::IsNullOrWhiteSpace($SourceDir)) { $SourceDir = Join-Path (Split-Path -Parent $scriptDir) 'data' }

$logFile = Join-Path $DestinationRoot 'backup.log'
$stamp = Get-Date -Format 'yyyy-MM-dd'
$zipPath = Join-Path $DestinationRoot ("aeos-hub-data-$stamp.zip")
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("aeos-backup-" + [Guid]::NewGuid().ToString('N'))

function Write-BackupLog([string]$line) {
  try {
    if (-not (Test-Path -LiteralPath $DestinationRoot -PathType Container)) {
      New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null
    }
    Add-Content -LiteralPath $logFile -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'), $line)
  } catch {
    # 日志失败不影响备份本身。
  }
}

function Test-Excluded([string]$name) {
  if ($name -eq 'access-token.txt') { return $true }
  foreach ($pattern in @('*.tmp-*', '*.corrupt-*', '*.bak', '*.bak-*')) {
    if ($name -like $pattern) { return $true }
  }
  return $false
}

try {
  if (-not (Test-Path -LiteralPath $SourceDir -PathType Container)) {
    throw "数据目录不存在：$SourceDir"
  }
  if (-not (Test-Path -LiteralPath $DestinationRoot -PathType Container)) {
    New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null
  }

  New-Item -ItemType Directory -Path $stage -Force | Out-Null
  $copied = 0
  Get-ChildItem -LiteralPath $SourceDir -Force | ForEach-Object {
    if (Test-Excluded $_.Name) { return }
    Copy-Item -LiteralPath $_.FullName -Destination $stage -Recurse -Force
    $copied += 1
  }
  if ($copied -eq 0) { throw '没有可备份的数据文件。' }

  if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zipPath -CompressionLevel Optimal -Force

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    if ($archive.Entries.Count -eq 0) { throw '备份压缩包为空。' }
    $entries = $archive.Entries.Count
  } finally {
    $archive.Dispose()
  }

  # 保留最近 N 天：按压缩包写入时间判断。
  $cutoff = (Get-Date).AddDays(-$RetentionDays)
  $removed = 0
  Get-ChildItem -LiteralPath $DestinationRoot -Filter 'aeos-hub-data-*.zip' -File | ForEach-Object {
    if ($_.LastWriteTime -lt $cutoff) {
      Remove-Item -LiteralPath $_.FullName -Force
      $removed += 1
    }
  }

  $sizeMb = [math]::Round((Get-Item -LiteralPath $zipPath).Length / 1MB, 2)
  Write-BackupLog ("OK zip={0} entries={1} sourceItems={2} sizeMB={3} retentionDays={4} removed={5}" -f $zipPath, $entries, $copied, $sizeMb, $RetentionDays, $removed)
  Write-Output ("备份完成：{0}（{1} MB，{2} 个条目；清理旧备份 {3} 个）" -f $zipPath, $sizeMb, $entries, $removed)
} catch {
  Write-BackupLog ("FAILED {0}" -f $_.Exception.Message)
  Write-Error ("备份失败：{0}" -f $_.Exception.Message)
  exit 1
} finally {
  if (Test-Path -LiteralPath $stage) {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
  }
}
