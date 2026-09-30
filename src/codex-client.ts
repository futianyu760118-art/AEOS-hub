// Codex app-server JSON-RPC 客户端（stdio）
// 协议依据: codex-rs/app-server/README.md (thread/start, turn/start, item/*, turn/completed)
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { appendEvidence } from './evidence.ts';

export interface RpcIncoming {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  params?: unknown;
}

type Pending = { method: string; resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export interface StartOptions {
  cwd: string;
  /** 隔离的 CODEX_HOME：codex 的所有状态/会话/配置只写这里，绝不碰全局 ~/.codex */
  codexHome: string;
  /** 要启动的 codex 可执行文件（项目内固定版本），不依赖 PATH 上的全局安装 */
  binary: string;
  clientName: string;
  requestTimeoutMs?: number;
}

export class CodexAppServerClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams;
  private rl: Interface;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private initialized = false;
  private failed = false;
  private requestTimeoutMs = 90_000;
  readonly codexHome: string;

  private constructor(child: ChildProcessWithoutNullStreams, rl: Interface, codexHome: string) {
    super();
    this.child = child;
    this.rl = rl;
    this.codexHome = codexHome;
    rl.on('line', (line) => this.onLine(line));
    child.on('exit', (code) => {
      const err = new Error(`codex app-server 进程退出，exitCode=${code}`);
      this.fail(err, code);
    });
    child.on('error', (error) => this.fail(error));
    child.stdin.on('error', (error) => this.fail(error));
    child.stdout.on('error', (error) => this.fail(error));
    rl.on('close', () => this.fail(new Error('codex stdout closed')));
  }

  private fail(error: Error, code: number | null = null): void {
    if (this.failed) return;
    this.failed = true;
    this.initialized = false;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.emit('exit', code);
    this.child.kill();
    const forceKill = setTimeout(() => { if (this.child.exitCode === null) this.child.kill('SIGKILL'); }, 3000);
    forceKill.unref();
  }

  static async start(opts: StartOptions): Promise<CodexAppServerClient> {
    if (opts.requestTimeoutMs !== undefined && (!Number.isFinite(opts.requestTimeoutMs) || opts.requestTimeoutMs < 1)) throw new Error('requestTimeoutMs must be positive');
    // Windows 下 .cmd 启动器需要 shell；env 里强制 CODEX_HOME（即使外层已有也覆盖），
    // 保证本进程与全局 ~/.codex（桌面版/其他 CLI）完全隔离
    const win = process.platform === 'win32';
    const directDeepSeek = {
      ...process.env,
      CODEX_HOME: opts.codexHome,
      // DeepSeek is reachable directly in this environment; the inherited
      // corporate proxy presents an untrusted certificate to the Rust client.
      NO_PROXY: [process.env.NO_PROXY, 'api.deepseek.com'].filter(Boolean).join(','),
      no_proxy: [process.env.no_proxy, 'api.deepseek.com'].filter(Boolean).join(','),
      ALL_PROXY: '',
      all_proxy: '',
    };
    const child = spawn(opts.binary, ['app-server'], {
      cwd: opts.cwd,
      shell: win,
      env: directDeepSeek,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    child.stderr.on('data', (d) => process.stderr.write(`[codex-stderr] ${d}`));
    const rl = createInterface({ input: child.stdout });
    const client = new CodexAppServerClient(child, rl, opts.codexHome);
    client.requestTimeoutMs = opts.requestTimeoutMs ?? 90_000;
    try { await client.initialize(opts.clientName); }
    catch (error) { client.close(); throw error; }
    return client;
  }

  private onLine(line: string): void {
    let msg: RpcIncoming;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // 非 JSON 行（理论上不会出现在 stdout 协议流）
    }
    if (msg.id !== undefined && msg.method === undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`RPC ${p.method} 失败: ${msg.error.message} (code=${msg.error.code})`));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method) {
      if (msg.id !== undefined) {
        // 服务端发起的请求（审批等），交给调用方决定，默认拒绝
        this.emit('serverRequest', msg);
      } else {
        try { this.recordNotification(msg.method, msg.params); }
        catch (error) { this.fail(error as Error); return; }
        this.emit('notification', msg.method, msg.params);
      }
    }
  }

  private recordNotification(method: string, params: unknown): void {
    const p = (params ?? {}) as { threadId?: string; turnId?: string; item?: Record<string, unknown> };
    const itemType = typeof p.item?.type === 'string' ? p.item.type : undefined;
    // agentMessage 的流式 delta 单独汇总，避免刷屏
    if (method === 'item/agentMessage/delta') return;
    appendEvidence({
      kind: 'notification',
      method,
      thread_id: p.threadId,
      turn_id: p.turnId,
      item_type: itemType,
      payload: params,
    });
  }

  private async initialize(clientName: string): Promise<void> {
    const res = (await this.request('initialize', {
      clientInfo: { name: clientName, title: 'AEOS Hub Orchestrator', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    })) as Record<string, unknown>;
    await this.notify('notifications/initialized', {});
    this.initialized = true;
    this.emit('ready', res);
  }

  request(method: string, params: unknown = {}): Promise<unknown> {
    if (this.failed) return Promise.reject(new Error('codex transport is closed'));
    if (!this.initialized && method !== 'initialize') {
      return Promise.reject(new Error('Not initialized'));
    }
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      let serialized: string;
      try { serialized = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'; }
      catch (error) { reject(error as Error); return; }
      const timer = setTimeout(() => this.fail(new Error(`RPC ${method} timed out after ${this.requestTimeoutMs}ms; runtime reset required`)), this.requestTimeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.child.stdin.write(serialized, (error) => { if (error) this.fail(error); });
    });
  }

  notify(method: string, params: unknown = {}): Promise<void> {
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
    return Promise.resolve();
  }

  /** 应答服务端发起的请求（如审批），result 形如 { decision: 'accept' | 'decline' } */
  respond(reqId: number, result: unknown): void {
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: reqId, result }) + '\n');
  }

  respondError(reqId: number, code: number, message: string): void {
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: reqId, error: { code, message } }) + '\n');
  }

  /** 等待满足条件的通知（如 turn/completed），超时抛出 */
  waitNotification(predicate: (method: string, params: unknown) => boolean, timeoutMs = 240_000): Promise<{ method: string; params: unknown }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off('notification', handler);
        reject(new Error(`等待通知超时(${timeoutMs}ms)`));
      }, timeoutMs);
      const handler = (method: string, params: unknown) => {
        if (predicate(method, params)) {
          clearTimeout(timer);
          this.off('notification', handler);
          resolve({ method, params });
        }
      };
      this.on('notification', handler);
    });
  }

  close(): void {
    this.fail(new Error('codex transport closed'));
    try {
      this.child.stdin.end();
    } catch { /* ignore */ }
    try {
      this.child.kill();
    } catch { /* ignore */ }
  }
}
