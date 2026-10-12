[CmdletBinding(SupportsShouldProcess = $true)]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$environmentFile = Join-Path $repositoryRoot 'deploy\m01\.env'
$certificateFile = Join-Path $repositoryRoot 'deploy\m01\caddy-root.crt'

function Read-Settings([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'Missing deploy/m01/.env.' }
  $settings = @{}
  foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
    if ($line -match '^\s*(?:#|$)') { continue }
    $separator = $line.IndexOf('=')
    if ($separator -gt 0) { $settings[$line.Substring(0, $separator).Trim()] = $line.Substring($separator + 1).Trim() }
  }
  return $settings
}

function Test-PrivateIPv4([string]$Address) {
  $ip = [System.Net.IPAddress]::Parse($Address)
  $bytes = $ip.GetAddressBytes()
  return ($bytes[0] -eq 10) -or ($bytes[0] -eq 192 -and $bytes[1] -eq 168) -or ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31)
}

$settings = Read-Settings $environmentFile
foreach ($name in @('M01_LISTEN_ADDRESS', 'M01_KEYCLOAK_EXTERNAL_HOSTNAME', 'M01_KEYCLOAK_HTTPS_PORT', 'M01_HUB_EXTERNAL_HOSTNAME', 'M01_HUB_HTTPS_PORT')) {
  if (-not $settings.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($settings[$name])) { throw "$name is required for the LAN demo." }
}
if ($settings['M01_LISTEN_ADDRESS'] -ne '0.0.0.0' -and -not (Test-PrivateIPv4 $settings['M01_LISTEN_ADDRESS'])) { throw 'M01_LISTEN_ADDRESS must be 0.0.0.0 or a private IPv4 address.' }
if ($settings['M01_KEYCLOAK_EXTERNAL_HOSTNAME'] -ne $settings['M01_HUB_EXTERNAL_HOSTNAME'] -or $settings['M01_KEYCLOAK_EXTERNAL_HOSTNAME'] -notmatch '^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$') { throw 'Both external hostnames must match and be a valid LAN hostname.' }
foreach ($portName in @('M01_KEYCLOAK_HTTPS_PORT', 'M01_HUB_HTTPS_PORT')) {
  $port = 0
  if (-not [int]::TryParse($settings[$portName], [ref]$port) -or $port -lt 1 -or $port -gt 65535) { throw "$portName must be a TCP port between 1 and 65535." }
}
if ($settings['M01_KEYCLOAK_HTTPS_PORT'] -eq $settings['M01_HUB_HTTPS_PORT']) { throw 'Identity and Hub HTTPS ports must differ.' }
if (-not (Test-Path -LiteralPath $certificateFile -PathType Leaf)) { throw 'Missing Caddy public root certificate.' }
Write-Output 'LAN M01 configuration is valid (values redacted).'
if ($WhatIfPreference) { Write-Output 'WhatIf: validation only; no service or firewall changes were made.' }
