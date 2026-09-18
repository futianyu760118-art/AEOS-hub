// hub 配置管理：读写隔离 CODEX_HOME 的 config.toml（模型提供商区段）与 .env（密钥）
// 原则：只重写"模型提供商"区段；MCP 区段（# ---- MCP 服务器 ---- 之后）原样保留。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const hubRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
export const codexHome = join(hubRoot, '.codex-home');
export const configFile = join(codexHome, 'config.toml');
export const envFile = join(codexHome, '.env');
export const presetsFile = join(hubRoot, 'data', 'model-presets.json');
const MCP_MARK = '# ---- MCP 服务器';

/** 默认 MCP 注册块：路径按当前项目位置生成，克隆到任何目录都可直接用 */
export function defaultMcpBlock(): string {
  const mcpPath = join(hubRoot, 'mcp', 'demo-erp.mjs').split(sep).join('/');
  return [
    MCP_MARK + '（中枢 Agent 的工具面，= 各自治系统/业务系统的能力入口）----',
    '[mcp_servers.demo-erp]',
    'command = "node"',
    `args = ["${mcpPath}"]`,
    '',
  ].join('\n');
}

/** 首次运行自动生成隔离 config.toml（含 MCP 注册）；已存在则不覆盖 */
export function ensureConfigFile(): void {
  if (existsSync(configFile)) return;
  mkdirSync(codexHome, { recursive: true });
  const header = [
    '# AEOS hub 隔离的 Codex 配置（CODEX_HOME 指向本目录，不污染全局 ~/.codex）',
    '# 模型区段由 Web 配置页管理；MCP 区段以下原样保留。',
    '',
  ].join('\n');
  writeFileSync(configFile, header + defaultMcpBlock(), 'utf-8');
}

/** 各提供商的默认"可切换模型"清单（存 data/model-presets.json，不写入 config.toml） */
export const DEFAULT_MODEL_PRESETS: Record<string, string[]> = {
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  openai: [],
};

export function loadModelPresets(): Record<string, string[]> {
  try {
    if (!existsSync(presetsFile)) return { ...DEFAULT_MODEL_PRESETS };
    const parsed = JSON.parse(readFileSync(presetsFile, 'utf-8')) as Record<string, string[]>;
    return { ...DEFAULT_MODEL_PRESETS, ...parsed };
  } catch {
    return { ...DEFAULT_MODEL_PRESETS };
  }
}

export function saveModelPresets(presets: Record<string, string[]>): void {
  mkdirSync(dirname(presetsFile), { recursive: true });
  writeFileSync(presetsFile, JSON.stringify({ ...DEFAULT_MODEL_PRESETS, ...presets }, null, 2), 'utf-8');
}

export interface ProviderCfg {
  id: string;
  base_url?: string;
  env_key?: string;
  wire_api?: string; // chat | responses
}

export interface ModelConfig {
  model: string;
  modelProvider: string; // 空 = openai 默认
  providers: ProviderCfg[];
  mcpServers: string[];
}

function unquote(v: string): string {
  return v.trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '');
}

/** 解析当前 config.toml 中我们管理的区段（容错：解析失败时返回空结构） */
export function readConfig(): ModelConfig {
  const cfg: ModelConfig = { model: '', modelProvider: '', providers: [], mcpServers: [] };
  if (!existsSync(configFile)) return cfg;
  const lines = readFileSync(configFile, 'utf-8').split('\n');
  let section: string | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const secMatch = line.match(/^\[([^\]]+)\]/);
    if (secMatch) {
      const path = secMatch[1];
      if (path.startsWith('model_providers.')) {
        section = 'model_providers';
        cfg.providers.push({ id: path.slice('model_providers.'.length), wire_api: 'responses' });
      } else if (path.startsWith('mcp_servers.')) {
        section = 'mcp';
        cfg.mcpServers.push(path.slice('mcp_servers.'.length));
      } else {
        section = null;
      }
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w.-]*)\s*=\s*(.+)$/);
    if (!kv) continue;
    const [key, val] = [kv[1], unquote(kv[2])];
    if (!section && key === 'model') cfg.model = val;
    else if (!section && key === 'model_provider') cfg.modelProvider = val;
    else if (section === 'model_providers' && cfg.providers.length) {
      const p = cfg.providers[cfg.providers.length - 1];
      if (key === 'base_url') p.base_url = val;
      else if (key === 'env_key') p.env_key = val;
      else if (key === 'wire_api') p.wire_api = val;
    }
  }
  return cfg;
}

/** 重写模型区段（从文件头到 MCP 标记之前），MCP 及以后原样保留 */
export function saveModelConfig(cfg: { model: string; modelProvider: string; providers: ProviderCfg[] }): void {
  const existing = existsSync(configFile) ? readFileSync(configFile, 'utf-8') : '';
  const mcpTailIdx = existing.indexOf(MCP_MARK);
  const tail = mcpTailIdx >= 0 ? existing.slice(mcpTailIdx) : defaultMcpBlock();

  const parts: string[] = [];
  parts.push('# AEOS hub 隔离的 Codex 配置（CODEX_HOME 指向本目录，不污染全局 ~/.codex）');
  parts.push('# 模型区段由 Web 配置页管理；MCP 区段以下原样保留。');
  parts.push('');
  if (cfg.model.trim()) parts.push(`model = "${cfg.model.trim()}"`);
  if (cfg.modelProvider.trim()) parts.push(`model_provider = "${cfg.modelProvider.trim()}"`);
  if (parts.length > 2) parts.push('');
  for (const p of cfg.providers) {
    if (!p.id.trim()) continue;
    parts.push(`[model_providers.${p.id.trim()}]`);
    parts.push(`name = "${p.id.trim()}"`);
    if (p.base_url?.trim()) parts.push(`base_url = "${p.base_url.trim()}"`);
    if (p.env_key?.trim()) parts.push(`env_key = "${p.env_key.trim()}"`);
    parts.push(`wire_api = "responses"`);
    parts.push('');
  }
  writeFileSync(configFile, parts.join('\n') + '\n' + tail, 'utf-8');
}

/** .env 中已配置的密钥名列表 */
export function listEnvKeys(): string[] {
  if (!existsSync(envFile)) return [];
  return readFileSync(envFile, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('=')[0].trim())
    .filter(Boolean);
}

/** 写入/更新密钥；value 为空或 null 时删除该键 */
export function setEnvKey(name: string, value: string | null): void {
  const key = name.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`非法环境变量名: ${name}`);
  const rest = existsSync(envFile) ? readFileSync(envFile, 'utf-8') : '';
  const kept = rest.split('\n').filter((l) => {
    const t = l.trim();
    return !(t && !t.startsWith('#') && t.split('=')[0].trim() === key);
  });
  if (value && value.trim()) {
    const safe = value.replace(/[\r\n]/g, '');
    kept.push(`${key}=${safe}`);
  }
  writeFileSync(envFile, kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n', 'utf-8');
}
