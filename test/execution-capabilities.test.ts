import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveExecutionQuery,
  hasExecutionCapability,
  registerExecutionCapability,
  resolveExecutionDispatch,
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
