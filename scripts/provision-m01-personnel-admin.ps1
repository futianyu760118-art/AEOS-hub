[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$environmentFile = Join-Path $repositoryRoot 'deploy\m01\.env'
$composeFile = Join-Path $repositoryRoot 'deploy\m01\docker-compose.yml'
$clientId = 'aeos-hub-personnel-admin'
$sentinel = '__REPLACE_BEFORE_START__'

function Read-M01Settings {
  if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) {
    throw 'M01 runtime configuration is missing. Create deploy/m01/.env from the template before provisioning.'
  }
  $settings = @{}
  foreach ($line in [System.IO.File]::ReadAllLines($environmentFile)) {
    if ($line -match '^\s*(?:#|$)') { continue }
    $separator = $line.IndexOf('=')
    if ($separator -lt 1) { continue }
    $settings[$line.Substring(0, $separator).Trim()] = $line.Substring($separator + 1)
  }
  foreach ($name in @('M01_CLIENT_SECRET', 'M01_KEYCLOAK_HTTPS_PORT', 'M01_KEYCLOAK_EXTERNAL_HOSTNAME', 'M01_HUB_HTTPS_PORT', 'M01_HUB_EXTERNAL_HOSTNAME', 'M01_LISTEN_ADDRESS')) {
    if (-not $settings.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($settings[$name]) -or $settings[$name] -eq $sentinel) {
      throw "M01 runtime configuration is incomplete: $name must be configured in deploy/m01/.env."
    }
  }
  return $settings
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

function New-ClientSecret {
  $bytes = New-Object byte[] 48
  # Windows PowerShell 5.1 targets .NET Framework, whose RNG type does not
  # expose the static Fill method available in newer .NET runtimes.
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  return [System.BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
}

function Wait-KeycloakReady([hashtable]$Settings) {
  $discoveryUri = "https://$($Settings['M01_KEYCLOAK_EXTERNAL_HOSTNAME']):$($Settings['M01_KEYCLOAK_HTTPS_PORT'])/realms/master/.well-known/openid-configuration"
  $deadline = (Get-Date).AddSeconds(120)
  do {
    try {
      $discovery = Invoke-RestMethod -UseBasicParsing -Uri $discoveryUri -TimeoutSec 10
      if ($discovery.issuer) { return }
    } catch {
      # The container is started before Keycloak accepts administrative traffic.
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  throw 'Keycloak did not become ready within two minutes; the personnel admin client was not configured.'
}

$settings = Read-M01Settings

$existingSecret = if ($settings.ContainsKey('M01_PERSONNEL_ADMIN_CLIENT_SECRET')) { $settings['M01_PERSONNEL_ADMIN_CLIENT_SECRET'] } else { '' }
$needsSecret = [string]::IsNullOrWhiteSpace($existingSecret) -or $existingSecret -eq $sentinel
$secretAction = if ($needsSecret) { 'generate a new secret and write it to deploy/m01/.env' } else { 'reuse the existing secret in deploy/m01/.env' }

if ($WhatIfPreference) {
  Write-Output "WhatIf: would reconcile Keycloak confidential client '$clientId' (service accounts enabled; minimum realm-management roles: query-users, manage-users, view-realm) and would $secretAction. No secret value is printed."
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Write-Output 'WhatIf: Docker Desktop is not available; no container command was run.' }
  return
}

if (-not $PSCmdlet.ShouldProcess($environmentFile, "provision Keycloak client '$clientId' and reconcile its ignored secret")) {
  return
}

if ($needsSecret) {
  Set-EnvironmentValue $environmentFile 'M01_PERSONNEL_ADMIN_CLIENT_SECRET' (New-ClientSecret)
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker Desktop is required to provision the personnel admin client.' }
& docker version --format '{{.Server.Version}}' 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is not ready.' }

Push-Location -LiteralPath $repositoryRoot
try {
  # Recreate keycloak so the freshly written secret is present in its environment.
  & docker compose --env-file deploy/m01/.env -f deploy/m01/docker-compose.yml up -d keycloak
  if ($LASTEXITCODE -ne 0) { throw 'The M01 identity stack did not start.' }
  Wait-KeycloakReady -Settings $settings
  & docker compose --env-file deploy/m01/.env -f deploy/m01/docker-compose.yml exec -T keycloak sh /opt/aeos/configure-personnel-admin.sh
  if ($LASTEXITCODE -ne 0) { throw 'Keycloak personnel admin client provisioning failed.' }
} finally {
  Pop-Location
}

Write-Output "Personnel admin client '$clientId' is provisioned. Enable the Hub console by setting M01_PERSONNEL_ADMIN_ENABLED=1 in deploy/m01/.env, then restart the Hub."
