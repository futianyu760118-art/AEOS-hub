// 执行面 Agent 能力选择：只返回 Agent 实际声明的能力，不再硬编码回退。
// 查询能力优先取带 intent 的查询能力；推理能力取 reason*。
export function selectExecutionCapabilities(capabilities) {
  const list = Array.isArray(capabilities) ? capabilities : [];
  const named = (prefix) => list.find((cap) => typeof cap?.name === 'string' && cap.name.startsWith(prefix))?.name ?? null;
  const query = list.find((cap) => cap?.intent)?.name ?? named('query');
  const reasoning = named('reason');
  return { query, reasoning };
}

export function isReasoningOnly(selection) {
  return Boolean(selection && !selection.query && selection.reasoning);
}

export function isQueryOnly(selection) {
  return Boolean(selection && selection.query && !selection.reasoning);
}
