[CmdletBinding()]
param(
  [switch]$IncludeCodexHome,
  [switch]$AdoptRunningDeepSeekKey,
  [switch]$AdoptOnly,
  [string]$SourceContainer = 'AEOS'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if (-not (Test-Path 'data')) {
  throw '未找到本机 data 目录，已停止迁移。'
}
if (-not (Test-Path 'mcp-company-control/.env')) {
  throw '未找到 mcp-company-control/.env，已停止迁移。请先配置中台地址与凭据。'
}
if ($IncludeCodexHome -and -not (Test-Path '.codex-home')) {
  throw '未找到本机 .codex-home，无法迁移模型配置与认证状态。'
}

function Test-DeepSeekKeyConfigured {
  if (-not (Test-Path '.env')) { return $false }
  return $null -ne (Get-Content '.env' | Where-Object { $_ -match '^\s*DEEPSEEK_API_KEY\s*=\s*.+\s*$' } | Select-Object -First 1)
}

function Adopt-RunningDeepSeekKey {
  if (Test-DeepSeekKeyConfigured) { return }
  $key = (& docker exec $SourceContainer sh -c 'printf %s "${DEEPSEEK_API_KEY:-}"')
  if (-not $key) { throw "容器 $SourceContainer 未提供 DEEPSEEK_API_KEY，无法迁移模型凭据。" }
  $lines = [System.Collections.Generic.List[string]]::new()
  if (Test-Path '.env') {
    foreach ($line in Get-Content '.env') { [void]$lines.Add([string]$line) }
  }
  $replacement = "DEEPSEEK_API_KEY=$key"
  $index = -1
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^\s*DEEPSEEK_API_KEY\s*=') { $index = $i; break }
  }
  if ($index -ge 0) { $lines[$index] = $replacement } else { $lines.Add($replacement) }
  $temporary = '.env.docker-migration.tmp'
  [System.IO.File]::WriteAllText((Join-Path $repoRoot $temporary), (($lines -join [Environment]::NewLine) + [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination '.env' -Force
  Write-Host '已从运行中的容器恢复 DeepSeek Key 到根目录 .env（密钥未输出）。'
}

function Invoke-DockerCompose([string[]]$Arguments) {
  & docker compose @Arguments
  if ($LASTEXITCODE -ne 0) { throw "docker compose 执行失败（exit=$LASTEXITCODE）。" }
}

if ($AdoptRunningDeepSeekKey) { Adopt-RunningDeepSeekKey }
if ($AdoptOnly) { return }

function Seed-Volume([string]$Source, [string]$Target, [string]$Name, [string[]]$ComposeFiles) {
  $shell = @'
set -eu
if [ -n "$(find {0} -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  echo "REFUSE: {1} Docker 数据卷已经有内容；为保护现有数据，未覆盖。"
  exit 12
fi
cp -a {2}/. {0}/
chown -R node:node {0}
echo "SEEDED: {1}"
'@ -f $Target, $Name, $Source
  Invoke-DockerCompose ($ComposeFiles + @('run', '--rm', '--no-deps', '--user', 'root', '--cap-add', 'CHOWN', '--entrypoint', '/bin/sh', 'aeos-hub', '-c', $shell))
}

# 先构建镜像，确保迁移容器使用与正式部署一致的运行环境。
Invoke-DockerCompose @('build', 'aeos-hub')

$baseFiles = @('-f', 'docker-compose.yml', '-f', 'docker-compose.migrate.yml')
Seed-Volume -Source '/seed/data' -Target '/app/data' -Name 'AEOS 运行数据（Agent、小队、会话、Evidence）' -ComposeFiles $baseFiles

if ($IncludeCodexHome) {
  $withCodexHome = $baseFiles + @('-f', 'docker-compose.migrate-codex-home.yml')
  Seed-Volume -Source '/seed/codex-home' -Target '/app/.codex-home' -Name 'Codex 模型配置与认证状态' -ComposeFiles $withCodexHome
} else {
  Write-Host '未迁移 .codex-home。请在根目录 .env 配置 DEEPSEEK_API_KEY，或重新执行脚本时加 -IncludeCodexHome。'
}

Write-Host '迁移完成。现在可执行：docker compose up -d'
