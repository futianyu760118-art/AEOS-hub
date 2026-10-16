// 模型目录：把 HarborAgent.model 从「一段展示文字」升级为可路由、可计价的 model_profile 引用。
// 独立存放在 data/model-profiles.json（与 ai-harbor.json 分开，避免大快照频繁整文件重写）。
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const modelProfilesFile = join(root, 'data', 'model-profiles.json');

const PROFILE_PROVIDERS = ['deepseek', 'openai', 'local', 'remote', 'account'] as const;
const PROFILE_TIERS = ['light', 'medium', 'heavy'] as const;

const profileIdSchema = z.string().trim()
  .regex(/^[a-z][a-z0-9._-]{1,79}$/, '模型档标识只能使用小写字母、数字、点、下划线和连字符，且长度为 2-80 位');
const trimmedString = (max: number, min = 0) => z.string()
  .min(min)
  .max(max)
  .refine((value) => value === value.trim(), '字符串前后不能包含空白');

export const ModelProfileSchema = z.object({
  id: profileIdSchema,
  provider: z.enum(PROFILE_PROVIDERS),
  modelName: trimmedString(120, 1),
  tier: z.enum(PROFILE_TIERS),
  // 每百万 token 的价格（人民币）。当前为占位价，接入真实供应商后再校正。
  inputPrice: z.number().nonnegative(),
  outputPrice: z.number().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
  contextWindow: z.number().int().nonnegative(),
  // true 表示「跟随默认」而非具体模型（account-default / provider-default），无真实价格与上下文。
  followsDefault: z.boolean().default(false),
  description: trimmedString(500).default(''),
}).strict();

export const ModelProfileSnapshotSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  profiles: z.array(ModelProfileSchema),
}).strict();

export type ModelProfile = z.infer<typeof ModelProfileSchema>;
export type ModelProfileSnapshot = z.infer<typeof ModelProfileSnapshotSchema>;

// 种子档：覆盖现有 12 个 Agent 用到的 deepseek-chat / account-default / provider-default，
// 以及设计稿 §3.1 的 openai / local 示例。特殊标记（followsDefault）保留「跟随默认」语义，不映射到具体模型。
const SEED_PROFILES: ModelProfile[] = [
  ModelProfileSchema.parse({
    id: 'deepseek-chat',
    provider: 'deepseek',
    modelName: 'deepseek-chat',
    tier: 'light',
    inputPrice: 1,
    outputPrice: 2,
    latencyMs: 800,
    contextWindow: 64_000,
    description: '低成本·高吞吐，普通查询/报表默认档',
  }),
  ModelProfileSchema.parse({
    id: 'deepseek-reasoner',
    provider: 'deepseek',
    modelName: 'deepseek-reasoner',
    tier: 'medium',
    inputPrice: 4,
    outputPrice: 16,
    latencyMs: 3_000,
    contextWindow: 64_000,
    description: 'DeepSeek 推理档，中等难度',
  }),
  ModelProfileSchema.parse({
    id: 'gpt-4o',
    provider: 'openai',
    modelName: 'gpt-4o',
    tier: 'heavy',
    inputPrice: 18,
    outputPrice: 72,
    latencyMs: 1_200,
    contextWindow: 128_000,
    description: '高难度推理，订单交付风险分析等',
  }),
  ModelProfileSchema.parse({
    id: 'local-llama',
    provider: 'local',
    modelName: 'llama3.1',
    tier: 'light',
    inputPrice: 0,
    outputPrice: 0,
    latencyMs: 200,
    contextWindow: 8_192,
    description: '本地模型，脱敏/离线场景（质检报告、批处理）',
  }),
  ModelProfileSchema.parse({
    id: 'account-default',
    provider: 'account',
    modelName: 'account-default',
    tier: 'light',
    inputPrice: 0,
    outputPrice: 0,
    latencyMs: 0,
    contextWindow: 0,
    followsDefault: true,
    description: '跟随账号默认模型（Hub 中枢 Agent 默认档）',
  }),
  ModelProfileSchema.parse({
    id: 'provider-default',
    provider: 'remote',
    modelName: 'provider-default',
    tier: 'light',
    inputPrice: 0,
    outputPrice: 0,
    latencyMs: 0,
    contextWindow: 0,
    followsDefault: true,
    description: '跟随远程执行提供方默认模型（创建 Agent 的兜底档）',
  }),
];

export class ModelProfileStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ModelProfileStoreError';
    this.code = code;
  }
}

function parseSnapshot(raw: unknown, label: string): ModelProfileSnapshot {
  const result = ModelProfileSnapshotSchema.safeParse(raw);
  if (!result.success) {
    throw new ModelProfileStoreError(
      'MODEL_PROFILE_STORE_INVALID',
      `${label} 校验失败: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    );
  }
  return result.data;
}

function writeTextAtomic(target: string, payload: string): void {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(temporary, payload, { encoding: 'utf8', flag: 'wx', mode: 0o600, flush: true });
    renameSync(temporary, target);
  } catch (error) {
    try {
      if (existsSync(temporary)) unlinkSync(temporary);
    } catch {
      // 保留原始写入错误。
    }
    throw new ModelProfileStoreError('MODEL_PROFILE_STORE_WRITE_FAILED', `写入模型目录失败: ${target}`, error);
  }
}

export function loadModelProfiles(): ModelProfileSnapshot {
  if (!existsSync(modelProfilesFile)) return { version: 1, revision: 0, profiles: [] };
  const raw = readFileSync(modelProfilesFile, 'utf8');
  return parseSnapshot(JSON.parse(raw), '模型目录快照');
}

export function saveModelProfiles(snapshot: ModelProfileSnapshot): ModelProfileSnapshot {
  const validated = parseSnapshot(snapshot, '待保存的模型目录快照');
  const payload = `${JSON.stringify(validated, null, 2)}\n`;
  writeTextAtomic(modelProfilesFile, payload);
  return validated;
}

// 幂等补齐种子档：缺哪个补哪个，不覆盖已有同 id 档。
export function ensureModelProfiles(): ModelProfileSnapshot {
  const snapshot = loadModelProfiles();
  const byId = new Map(snapshot.profiles.map((profile) => [profile.id, profile]));
  let changed = false;
  for (const seed of SEED_PROFILES) {
    if (!byId.has(seed.id)) {
      byId.set(seed.id, seed);
      changed = true;
    }
  }
  if (!changed) return snapshot;
  const next = { version: 1 as const, revision: snapshot.revision + 1, profiles: [...byId.values()] };
  return saveModelProfiles(next);
}

export function getModelProfile(id: string | null | undefined): ModelProfile | undefined {
  if (!id) return undefined;
  return loadModelProfiles().profiles.find((profile) => profile.id === id);
}
