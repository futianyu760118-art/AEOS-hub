[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Low')]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$dryRun = [bool]$WhatIfPreference
$WhatIfPreference = $false
if ($dryRun) {
  Write-Output 'WhatIf: would remove only the two named M01 LAN firewall rules.'
  return
}
foreach ($name in @('AEOS M01 LAN HTTPS Identity', 'AEOS M01 LAN HTTPS Hub')) {
  $rules = @(Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue)
  if ($rules.Count) { $rules | Remove-NetFirewallRule }
}
Write-Output 'M01 LAN firewall rules removed; no Docker volume, database, account, or other firewall rule was changed.'
