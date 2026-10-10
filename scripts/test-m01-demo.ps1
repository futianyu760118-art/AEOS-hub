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
$identityListener = @(Get-NetTCPConnection -LocalPort 9443 -State Listen -ErrorAction SilentlyContinue)
if ($hubListener.Count) { Write-Output 'Hub port 8790: listening.' } else { Write-Output 'Hub port 8790: not listening.' }
if ($identityListener.Count) { Write-Output 'Identity port 9443: listening.' } else { Write-Output 'Identity port 9443: not listening.' }
Write-Output 'Runtime configuration and local CA certificate: present (values redacted).'
if ($dryRun) {
  Write-Output 'WhatIf: status-only check completed; no services were changed.'
}
