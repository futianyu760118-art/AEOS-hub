import assert from 'node:assert/strict';
import test from 'node:test';
import { looksLikeWriteCommand, parseWriteConfirmation, parseWriteIntentWithLLM } from '../src/write-intent.ts';
import type { WriteCapabilityDescriptor } from '../src/write-request-service.ts';

const CAPABILITY: WriteCapabilityDescriptor = {
  systemId: 'control-platform',
  systemName: '公司中控平台',
  agentId: 'gateway-control-platform',
  agentName: '公司中台系统网关',
  capability: 'write_control_platform',
  operations: ['order.update_note', 'order.update_status', 'order.update_delivery_date'],
  riskLevel: 'low',
  approvalRequired: true,
  inputSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', enum: ['order.update_note', 'order.update_status', 'order.update_delivery_date', 'order.update_owner'] },
      orderNo: { type: 'string' },
      changes: { type: 'object' },
    },
    required: ['operation', 'orderNo', 'changes'],
  },
  operationDetails: [
    { name: 'order.update_note', title: '修改订单备注', keywords: ['备注', '说明'], changesField: 'changes', fields: [{ name: 'remark', label: '备注' }] },
    { name: 'order.update_status', title: '修改订单状态', keywords: ['状态'], changesField: 'changes', fields: [{ name: 'status', label: '状态' }] },
    { name: 'order.update_delivery_date', title: '修改交付日期', keywords: ['交付日期', '交期'], changesField: 'changes', fields: [{ name: 'deliveryDate', label: '交付日期', type: 'date', required: true }] },
    { name: 'order.update_owner', title: '修改订单负责人', keywords: ['负责人'], changesField: 'changes', fields: [{ name: 'owner', label: '负责人' }] },
  ],
};

function fakeFetch(content: unknown, status = 200): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] }),
  })) as unknown as typeof fetch;
}

test('只有写动作 + 业务标识才进入写解析', () => {
  assert.equal(looksLikeWriteCommand('改写订单 HJ202602-0009-0028 的备注为已确认'), true);
  assert.equal(looksLikeWriteCommand('分析订单 HJ202602-0009-0028 的交付风险'), false);
  assert.equal(looksLikeWriteCommand('改写订单的备注为已确认'), false);
});

test('确认与取消单独识别', () => {
  assert.equal(parseWriteConfirmation('确认'), 'confirm');
  assert.equal(parseWriteConfirmation('取消'), 'cancel');
  assert.equal(parseWriteConfirmation('确认一下风险'), null);
});

test('模型按 schema 解析出写操作', async () => {
  const intent = await parseWriteIntentWithLLM(
    '调整订单 HJ202602-0009-0028 的附加信息为 2026-11-10',
    [CAPABILITY],
    {
      apiKey: 'test-key',
      fetchImpl: fakeFetch({
        kind: 'write',
        systemId: 'control-platform',
        capability: 'write_control_platform',
        input: {
          operation: 'order.update_delivery_date',
          orderNo: 'HJ202602-0009-0028',
          changes: { deliveryDate: '2026-11-10' },
        },
      }),
    },
  );
  assert.equal(intent.kind, 'write');
  if (intent.kind !== 'write') return;
  assert.equal(intent.operation, 'order.update_delivery_date');
  assert.deepEqual(intent.input.changes, { deliveryDate: '2026-11-10' });
});

test('模型返回 clarify 时原样转达', async () => {
  const intent = await parseWriteIntentWithLLM('调整订单 HJ202602-0009-0028 的某些东西', [CAPABILITY], {
    apiKey: 'test-key',
    fetchImpl: fakeFetch({ kind: 'clarify', message: '请说明要修改哪个字段' }),
  });
  assert.equal(intent.kind, 'clarify');
  if (intent.kind !== 'clarify') return;
  assert.match(intent.message, /哪个字段/);
});

test('模型给出未声明的操作时要求补充', async () => {
  const intent = await parseWriteIntentWithLLM('调整订单 HJ202602-0009-0028 的删除标记为 是', [CAPABILITY], {
    apiKey: 'test-key',
    fetchImpl: fakeFetch({
      kind: 'write',
      systemId: 'control-platform',
      capability: 'write_control_platform',
      input: { operation: 'order.delete', orderNo: 'HJ202602-0009-0028', changes: {} },
    }),
  });
  assert.equal(intent.kind, 'clarify');
  if (intent.kind !== 'clarify') return;
  assert.match(intent.message, /不支持的操作/);
});

test('输入不符合 schema 时要求补充', async () => {
  const intent = await parseWriteIntentWithLLM('调整订单 HJ202602-0009-0028 的附加信息', [CAPABILITY], {
    apiKey: 'test-key',
    fetchImpl: fakeFetch({
      kind: 'write',
      systemId: 'control-platform',
      capability: 'write_control_platform',
      input: { operation: 'order.update_note', orderNo: 'HJ202602-0009-0028' },
    }),
  });
  assert.equal(intent.kind, 'clarify');
  if (intent.kind !== 'clarify') return;
  assert.match(intent.message, /参数不完整|缺少必要信息/);
});

test('未配置密钥或没有写能力时明确说明', async () => {
  const noKey = await parseWriteIntentWithLLM('调整订单 HJ202602-0009-0028 的附加信息为已确认', [CAPABILITY], { apiKey: '' });
  assert.equal(noKey.kind, 'clarify');
  const noCapability = await parseWriteIntentWithLLM('调整订单 HJ202602-0009-0028 的附加信息为已确认', [], { apiKey: 'test-key' });
  assert.equal(noCapability.kind, 'clarify');
  if (noCapability.kind !== 'clarify') return;
  assert.match(noCapability.message, /没有可用的写能力/);
});

test('模型调用失败时要求稍后重试', async () => {
  const intent = await parseWriteIntentWithLLM('调整订单 HJ202602-0009-0028 的附加信息为已确认', [CAPABILITY], {
    apiKey: 'test-key',
    fetchImpl: fakeFetch('', 500),
  });
  assert.equal(intent.kind, 'clarify');
  if (intent.kind !== 'clarify') return;
  assert.match(intent.message, /稍后重试/);
});

test('提供方声明 operations 后，新写命令无需改 Hub 代码（不调用模型）', async () => {
  const intent = await parseWriteIntentWithLLM('把订单 HJ202602-0009-0028 的负责人改为张三', [CAPABILITY], { apiKey: '' });
  assert.equal(intent.kind, 'write');
  if (intent.kind !== 'write') return;
  assert.equal(intent.operation, 'order.update_owner');
  assert.deepEqual(intent.input, {
    operation: 'order.update_owner',
    orderNo: 'HJ202602-0009-0028',
    changes: { owner: '张三' },
  });
});

test('元数据解析交付日期并规范为 YYYY-MM-DD', async () => {
  const intent = await parseWriteIntentWithLLM('改写订单 HJ202602-0009-0028 的交付日期为 2026年11月10日', [CAPABILITY], { apiKey: '' });
  assert.equal(intent.kind, 'write');
  if (intent.kind !== 'write') return;
  assert.equal(intent.operation, 'order.update_delivery_date');
  assert.deepEqual(intent.input.changes, { deliveryDate: '2026-11-10' });
});

test('元数据缺少必要字段时要求补充', async () => {
  const intent = await parseWriteIntentWithLLM('改写订单 HJ202602-0009-0028 的交付日期', [CAPABILITY], { apiKey: '' });
  assert.equal(intent.kind, 'clarify');
  if (intent.kind !== 'clarify') return;
  assert.match(intent.message, /缺少必要信息：交付日期/);
});

test('清空备注解析为空字符串', async () => {
  const intent = await parseWriteIntentWithLLM('把订单 HJ202602-0009-0028 的备注清空', [CAPABILITY], { apiKey: '' });
  assert.equal(intent.kind, 'write');
  if (intent.kind !== 'write') return;
  assert.deepEqual(intent.input.changes, { remark: '' });
});

test('交付日期支持斜杠格式并规范化', async () => {
  const intent = await parseWriteIntentWithLLM('改写订单 HJ202602-0009-0028 的交付日期为 2026/11/10', [CAPABILITY], { apiKey: '' });
  assert.equal(intent.kind, 'write');
  if (intent.kind !== 'write') return;
  assert.deepEqual(intent.input.changes, { deliveryDate: '2026-11-10' });
});
