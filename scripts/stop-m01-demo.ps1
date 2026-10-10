[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Low')]
param(
  [switch]$KeepIdentityStack
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$dryRun = [bool]$WhatIfPreference
$WhatIfPreference = $false

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$environmentFile = Join-Path $repositoryRoot 'deploy\m01\.env'

function Get-M01HubProcess {
  $owners = @(Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  if ($owners.Count -gt 1) { throw 'More than one process is listening on port 8790; refusing to stop any process.' }
  if ($owners.Count -eq 0) { return $null }
  return Get-CimInstance Win32_Process -Filter "ProcessId = $($owners[0])"
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

if ($dryRun) {
  Write-Output 'WhatIf: would stop only a positively identified M01 Hub and would preserve Docker volumes.'
  return
}

$hub = Get-M01HubProcess
if ($hub) {
  if (-not (Test-M01HubProcess -Process $hub)) {
    throw 'Port 8790 is occupied by an unknown process. Refusing to stop it.'
  }
  Stop-Process -Id $hub.ProcessId
  Write-Output 'M01 Hub stopped.'
} else {
  Write-Output 'M01 Hub is not listening on port 8790.'
}

if ($KeepIdentityStack) {
  Write-Output 'M01 identity stack was kept running.'
  return
}
if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) {
  throw 'M01 runtime configuration is missing; refusing to run Docker Compose.'
}

Push-Location -LiteralPath $repositoryRoot
try {
  & docker compose --env-file deploy/m01/.env -f deploy/m01/docker-compose.yml stop
  if ($LASTEXITCODE -ne 0) { throw 'The M01 identity stack could not be stopped cleanly.' }
  Write-Output 'M01 identity stack stopped; Docker volumes and local CA were preserved.'
} finally {
  Pop-Location
}
