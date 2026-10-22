import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCapabilityParams, matchCapabilityTemplate } from '../public/capability-template-intent.js';

const PLM_TEMPLATE = {
  capability: 'query_plm',
  title: '查询 PLM 研发项目',
  parameterSchema: {
    type: 'object',
    required: ['keyword'],
    properties: {
      keyword: { type: 'string' },
      pageNum: { type: 'integer' },
      pageSize: { type: 'integer' },
    },
  },
  parameterDefaults: { pageNum: 1, pageSize: 5 },
  intent: {
    keywords: ['PLM', '研发项目', '研发', '项目', '图纸', '立项'],
    parameterHints: { keyword: 'identifier' },
  },
};

test('按模板关键词匹配 PLM 查询', () => {
  assert.equal(matchCapabilityTemplate('查 PLM 项目 HJ.26033.V1.256JY', [PLM_TEMPLATE])?.capability, 'query_plm');
  assert.equal(matchCapabilityTemplate('看看研发项目 HJ.26033.V1.256JY', [PLM_TEMPLATE])?.capability, 'query_plm');
  assert.equal(matchCapabilityTemplate('今天天气怎么样', [PLM_TEMPLATE]), null);
});

test('按 parameterHints 提取编号并补默认分页', () => {
  assert.deepEqual(buildCapabilityParams('查 PLM 项目 HJ.26033.V1.256JY', PLM_TEMPLATE), {
    keyword: 'HJ.26033.V1.256JY',
    pageNum: 1,
    pageSize: 5,
  });
});

test('缺少必填参数返回 null', () => {
  assert.equal(buildCapabilityParams('查 PLM 项目', PLM_TEMPLATE), null);
});

test('没有 intent 的模板不参与自然语言匹配', () => {
  assert.equal(matchCapabilityTemplate('查订单', [{ capability: 'query_x', parameterSchema: { type: 'object' } }]), null);
});
