// 每系统令牌派生/校验：让「系统自助增删本系统 Agent」的控制面能区分令牌属于哪个系统。
// 根密钥仍是单一 EXECUTION_PLANE_TOKEN；每个系统的子令牌 = HMAC-SHA256(root, "aeos-system-token:<systemId>")。
// 无状态：不新增存储/环境变量；根密钥持有者（管理面）可派生任意系统令牌，系统只持自己的令牌、无法伪造他系统。
import { createHmac, timingSafeEqual } from 'node:crypto';

export function deriveSystemToken(rootSecret: string, systemId: string): string {
  return createHmac('sha256', rootSecret).update(`aeos-system-token:${systemId}`).digest('hex');
}

export function verifySystemToken(rootSecret: string, systemId: string, token: string): boolean {
  if (!rootSecret || !systemId || !token) return false;
  const expected = Buffer.from(deriveSystemToken(rootSecret, systemId), 'hex');
  const actual = Buffer.from(token, 'hex');
  // 非 hex 输入经 Buffer.from(..., 'hex') 会得到短 buffer，长度不匹配直接拒绝，避免异常。
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
