import { z } from 'zod';

/** Versioned evidence wire contract shared by the JSONL pilot adapter and future M02 adapter. */
export const evidenceEntrySchema = z.object({
  event_id: z.string().uuid(),
  occurred_at: z.string().datetime(),
  tenant_id: z.string().trim().min(1).max(200),
  object_ref: z.string().trim().min(1).max(2048),
  source_system: z.string().trim().min(1).max(200),
  correlation_id: z.string().trim().min(1).max(200),
  version: z.string().trim().min(1).max(40),
  kind: z.string().trim().min(1).max(100),
  method: z.string().max(500).optional(),
  thread_id: z.string().max(200).optional(),
  turn_id: z.string().max(200).optional(),
  item_type: z.string().max(100).optional(),
  actor_id: z.string().trim().min(1).max(200).optional(),
  actor_type: z.enum(['human', 'service', 'agent', 'system']).optional(),
  summary: z.string().max(4000).optional(),
  evidence_refs: z.array(z.string().trim().min(1).max(2048)).max(200).refine(
    (refs) => new Set(refs).size === refs.length,
    'evidence_refs 不能重复',
  ),
  payload_hash: z.string().regex(/^[a-f0-9]{64}$/, 'payload_hash 必须是 SHA-256 十六进制摘要'),
  payload: z.unknown().optional(),
}).strict().superRefine((entry, context) => {
  if ((entry.actor_id === undefined) !== (entry.actor_type === undefined)) {
    context.addIssue({ code: 'custom', path: ['actor_id'], message: 'actor_id and actor_type must be provided together' });
  }
});

export type EvidenceEntryContract = z.infer<typeof evidenceEntrySchema>;

export function validateEvidenceEntry(value: unknown): EvidenceEntryContract {
  return evidenceEntrySchema.parse(value);
}
