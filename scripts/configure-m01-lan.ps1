[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
  [ValidatePattern('^\d{1,3}(\.\d{1,3}){3}$')]
  [string]$LanAddress = '192.168.0.23',
  [ValidatePattern('^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$')]
  [string]$ExternalHost = 'aeos-hub.test',
  [ValidateRange(1, 65535)]
  [int]$IdentityPort = 9443,
  [ValidateRange(1, 65535)]
  [int]$HubPort = 9444,
  [switch]$ApplyKeycloakClient
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$environmentFile = Join-Path $repositoryRoot 'deploy\m01\.env'
$composeFile = Join-Path $repositoryRoot 'deploy\m01\docker-compose.yml'

function Assert-LocalPrivateIPv4([string]$Address) {
  $ip = [System.Net.IPAddress]::Parse($Address)
  $bytes = $ip.GetAddressBytes()
  $private = ($bytes[0] -eq 10) -or ($bytes[0] -eq 192 -and $bytes[1] -eq 168) -or ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31)
  if (-not $private) { throw 'LAN address must be an RFC1918 private IPv4 address.' }
  $local = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.IPAddress -eq $Address -and $_.AddressState -eq 'Preferred' }
  if (-not $local) { throw "$Address is not a preferred IPv4 address on this computer." }
}

function Set-EnvironmentValue([string]$Path, [string]$Name, [string]$Value) {
  $lines = [System.Collections.Generic.List[string]]([System.IO.File]::ReadAllLines($Path))
  $updated = $false
  for ($index = 0; $index -lt $lines.Count; $index++) {
    if ($lines[$index] -match "^\s*$([regex]::Escape($Name))=") {
      $lines[$index] = "$Name=$Value"
      $updated = $true
    }
  }
  if (-not $updated) { $lines.Add("$Name=$Value") }
  [System.IO.File]::WriteAllLines($Path, $lines)
}

if ($IdentityPort -eq $HubPort) { throw 'IdentityPort and HubPort must differ.' }
if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) { throw 'Missing deploy/m01/.env.' }
Assert-LocalPrivateIPv4 $LanAddress
$planned = @{
  # Docker Desktop on Windows cannot always reach an individual host-IP port
  # mapping from the host itself. Firewall rules restrict this all-interface
  # listener to Private/LocalSubnet while external URLs keep the fixed IP.
  M01_LISTEN_ADDRESS = '0.0.0.0'
  M01_KEYCLOAK_EXTERNAL_HOSTNAME = $ExternalHost
  M01_KEYCLOAK_HTTPS_PORT = [string]$IdentityPort
  M01_HUB_EXTERNAL_HOSTNAME = $ExternalHost
  M01_HUB_HTTPS_PORT = [string]$HubPort
}
if ($WhatIfPreference) {
  Write-Output "WhatIf: would configure private LAN TLS endpoints for $ExternalHost -> $LanAddress (identity $IdentityPort; Hub $HubPort) and would not print secrets."
  if ($ApplyKeycloakClient) { Write-Output 'WhatIf: would update only the aeos-hub-web redirect URI, web origin, and post-logout URI.' }
  return
}

$backupRoot = Join-Path $env:LOCALAPPDATA 'AEOS-Hub\m01-backups'
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
$backupFile = Join-Path $backupRoot ("m01-env-before-lan-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.env')
Copy-Item -LiteralPath $environmentFile -Destination $backupFile -ErrorAction Stop
foreach ($entry in $planned.GetEnumerator()) { Set-EnvironmentValue $environmentFile $entry.Key $entry.Value }
Write-Output "Runtime configuration updated; backup stored outside the repository at $backupFile."

if (-not $ApplyKeycloakClient) { return }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker Desktop is required to update the Keycloak client.' }
& docker version --format '{{.Server.Version}}' 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is not ready.' }
$callback = "https://$ExternalHost`:$HubPort/api/auth/callback"
$origin = "https://$ExternalHost`:$HubPort"
$logout = "$origin/?logged_out=1"
& docker compose --env-file $environmentFile -f $composeFile exec -T keycloak sh /opt/aeos/configure-client.sh
if ($LASTEXITCODE -ne 0) { throw 'Keycloak client update failed.' }
