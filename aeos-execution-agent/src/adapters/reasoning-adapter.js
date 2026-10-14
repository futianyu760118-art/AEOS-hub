// 推理适配器（占位）：中台大模型 / 推理智能体接口契约尚未提供。
// 本实现返回结构正确、明确标记「未接通」的结果，绝不伪造已联通中台大模型。
// 中台契约确认后，替换本文件的 reason 实现即可，不改 agent-core。
export function createReasoningAdapter(_config) {
  return async function reason(request, _abortSignal, _onProgress) {
    return {
      summary: '推理能力尚未接通中台大模型（占位实现）。',
      conclusions: [{
        matter: '中台推理接口未接通',
        evidence_refs: ['control-platform://reasoning/not-connected'],
        risk: '无法给出真实分析结论',
        recommendation: '请向中台确认推理接口契约（地址/鉴权/参数/返回/错误码/evidence 规则等）并接入后重试',
        confidence: 'low',
      }],
      data_as_of: new Date().toISOString(),
      data_confidence: 'low',
    };
  };
}
