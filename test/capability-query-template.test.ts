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

test('path 可引用受 schema 枚举保护的参数', () => {
  const generic = parseCapabilityQueryTemplate({
    capability: 'query_control_platform',
    version: '1.0.0',
    title: '查询中台只读业务数据',
    domain: 'control-platform',
    providerSystem: 'control-platform',
    providerAgentId: 'runtime-control-platform-query',
    readOnly: true,
    requestTemplate: { path: '{{path}}', params: '{{params}}' },
    parameterSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', enum: ['/external/orders/list', '/external/materials/list'] },
        params: { type: 'object' },
      },
    },
    parameterDefaults: { params: {} },
  });

  const rendered = renderCapabilityQuery(generic, {
    path: '/external/orders/list',
    params: { page: 1, page_size: 5 },
  });
  assert.deepEqual(rendered, {
    path: '/external/orders/list',
    params: { page: 1, page_size: 5 },
  });

  assert.throws(
    () => renderCapabilityQuery(generic, { path: '/not/allowed' }),
    (error: unknown) => error instanceof CapabilityQueryTemplateError && error.code === 'INVALID_ARGUMENT',
  );
});

test('path 占位符引用未定义参数时模板拒绝', () => {
  assert.throws(
    () => parseCapabilityQueryTemplate({
      capability: 'bad_path_template',
      version: '1.0.0',
      title: 'bad',
      domain: 'test',
      providerSystem: 'test',
      readOnly: true,
      requestTemplate: { path: '{{endpoint}}', params: {} },
      parameterSchema: {
        type: 'object',
        required: ['path'],
        properties: { path: { type: 'string' } },
      },
    }),
    (error: unknown) => error instanceof CapabilityQueryTemplateError && /引用的参数未定义/.test(error.message),
  );
});

