# ============================================================
# AEOS Hub - Gitee -> GitHub one-way sync (Gitee is source of truth)
# Usage:
#   powershell -ExecutionPolicy Bypass -File sync-gitee-github.ps1
#   powershell -ExecutionPolicy Bypass -File sync-gitee-github.ps1 -Proxy http://127.0.0.1:7890
# Behavior: fetch Gitee, force-align local branches to Gitee, push to GitHub (overwrite).
# ============================================================
param(
    [string]$Proxy = '',
    [int]$MaxRetries = 3
)

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $RepoRoot

$Branches = @('main', 'master')

if (-not (git remote get-url gitee 2>&1)) {
    Write-Error 'gitee remote missing. Run: git remote add gitee https://gitee.com/ningbohengjianguangdian/aeoshub.git'
}
if (-not (git remote get-url origin 2>&1)) {
    Write-Error 'origin remote missing. Run: git remote add origin https://github.com/futianyu760118-art/AEOS-hub.git'
}

if ($Proxy) {
    git config --global http.https://github.com.proxy $Proxy
    git config --global https.https://github.com.proxy $Proxy
    Write-Host "==> Using proxy: $Proxy"
}

Write-Host '==> Fetching latest from Gitee...'
git fetch gitee --prune 2>&1 | Out-Null

foreach ($b in $Branches) {
    if (-not (git rev-parse --verify "gitee/$b" 2>&1)) {
        Write-Warning "Branch $b does not exist on Gitee, skipping"
        continue
    }
    Write-Host "==> Syncing branch $b"
    git checkout -B $b "gitee/$b" 2>&1 | Out-Null

    $ok = $false
    for ($i = 1; $i -le $MaxRetries; $i++) {
        git push -f origin $b 2>&1
        if ($LASTEXITCODE -eq 0) { $ok = $true; break }
        Write-Warning "Push $b failed (attempt $i/$MaxRetries), retrying in 3s..."
        Start-Sleep -Seconds 3
    }
    if (-not $ok) {
        throw "Failed to push branch $b after $MaxRetries attempts"
    }
}

git checkout main 2>&1 | Out-Null
Write-Host ''
Write-Host 'Sync done: Gitee -> GitHub (main, master)'
