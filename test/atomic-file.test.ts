import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, renameSync as realRename, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { atomicWrite } from '../src/atomic-file.ts';

function sandbox(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-atomic-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'store.json');
}

test('写入文件并在覆盖前生成 .bak', (t) => {
  const file = sandbox(t);
  atomicWrite(file, '{"a":1}');
  assert.equal(readFileSync(file, 'utf8'), '{"a":1}');
  assert.equal(existsSync(`${file}.bak`), false);
  atomicWrite(file, '{"a":2}');
  assert.equal(readFileSync(file, 'utf8'), '{"a":2}');
  assert.equal(readFileSync(`${file}.bak`, 'utf8'), '{"a":1}');
});

test('backup=false 时不生成 .bak', (t) => {
  const file = sandbox(t);
  atomicWrite(file, '{"a":1}', { backup: false });
  atomicWrite(file, '{"a":2}', { backup: false });
  assert.equal(readFileSync(file, 'utf8'), '{"a":2}');
  assert.equal(existsSync(`${file}.bak`), false);
});

test('EPERM 等占用错误短重试后成功', (t) => {
  const file = sandbox(t);
  let calls = 0;
  const waits: number[] = [];
  atomicWrite(file, 'ok', {
    rename: (from, to) => {
      calls += 1;
      if (calls <= 2) {
        const error = new Error('locked') as NodeJS.ErrnoException;
        error.code = 'EPERM';
        throw error;
      }
      realRename(from, to);
    },
    wait: (ms) => waits.push(ms),
    waitMs: 10,
  });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [10, 20]);
  assert.equal(readFileSync(file, 'utf8'), 'ok');
});

test('不可重试错误立即失败并清理临时文件', (t) => {
  const file = sandbox(t);
  let calls = 0;
  assert.throws(() => atomicWrite(file, 'x', {
    rename: () => {
      calls += 1;
      const error = new Error('disk full') as NodeJS.ErrnoException;
      error.code = 'ENOSPC';
      throw error;
    },
    wait: () => {},
  }));
  assert.equal(calls, 1);
  assert.equal(readdirSync(dirname(file)).some((name) => name.includes('.tmp')), false);
  assert.equal(existsSync(file), false);
});

test('重试耗尽后抛出并清理临时文件', (t) => {
  const file = sandbox(t);
  let calls = 0;
  assert.throws(() => atomicWrite(file, 'x', {
    rename: () => {
      calls += 1;
      const error = new Error('busy') as NodeJS.ErrnoException;
      error.code = 'EBUSY';
      throw error;
    },
    wait: () => {},
    attempts: 3,
  }));
  assert.equal(calls, 3);
  assert.equal(readdirSync(dirname(file)).some((name) => name.includes('.tmp')), false);
});
