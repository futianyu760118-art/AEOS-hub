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
const PROFILE_EFFORTS = ['low', 'high', 'max'] as const;

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
  // 每百万 token 的价格（人民币）。inputPrice 为高峰时段、缓存未命中的输入价；
  // inputPriceCached 为高峰时段缓存命中价；offPeakMultiplier 为空闲时段价格系数
  // （DeepSeek 官方为空闲=高峰的一半）。价格来源：DeepSeek 官方价目页 2026-10 实测。
  inputPrice: z.number().nonnegative(),
  inputPriceCached: z.number().nonnegative().default(0),
  outputPrice: z.number().nonnegative(),
  offPeakMultiplier: z.number().positive().max(1).default(1),
  // 思考强度（DeepSeek 支持 low/high/max）；不具备该语义的档省略。
  effort: z.enum(PROFILE_EFFORTS).optional(),
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

// 种子档：DeepSeek-only 试点。三档共用 deepseek-flash（V4.1-Flash），仅以 effort 区分；
// 保留 deepseek-chat / deepseek-reasoner 两个历史 id 以兼容既有 Agent 的 modelProfileId 引用。
// 价格为 DeepSeek 官方价目（人民币/百万 token，高峰时段）：缓存未命中输入 2、缓存命中 0.04、输出 8；
// 空闲时段为高峰价的一半（周一至周五 9:00-12:00、14:00-18:00 以外，北京时间）。
// local-llama 保留给「数据脱敏」任务；followsDefault 档保留「跟随默认」语义，不映射到具体模型。
const FLASH_PRICING = {
  provider: 'deepseek' as const,
  modelName: 'deepseek-flash',
  inputPrice: 2,
  inputPriceCached: 0.04,
  outputPrice: 8,
  offPeakMultiplier: 0.5,
  contextWindow: 1_048_576,
};

const SEED_PROFILES: ModelProfile[] = [
  ModelProfileSchema.parse({
    id: 'deepseek-chat',
    ...FLASH_PRICING,
    tier: 'light',
    effort: 'low',
    latencyMs: 800,
    description: 'DeepSeek V4.1-Flash · effort=low，普通查询/报表默认档（官方价：输入 ¥2/M·缓存命中 ¥0.04/M·输出 ¥8/M，空闲五折）',
  }),
  ModelProfileSchema.parse({
    id: 'deepseek-reasoner',
    ...FLASH_PRICING,
    tier: 'medium',
    effort: 'high',
    latencyMs: 3_000,
    description: 'DeepSeek V4.1-Flash · effort=high（默认思考强度），中等推理/分析档',
  }),
  ModelProfileSchema.parse({
    id: 'deepseek-flash-max',
    ...FLASH_PRICING,
    tier: 'heavy',
    effort: 'max',
    latencyMs: 6_000,
    description: 'DeepSeek V4.1-Flash · effort=max，高难度复杂推理档',
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

/** 供一次性迁移脚本读取种子档（返回副本，避免外部修改常量）。 */
export function getSeedProfiles(): ModelProfile[] {
  return SEED_PROFILES.map((profile) => ({ ...profile }));
}
