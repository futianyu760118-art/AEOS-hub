[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
  [switch]$Rotate,
  [switch]$Reveal
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$environmentFile = Join-Path $repositoryRoot 'deploy\m01\.env'
$sentinel = '__REPLACE_BEFORE_START__'

function Read-EnvironmentValue([string]$Path, [string]$Name) {
  foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
    if ($line -match "^\s*$([regex]::Escape($Name))=(.*)$") { return $Matches[1] }
  }
  return ''
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

function New-ExecutionPlaneToken {
  $bytes = New-Object byte[] 48
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return [System.BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
}

if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) {
  throw 'M01 runtime configuration is missing. Create deploy/m01/.env from the template before issuing a token.'
}

$existing = Read-EnvironmentValue $environmentFile 'EXECUTION_PLANE_TOKEN'
$needsToken = [string]::IsNullOrWhiteSpace($existing) -or $existing -eq $sentinel
if (-not $needsToken -and -not $Rotate) {
  if ($Reveal) { Write-Output "EXECUTION_PLANE_TOKEN=$existing" }
  else { Write-Output 'An execution-plane token is already provisioned. Use -Rotate to replace it; no token value was printed.' }
  return
}

if ($WhatIfPreference) {
  Write-Output 'WhatIf: would generate a 384-bit execution-plane token and write it only to ignored deploy/m01/.env. No token value is printed.'
  return
}

if (-not $PSCmdlet.ShouldProcess($environmentFile, 'issue execution-plane token')) { return }

$token = New-ExecutionPlaneToken
Set-EnvironmentValue $environmentFile 'EXECUTION_PLANE_TOKEN' $token
if ($Reveal) { Write-Output "EXECUTION_PLANE_TOKEN=$token" }
else { Write-Output 'A new execution-plane token was written to ignored deploy/m01/.env. Restart the Hub before use; no token value was printed.' }
