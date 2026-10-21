// 配置与密钥读取：只从环境变量读取，绝不把密钥写入日志/镜像/示例文件。
export function loadConfig(env = process.env) {
  const required = (name) => {
    const value = (env[name] ?? '').trim();
    if (!value) throw new Error(`缺少环境变量 ${name}`);
    return value;
  };

  const legacyToken = (env.EXECUTION_PLANE_TOKEN ?? '').trim();
  const systemId = (env.EXECUTION_SYSTEM_ID ?? '').trim();
  const systemToken = (env.EXECUTION_SYSTEM_TOKEN ?? '').trim();
  const wsUrl = required('EXECUTION_WS_URL');
  if (Boolean(systemId) !== Boolean(systemToken)) {
    throw new Error('EXECUTION_SYSTEM_ID 和 EXECUTION_SYSTEM_TOKEN 必须同时提供');
  }
  if (!systemId && !legacyToken) {
    throw new Error('缺少环境变量 EXECUTION_PLANE_TOKEN，或同时提供 EXECUTION_SYSTEM_ID 和 EXECUTION_SYSTEM_TOKEN');
  }

  return {
    wsUrl,
    token: legacyToken,
    systemId,
    systemToken,
    authMode: systemId ? 'system-token' : 'legacy-root',
    agentId: required('EXECUTION_AGENT_ID'),
    agentName: (env.EXECUTION_AGENT_NAME ?? '').trim() || required('EXECUTION_AGENT_ID'),
    agentVersion: (env.EXECUTION_AGENT_VERSION ?? '').trim() || '1.0.0',
    protocolVersion: (env.EXECUTION_PROTOCOL_VERSION ?? '').trim() || '1.0',
    sourceSystem: required('EXECUTION_SOURCE_SYSTEM'),
    targetQueryBaseUrl: required('TARGET_QUERY_BASE_URL'),
    targetQueryAppKey: required('TARGET_QUERY_APP_KEY'),
    targetQueryAppSecret: required('TARGET_QUERY_APP_SECRET'),
    targetReasoningUrl: (env.TARGET_REASONING_URL ?? '').trim(),
    targetReasoningAgentId: (env.TARGET_REASONING_AGENT_ID ?? '').trim(),
    targetReasoningToken: (env.TARGET_REASONING_TOKEN ?? '').trim(),
  };
}
