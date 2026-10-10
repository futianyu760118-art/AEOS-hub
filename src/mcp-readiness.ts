type JsonRecord = Record<string, unknown>;

export class McpReadinessError extends Error {
  readonly server: string;
  readonly tools: readonly string[];

  constructor(server: string, tools: readonly string[]) {
    super(`MCP ${server} 的只读工具尚未就绪，请稍后刷新`);
    this.name = 'McpReadinessError';
    this.server = server;
    this.tools = tools;
  }
}

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

export function hasReadOnlyTools(inventory: unknown, server: string, tools: readonly string[]): boolean {
  const response = record(inventory);
  const servers = Array.isArray(response.data) ? response.data.map(record) : [];
  const runtimeServer = servers.find((item) => item.name === server);
  const runtimeTools = record(runtimeServer?.tools);
  return tools.every((name) => {
    const listed = Object.values(runtimeTools).map(record).find((item) => item.name === name);
    const runtimeTool = listed ?? record(runtimeTools[name]);
    return record(runtimeTool.annotations).readOnlyHint === true;
  });
}

export interface McpReadinessOptions {
  readInventory: () => Promise<unknown>;
  server: string;
  tools: readonly string[];
  attempts?: number;
  delayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
}

const sleep = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs));

/**
 * MCP tool metadata arrives asynchronously after a runtime session is created.
 * The caller may only use the returned inventory for read-only direct calls.
 */
export async function waitForReadOnlyMcpTools(options: McpReadinessOptions): Promise<unknown> {
  const attempts = options.attempts ?? 20;
  const delayMs = options.delayMs ?? 500;
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error('attempts must be a positive integer');
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error('delayMs must be a non-negative finite number');

  let lastInventory: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      lastInventory = await options.readInventory();
      if (hasReadOnlyTools(lastInventory, options.server, options.tools)) return lastInventory;
    } catch {
      // A runtime can briefly reject inventory requests while launching MCP stdio.
      // The final error intentionally stays generic and never exposes environment data.
    }
    if (attempt < attempts) await (options.sleep ?? sleep)(delayMs);
  }
  throw new McpReadinessError(options.server, options.tools);
}
