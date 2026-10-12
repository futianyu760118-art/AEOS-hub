[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$dryRun = [bool]$WhatIfPreference
$WhatIfPreference = $false
$rules = @(
  @{ Name = 'AEOS M01 LAN HTTPS Identity'; Port = 9443 },
  @{ Name = 'AEOS M01 LAN HTTPS Hub'; Port = 9444 }
)
if ($dryRun) {
  foreach ($rule in $rules) { Write-Output "WhatIf: would allow TCP $($rule.Port) from LocalSubnet on Private profile for $($rule.Name)." }
  Write-Output 'WhatIf: no firewall rule was changed; 8790, 5432, and 8080 remain excluded.'
  return
}
foreach ($rule in $rules) {
  Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName $rule.Name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $rule.Port -Profile Private -RemoteAddress LocalSubnet | Out-Null
}
Write-Output 'Only Private-profile LocalSubnet access to TCP 9443 and 9444 is allowed; no rule was created for 8790, 5432, or 8080.'
