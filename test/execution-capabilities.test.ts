import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveExecutionQuery,
  deriveExecutionReasoning,
  hasExecutionCapability,
  registerExecutionCapability,
  resolveExecutionDispatch,
  validateQueryInput,
  validateReasoningInput,
} from '../src/execution-capabilities.ts';

test('内置能力 query_control_platform 已注册', () => {
  assert.equal(hasExecutionCapability('query_control_platform'), true);
});

test('kitting source 派生齐套查询（entityId 含冒号拆 demand_no/demand_line_no）', () => {
  const q = deriveExecutionQuery('business://kitting/HJY20260903-261%3A18');
  assert.deepEqual(q, {
    path: '/external/material-kitting/results',
    params: { demand_no: 'HJY20260903-261', demand_line_no: '18' },
  });
});

test('kitting source 无冒号时只有 demand_no', () => {
  const q = deriveExecutionQuery('business://kitting/HJ202607-0007-0148');
  assert.deepEqual(q, {
    path: '/external/material-kitting/results',
    params: { demand_no: 'HJ202607-0007-0148' },
  });
});

test('order source 派生订单查询（keyword 模糊匹配）', () => {
  const q = deriveExecutionQuery('business://order/SO-2609-001');
  assert.deepEqual(q, { path: '/external/orders/list', params: { keyword: 'SO-2609-001' } });
});

test('无法解析的 businessObjectRef 抛错', () => {
  assert.throws(() => deriveExecutionQuery('not-a-valid-ref'), /无法解析/);
});

test('未知 source 抛错', () => {
  assert.throws(() => deriveExecutionQuery('business://quality/xxx'), /暂不支持/);
});

test('deriveExecutionQuery 按 intent.sources 派生非中台查询', () => {
  const intent = { paths: [{ path: '/api/boss/orders', label: '订单', sources: [{ source: 'boss_order', param: 'order_no' }] }] };
  assert.deepEqual(deriveExecutionQuery('business://boss_order/BO-1001', intent), { path: '/api/boss/orders', params: { order_no: 'BO-1001' } });
});

test('deriveExecutionQuery 按 intent.sources 的 split 拆分实体 ID', () => {
  const intent = { paths: [{ path: '/api/boss/kitting', label: '齐套', sources: [{ source: 'boss_kitting', param: 'demand_no', lineParam: 'line_no', split: ':' }] }] };
  assert.deepEqual(deriveExecutionQuery('business://boss_kitting/ABC-1:18', intent), { path: '/api/boss/kitting', params: { demand_no: 'ABC-1', line_no: '18' } });
});

test('注册新能力后可解析派单（接新智能体 = 新增一条注册）', () => {
  registerExecutionCapability('analyze_order_risk', (task) => ({ orderNo: task.businessObjectRef.split('/').pop() }));
  assert.equal(hasExecutionCapability('analyze_order_risk'), true);
  const dispatch = resolveExecutionDispatch(
    { businessObjectRef: 'business://order/SO-1', title: '订单风险' },
    'analyze_order_risk',
  );
  assert.deepEqual(dispatch, { capability: 'analyze_order_risk', input: { orderNo: 'SO-1' } });
});

test('未注册能力解析派单抛错', () => {
  assert.throws(
    () => resolveExecutionDispatch({ businessObjectRef: 'business://order/SO-1', title: 'x' }, 'not_registered'),
    /未注册执行面能力/,
  );
});

test('内置能力 reason_control_platform 已注册', () => {
  assert.equal(hasExecutionCapability('reason_control_platform'), true);
});

test('deriveExecutionReasoning 从任务派生受控推理请求', () => {
  const r = deriveExecutionReasoning({ businessObjectRef: 'business://kitting/HJY1%3A18', title: '物料齐套状态 BLOCKED' });
  assert.equal(r.prompt, '物料齐套状态 BLOCKED');
  assert.equal(r.task_type, 'material_kitting_analysis');
  assert.deepEqual(r.context, { businessObjectRef: 'business://kitting/HJY1%3A18' });
  assert.deepEqual(r.constraints, { read_only: true, require_evidence: true });
});

test('resolveExecutionDispatch 能解析推理能力', () => {
  const d = resolveExecutionDispatch({ businessObjectRef: 'business://order/SO-1', title: '订单交付风险' }, 'reason_control_platform');
  assert.equal(d.capability, 'reason_control_platform');
  assert.equal((d.input as { task_type: string }).task_type, 'order_delivery_analysis');
});

test('resolveExecutionDispatch 通用回退：带 intent 的非中台查询能力按 intent 派生', () => {
  const intent = { paths: [{ path: '/api/plm/project', label: '研发项目', sources: [{ source: 'plm_project', param: 'project_no' }] }] };
  const d = resolveExecutionDispatch({ businessObjectRef: 'business://plm_project/PJ-1', title: 'x' }, 'query_plm', intent);
  assert.deepEqual(d, { capability: 'query_plm', input: { path: '/api/plm/project', params: { project_no: 'PJ-1' } } });
});

test('resolveExecutionDispatch 通用回退：reason* 能力按推理派生', () => {
  const d = resolveExecutionDispatch({ businessObjectRef: 'business://plm_project/PJ-1', title: '分析' }, 'reason_plm');
  assert.equal(d.capability, 'reason_plm');
  assert.equal((d.input as { task_type: string }).task_type, 'operating_case_analysis');
});

test('validateQueryInput 拒绝白名单外 path', () => {
  assert.equal(validateQueryInput({ path: '/external/orders/delete', params: {} }), '不在只读白名单内的查询 path: /external/orders/delete');
  assert.equal(validateQueryInput({ path: '/external/orders/list', params: {} }), null);
});

test('validateReasoningInput 拒绝写操作、缺 prompt、超大 prompt', () => {
  assert.equal(validateReasoningInput({ prompt: '分析订单', task_type: 'x', constraints: { read_only: false, require_evidence: true } }), '推理能力不允许写操作（constraints.read_only 必须为 true）');
  assert.equal(validateReasoningInput({ prompt: '', task_type: 'x' }), '推理输入缺少 prompt');
  assert.equal(validateReasoningInput({ prompt: 'a'.repeat(2001), task_type: 'x' }), '推理 prompt 过长（最多 2000 字符）');
  assert.equal(validateReasoningInput({ prompt: '分析订单', task_type: 'order_delivery_analysis', constraints: { read_only: true, require_evidence: true } }), null);
});
