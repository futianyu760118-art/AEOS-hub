import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ExecutionIdentityError,
  resolveExecutionPlaneAuth,
  resolveRegistrationIdentity,
  type RegisteredSystem,
} from '../src/execution-identity.ts';

const SYSTEMS: Record<string, RegisteredSystem> = {
  'control-platform': { systemId: 'control-platform', name: '公司中控平台', status: 'active' },
  'hengjian-plm': { systemId: 'hengjian-plm', name: '恒剑 PLM', status: 'active' },
  disabled: { systemId: 'disabled', name: '停用系统', status: 'disabled' },
};

function authDeps(overrides: Partial<{ verify: (systemId: string, token: string) => boolean }> = {}) {
  return {
    rootSecret: 'root-secret',
    verifySystemToken: overrides.verify ?? ((systemId: string, token: string) => token === `token-${systemId}`),
    getSystem: (systemId: string) => SYSTEMS[systemId] ?? null,
  };
}

const findBySourceSystem = (sourceSystem: string): RegisteredSystem | null => {
  if (sourceSystem === '公司中控平台（本机演示）' || sourceSystem === '公司中控平台') return SYSTEMS['control-platform']!;
  if (sourceSystem === '恒剑PLM') return SYSTEMS['hengjian-plm']!;
  if (sourceSystem === '停用系统') return SYSTEMS.disabled!;
  return null;
};

test('系统令牌鉴权：有效令牌返回规范系统身份', () => {
  const auth = resolveExecutionPlaneAuth({ systemId: 'control-platform', systemToken: 'token-control-platform' }, authDeps());
  assert.deepEqual(auth, { mode: 'system-token', systemId: 'control-platform', systemName: '公司中控平台' });
});

test('系统令牌无效时拒绝，且不回退 legacy 根令牌', () => {
  assert.equal(resolveExecutionPlaneAuth({ systemId: 'control-platform', systemToken: 'wrong', legacyToken: 'root-secret' }, authDeps()), null);
  assert.equal(resolveExecutionPlaneAuth({ systemId: 'control-platform' }, authDeps()), null);
  assert.equal(resolveExecutionPlaneAuth({ systemToken: 'token-control-platform' }, authDeps()), null);
});

test('停用系统或未登记系统拒绝鉴权', () => {
  assert.equal(resolveExecutionPlaneAuth({ systemId: 'disabled', systemToken: 'token-disabled' }, authDeps()), null);
  assert.equal(resolveExecutionPlaneAuth({ systemId: 'unknown', systemToken: 'token-unknown' }, authDeps()), null);
});

test('legacy 根令牌仍可连接，错误根令牌拒绝', () => {
  assert.deepEqual(resolveExecutionPlaneAuth({ legacyToken: 'root-secret' }, authDeps()), {
    mode: 'legacy-root', systemId: null, systemName: null,
  });
  assert.equal(resolveExecutionPlaneAuth({ legacyToken: 'other' }, authDeps()), null);
});

test('系统令牌注册：忽略自报值并使用令牌系统', () => {
  const identity = resolveRegistrationIdentity(
    { mode: 'system-token', systemId: 'control-platform', systemName: '公司中控平台' },
    '',
    { findBySourceSystem },
  );
  assert.deepEqual(identity, {
    authMode: 'system-token',
    systemId: 'control-platform',
    sourceSystem: 'control-platform',
    sourceSystemName: '公司中控平台',
    legacyUnresolved: false,
  });
});

test('系统令牌注册：自报同系统别名允许', () => {
  const identity = resolveRegistrationIdentity(
    { mode: 'system-token', systemId: 'control-platform', systemName: '公司中控平台' },
    '公司中控平台（本机演示）',
    { findBySourceSystem },
  );
  assert.equal(identity.systemId, 'control-platform');
});

test('系统令牌注册：冒用其他系统被拒绝', () => {
  assert.throws(
    () => resolveRegistrationIdentity(
      { mode: 'system-token', systemId: 'control-platform', systemName: '公司中控平台' },
      '恒剑PLM',
      { findBySourceSystem },
    ),
    (error: unknown) => error instanceof ExecutionIdentityError && error.code === 'SYSTEM_IDENTITY_MISMATCH',
  );
  assert.throws(
    () => resolveRegistrationIdentity(
      { mode: 'system-token', systemId: 'control-platform', systemName: '公司中控平台' },
      '临时伪装系统',
      { findBySourceSystem },
    ),
    (error: unknown) => error instanceof ExecutionIdentityError && error.code === 'SYSTEM_IDENTITY_MISMATCH',
  );
});

test('legacy 注册：自报名称能解析到系统登记时归一到 systemId', () => {
  const identity = resolveRegistrationIdentity(
    { mode: 'legacy-root', systemId: null, systemName: null },
    '公司中控平台（本机演示）',
    { findBySourceSystem },
  );
  assert.deepEqual(identity, {
    authMode: 'legacy-root',
    systemId: 'control-platform',
    sourceSystem: 'control-platform',
    sourceSystemName: '公司中控平台',
    legacyUnresolved: false,
  });
});

test('legacy 注册：无法解析时保留自报值并标记待补充', () => {
  const identity = resolveRegistrationIdentity(
    { mode: 'legacy-root', systemId: null, systemName: null },
    '临时系统',
    { findBySourceSystem },
  );
  assert.deepEqual(identity, {
    authMode: 'legacy-root',
    systemId: null,
    sourceSystem: '临时系统',
    sourceSystemName: '临时系统',
    legacyUnresolved: true,
  });
  assert.throws(
    () => resolveRegistrationIdentity({ mode: 'legacy-root', systemId: null, systemName: null }, ' ', { findBySourceSystem }),
    (error: unknown) => error instanceof ExecutionIdentityError && error.code === 'INVALID_ARGUMENT',
  );
});
