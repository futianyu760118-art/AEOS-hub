# AEOS control-platform gateway watchdog: starts the node gateway and restarts it on exit.
# Invoked by a Windows Scheduled Task at user logon. Logs stay under aeos-execution-agent/ (*.log is gitignored).
[CmdletBinding()]
param(
  [int]$RestartDelaySeconds = 5,
  [int]$ExistingCheckSeconds = 30,
  [string]$NodePath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$packageRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $packageRoot '.env'
if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
  throw "Missing $envFile. Create the gateway config first (see GATEWAY.md)."
}

$watchdogLog = Join-Path $packageRoot 'gateway-watchdog.log'

function Write-Log([string]$Message) {
  $line = "$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK') $Message"
  Add-Content -LiteralPath $watchdogLog -Value $line -Encoding UTF8
}

if (-not $NodePath) {
  $command = Get-Command node -ErrorAction SilentlyContinue
  if ($null -ne $command) {
    $NodePath = $command.Source
  } elseif (Test-Path -LiteralPath 'D:\Program Files\nodejs\node.exe') {
    $NodePath = 'D:\Program Files\nodejs\node.exe'
  } elseif (Test-Path -LiteralPath 'C:\Program Files\nodejs\node.exe') {
    $NodePath = 'C:\Program Files\nodejs\node.exe'
  }
}
if (-not $NodePath -or -not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
  throw 'node.exe not found. Pass -NodePath explicitly.'
}

Write-Log "watchdog started; node=$NodePath; package=$packageRoot"

while ($true) {
  $existing = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'node.exe' -and $_.CommandLine -match 'gateway-main\.js'
  })
  if ($existing.Count -gt 0) {
    Write-Log ("gateway already running: " + (($existing | ForEach-Object { $_.ProcessId }) -join ','))
    Start-Sleep -Seconds $ExistingCheckSeconds
    continue
  }

  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $outFile = Join-Path $packageRoot "gateway.out.$stamp.log"
  $errFile = Join-Path $packageRoot "gateway.err.$stamp.log"
  try {
    Write-Log 'starting gateway'
    $process = Start-Process -FilePath $NodePath `
      -ArgumentList '--env-file=.env', 'src/gateway-main.js' `
      -WorkingDirectory $packageRoot `
      -RedirectStandardOutput $outFile `
      -RedirectStandardError $errFile `
      -WindowStyle Hidden `
      -PassThru
    Write-Log ("gateway pid " + $process.Id)
    $process.WaitForExit()
    $exitCode = $process.ExitCode
    if ($null -eq $exitCode) { $exitCode = 'unknown' }
    Write-Log ("gateway exited code " + $exitCode + "; restarting in " + $RestartDelaySeconds + "s")
  } catch {
    Write-Log ("gateway start failed: " + $_.Exception.Message)
  }
  Start-Sleep -Seconds $RestartDelaySeconds
}
