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

foreach ($name in @('M01_CLIENT_SECRET', 'M01_KEYCLOAK_HTTPS_PORT', 'M01_KEYCLOAK_EXTERNAL_HOSTNAME')) {
  if (-not $settings.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($settings[$name]) -or $settings[$name] -eq '__REPLACE_BEFORE_START__') {
    throw "M01 runtime configuration is incomplete: $name must be configured in deploy/m01/.env."
  }
}

if ($settings['M01_KEYCLOAK_HTTPS_PORT'] -notmatch '^\d{2,5}$') {
  throw 'M01_KEYCLOAK_HTTPS_PORT must be a valid port number in deploy/m01/.env.'
}

# Keep all secret handling inside this child process. Do not log this hashtable or its values.
$env:NODE_EXTRA_CA_CERTS = $certificateFile
$env:NODE_ENV = 'development'
$env:AEOS_AUTH_MODE = 'm01'
$env:AEOS_COOKIE_SECURE = '0'
$env:HOST = '127.0.0.1'
$env:PORT = '8790'
$env:M01_ISSUER = "https://$($settings['M01_KEYCLOAK_EXTERNAL_HOSTNAME']):$($settings['M01_KEYCLOAK_HTTPS_PORT'])/realms/aeos"
$env:M01_CLIENT_ID = 'aeos-hub-web'
$env:M01_CLIENT_SECRET = $settings['M01_CLIENT_SECRET']
$env:M01_REDIRECT_URI = 'http://127.0.0.1:8790/api/auth/callback'
$env:M01_AUDIENCE = 'aeos-hub-web'
$env:AEOS_M01_ALLOWED_ROLES = 'manager,analyst'

Set-Location -LiteralPath $repositoryRoot
& npm.cmd run web
exit $LASTEXITCODE
