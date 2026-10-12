[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
  [ValidatePattern('^\d{1,3}(\.\d{1,3}){3}$')]
  [string]$LanAddress = '192.168.0.23',
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$')]
  [string]$HostName = 'aeos-hub.test'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$dryRun = [bool]$WhatIfPreference
$WhatIfPreference = $false
if ($dryRun) { Write-Output "WhatIf: would map $HostName to $LanAddress in the Windows hosts file and flush DNS."; return }
$hostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$line = "$LanAddress`t$HostName # AEOS M01 LAN demo"
$existing = @(Get-Content -LiteralPath $hostsPath)
$pattern = "^\s*\d{1,3}(?:\.\d{1,3}){3}\s+$([regex]::Escape($HostName))(?:\s|$)"
$filtered = @($existing | Where-Object { $_ -notmatch $pattern })
[System.IO.File]::WriteAllLines($hostsPath, @($filtered + $line))
Clear-DnsClientCache
Write-Output "$HostName now resolves locally to $LanAddress."
