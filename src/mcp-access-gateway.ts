import { appendEvidence, type EvidenceEntry } from './evidence.ts';
import { findMcpRegistration, type McpRegistry } from './mcp-registry.ts';

type JsonRecord = Record<string, unknown>;

export interface McpToolRuntime {
  callMcpTool(sessionId: string, server: string, tool: string, args?: Record<string, unknown>): Promise<unknown>;
}

export interface ReadonlyMcpCall {
  sessionId: string;
  server: string;
  tool: string;
  args?: Record<string, unknown>;
  purpose: string;
  runtimeInventory: unknown;
}

export class McpAccessGatewayError extends Error {
  readonly code: 'MCP_NOT_REGISTERED' | 'MCP_TOOL_NOT_ALLOWED' | 'MCP_NOT_READ_ONLY' | 'MCP_CIRCUIT_OPEN';

  constructor(code: 'MCP_NOT_REGISTERED' | 'MCP_TOOL_NOT_ALLOWED' | 'MCP_NOT_READ_ONLY' | 'MCP_CIRCUIT_OPEN', message: string) {
    super(message);
    this.code = code;
  }
}

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function runtimeToolIsReadOnly(runtimeInventory: unknown, server: string, tool: string): boolean {
  const response = record(runtimeInventory);
  const servers = Array.isArray(response.data) ? response.data.map(record) : [];
  const runtimeServer = servers.find((item) => item.name === server);
  const tools = record(runtimeServer?.tools);
  const runtimeTool = Object.values(tools).map(record).find((item) => item.name === tool) ?? record(tools[tool]);
  return record(runtimeTool.annotations).readOnlyHint === true;
}

interface FailureState { failures: number; blockedUntil: number }

/**
 * Single policy boundary for Hub-initiated MCP calls.  It deliberately fails
 * closed when the live MCP inventory cannot prove the requested tool is read-only.
 */
export class McpAccessGateway {
  private readonly failures = new Map<string, FailureState>();
  private readonly runtime: McpToolRuntime;
  private readonly registry: McpRegistry;
  private readonly now: () => number;
  private readonly recordEvidence: (partial: Omit<EvidenceEntry, 'event_id' | 'occurred_at'>) => EvidenceEntry;

  constructor(
    runtime: McpToolRuntime,
    registry: McpRegistry,
    now = () => Date.now(),
    recordEvidence = appendEvidence,
  ) {
    this.runtime = runtime;
    this.registry = registry;
    this.now = now;
    this.recordEvidence = recordEvidence;
  }

  async callReadOnly(input: ReadonlyMcpCall): Promise<unknown> {
    const registration = findMcpRegistration(input.server, this.registry);
    if (!registration) return this.deny(input, 'MCP_NOT_REGISTERED', `MCP 未在注册清单启用: ${input.server}`);
    if (!registration.tools.some((item) => item.name === input.tool && item.readOnly)) {
      return this.deny(input, 'MCP_TOOL_NOT_ALLOWED', `工具不在只读白名单中: ${input.server}/${input.tool}`);
    }
    if (!runtimeToolIsReadOnly(input.runtimeInventory, input.server, input.tool)) {
      return this.deny(input, 'MCP_NOT_READ_ONLY', `运行时未确认只读工具，已拒绝调用: ${input.server}/${input.tool}`);
    }

    const key = `${input.server}/${input.tool}`;
    const state = this.failures.get(key);
    if (state && state.blockedUntil > this.now()) {
      return this.deny(input, 'MCP_CIRCUIT_OPEN', `工具暂时熔断，稍后重试: ${key}`);
    }

    const payload = {
      server: input.server,
      tool: input.tool,
      purpose: input.purpose,
      arguments: input.args ?? {},
      policy: 'registry-readonly + runtime-readOnlyHint',
    };
    this.recordEvidence({ kind: 'guard_decision', method: 'mcpServer/tool/call', thread_id: input.sessionId, summary: `auto-approved read-only MCP call: ${key}`, payload });
    try {
      const result = await this.runtime.callMcpTool(input.sessionId, input.server, input.tool, input.args ?? {});
      this.failures.delete(key);
      this.recordEvidence({ kind: 'mcp_tool_call', method: 'mcpServer/tool/call', thread_id: input.sessionId, summary: `completed: ${key}`, payload });
      return result;
    } catch (error) {
      const failures = (state?.failures ?? 0) + 1;
      const blockedUntil = failures >= 3 ? this.now() + 30_000 : 0;
      this.failures.set(key, { failures: blockedUntil ? 0 : failures, blockedUntil });
      this.recordEvidence({
        kind: 'mcp_tool_call', method: 'mcpServer/tool/call', thread_id: input.sessionId,
        summary: `failed: ${key}`,
        payload: { ...payload, error: error instanceof Error ? error.message : String(error), failures, ...(blockedUntil ? { blockedUntil: new Date(blockedUntil).toISOString() } : {}) },
      });
      throw error;
    }
  }

  private deny(input: ReadonlyMcpCall, code: McpAccessGatewayError['code'], message: string): never {
    this.recordEvidence({
      kind: 'guard_decision', method: 'mcpServer/tool/call', thread_id: input.sessionId,
      summary: `denied MCP call: ${input.server}/${input.tool}`,
      payload: { server: input.server, tool: input.tool, purpose: input.purpose, arguments: input.args ?? {}, outcome: 'denied', code, message },
    });
    throw new McpAccessGatewayError(code, message);
  }
}
