[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Low')]
param(
  [switch]$NoBrowser
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$dryRun = [bool]$WhatIfPreference
$WhatIfPreference = $false

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$environmentFile = Join-Path $repositoryRoot 'deploy\m01\.env'
$composeFile = Join-Path $repositoryRoot 'deploy\m01\docker-compose.yml'
$hubRunner = Join-Path $PSScriptRoot 'run-m01-hub.ps1'

function Get-M01Settings {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw 'M01 runtime configuration is missing. Create deploy/m01/.env from the template before starting.'
  }
  $settings = @{}
  foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
    if ($line -match '^\s*(?:#|$)') { continue }
    $separator = $line.IndexOf('=')
    if ($separator -lt 1) { continue }
    $settings[$line.Substring(0, $separator).Trim()] = $line.Substring($separator + 1)
  }
  foreach ($name in @('M01_CLIENT_SECRET', 'M01_KEYCLOAK_HTTPS_PORT', 'M01_KEYCLOAK_EXTERNAL_HOSTNAME')) {
    if (-not $settings.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($settings[$name]) -or $settings[$name] -eq '__REPLACE_BEFORE_START__') {
      throw "M01 runtime configuration is incomplete: $name must be configured in deploy/m01/.env."
    }
  }
  if ($settings['M01_KEYCLOAK_HTTPS_PORT'] -notmatch '^\d{2,5}$') {
    throw 'M01_KEYCLOAK_HTTPS_PORT must be a valid port number in deploy/m01/.env.'
  }
  return $settings
}

function Get-ListenerProcess {
  $connections = @(Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  if ($connections.Count -gt 1) { throw 'More than one process is listening on port 8790; refusing to make a change.' }
  if ($connections.Count -eq 0) { return $null }
  return Get-CimInstance Win32_Process -Filter "ProcessId = $($connections[0])"
}

function Test-M01HubProcess {
  param($Process)
  if ($null -eq $Process) { return $false }
  $lineage = @()
  $current = $Process
  for ($depth = 0; $depth -lt 5 -and $null -ne $current; $depth++) {
    $lineage += [string]$current.CommandLine
    if ($current.ParentProcessId -le 0) { break }
    $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($current.ParentProcessId)" -ErrorAction SilentlyContinue
  }
  $description = $lineage -join "`n"
  if ($description -notmatch '(?i)node(?:\.exe)?\s+src[\\/]server\.ts') { return $false }
  if ($description -match '(?i)run-m01-hub\.ps1' -and $description.Contains($repositoryRoot)) { return $true }
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8790/' -TimeoutSec 5
    return $response.StatusCode -eq 200 -and $response.Content -match 'AEOS'
  } catch {
    return $false
  }
}

$settings = Get-M01Settings -Path $environmentFile
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker Desktop is not available. Start Docker Desktop and try again.'
}
& docker version --format '{{.Server.Version}}' 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is not ready. Start it and wait until it is running.' }

if ($dryRun) {
  Write-Output 'WhatIf: M01 runtime configuration and Docker were validated; no services or Hub process were started.'
  return
}

$listener = Get-ListenerProcess
if ($listener) {
  if (Test-M01HubProcess -Process $listener) {
    Write-Output 'M01 Hub is already running on http://127.0.0.1:8790.'
    return
  }
  throw 'Port 8790 is occupied by an unknown process. Nothing was changed.'
}

Push-Location -LiteralPath $repositoryRoot
try {
  & docker compose --env-file deploy/m01/.env -f deploy/m01/docker-compose.yml up -d
  if ($LASTEXITCODE -ne 0) { throw 'The M01 identity stack did not start. Review Docker Desktop status and retry.' }
} finally {
  Pop-Location
}

$discoveryUri = "https://$($settings['M01_KEYCLOAK_EXTERNAL_HOSTNAME']):$($settings['M01_KEYCLOAK_HTTPS_PORT'])/realms/aeos/.well-known/openid-configuration"
$deadline = (Get-Date).AddSeconds(120)
$ready = $false
do {
  try {
    $discovery = Invoke-RestMethod -Uri $discoveryUri -UseBasicParsing -TimeoutSec 10
    if ($discovery.issuer) { $ready = $true; break }
  } catch {
    Start-Sleep -Seconds 2
  }
} while ((Get-Date) -lt $deadline)
if (-not $ready) { throw 'M01 identity service was not ready within two minutes. No Hub process was started.' }

$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$hubRunner`""
Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WorkingDirectory $repositoryRoot -WindowStyle Hidden
Write-Output 'M01 Hub is starting. Open http://127.0.0.1:8790 after a few seconds.'
