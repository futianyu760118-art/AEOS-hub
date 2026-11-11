export type AgentResultDigest = {
  summary: string;
  evidenceRefs: string[];
  dataConfidence: string | null;
  lowConfidence: boolean;
  validationNote: string | null;
};

const MAX_SUMMARY_LENGTH = 4_000;
const MAX_EVIDENCE_REFS = 200;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function uniqueEvidenceRefs(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const value of values) {
    const ref = value.trim();
    if (!ref || seen.has(ref) || ref.length > 2_048) continue;
    seen.add(ref);
    refs.push(ref);
    if (refs.length >= MAX_EVIDENCE_REFS) break;
  }
  return refs;
}

function fallbackSummary(result: unknown): string {
  if (typeof result === 'string' && result.trim()) return result.trim().slice(0, MAX_SUMMARY_LENGTH);
  if (result === null || result === undefined) return 'Agent 运行完成，但未返回可展示的结果摘要。';
  try {
    const json = JSON.stringify(result);
    return json.length > MAX_SUMMARY_LENGTH ? `${json.slice(0, MAX_SUMMARY_LENGTH - 1)}…` : json;
  } catch {
    return 'Agent 运行完成，但结果无法序列化。';
  }
}

/**
 * Extracts the business-facing summary, evidence references and confidence
 * signals from a Runtime result. The raw Runtime payload is never treated as a
 * verified business fact; it only becomes a PENDING Result when confidence is
 * sufficient, otherwise the governed task must escalate to a human decision.
 */
export function digestAgentResult(result: unknown): AgentResultDigest {
  const root = record(result);
  const conclusionRefs = Array.isArray(root?.conclusions)
    ? root.conclusions.flatMap((item) => strings(record(item)?.evidence_refs))
    : [];
  const evidenceRefs = uniqueEvidenceRefs([
    ...strings(root?.evidence_refs),
    ...conclusionRefs,
  ]);
  const dataConfidence = typeof root?.data_confidence === 'string' && root.data_confidence.trim()
    ? root.data_confidence.trim().toLowerCase()
    : null;
  const validationNote = typeof root?.validation_note === 'string' && root.validation_note.trim()
    ? root.validation_note.trim()
    : null;
  const lowConfidence = dataConfidence === 'low'
    || validationNote !== null
    || root?.stale === true;
  const summary = typeof root?.summary === 'string' && root.summary.trim()
    ? root.summary.trim().slice(0, MAX_SUMMARY_LENGTH)
    : fallbackSummary(result);

  return { summary, evidenceRefs, dataConfidence, lowConfidence, validationNote };
}
