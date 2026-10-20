import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUSINESS_DOMAINS,
  domainIdToSquadId,
  getDomain,
  isDomainId,
  normalizeDomainIds,
  squadIdToDomainId,
} from '../src/domain-registry.ts';

test('业务域包含四个一等域与跨域', () => {
  assert.deepEqual(BUSINESS_DOMAINS.map((domain) => domain.domainId), ['order', 'kitting', 'quality', 'production', 'cross-domain']);
  assert.equal(getDomain('order')?.name, '订单交付');
  assert.equal(getDomain('cross-domain')?.name, '跨域/中枢');
  assert.equal(getDomain('unknown'), null);
});

test('旧 Agent 小队 ID 能映射到业务域', () => {
  assert.equal(squadIdToDomainId('business-squad-orders'), 'order');
  assert.equal(squadIdToDomainId('business-squad-material-kitting'), 'kitting');
  assert.equal(squadIdToDomainId('business-squad-quality'), 'quality');
  assert.equal(squadIdToDomainId('business-squad-production'), 'production');
  assert.equal(squadIdToDomainId('unknown-squad'), null);
  assert.equal(domainIdToSquadId('cross-domain'), null);
});

test('isDomainId 只认已登记域', () => {
  assert.equal(isDomainId('order'), true);
  assert.equal(isDomainId('cross-domain'), true);
  assert.equal(isDomainId('unknown'), false);
  assert.equal(isDomainId(null), false);
});

test('normalizeDomainIds 去重、过滤未知域并强制包含主属域', () => {
  assert.deepEqual(normalizeDomainIds('cross-domain', ['order', 'order', 'unknown', 'kitting']), ['cross-domain', 'order', 'kitting']);
  assert.deepEqual(normalizeDomainIds('order', ['kitting']), ['order', 'kitting']);
  assert.deepEqual(normalizeDomainIds(null, ['quality', 'quality']), ['quality']);
  assert.deepEqual(normalizeDomainIds('unknown', ['order']), ['order']);
  assert.deepEqual(normalizeDomainIds(null, 'not-array'), []);
});
