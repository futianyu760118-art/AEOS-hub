// 调用方上下文：SPC 只对 Hub 暴露一个系统网关时，用它说明“这次调用代表哪个系统/用户/Agent/任务”。
//
// 边界：
// - Hub 只存储与归属，不在这里放 actor token；token/签名合同确定后再另走透传通道。
// - system-token 只能声明自己的 systemId；userId/agentId/taskId 目前是系统自报的元数据，
//   用于归属、计费与链路，不作为 Hub 的鉴权依据。
import { z } from 'zod';

const idLike = z.union([
  z.string().trim().min(1).max(160),
  z.number().int().nonnegative().transform((value) => String(value)),
]);
const optionalId = idLike.nullable().default(null);

export const CallerContextSchema = z.object({
  /** 发起系统；必须与借调/派单的 fromSystem 一致。 */
  systemId: z.string().trim().min(1).max(160),
  /** SPC 内部用户智能体 ID（一人一个 Agent 时的 agent id/agent_no）。 */
  agentId: optionalId,
  /** SPC 用户 ID；SPC 侧可能是整数，这里统一存字符串。 */
  userId: optionalId,
  /** SPC 任务 ID；用于把跨系统调用挂回任务闭环。 */
  taskId: optionalId,
  /** SPC trace_id；与 Hub traceId 对齐，便于跨系统链路拼接。 */
  traceId: optionalId,
}).strict();

export type CallerContext = z.infer<typeof CallerContextSchema>;

/** 宽松解析：undefined/null 返回 null；格式错误抛错，由调用方决定 400。 */
export function parseCallerContext(value: unknown): CallerContext | null {
  if (value === undefined || value === null) return null;
  return CallerContextSchema.parse(value);
}
