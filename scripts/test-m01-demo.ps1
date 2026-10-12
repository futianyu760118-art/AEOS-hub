[CmdletBinding(SupportsShouldProcess = $true)]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$dryRun = [bool]$WhatIfPreference
$WhatIfPreference = $false

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$environmentFile = Join-Path $repositoryRoot 'deploy\m01\.env'
$certificateFile = Join-Path $repositoryRoot 'deploy\m01\caddy-root.crt'

if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) {
  throw 'M01 runtime configuration is missing: deploy/m01/.env.'
}
if (-not (Test-Path -LiteralPath $certificateFile -PathType Leaf)) {
  throw 'The local M01 CA certificate is missing: deploy/m01/caddy-root.crt.'
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker Desktop is not available.'
}
& docker version --format '{{.Server.Version}}' 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is not ready.' }

$hubListener = @(Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue)
$settings = @{}
foreach ($line in [System.IO.File]::ReadAllLines($environmentFile)) {
  if ($line -match '^\s*(?:#|$)') { continue }
  $separator = $line.IndexOf('=')
  if ($separator -lt 1) { continue }
  $settings[$line.Substring(0, $separator).Trim()] = $line.Substring($separator + 1)
}
$identityPort = $settings['M01_KEYCLOAK_HTTPS_PORT']
$hubHttpsPort = $settings['M01_HUB_HTTPS_PORT']
$identityListener = @(Get-NetTCPConnection -LocalPort $identityPort -State Listen -ErrorAction SilentlyContinue)
$hubHttpsListener = @(Get-NetTCPConnection -LocalPort $hubHttpsPort -State Listen -ErrorAction SilentlyContinue)
if ($hubListener.Count) { Write-Output 'Hub port 8790: listening.' } else { Write-Output 'Hub port 8790: not listening.' }
if ($identityListener.Count) { Write-Output "Identity HTTPS port ${identityPort}: listening." } else { Write-Output "Identity HTTPS port ${identityPort}: not listening." }
if ($hubHttpsListener.Count) { Write-Output "Hub HTTPS port ${hubHttpsPort}: listening." } else { Write-Output "Hub HTTPS port ${hubHttpsPort}: not listening." }
Write-Output 'Runtime configuration and local CA certificate: present (values redacted).'
if ($dryRun) {
  Write-Output 'WhatIf: status-only check completed; no services were changed.'
}
