// 模型路由器（选模型）：确定性、可解释的选型器。输入任务约束，输出选定 model_profile + 规则矩阵轨迹。
// 纯逻辑、无文件/时钟副作用；profiles 可注入便于单测。本次不做「LLM 判难度」、不做模型网关（统一代理）。
import { z } from 'zod';
import { loadModelProfiles, type ModelProfile } from './model-profile-store.ts';

const DIFFICULTIES = ['light', 'medium', 'heavy'] as const;
export type RouteDifficulty = (typeof DIFFICULTIES)[number];

export const RouteRequestSchema = z.object({
  // 任务难度 → 档位（1:1 映射到 model_profile.tier）
  difficulty: z.enum(DIFFICULTIES).default('light'),
  // 数据脱敏要求：true 仅选本地模型，false 排除本地模型
  dataSensitive: z.boolean().default(false),
  // 硬约束（可选）：时延上限 / 最小上下文 / 每百万 Token 成本上限（人民币，inputPrice+outputPrice）
  maxLatencyMs: z.number().int().nonnegative().optional(),
  minContextWindow: z.number().int().nonnegative().optional(),
  maxCostPerMillion: z.number().nonnegative().optional(),
  // Agent 默认档（锚点）：满足约束时优先沿用，不因成本/时延被换掉
  agentModelProfileId: z.string().optional(),
}).strict();

export type RouteRequest = z.input<typeof RouteRequestSchema>;

export interface RouteDecision {
  satisfied: boolean;
  profileId: string | null;
  profile: ModelProfile | null;
  tier: RouteDifficulty;
  reasons: string[];
  /** Hub 当前能否真正直连调用该档的 provider（现仅 deepseek 有真实 key + base_url）。 */
  executable: boolean;
  fallbackProfileId: string | null;
}

export class ModelRouterError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ModelRouterError';
    this.code = code;
  }
}

export function parseRouteRequest(input: unknown): RouteRequest {
  const result = RouteRequestSchema.safeParse(input);
  if (!result.success) {
    throw new ModelRouterError(
      'INVALID_ROUTE_REQUEST',
      `选型请求校验失败: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    );
  }
  return result.data;
}

// Hub 自身直连可执行的 provider 边界。注意：这是「Hub 自己发起的模型调用」能直连的范围，
// 与设计稿 §5 决策1 的「模型网关统一代理」是两回事——网关是后续独立的接入面。
export const HUB_EXECUTABLE_PROVIDERS: ReadonlySet<string> = new Set(['deepseek']);

export function isHubExecutableProfile(profile: ModelProfile): boolean {
  return HUB_EXECUTABLE_PROVIDERS.has(profile.provider);
}

function costPerMillion(profile: ModelProfile): number {
  return profile.inputPrice + profile.outputPrice;
}

/** 回退档：Agent 默认档（若为非 local 具体档）优先，否则成本最低的非 local 具体档。 */
function pickFallback(profiles: ModelProfile[], agentModelProfileId?: string): ModelProfile | null {
  const concrete = profiles.filter((profile) => !profile.followsDefault && profile.provider !== 'local');
  const agentDefault = agentModelProfileId
    ? concrete.find((profile) => profile.id === agentModelProfileId)
    : undefined;
  if (agentDefault) return agentDefault;
  return concrete.slice().sort((a, b) => costPerMillion(a) - costPerMillion(b) || a.latencyMs - b.latencyMs)[0] ?? null;
}

export function routeModel(request: RouteRequest, profiles: ModelProfile[] = loadModelProfiles().profiles): RouteDecision {
  const difficulty = request.difficulty ?? 'light';
  const dataSensitive = request.dataSensitive ?? false;
  const reasons: string[] = [];
  let candidates = profiles.filter((profile) => !profile.followsDefault);

  // 1. 脱敏：true 仅本地；false 排除本地（避免 0 成本的 local-llama 抢掉 cloud 档）。
  if (dataSensitive) {
    candidates = candidates.filter((profile) => profile.provider === 'local');
    reasons.push('数据脱敏要求 → 仅本地模型');
  } else {
    candidates = candidates.filter((profile) => profile.provider !== 'local');
    reasons.push('非脱敏任务 → 排除本地模型');
  }

  // 2. 难度 → 档位。
  candidates = candidates.filter((profile) => profile.tier === difficulty);
  reasons.push(`难度=${difficulty} → 档位=${difficulty}`);

  // 3. 上下文下限。
  if (request.minContextWindow != null) {
    candidates = candidates.filter((profile) => profile.contextWindow >= request.minContextWindow);
    reasons.push(`最小上下文 ${request.minContextWindow} tokens → 过滤`);
  }
  // 4. 时延上限。
  if (request.maxLatencyMs != null) {
    candidates = candidates.filter((profile) => profile.latencyMs <= request.maxLatencyMs);
    reasons.push(`最大时延 ${request.maxLatencyMs}ms → 过滤`);
  }
  // 5. 成本上限（每百万 Token）。
  if (request.maxCostPerMillion != null) {
    candidates = candidates.filter((profile) => costPerMillion(profile) <= request.maxCostPerMillion);
    reasons.push(`每百万 Token 成本上限 ¥${request.maxCostPerMillion} → 过滤`);
  }

  if (candidates.length === 0) {
    const fallback = dataSensitive ? null : pickFallback(profiles, request.agentModelProfileId);
    reasons.push(dataSensitive
      ? '无本地模型满足全部约束，脱敏任务不可回退到云端模型'
      : '无档位同时满足全部约束 → 回退');
    return {
      satisfied: false,
      profileId: null,
      profile: null,
      tier: difficulty,
      reasons,
      executable: false,
      fallbackProfileId: fallback?.id ?? null,
    };
  }

  let selected: ModelProfile | undefined;
  if (request.agentModelProfileId) {
    selected = candidates.find((profile) => profile.id === request.agentModelProfileId);
    if (selected) reasons.push(`沿用 Agent 默认档 ${selected.id}`);
  }
  if (!selected) {
    selected = candidates.slice().sort((a, b) => costPerMillion(a) - costPerMillion(b) || a.latencyMs - b.latencyMs)[0];
    reasons.push('同档内成本优先、时延次之');
  }

  return {
    satisfied: true,
    profileId: selected.id,
    profile: selected,
    tier: difficulty,
    reasons,
    executable: isHubExecutableProfile(selected),
    fallbackProfileId: null,
  };
}
