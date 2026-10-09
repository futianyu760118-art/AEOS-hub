import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const timestamp = z.string().datetime({ offset: true });

export const ResultStatusSchema = z.enum(['PENDING', 'VERIFIED', 'REJECTED']);

export const ResultContractSchema = z.object({
  result_id: text(200),
  result_type: text(200),
  tenant_id: text(200),
  object_ref: text(2048),
  owner: text(200),
  created_by: text(200),
  status: ResultStatusSchema,
  source_system: text(200),
  correlation_id: text(200),
  version: text(40),
  evidence_refs: z.array(text(2048)).min(1).max(200).refine((refs) => new Set(refs).size === refs.length, 'evidence_refs 不能重复'),
  summary: text(4000),
  created_at: timestamp,
  verified_by: z.string().trim().min(1).max(200).nullable(),
  verified_at: timestamp.nullable(),
  verification_note: z.string().trim().min(1).max(4000).nullable(),
}).strict().superRefine((result, context) => {
  if (result.status === 'PENDING' && (result.verified_by || result.verified_at || result.verification_note)) {
    context.addIssue({ code: 'custom', message: 'PENDING Result 不得包含验证结论' });
  }
  if (result.status !== 'PENDING' && (!result.verified_by || !result.verified_at || !result.verification_note)) {
    context.addIssue({ code: 'custom', message: 'VERIFIED 或 REJECTED Result 必须包含 verified_by、verified_at 和 verification_note' });
  }
});

export type ResultContract = z.infer<typeof ResultContractSchema>;

export function validateResult(value: unknown): ResultContract {
  return ResultContractSchema.parse(value);
}
