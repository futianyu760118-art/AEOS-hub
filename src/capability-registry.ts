type JsonRecord = Record<string, unknown>;

export interface RegistrySystem {
  id: string;
  name: string;
  description: string;
  kind: 'core' | 'mcp';
  status: string;
  statusTone: 'ok' | 'info' | 'warn' | 'danger' | 'neutral';
  version?: string;
}

export interface RegistryCapability {
  id: string;
  server: string;
  name: string;
  title: string;
  description: string;
  inputs: string[];
  readOnly: boolean;
  status: string;
  statusTone: RegistrySystem['statusTone'];
}

export interface CapabilityRegistrySnapshot {
  generatedAt: string;
  systems: RegistrySystem[];
  capabilities: RegistryCapability[];
  warning?: string;
}

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function statusPresentation(status: string): Pick<RegistrySystem, 'status' | 'statusTone'> {
  switch (status) {
    case 'connected': return { status: '已连接', statusTone: 'ok' };
    case 'starting': return { status: '启动中', statusTone: 'info' };
    case 'authenticationRequired': return { status: '待认证', statusTone: 'warn' };
    case 'failed': return { status: '失败', statusTone: 'danger' };
    case 'cancelled': return { status: '已取消', statusTone: 'warn' };
    case 'disabled': return { status: '已禁用', statusTone: 'neutral' };
    default: return { status: '已注册', statusTone: 'info' };
  }
}

function toolInputs(tool: JsonRecord): string[] {
  const properties = record(record(tool.inputSchema).properties);
  return Object.keys(properties);
}

function toolReadOnly(tool: JsonRecord): boolean {
  return record(tool.annotations).readOnlyHint === true;
}

export function buildCapabilityRegistry(
  registeredServers: string[],
  runtimeResponse: unknown,
  warning?: string,
): CapabilityRegistrySnapshot {
  const response = record(runtimeResponse);
  const runtimeServers = Array.isArray(response.data) ? response.data.map(record) : [];
  const runtimeByName = new Map(runtimeServers
    .filter((item) => typeof item.name === 'string')
    .map((item) => [String(item.name), item]));
  // Codex may attach optional plugin MCPs (for example codex_apps) at runtime.
  // Registry only exposes servers explicitly registered in this Hub config.
  const serverNames = [...new Set(registeredServers)].sort((a, b) => a.localeCompare(b));

  const systems: RegistrySystem[] = [
    { id: 'aeos-hub', name: 'AEOS Hub', description: '中枢编排服务', kind: 'core', status: '在线', statusTone: 'ok' },
    { id: 'codex-runtime', name: 'Codex App Server', description: 'Agent Runtime', kind: 'core', status: '隔离运行', statusTone: 'ok' },
    { id: 'evidence-store', name: 'Evidence Store', description: 'JSONL 试点存储', kind: 'core', status: '试点', statusTone: 'info' },
  ];
  const capabilities: RegistryCapability[] = [];

  for (const name of serverNames) {
    const runtime = runtimeByName.get(name) ?? {};
    const serverInfo = record(runtime.serverInfo);
    const presentation = statusPresentation(typeof runtime.runtimeStatus === 'string' ? runtime.runtimeStatus : 'notStarted');
    systems.push({
      id: `mcp:${name}`,
      name,
      description: typeof serverInfo.description === 'string' && serverInfo.description
        ? serverInfo.description
        : 'MCP 业务能力源',
      kind: 'mcp',
      version: typeof serverInfo.version === 'string' ? serverInfo.version : undefined,
      ...presentation,
    });
    const tools = record(runtime.tools);
    for (const [toolKey, rawTool] of Object.entries(tools)) {
      const tool = record(rawTool);
      const toolName = typeof tool.name === 'string' ? tool.name : toolKey;
      capabilities.push({
        id: `${name}/${toolName}`,
        server: name,
        name: toolName,
        title: typeof tool.title === 'string' && tool.title ? tool.title : toolName,
        description: typeof tool.description === 'string' ? tool.description : '',
        inputs: toolInputs(tool),
        readOnly: toolReadOnly(tool),
        ...presentation,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    systems,
    capabilities: capabilities.sort((left, right) => left.id.localeCompare(right.id)),
    ...(warning ? { warning } : {}),
  };
}
