# AEOS control-platform gateway run script (foreground, no child process).
# Invoked by the Windows Scheduled Task. Exits non-zero when the gateway stops,
# so Task Scheduler "restart on failure" can bring it back; the keeper task also checks every minute.
# Pause: create gateway.pause in the package root (keeper and this script will not start the gateway).
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$packageRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $packageRoot '.env'
$pauseFile = Join-Path $packageRoot 'gateway.pause'
$watchdogLog = Join-Path $packageRoot 'gateway-watchdog.log'

function Write-Log([string]$Message) {
  $line = "$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK') $Message"
  Add-Content -LiteralPath $watchdogLog -Value $line -Encoding UTF8
}

if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
  throw "Missing $envFile. Create the gateway config first (see GATEWAY.md)."
}
if (Test-Path -LiteralPath $pauseFile -PathType Leaf) {
  Write-Log 'gateway paused via gateway.pause; not starting'
  exit 0
}

$existing = @(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'node.exe' -and $_.CommandLine -match 'gateway-main\.js'
})
if ($existing.Count -gt 0) {
  Write-Log ("gateway already running: " + (($existing | ForEach-Object { $_.ProcessId }) -join ','))
  exit 0
}

$nodePath = ''
$command = Get-Command node -ErrorAction SilentlyContinue
if ($null -ne $command) {
  $nodePath = $command.Source
} elseif (Test-Path -LiteralPath 'D:\Program Files\nodejs\node.exe') {
  $nodePath = 'D:\Program Files\nodejs\node.exe'
} elseif (Test-Path -LiteralPath 'C:\Program Files\nodejs\node.exe') {
  $nodePath = 'C:\Program Files\nodejs\node.exe'
}
if (-not $nodePath -or -not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
  throw 'node.exe not found.'
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outFile = Join-Path $packageRoot "gateway.out.$stamp.log"
$errFile = Join-Path $packageRoot "gateway.err.$stamp.log"

Set-Location -LiteralPath $packageRoot
Write-Log "starting gateway in foreground; node=$nodePath"
& $nodePath '--env-file=.env' 'src/gateway-main.js' 1>> $outFile 2>> $errFile
$exitCode = $LASTEXITCODE
if ($null -eq $exitCode) { $exitCode = 'unknown' }
Write-Log "gateway exited code $exitCode; scheduler/keeper will restart in about 1 minute"
# Always fail so Task Scheduler restarts the task; the keeper is the second safety net.
exit 1
