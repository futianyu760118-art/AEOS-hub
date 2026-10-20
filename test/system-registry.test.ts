import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SystemRegistry,
  SystemRegistryError,
  SystemSnapshotSchema,
} from '../src/system-registry.ts';

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-systems-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clock = { current: new Date('2026-10-20T09:00:00.000Z') };
  let revision = 0;
  const registry = new SystemRegistry({
    file: join(dir, 'systems.json'),
    clock: () => clock.current,
  });
  return { dir, registry, clock, revision };
}

test('ensure 补齐三个默认系统', (t) => {
  const { registry } = fixture(t);
  const snapshot = registry.ensure();
  assert.equal(snapshot.systems.length, 3);
  assert.deepEqual(snapshot.systems.map((system) => system.systemId).sort(), ['aeos-hub', 'control-platform', 'hengjian-plm']);
  assert.doesNotThrow(() => SystemSnapshotSchema.parse(snapshot));
});

test('get/list 能按系统 ID 查询', (t) => {
  const { registry } = fixture(t);
  registry.ensure();
  assert.equal(registry.get('control-platform')?.name, '公司中控平台');
  assert.equal(registry.get('missing'), null);
  assert.deepEqual(registry.list().map((system) => system.systemId), ['aeos-hub', 'control-platform', 'hengjian-plm']);
});

test('findBySourceSystem 按执行面自报名称归一', (t) => {
  const { registry } = fixture(t);
  registry.ensure();
  assert.equal(registry.findBySourceSystem('公司中控平台（本机演示）')?.systemId, 'control-platform');
  assert.equal(registry.findBySourceSystem('公司中控平台')?.systemId, 'control-platform');
  assert.equal(registry.findBySourceSystem('恒剑PLM')?.systemId, 'hengjian-plm');
  assert.equal(registry.findBySourceSystem('未知系统'), null);
});

test('upsert 新增并保留 createdAt，revision 递增', (t) => {
  const { registry, clock } = fixture(t);
  const first = registry.ensure();
  const created = registry.upsert({
    systemId: 'mes',
    name: 'MES 系统',
    tenantId: 'pilot-default',
    owner: '制造团队',
    sourceSystemAliases: ['MES'],
  });
  assert.equal(created.systemId, 'mes');
  assert.equal(created.createdAt, clock.current.toISOString());
  const updated = registry.upsert({
    systemId: 'mes',
    name: 'MES 制造执行系统',
    tenantId: 'pilot-default',
    owner: '制造团队',
  });
  assert.equal(updated.name, 'MES 制造执行系统');
  assert.equal(updated.createdAt, created.createdAt);
  assert.ok(registry.load().revision > first.revision);
});

test('非法 upsert 被拒绝', (t) => {
  const { registry } = fixture(t);
  assert.throws(() => registry.upsert({ systemId: '', name: 'x', tenantId: 'pilot-default' }), (error: unknown) => error instanceof SystemRegistryError);
  assert.throws(() => registry.upsert({ systemId: 'x', name: 'x', tenantId: 'pilot-default', status: 'deleted' }), (error: unknown) => error instanceof SystemRegistryError);
});

test('重复 systemId 的快照被 schema 拒绝', (t) => {
  const { registry } = fixture(t);
  const snapshot = registry.ensure();
  const duplicated = {
    ...snapshot,
    systems: [snapshot.systems[0], snapshot.systems[0]],
    revision: snapshot.revision + 1,
  };
  assert.throws(() => registry.save(duplicated));
});

test('损坏文件被隔离，ensure 重新补种', (t) => {
  const { dir, registry } = fixture(t);
  registry.ensure();
  writeFileSync(registry.file, '{ not json', 'utf8');
  const loaded = registry.load();
  assert.deepEqual(loaded.systems, []);
  const quarantined = readdirSync(dir).filter((name) => name.includes('corrupt-'));
  assert.equal(quarantined.length, 1);
  const rebuilt = registry.ensure();
  assert.equal(rebuilt.systems.length, 3);
});
