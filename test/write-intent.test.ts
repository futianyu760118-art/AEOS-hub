import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWriteIntent } from '../src/write-intent.ts';

test('解析订单交付日期修改', () => {
  assert.deepEqual(parseWriteIntent('改写订单 HJ202602-0009-0028 的交付日期为 2026-11-10'), {
    kind: 'write',
    operation: 'order.update_delivery_date',
    orderNo: 'HJ202602-0009-0028',
    changes: { deliveryDate: '2026-11-10' },
    raw: '改写订单 HJ202602-0009-0028 的交付日期为 2026-11-10',
  });
});

test('解析订单备注修改', () => {
  const intent = parseWriteIntent('改写 HJ201810-0021-0195 的备注为：客户要求改期');
  assert.equal(intent?.kind, 'write');
  if (intent?.kind !== 'write') return;
  assert.equal(intent.operation, 'order.update_note');
  assert.equal(intent.orderNo, 'HJ201810-0021-0195');
  assert.deepEqual(intent.changes, { remark: '客户要求改期' });
});

test('解析订单状态修改', () => {
  const intent = parseWriteIntent('更新订单 SO-2609-001 状态为 confirmed');
  assert.equal(intent?.kind, 'write');
  if (intent?.kind !== 'write') return;
  assert.equal(intent.operation, 'order.update_status');
  assert.deepEqual(intent.changes, { status: 'confirmed' });
});

test('确认/取消单独识别', () => {
  assert.deepEqual(parseWriteIntent('确认'), { kind: 'confirm' });
  assert.deepEqual(parseWriteIntent('取消'), { kind: 'cancel' });
});

test('缺少订单号或目标值时不解析，交给普通对话', () => {
  assert.equal(parseWriteIntent('帮我看看订单 HJ202602-0009-0028 的风险'), null);
  assert.equal(parseWriteIntent('改写订单 HJ202602-0009-0028 的交付日期'), null);
  assert.equal(parseWriteIntent('改写订单的备注为测试'), null);
});
