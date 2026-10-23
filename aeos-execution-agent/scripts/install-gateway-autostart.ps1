# Install/uninstall the Windows logon autostart task for the control-platform gateway.
# Install: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-gateway-autostart.ps1
# Uninstall: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-gateway-autostart.ps1 -Uninstall
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch]$Uninstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$taskName = 'AEOS-Hub-ControlPlatformGateway'
$watchdog = Join-Path $PSScriptRoot 'run-gateway.ps1'

function Stop-GatewayNodes {
  Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'node.exe' -and $_.CommandLine -match 'gateway-main\.js'
  } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Output ("stopped gateway pid " + $_.ProcessId)
  }
}

if ($Uninstall) {
  if ($PSCmdlet.ShouldProcess($taskName, 'Uninstall logon autostart task and stop gateway')) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Stop-GatewayNodes
    Write-Output 'Uninstalled gateway autostart task and stopped gateway processes.'
  }
  return
}

if (-not (Test-Path -LiteralPath $watchdog -PathType Leaf)) {
  throw "Missing watchdog script: $watchdog"
}

$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $powershell -PathType Leaf)) { $powershell = 'powershell.exe' }
$packageRoot = Split-Path -Parent $PSScriptRoot
$action = New-ScheduledTaskAction `
  -Execute $powershell `
  -Argument "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$watchdog`"" `
  -WorkingDirectory $packageRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

if ($PSCmdlet.ShouldProcess($taskName, 'Register logon autostart task and start watchdog')) {
  Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description 'AEOS Hub control-platform gateway: logon autostart + crash restart' `
    -Force | Out-Null
  Start-ScheduledTask -TaskName $taskName
  Write-Output "Installed and started scheduled task: $taskName"
  Write-Output "Watchdog log: $PSScriptRoot\..\gateway-watchdog.log"
  Write-Output "Gateway output: $PSScriptRoot\..\gateway.out.*.log / gateway.err.*.log"
}
