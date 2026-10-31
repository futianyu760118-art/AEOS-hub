// AEOS 中枢编排演示：起 app-server → 建线程 → 发指令 → 事件流落 evidence → 汇总
// 用法:
//   npm run demo                                    # 默认分析指令
//   npm run demo -- "检查 MO-8821 的供应缺口"         # 自定义指令
//   npm run demo -- --auto-approve                  # 审批请求一律放行（仅演示环境用）
// 退出码: 0=完整通过(agent 已回复)  2=协议验证通过但缺模型凭证  1=其他失败
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { CodexAppServerClient } from './codex-client.ts';
import { appendEvidence, evidenceFile } from './evidence.ts';
import { listConfiguredMcpServers } from './mcp-registry.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const codexHome = join(root, '.codex-home');
mkdirSync(codexHome, { recursive: true });

// 只使用 hub 项目内固定版本的 codex，避免依赖/影响机器上其他 codex 安装
const binary = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'codex.cmd' : 'codex');
if (!existsSync(binary)) {
  console.error(`[FAIL] 未找到项目内 codex CLI: ${binary}`);
  console.error('       请先执行 npm install（@openai/codex 已固定为项目 devDependency）');
  process.exit(1);
}

const args = process.argv.slice(2);
const autoApprove = args.includes('--auto-approve');
const prompt = (args.filter((a) => !a.startsWith('--')).join(' ') ||
  '扫描未来 30 天内的订单风险与物料缺口，输出 TOP 需人关注事项（按 金额影响×概率×时效 排序），所有结论必须引用 evidence_refs。仅调用已注册的 MCP 工具核查；不得执行命令或文件扫描；不得把 MCP resources 为空解读为未注册工具。').trim();

const approvals = [];
const mcpStatuses = [];
const collected = { agentMessage: '', mcpTools: [], commands: [], itemTypeCounts: {} };
const READ_ONLY_MCP_SERVERS = new Set(listConfiguredMcpServers());

/** 判断失败是否源于"未配置模型凭证"，若是返回退出码 2 */
function classifyFailure(text: string): number {
  return /unauthorized|auth|login|api.?key|凭证|model|模型|quota|usage limit|billing|provider/i.test(text) ? 2 : 1;
}

async function main(): Promise<number> {
  console.log('=== AEOS Hub 中枢编排演示 ===');
  console.log(`prompt: ${prompt}`);
  console.log(`审批策略: ${autoApprove ? '自动放行(--auto-approve，仅演示)' : '已注册只读 MCP 自动放行；命令与写操作自动拒绝(试点安全默认，HITL 网关)'}`);
  console.log(`evidence 文件: ${evidenceFile}\n`);

  const client = await CodexAppServerClient.start({
    cwd: root,
    codexHome,
    binary,
    clientName: 'aeos_hub_orchestrator',
  });

  // 服务端发起的请求（MCP 工具授权询问 / 审批请求）→ AEOS Guard 试点策略点
  // 所有决策落 evidence；响应格式以官方生成的协议类型为准（src/generated）
  client.on('serverRequest', (req) => {
    const method = req.method ?? '(unknown)';
    const params = (req.params ?? {}) as { serverName?: string; message?: string };
    let kind = 'policy_decision';
    let decision = 'decline';

    if (method === 'mcpServer/elicitation/request') {
      // MCP 注册清单中的工具均已由元数据校验为 READ_ONLY。
      const allowed = autoApprove || (typeof params.serverName === 'string' && READ_ONLY_MCP_SERVERS.has(params.serverName));
      decision = allowed ? 'accept' : 'decline';
      console.log(`[Guard] MCP 工具授权 ${params.serverName ?? '?'} -> ${decision}${allowed ? '' : '（非白名单系统，拒绝）'}`);
      client.respond(req.id!, { action: decision, content: null, _meta: null });
    } else if (/approval/i.test(method)) {
      kind = 'approval_decision';
      decision = autoApprove ? 'accept' : 'decline';
      console.log(`[Guard] 审批请求 ${method} -> ${decision}${autoApprove ? '（--auto-approve）' : ''}`);
      client.respond(req.id!, { decision });
    } else {
      decision = 'unsupported';
      console.log(`[Guard] 未知服务端请求 ${method} -> 拒绝`);
      client.respondError(req.id!, -32601, `AEOS hub 不支持的服务端请求: ${method}`);
    }

    approvals.push({ method, decision });
    appendEvidence({ kind, method, summary: `decision=${decision}`, payload: { decision, request: { method, params } } });
  });

  client.on('notification', (method, params) => {
    const p = (params ?? {}) as { threadId?: string; delta?: string; item?: Record<string, unknown> };
    if (method === 'item/agentMessage/delta') {
      collected.agentMessage += p.delta ?? '';
      return;
    }
    if (method === 'item/completed') {
      const item = p.item ?? {};
      const t = item.type;
      if (typeof t === 'string') {
        collected.itemTypeCounts[t] = (collected.itemTypeCounts[t] ?? 0) + 1;
        if (t === 'mcpToolCall') {
          collected.mcpTools.push({ server: item.server, tool: item.tool, status: item.status, error: item.error ?? null });
        }
        if (t === 'commandExecution') {
          collected.commands.push({ command: item.command, status: item.status, exitCode: item.exitCode ?? null });
        }
        if (t === 'agentMessage' && typeof item.text === 'string') {
          collected.agentMessage = item.text;
        }
      }
    }
    if (method === 'mcpServer/startupStatus/updated') {
      mcpStatuses.push({ name: p.name, status: p.status });
    }
  });

  let threadId: string | null = null;
  let turnId: string | null = null;

  try {
    // 1) 握手（start() 内已完成 initialize）
    console.log(`[1/4] app-server 已连接 (CODEX_HOME=${codexHome})`);

    // 2) 建线程（cwd=hub 根 → 加载 AGENTS.md 与 mcp_servers）
    try {
      const threadRes = (await client.request('thread/start', { cwd: root })) as Record<string, unknown>;
      threadId = (threadRes as { thread?: { id?: string } }).thread?.id ?? (typeof threadRes.id === 'string' ? threadRes.id : null);
      if (!threadId) {
        console.error(`[FAIL] thread/start 响应未含 threadId: ${JSON.stringify(threadRes).slice(0, 300)}`);
        return 1;
      }
      console.log(`[2/4] thread/start => ${threadId}`);
      appendEvidence({ kind: 'app_event', summary: 'thread started', thread_id: threadId, payload: threadRes });
    } catch (e) {
      const msg = (e as Error).message;
      console.error(`[FAIL] thread/start: ${msg}`);
      return classifyFailure(msg);
    }

    // 3) 发起 turn（审批/写操作按网关策略处理）
    try {
      const turnRes = (await client.request('turn/start', {
        threadId,
        clientUserMessageId: `aeos_demo_${Date.now()}`,
        input: [{ type: 'text', text: prompt }],
      })) as Record<string, unknown>;
      turnId = (turnRes as { turn?: { id?: string } }).turn?.id ?? (typeof turnRes.id === 'string' ? turnRes.id : null);
      console.log(`[3/4] turn/start => ${turnId ?? JSON.stringify(turnRes).slice(0, 300)}`);
    } catch (e) {
      const msg = (e as Error).message;
      console.error(`[FAIL] turn/start: ${msg}`);
      return classifyFailure(msg);
    }

    // 4) 等待结束
    console.log('[4/4] 等待 agent 执行（事件流已实时写入 evidence.jsonl）...');
    const ended = await client.waitNotification((m) => m === 'turn/completed', 600_000);
    const finalTurn = (ended.params as { turn?: Record<string, unknown> })?.turn ?? {};
    const status = finalTurn.status;
    const err = (finalTurn.error ?? null) as { message?: string } | null;
    console.log(`turn 结束: status=${status}`);

    if (err?.message) {
      appendEvidence({ kind: 'turn_result', thread_id: threadId, turn_id: turnId, summary: `turn failed: ${err.message}`, payload: err });
      console.error(`[WARN] turn 失败: ${err.message}`);
      return classifyFailure(err.message);
    }
    if (status !== 'completed') {
      appendEvidence({ kind: 'turn_result', thread_id: threadId, turn_id: turnId, summary: `turn ended with status=${status}` });
      console.error(`[WARN] turn 未正常完成: status=${status}`);
      return 1;
    }

    appendEvidence({ kind: 'turn_result', thread_id: threadId, turn_id: turnId, summary: 'turn completed', payload: { item_types: collected.itemTypeCounts, mcp_tool_calls: collected.mcpTools.length } });
    return 0;
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[FAIL] ${msg}`);
    if (/凭证|模型|auth|unauthorized/i.test(msg)) return 2;
    return 1;
  } finally {
    // 汇总（无论成败都输出，便于排障）
    const itemKinds = Object.entries(collected.itemTypeCounts).map(([k, v]) => `${k}x${v}`).join(', ');
    console.log('\n=== 演示汇总 ===');
    console.log(`线程: ${threadId ?? '-'}`);
    console.log(`MCP 工具调用: ${collected.mcpTools.length} 次`);
    for (const t of collected.mcpTools) console.log(`  - ${t.server}/${t.tool}: ${t.status}`);
    console.log(`命令执行: ${collected.commands.length} 次（试点安全基线：应保持 0 写类命令）`);
    console.log(`服务端授权/审批请求: ${approvals.length} 次（决策均落 evidence）`);
    console.log(`MCP 服务器状态: ${mcpStatuses.length ? mcpStatuses.map((s) => `${s.name}=${s.status}`).join(', ') : '(未观测到启动事件)'}`);
    console.log(`item 构成: ${itemKinds || '(无)'}`);
    const text = collected.agentMessage.trim();
    if (text) {
      console.log(`\n--- agent 最终回复（前 1500 字）---\n${text.slice(0, 1500)}`);
    } else if (mcpStatuses.length) {
      console.log('\n(agent 未产出文本回复，可能被模型凭证问题阻断)');
    }
    try {
      const st = statSync(evidenceFile);
      const lines = readFileSync(evidenceFile, 'utf-8').trim().split('\n').filter(Boolean).length;
      console.log(`\nevidence: ${evidenceFile} (本次共 ${lines} 条, ${st.size} 字节)`);
    } catch {
      console.log('\nevidence: (本次未写入)');
    }
    client.close();
  }
}

const code = await main();
process.exit(code);
