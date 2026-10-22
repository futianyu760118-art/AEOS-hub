import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCapabilityParams, matchCapabilityTemplate, summarizeCapabilityResult } from '../public/capability-template-intent.js';

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
  display: {
    title: ['projectName', 'projectNo'],
    fields: ['projectNo', 'projectName', 'status', 'currentGate', 'owner', 'projectType', 'orderAmount'],
    labels: {
      projectNo: '项目号',
      projectName: '项目名称',
      status: '状态',
      currentGate: '当前阶段',
      owner: '负责人',
      projectType: '项目类型',
      orderAmount: '订单金额',
      data_as_of: '数据时间',
      data_confidence: '数据置信度',
      stale: '是否过期',
    },
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

test('按模板 display 输出可读摘要，不直接展示整段 JSON', () => {
  const summary = summarizeCapabilityResult({
    total: 1,
    items: [{
      projectNo: 'HJ.26033.V1.256JY',
      projectName: 'X系列7代可拆卸电池',
      status: 'ACTIVE',
      currentGate: 'G1',
      owner: '虞周峰',
      projectType: '客制',
      orderAmount: 2368000,
    }],
    data_as_of: '2026-10-22T08:32:00.626Z',
    data_confidence: 'high',
    stale: false,
  }, PLM_TEMPLATE);
  assert.match(summary, /查询完成：共 1 条/);
  assert.match(summary, /项目号：HJ\.26033\.V1\.256JY/);
  assert.match(summary, /负责人：虞周峰/);
  assert.match(summary, /订单金额：2,368,000/);
  assert.match(summary, /是否过期：否/);
  assert.doesNotMatch(summary, /"items"\s*:/);
});

