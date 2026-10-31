import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const hubRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
export const mcpRegistryFile = join(hubRoot, 'mcp', 'registry.json');

const toolSchema = z.object({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/, '工具名不合法'),
  readOnly: z.literal(true),
}).strict();

const serverSchema = z.object({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'MCP 服务名不合法'),
  command: z.string().min(1),
  commandByPlatform: z.record(z.string(), z.string().min(1)).optional(),
  args: z.array(z.string()),
  cwd: z.string().optional(),
  metadataFile: z.string().min(1),
  enabled: z.boolean().default(true),
  required: z.boolean().default(false),
  startupTimeoutSec: z.number().int().min(1).max(120).default(20),
  toolTimeoutSec: z.number().int().min(1).max(300).default(60),
  tools: z.array(toolSchema).min(1),
}).strict().superRefine((value, context) => {
  const names = value.tools.map((tool) => tool.name);
  if (new Set(names).size !== names.length) context.addIssue({ code: 'custom', message: '同一 MCP 不能重复声明工具' });
});

const registrySchema = z.object({
  version: z.literal(1),
  servers: z.array(serverSchema).min(1),
}).strict().superRefine((value, context) => {
  const ids = value.servers.map((server) => server.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'MCP 服务 id 不能重复' });
});

export type McpRegistration = z.infer<typeof serverSchema>;
export type McpRegistry = z.infer<typeof registrySchema>;

function expandProjectRoot(value: string): string {
  return value.replaceAll('${PROJECT_ROOT}', hubRoot.split(sep).join('/'));
}

function validateServerMetadata(registry: McpRegistry): void {
  for (const server of registry.servers) {
    const metadataFile = expandProjectRoot(server.metadataFile);
    if (!existsSync(metadataFile)) throw new Error(`MCP ${server.id} 元数据文件不存在: ${metadataFile}`);
    let metadata: { name?: unknown; tools?: unknown };
    try {
      metadata = JSON.parse(readFileSync(metadataFile, 'utf8')) as { name?: unknown; tools?: unknown };
    } catch (error) {
      throw new Error(`MCP ${server.id} 元数据文件不是有效 JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (metadata.name !== server.id) throw new Error(`MCP ${server.id} 的元数据 name 不匹配`);
    const metadataTools = Array.isArray(metadata.tools) ? metadata.tools : [];
    const declared = new Map(metadataTools.map((item) => {
      const tool = item !== null && typeof item === 'object' ? item as Record<string, unknown> : {};
      return [tool.name, tool];
    }));
    const configuredNames = server.tools.map((tool) => tool.name);
    if (declared.size !== configuredNames.length || configuredNames.some((name) => !declared.has(name))) {
      throw new Error(`MCP ${server.id} 的 registry 工具白名单与元数据 tools 不一致`);
    }
    for (const name of configuredNames) {
      const tool = declared.get(name)!;
      if (tool.permission_level !== 'READ_ONLY') throw new Error(`MCP ${server.id}/${name} 元数据未声明 READ_ONLY`);
    }
  }
}

/**
 * company-control is a single business-system adapter.  Version numbers live
 * in its manifest; parallel `mcp-company-control-v*` directories are not
 * supported because they make the active credentials and tool contract
 * ambiguous.
 */
function validateCanonicalCompanyControl(registry: McpRegistry): void {
  const server = registry.servers.find((item) => item.id === 'company-control');
  if (!server) return;
  const canonicalDirectory = join(hubRoot, 'mcp-company-control').split(sep).join('/');
  const configuredDirectory = expandProjectRoot(server.cwd ?? '').replace(/\\/g, '/').replace(/\/$/, '');
  if (configuredDirectory !== canonicalDirectory) {
    throw new Error(`company-control 必须使用唯一规范目录: ${canonicalDirectory}`);
  }
  const duplicates = readdirSync(hubRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^mcp-company-control-v/i.test(entry.name))
    .map((entry) => entry.name);
  if (duplicates.length) {
    throw new Error(`检测到重复 company-control 包目录: ${duplicates.join(', ')}；请合并至 mcp-company-control 后删除重复目录`);
  }
}

function tomlString(value: string): string {
  return JSON.stringify(expandProjectRoot(value));
}

function commandForPlatform(server: McpRegistration, platform: string): string {
  return server.commandByPlatform?.[platform] ?? server.command;
}

/**
 * The checked-in registry is the sole source of truth for MCP registration
 * and the direct-call allowlist.  Runtime TOML is rendered from it, never
 * hand-maintained as a second list.
 */
export function loadMcpRegistry(file = mcpRegistryFile): McpRegistry {
  if (!existsSync(file)) throw new Error(`MCP 注册清单不存在: ${file}`);
  try {
    const registry = registrySchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    validateCanonicalCompanyControl(registry);
    validateServerMetadata(registry);
    return registry;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`MCP 注册清单无效: ${message}`);
  }
}

export function findMcpRegistration(server: string, registry = loadMcpRegistry()): McpRegistration | undefined {
  return registry.servers.find((item) => item.id === server && item.enabled);
}

export function listConfiguredMcpServers(registry = loadMcpRegistry()): string[] {
  return registry.servers.filter((server) => server.enabled).map((server) => server.id);
}

/** Render the Codex MCP section from the checked-in registry. */
export function renderMcpConfigBlock(registry = loadMcpRegistry(), platform = process.platform): string {
  const lines = [
    '# ---- MCP 服务器（由 mcp/registry.json 生成，请勿手工编辑）----',
    '# 新增或变更 MCP 时只修改 mcp/registry.json；启动时会同步此区段。',
    '',
  ];
  for (const server of registry.servers.filter((item) => item.enabled)) {
    lines.push(`[mcp_servers.${server.id}]`);
    lines.push(`command = ${tomlString(commandForPlatform(server, platform))}`);
    lines.push(`args = [${server.args.map(tomlString).join(', ')}]`);
    if (server.cwd) lines.push(`cwd = ${tomlString(server.cwd)}`);
    lines.push(`enabled = true`);
    lines.push(`required = ${server.required}`);
    lines.push(`startup_timeout_sec = ${server.startupTimeoutSec}`);
    lines.push(`tool_timeout_sec = ${server.toolTimeoutSec}`);
    // Every registered direct-call tool must be explicitly read-only.
    lines.push('default_tools_approval_mode = "writes"');
    lines.push(`enabled_tools = [${server.tools.map((tool) => tomlString(tool.name)).join(', ')}]`);
    lines.push('');
  }
  return lines.join('\n');
}
