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
# MCP 子进程（Python）按 UTF-8 输出 stderr，否则 Codex 无法解码，错误会丢失。
$env:PYTHONIOENCODING = 'utf-8'
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

# 执行面身份：M01 默认只接受每系统令牌；如需临时兼容旧根令牌，在 deploy/m01/.env 显式设为 1。
$legacyRootEnabled = if ($settings.ContainsKey('EXECUTION_LEGACY_ROOT_ENABLED')) { $settings['EXECUTION_LEGACY_ROOT_ENABLED'].Trim() } else { '0' }
if ($legacyRootEnabled -ne '0' -and $legacyRootEnabled -ne '1') {
  throw 'EXECUTION_LEGACY_ROOT_ENABLED must be 0 or 1 in deploy/m01/.env.'
}
$env:EXECUTION_LEGACY_ROOT_ENABLED = $legacyRootEnabled

# 可选：企业微信群机器人告警 webhook。未配置时告警只写页面与日志。
if ($settings.ContainsKey('WECOM_ALERT_WEBHOOK') -and -not [string]::IsNullOrWhiteSpace($settings['WECOM_ALERT_WEBHOOK'])) {
  $env:WECOM_ALERT_WEBHOOK = $settings['WECOM_ALERT_WEBHOOK']
}

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

# 模型密钥：从仓库根 .env 读取 DEEPSEEK_API_KEY 注入进程，供 Codex 运行时与执行面 LLM 意图解析使用。
# 缺失时保持未设置（Codex 可回退 auth.json，执行面意图解析回退本地正则），不阻断启动。
$deepSeekKey = ''
$rootEnvFile = Join-Path $repositoryRoot '.env'
if (Test-Path -LiteralPath $rootEnvFile -PathType Leaf) {
  foreach ($line in [System.IO.File]::ReadAllLines($rootEnvFile)) {
    if ($line -match '^\s*(?:#|$)') { continue }
    $separator = $line.IndexOf('=')
    if ($separator -lt 1) { continue }
    $name = $line.Substring(0, $separator).Trim()
    if ($name -eq 'DEEPSEEK_API_KEY') {
      $deepSeekKey = $line.Substring($separator + 1).Trim()
      break
    }
  }
}
if ($deepSeekKey) { $env:DEEPSEEK_API_KEY = $deepSeekKey }

Set-Location -LiteralPath $repositoryRoot
& npm.cmd run web
exit $LASTEXITCODE
