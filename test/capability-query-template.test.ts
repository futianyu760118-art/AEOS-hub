import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCapabilityQueryTemplate,
  parseCapabilityQueryTemplates,
  renderCapabilityQuery,
  CapabilityQueryTemplateError,
} from '../src/capability-query-template.ts';

const template = parseCapabilityQueryTemplate({
  capability: 'query_plm',
  version: '1.0.0',
  title: '查询 PLM 研发项目',
  domain: 'plm',
  providerSystem: 'hengjian-plm',
  providerAgentId: 'runtime-execution-query',
  readOnly: true,
  requestTemplate: {
    path: '/project/page/{{keyword}}',
    params: {
      keyword: '{{keyword}}',
      pageNum: '{{pageNum}}',
      pageSize: '{{pageSize}}',
      filter: { value: '{{keyword}}' },
    },
  },
  parameterSchema: {
    type: 'object',
    required: ['keyword'],
    properties: {
      keyword: { type: 'string', maxLength: 160 },
      pageNum: { type: 'integer' },
      pageSize: { type: 'integer' },
    },
  },
  parameterDefaults: { pageNum: 1, pageSize: 5 },
});

test('解析合法只读能力模板', () => {
  assert.equal(template.capability, 'query_plm');
  assert.equal(template.readOnly, true);
  assert.equal(template.providerAgentId, 'runtime-execution-query');
});

test('非只读模板和重复能力拒绝', () => {
  assert.throws(
    () => parseCapabilityQueryTemplate({ ...template, readOnly: false }),
    (error: unknown) => error instanceof CapabilityQueryTemplateError && error.code === 'INVALID_TEMPLATE',
  );
  assert.throws(
    () => parseCapabilityQueryTemplates([template, template]),
    (error: unknown) => error instanceof CapabilityQueryTemplateError && /重复的 capability/.test(error.message),
  );
});

test('参数默认值补齐且占位符保留原始类型', () => {
  const rendered = renderCapabilityQuery(template, { keyword: 'HJ.26033.V1.256JY' });
  assert.equal(rendered.path, `/project/page/${encodeURIComponent('HJ.26033.V1.256JY')}`);
  assert.deepEqual(rendered.params, {
    keyword: 'HJ.26033.V1.256JY',
    pageNum: 1,
    pageSize: 5,
    filter: { value: 'HJ.26033.V1.256JY' },
  });
});

test('未知参数和 schema 错误拒绝', () => {
  assert.throws(
    () => renderCapabilityQuery(template, { keyword: 'X', unknown: true }),
    (error: unknown) => error instanceof CapabilityQueryTemplateError && error.code === 'INVALID_ARGUMENT',
  );
  assert.throws(
    () => renderCapabilityQuery(template, {}),
    (error: unknown) => error instanceof CapabilityQueryTemplateError && error.code === 'INVALID_ARGUMENT',
  );
});
