# AEOS Hub 数据清理（默认只预览；加 -Apply 才删除）
# 清理范围：
#   - 执行面原子写残留：*.tmp-*（默认超过 24 小时）
#   - 历史备份/隔离文件：*.bak / *.bak-* / *.corrupt-*（默认超过 30 天）
#   - Evidence 归档：evidence-archive/*.jsonl（默认超过 180 天，且至少保留最新 7 个）
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\cleanup-data.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\cleanup-data.ps1 -Apply
[CmdletBinding()]
param(
  [string]$SourceDir = '',
  [int]$TmpRetentionHours = 24,
  [int]$BackupRetentionDays = 30,
  [int]$EvidenceRetentionDays = 180,
  [int]$KeepMinEvidenceFiles = 7,
  [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($scriptDir)) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if ([string]::IsNullOrWhiteSpace($SourceDir)) { $SourceDir = Join-Path (Split-Path -Parent $scriptDir) 'data' }
$evidenceDir = Join-Path $SourceDir 'evidence-archive'
$logFile = Join-Path $SourceDir 'cleanup.log'
$now = Get-Date
$candidates = @()

function Write-Log([string]$line) {
  try {
    Add-Content -LiteralPath $logFile -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'), $line) -Encoding UTF8
  } catch {
    # 日志失败不影响清理。
  }
}

function Add-Candidate([System.IO.FileInfo]$file, [string]$reason) {
  $script:candidates += [PSCustomObject]@{
    Path = $file.FullName
    SizeMB = [math]::Round($file.Length / 1MB, 3)
    Reason = $reason
    LastWriteTime = $file.LastWriteTime
  }
}

if (-not (Test-Path -LiteralPath $SourceDir -PathType Container)) {
  throw "数据目录不存在：$SourceDir"
}

# 1) 执行面原子写残留
Get-ChildItem -LiteralPath $SourceDir -File -Force |
  Where-Object { $_.Name -like '*.tmp-*' -and $_.LastWriteTime -lt $now.AddHours(-$TmpRetentionHours) } |
  ForEach-Object { Add-Candidate $_ "tmp older than ${TmpRetentionHours}h" }

# 2) 历史 bak / corrupt 文件
Get-ChildItem -LiteralPath $SourceDir -File -Force |
  Where-Object {
    ($_.Name -like '*.bak' -or $_.Name -like '*.bak-*' -or $_.Name -like '*.corrupt-*') -and
    $_.LastWriteTime -lt $now.AddDays(-$BackupRetentionDays)
  } |
  ForEach-Object { Add-Candidate $_ "backup older than ${BackupRetentionDays}d" }

# 3) Evidence 归档：按文件名时间；至少保留最新 N 个
if (Test-Path -LiteralPath $evidenceDir -PathType Container) {
  $archives = Get-ChildItem -LiteralPath $evidenceDir -File -Filter '*.jsonl' -Force | ForEach-Object {
    $stamp = $_.Name.Substring(0, [Math]::Min(19, $_.Name.Length))
    $parsed = [datetime]::MinValue
    $ok = [datetime]::TryParseExact($stamp, 'yyyy-MM-ddTHH-mm-ss', [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AssumeLocal, [ref]$parsed)
    [PSCustomObject]@{ File = $_; When = $(if ($ok) { $parsed } else { $_.LastWriteTime }) }
  } | Sort-Object When -Descending
  $cutoff = $now.AddDays(-$EvidenceRetentionDays)
  $index = 0
  foreach ($item in $archives) {
    $index += 1
    if ($index -le $KeepMinEvidenceFiles) { continue }
    if ($item.When -lt $cutoff) { Add-Candidate $item.File "evidence archive older than ${EvidenceRetentionDays}d" }
  }
}

if ($candidates.Count -eq 0) {
  Write-Log "cleanup: no candidates; apply=$Apply"
  Write-Output "没有需要清理的文件。"
  exit 0
}

$totalMB = [math]::Round(($candidates | Measure-Object -Property SizeMB -Sum).Sum, 2)

foreach ($candidate in $candidates) {
  if ($Apply) {
    try {
      Remove-Item -LiteralPath $candidate.Path -Force
      Write-Log ("removed {0} ({1} MB) reason={2}" -f $candidate.Path, $candidate.SizeMB, $candidate.Reason)
    } catch {
      Write-Log ("remove failed {0}: {1}" -f $candidate.Path, $_.Exception.Message)
    }
  } else {
    Write-Log ("dry-run {0} ({1} MB) reason={2}" -f $candidate.Path, $candidate.SizeMB, $candidate.Reason)
  }
}

$action = if ($Apply) { '已清理' } else { '可清理（预览）' }
Write-Output ("{0} {1} 个文件，共 {2} MB。" -f $action, $candidates.Count, $totalMB)
Write-Log ("cleanup summary: apply={0} files={1} sizeMB={2}" -f $Apply, $candidates.Count, $totalMB)
