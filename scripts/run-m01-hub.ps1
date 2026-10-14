[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$environmentFile = Join-Path $repositoryRoot 'deploy\m01\.env'
$certificateFile = Join-Path $repositoryRoot 'deploy\m01\caddy-root.crt'

if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) {
  throw 'M01 runtime configuration is missing. Create deploy/m01/.env from the template before starting.'
}
if (-not (Test-Path -LiteralPath $certificateFile -PathType Leaf)) {
  throw 'The local M01 CA certificate is missing. Restore deploy/m01/caddy-root.crt before starting.'
}

$settings = @{}
foreach ($line in [System.IO.File]::ReadAllLines($environmentFile)) {
  if ($line -match '^\s*(?:#|$)') { continue }
  $separator = $line.IndexOf('=')
  if ($separator -lt 1) { continue }
  $name = $line.Substring(0, $separator).Trim()
  $value = $line.Substring($separator + 1)
  $settings[$name] = $value
}

foreach ($name in @('M01_CLIENT_SECRET', 'M01_KEYCLOAK_HTTPS_PORT', 'M01_KEYCLOAK_EXTERNAL_HOSTNAME', 'M01_HUB_HTTPS_PORT', 'M01_HUB_EXTERNAL_HOSTNAME', 'M01_LISTEN_ADDRESS', 'EXECUTION_PLANE_TOKEN')) {
  if (-not $settings.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($settings[$name]) -or $settings[$name] -eq '__REPLACE_BEFORE_START__') {
    throw "M01 runtime configuration is incomplete: $name must be configured in deploy/m01/.env."
  }
}

foreach ($name in @('M01_KEYCLOAK_HTTPS_PORT', 'M01_HUB_HTTPS_PORT')) {
  if ($settings[$name] -notmatch '^\d{2,5}$') {
    throw "$name must be a valid port number in deploy/m01/.env."
  }
}

# Keep all secret handling inside this child process. Do not log this hashtable or its values.
$env:NODE_EXTRA_CA_CERTS = $certificateFile
$env:NODE_ENV = 'production'
$env:AEOS_ENV = 'production'
$env:AEOS_AUTH_MODE = 'm01'
$env:AEOS_COOKIE_SECURE = '1'
$env:HOST = '0.0.0.0'
$env:PORT = '8790'
$env:M01_ISSUER = "https://$($settings['M01_KEYCLOAK_EXTERNAL_HOSTNAME']):$($settings['M01_KEYCLOAK_HTTPS_PORT'])/realms/aeos"
$env:M01_CLIENT_ID = 'aeos-hub-web'
$env:M01_CLIENT_SECRET = $settings['M01_CLIENT_SECRET']
$env:M01_REDIRECT_URI = "https://$($settings['M01_HUB_EXTERNAL_HOSTNAME']):$($settings['M01_HUB_HTTPS_PORT'])/api/auth/callback"
$env:M01_AUDIENCE = 'aeos-hub-web'
$env:AEOS_M01_ALLOWED_ROLES = 'manager,supervisor,operator,owner,analyst'
$env:EXECUTION_PLANE_TOKEN = $settings['EXECUTION_PLANE_TOKEN']

# Personnel administration is fail-closed: it is enabled only when the feature
# flag is on and a non-sentinel service-client secret is present in the ignored
# runtime .env. The secret is never written to the process command line or logs.
$personnelEnabled = $settings.ContainsKey('M01_PERSONNEL_ADMIN_ENABLED') -and ($settings['M01_PERSONNEL_ADMIN_ENABLED'] -eq '1' -or $settings['M01_PERSONNEL_ADMIN_ENABLED'] -eq 'true')
$personnelSecret = if ($settings.ContainsKey('M01_PERSONNEL_ADMIN_CLIENT_SECRET')) { $settings['M01_PERSONNEL_ADMIN_CLIENT_SECRET'] } else { '' }
if ($personnelEnabled -and -not [string]::IsNullOrWhiteSpace($personnelSecret) -and $personnelSecret -ne '__REPLACE_BEFORE_START__') {
  $env:M01_PERSONNEL_ADMIN_ENABLED = '1'
  $env:M01_PERSONNEL_ADMIN_CLIENT_ID = 'aeos-hub-personnel-admin'
  $env:M01_PERSONNEL_ADMIN_CLIENT_SECRET = $personnelSecret
} else {
  $env:M01_PERSONNEL_ADMIN_ENABLED = '0'
}

Set-Location -LiteralPath $repositoryRoot
& npm.cmd run web
exit $LASTEXITCODE
