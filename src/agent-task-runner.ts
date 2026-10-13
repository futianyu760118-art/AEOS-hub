export type AgentRunInstructionSource = {
  name: string;
  role: string;
  registration: {
    allowedRuntimeCapabilities: string[];
    taskServiceProfile: { dataFreshnessMinutes: number };
  };
};

export type AgentRunTaskSource = {
  title: string;
  businessObjectRef: string;
  evidenceRefs: string[];
};

export type AgentRunOutcome =
  | { state: 'completed' }
  | { state: 'failed'; reason: string }
  | { state: 'awaiting_decision'; reason: string };

export type AgentTaskRun = {
  taskId: string;
  agentId: string;
  correlationId: string;
  runtimeSessionId: string;
  runtimeRunId: string;
  outcome: AgentRunOutcome;
  startedAt: string;
  endedAt: string;
};

export type AgentTaskRunDeps = {
  runtime: {
    createSession(request: { developerInstructions?: string }): Promise<{ id: string }>;
    startRun(sessionId: string, request: { input: string }): Promise<{ id: string }>;
    waitForRun(runId: string): Promise<{ state: string; failure?: { message?: string; code?: string } | null }>;
  };
  now?: () => Date;
};

/**
 * Builds the developer instructions injected into the Agent's Runtime session.
 * The duty, allowed tool scope, data freshness, structured output contract, and
 * forbidden actions are resolved server-side from the persisted Agent and Task,
 * never from the browser request.
 */
export function buildAgentRunInstructions(agent: AgentRunInstructionSource, task: AgentRunTaskSource): string {
  const tools = agent.registration.allowedRuntimeCapabilities.length
    ? agent.registration.allowedRuntimeCapabilities.join('、')
    : '其服务档案声明范围内的只读工具';
  const freshness = agent.registration.taskServiceProfile.dataFreshnessMinutes > 0
    ? `不得早于 ${agent.registration.taskServiceProfile.dataFreshnessMinutes} 分钟`
    : '不得过期';
  const evidence = task.evidenceRefs.length ? task.evidenceRefs.join('；') : '任务创建时未携带证据上下文，必须标注数据置信度不足';
  return [
    `你现在以「${agent.name}」（${agent.role}）身份执行一项只读经营分析任务。`,
    `只读边界：仅调用 ${tools}；不得写入任何业务数据。`,
    `数据时效：引用的数据${freshness}；缺失或过期必须明确标注「数据置信度不足」。`,
    `结构化输出：1. 事项；2. evidence_refs 依据；3. 风险/时间/金额影响；4. 建议动作与责任角色；5. 数据置信度。`,
    `禁止：不得自行 Verify、不得关闭任务、不得绕过人工派单。`,
    `任务：${task.title}（关联 ${task.businessObjectRef}）`,
    `Evidence 线索：${evidence}`,
  ].join('\n');
}

/**
 * Maps a Runtime run to a governed task outcome. Dependency unavailability and
 * insufficient data escalate to a human decision instead of being rendered as a
 * completed or generic failure.
 */
export function mapRunOutcome(run: { state: string; failure?: { message?: string; code?: string } | null }): AgentRunOutcome {
  if (run.state === 'completed') return { state: 'completed' };
  if (run.state === 'interrupted' || run.state === 'interrupting') {
    return { state: 'awaiting_decision', reason: '运行被中断，等待人工决策' };
  }
  const code = run.failure?.code ?? '';
  const message = run.failure?.message ?? '';
  const text = `${code} ${message}`.toLowerCase();
  if (/timeout|超时/.test(text)) return { state: 'failed', reason: message || '运行超时' };
  if (/upstream|unavailable|上游|不可用|dependency|依赖/.test(text)) return { state: 'awaiting_decision', reason: message || '上游依赖不可用' };
  if (/insufficient|数据不足|置信度不足|no data|empty/.test(text)) return { state: 'awaiting_decision', reason: message || '数据不足' };
  return { state: 'failed', reason: message || '运行异常' };
}

/**
 * Governed orchestration: the instructions and identity are derived from the
 * persisted Agent and Task, and the run is tied to the task correlation id.
 */
export async function startAgentTaskRun(
  task: AgentRunTaskSource & { taskId: string; correlationId: string },
  agent: AgentRunInstructionSource & { id: string },
  deps: AgentTaskRunDeps,
): Promise<AgentTaskRun> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const instructions = buildAgentRunInstructions(agent, task);
  const session = await deps.runtime.createSession({ developerInstructions: instructions });
  const run = await deps.runtime.startRun(session.id, { input: task.title });
  const finalRun = await deps.runtime.waitForRun(run.id);
  const endedAt = now().toISOString();
  return {
    taskId: task.taskId,
    agentId: agent.id,
    correlationId: task.correlationId,
    runtimeSessionId: session.id,
    runtimeRunId: run.id,
    outcome: mapRunOutcome(finalRun),
    startedAt,
    endedAt,
  };
}
