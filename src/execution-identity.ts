// P1 执行面身份：把「连接鉴权」与「注册归属」从自报字符串中解耦。
// system-token 模式以令牌声明的 systemId 为准；legacy 根令牌仍兼容，但会解析到系统登记并标记审计。
import { timingSafeEqual } from 'node:crypto';

export type ExecutionAuthMode = 'system-token' | 'legacy-root';

export interface ExecutionPlaneConnectionAuth {
  mode: ExecutionAuthMode;
  /** system-token 模式下必有；legacy 模式为 null。 */
  systemId: string | null;
  systemName: string | null;
}

export interface ExecutionRegistrationIdentity {
  authMode: ExecutionAuthMode;
  /** 能解析到系统登记时的规范 systemId；legacy 且无法解析时为 null。 */
  systemId: string | null;
  /** 执行面记录里的 sourceSystem：优先规范 systemId，否则保留 legacy 自报值。 */
  sourceSystem: string;
  /** 页面展示用系统名。 */
  sourceSystemName: string;
  /** legacy 自报值无法匹配系统登记。 */
  legacyUnresolved: boolean;
}

export interface ExecutionAuthHeaders {
  systemId?: unknown;
  systemToken?: unknown;
  legacyToken?: unknown;
}

export type RegisteredSystem = {
  systemId: string;
  name: string;
  status: 'active' | 'disabled';
};

export interface ExecutionAuthDependencies {
  rootSecret: string;
  verifySystemToken: (systemId: string, token: string) => boolean;
  getSystem: (systemId: string) => RegisteredSystem | null;
  /** 兼容期开关：false 时拒绝 legacy 根令牌（建议 2 周后关闭）。默认允许。 */
  allowLegacyRoot?: boolean;
}

export interface RegistrationIdentityDependencies {
  findBySourceSystem: (sourceSystem: string) => RegisteredSystem | null;
}

export class ExecutionIdentityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ExecutionIdentityError';
    this.code = code;
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * 连接鉴权：
 * - 出现任一系统令牌头 → 必须同时提供 systemId 与 token，且系统已登记、启用；失败不回退 legacy；
 * - 否则只接受 legacy 根令牌。
 */
export function resolveExecutionPlaneAuth(
  headers: ExecutionAuthHeaders,
  dependencies: ExecutionAuthDependencies,
): ExecutionPlaneConnectionAuth | null {
  const systemId = text(headers.systemId);
  const systemToken = text(headers.systemToken);
  if (systemId || systemToken) {
    if (!systemId || !systemToken || !dependencies.rootSecret) return null;
    if (!dependencies.verifySystemToken(systemId, systemToken)) return null;
    const system = dependencies.getSystem(systemId);
    if (!system || system.status !== 'active') return null;
    return { mode: 'system-token', systemId: system.systemId, systemName: system.name };
  }

  const legacyToken = text(headers.legacyToken);
  if (dependencies.allowLegacyRoot !== false && legacyToken && dependencies.rootSecret && safeEqual(legacyToken, dependencies.rootSecret)) {
    return { mode: 'legacy-root', systemId: null, systemName: null };
  }
  return null;
}

/**
 * 注册归属：
 * - 系统令牌：忽略自报值；若自报值明确指向另一个系统，拒绝注册（防冒用）；
 * - legacy：自报值能匹配系统登记则归一到 systemId，否则保留自报值并标记待补充。
 */
export function resolveRegistrationIdentity(
  auth: ExecutionPlaneConnectionAuth,
  reportedSource: unknown,
  dependencies: RegistrationIdentityDependencies,
): ExecutionRegistrationIdentity {
  const reported = text(reportedSource);

  if (auth.mode === 'system-token') {
    if (!auth.systemId || !auth.systemName) {
      throw new ExecutionIdentityError('AUTH_INVALID', '系统令牌缺少有效系统身份');
    }
    if (reported && reported !== auth.systemId && reported !== auth.systemName) {
      const claimed = dependencies.findBySourceSystem(reported);
      if (!claimed || claimed.systemId !== auth.systemId) {
        throw new ExecutionIdentityError(
          'SYSTEM_IDENTITY_MISMATCH',
          `执行面自报系统「${reported}」与令牌系统「${auth.systemName}」不一致`,
        );
      }
    }
    return {
      authMode: 'system-token',
      systemId: auth.systemId,
      sourceSystem: auth.systemId,
      sourceSystemName: auth.systemName,
      legacyUnresolved: false,
    };
  }

  if (!reported) {
    throw new ExecutionIdentityError('INVALID_ARGUMENT', 'sourceSystem 不能为空');
  }
  const resolved = dependencies.findBySourceSystem(reported);
  if (resolved && resolved.status === 'active') {
    return {
      authMode: 'legacy-root',
      systemId: resolved.systemId,
      sourceSystem: resolved.systemId,
      sourceSystemName: resolved.name,
      legacyUnresolved: false,
    };
  }
  return {
    authMode: 'legacy-root',
    systemId: null,
    sourceSystem: reported,
    sourceSystemName: reported,
    legacyUnresolved: true,
  };
}
