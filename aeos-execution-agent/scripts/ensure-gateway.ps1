# AEOS control-platform gateway keeper: runs every minute via Task Scheduler.
# If no gateway node process is present and gateway.pause does not exist, start the gateway task.
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$packageRoot = Split-Path -Parent $PSScriptRoot
$pauseFile = Join-Path $packageRoot 'gateway.pause'
$watchdogLog = Join-Path $packageRoot 'gateway-watchdog.log'
$taskName = 'AEOS-Hub-ControlPlatformGateway'

function Write-Log([string]$Message) {
  $line = "$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK') $Message"
  Add-Content -LiteralPath $watchdogLog -Value $line -Encoding UTF8
}

if (Test-Path -LiteralPath $pauseFile -PathType Leaf) {
  exit 0
}

$existing = @(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'node.exe' -and $_.CommandLine -match 'gateway-main\.js'
})
if ($existing.Count -gt 0) {
  exit 0
}

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($null -ne $task -and $task.State -eq 'Running') {
  # The gateway task is starting or between process spawns; wait for the next keeper tick.
  exit 0
}

Write-Log "keeper: gateway process missing; starting task $taskName"
Start-ScheduledTask -TaskName $taskName
