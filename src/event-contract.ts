import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);

export const EventContractSchema = z.object({
  event_id: text(200),
  event_type: text(200),
  tenant_id: text(200),
  object_ref: text(2048),
  source_system: text(200),
  correlation_id: text(200),
  version: text(40),
  occurred_at: z.string().datetime({ offset: true }),
  evidence_refs: z.array(text(2048)).max(200).refine((refs) => new Set(refs).size === refs.length, 'evidence_refs 不能重复'),
  payload: z.unknown().optional(),
}).strict();

export type EventContract = z.infer<typeof EventContractSchema>;

export function validateEvent(value: unknown): EventContract {
  return EventContractSchema.parse(value);
}
