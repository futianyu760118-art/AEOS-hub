import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAgainstSchema, type Schema } from '../src/schema-validation.ts';

const querySchema: Schema = {
  type: 'object',
  properties: {
    path: { type: 'string', enum: ['/external/orders/list', '/external/inventory/availability'] },
    params: { type: 'object' },
  },
  required: ['path'],
};

test('object 类型通过/拒绝', () => {
  assert.equal(validateAgainstSchema({ path: '/external/orders/list', params: {} }, querySchema), null);
  assert.match(validateAgainstSchema('not-an-object', querySchema)!, /期望 object/);
  assert.match(validateAgainstSchema(null, querySchema)!, /期望 object/);
  assert.match(validateAgainstSchema([], querySchema)!, /期望 object/);
});

test('required 字段缺失报错', () => {
  assert.match(validateAgainstSchema({ params: {} }, querySchema)!, /缺少必填字段 path/);
});

test('string enum 越界拒绝', () => {
  assert.match(validateAgainstSchema({ path: '/external/orders/delete' }, querySchema)!, /不在允许范围/);
});

test('string maxLength 拒绝', () => {
  const schema: Schema = { type: 'string', maxLength: 3 };
  assert.equal(validateAgainstSchema('abc', schema), null);
  assert.match(validateAgainstSchema('abcd', schema)!, /超过上限 3/);
});

test('number enum 校验', () => {
  const schema: Schema = { type: 'number', enum: [1, 2, 3] };
  assert.equal(validateAgainstSchema(2, schema), null);
  assert.match(validateAgainstSchema(5, schema)!, /不在允许范围/);
  assert.match(validateAgainstSchema('2', schema)!, /期望 number/);
});

test('integer 类型校验', () => {
  const schema: Schema = { type: 'integer', enum: [0, 1, 2] };
  assert.equal(validateAgainstSchema(2, schema), null);
  assert.match(validateAgainstSchema(2.5, schema)!, /期望 integer/);
  assert.match(validateAgainstSchema('2', schema)!, /期望 integer/);
  assert.match(validateAgainstSchema(5, schema)!, /不在允许范围/);
});

test('boolean 类型校验', () => {
  assert.equal(validateAgainstSchema(true, { type: 'boolean' }), null);
  assert.match(validateAgainstSchema(1, { type: 'boolean' })!, /期望 boolean/);
});

test('array + items + minItems', () => {
  const schema: Schema = {
    type: 'array',
    minItems: 1,
    items: { type: 'object', properties: { evidence_refs: { type: 'array', minItems: 1 } }, required: ['evidence_refs'] },
  };
  assert.equal(validateAgainstSchema([{ evidence_refs: ['x'] }], schema), null);
  assert.match(validateAgainstSchema([], schema)!, /小于最小要求 1/);
  assert.match(validateAgainstSchema([{ matter: 'x' }], schema)!, /第 0 项/);
});

test('嵌套字段错误带路径前缀', () => {
  const schema: Schema = {
    type: 'object',
    properties: { conclusions: { type: 'array', items: { type: 'object', required: ['evidence_refs'] } } },
  };
  const issue = validateAgainstSchema({ conclusions: [{}] }, schema);
  assert.ok(issue && /conclusions/.test(issue));
});

test('未知字段默认放行（向前兼容）', () => {
  assert.equal(validateAgainstSchema({ path: '/external/orders/list', extra: 1, context: {} }, querySchema), null);
});

test('不支持的 type 报错', () => {
  assert.match(validateAgainstSchema({}, { type: 'symbol' as never })!, /不支持的 schema type/);
});
