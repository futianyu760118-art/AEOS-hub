# Install/uninstall the Windows logon autostart + keeper tasks for the control-platform gateway.
# Install: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-gateway-autostart.ps1
# Uninstall: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-gateway-autostart.ps1 -Uninstall
# Pause: create gateway.pause in the package root; delete it to resume.
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch]$Uninstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$gatewayTask = 'AEOS-Hub-ControlPlatformGateway'
$keeperTask = 'AEOS-Hub-ControlPlatformGateway-Keeper'
$gatewayScript = Join-Path $PSScriptRoot 'run-gateway.ps1'
$keeperScript = Join-Path $PSScriptRoot 'ensure-gateway.ps1'
$packageRoot = Split-Path -Parent $PSScriptRoot
$pauseFile = Join-Path $packageRoot 'gateway.pause'

function Stop-GatewayNodes {
  Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'node.exe' -and $_.CommandLine -match 'gateway-main\.js'
  } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Output ("stopped gateway pid " + $_.ProcessId)
  }
}

if ($Uninstall) {
  if ($PSCmdlet.ShouldProcess($gatewayTask, 'Uninstall gateway tasks and stop gateway')) {
    Stop-ScheduledTask -TaskName $keeperTask -ErrorAction SilentlyContinue
    Stop-ScheduledTask -TaskName $gatewayTask -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $keeperTask -Confirm:$false -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $gatewayTask -Confirm:$false -ErrorAction SilentlyContinue
    Stop-GatewayNodes
    Write-Output 'Uninstalled gateway tasks and stopped gateway processes.'
  }
  return
}

foreach ($script in @($gatewayScript, $keeperScript)) {
  if (-not (Test-Path -LiteralPath $script -PathType Leaf)) {
    throw "Missing script: $script"
  }
}

$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $powershell -PathType Leaf)) { $powershell = 'powershell.exe' }

$gatewayAction = New-ScheduledTaskAction `
  -Execute $powershell `
  -Argument "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$gatewayScript`"" `
  -WorkingDirectory $packageRoot
$gatewayTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$gatewaySettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

$keeperAction = New-ScheduledTaskAction `
  -Execute $powershell `
  -Argument "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$keeperScript`"" `
  -WorkingDirectory $packageRoot
$keeperOnLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$keeperRepeat = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 1) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$keeperSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

if ($PSCmdlet.ShouldProcess($gatewayTask, 'Register gateway + keeper tasks')) {
  Register-ScheduledTask `
    -TaskName $gatewayTask `
    -Action $gatewayAction `
    -Trigger $gatewayTrigger `
    -Settings $gatewaySettings `
    -Description 'AEOS Hub control-platform gateway: foreground node process, restart on failure' `
    -Force | Out-Null
  Register-ScheduledTask `
    -TaskName $keeperTask `
    -Action $keeperAction `
    -Trigger @($keeperOnLogon, $keeperRepeat) `
    -Settings $keeperSettings `
    -Description 'AEOS Hub control-platform gateway keeper: checks every minute and starts the gateway task if missing' `
    -Force | Out-Null
  Start-ScheduledTask -TaskName $gatewayTask
  Start-ScheduledTask -TaskName $keeperTask
  Write-Output "Installed and started scheduled tasks: $gatewayTask, $keeperTask"
  if (Test-Path -LiteralPath $pauseFile -PathType Leaf) {
    Write-Output "WARNING: $pauseFile exists; the gateway will stay paused until you delete it."
  }
  Write-Output "Watchdog log: $packageRoot\gateway-watchdog.log"
  Write-Output "Gateway output: $packageRoot\gateway.out.*.log / gateway.err.*.log"
}
