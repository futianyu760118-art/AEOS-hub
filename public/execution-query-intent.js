const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_RELATIVE_DAYS = 90;
const MAX_PAGE = 1000;

const INTENTS = [
  { name: 'supplier', test: /供应商|supplier|vendor/i, path: '/external/suppliers/list', label: '供应商' },
  { name: 'kitting', test: /齐套|套料|kitting/i, path: '/external/material-kitting/results', label: '齐套' },
  { name: 'shortage', test: /缺料|短缺|shortage/i, path: '/external/material-kitting/shortages', label: '缺料' },
  { name: 'inventory', test: /库存|可用量|inventory/i, path: '/external/inventory/availability', label: '库存' },
  { name: 'quality', test: /质量|quality/i, path: '/external/quality-issues/list', label: '质量异常' },
  { name: 'production', test: /生产|工单|production/i, path: '/external/production/work-orders/list', label: '生产工单' },
  { name: 'order', test: /订单|order/i, path: '/external/orders/list', label: '订单' },
  { name: 'supply', test: /供给|供应|supply/i, path: '/external/material-supplies/list', label: '物料供给' },
];

const CODE_SOURCE = String.raw`(?:[A-Za-z0-9]+(?:[.:-][A-Za-z0-9]+)+)`;
const IDENTIFIER_RE = new RegExp(`(?<![A-Za-z0-9])(${CODE_SOURCE})(?![A-Za-z0-9])`, 'g');
const QUERY_STOP_WORDS = new Set(['列表', '信息', '情况', '记录', '数据', '供应商', '库存', '订单', '工单']);

function error(message) { return { error: message }; }

function dateOnly(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parsePositiveInteger(raw, maximum, label) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > maximum) return error(`${label}必须是 1–${maximum} 的整数。`);
  return value;
}

function normalizedDate(raw) {
  const match = String(raw).match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function dateRange(text, now) {
  if (/今天/.test(text)) return { start: dateOnly(now), end: dateOnly(now), days: 1 };
  const relative = text.match(/(?:近|最近)\s*(\d+)\s*(?:天|日)/);
  if (relative) {
    const days = parsePositiveInteger(relative[1], MAX_RELATIVE_DAYS, '天数');
    if (typeof days !== 'number') return days;
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start = new Date(end);
    start.setDate(start.getDate() - days + 1);
    return { start: dateOnly(start), end: dateOnly(end), days };
  }
  if (/(?:近|最近)\s*(?:几|多)?\s*(?:天|日)/.test(text)) return error('请明确时间范围，例如“近 3 天”。');
  const explicit = text.match(/(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\s*(?:至|到)\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/);
  if (!explicit) return null;
  const start = normalizedDate(explicit[1]);
  const end = normalizedDate(explicit[2]);
  if (!start || !end) return error('日期格式或日期值无效，请使用 YYYY-MM-DD。');
  if (start > end) return error('开始日期不能晚于结束日期。');
  return { start, end };
}

function pagination(text) {
  const limitMatch = text.match(/(?:前|最多)\s*(\d+)\s*(?:个|条|项|笔|张|单|家)/);
  const pageSize = limitMatch ? parsePositiveInteger(limitMatch[1], MAX_PAGE_SIZE, '查询条数') : null;
  if (pageSize?.error) return pageSize;
  const pageMatch = text.match(/第\s*(\d+)\s*页/);
  const page = pageMatch ? parsePositiveInteger(pageMatch[1], MAX_PAGE, '页码') : 1;
  if (page?.error) return page;
  return { page, page_size: pageSize || DEFAULT_PAGE_SIZE, explicitLimit: Boolean(pageSize) };
}

function withPagination(params, paging) { return { ...params, page: paging.page, page_size: paging.page_size }; }
function identifiers(text) { return [...String(text).matchAll(IDENTIFIER_RE)].map((match) => match[1]); }
function firstCode(text) { return identifiers(text)[0] || ''; }

function codeAfter(text, labels) {
  for (const label of labels) {
    const found = text.match(new RegExp(`${label}\\s*(?:为|是|:|：)?\\s*(${CODE_SOURCE})`, 'i'));
    if (found) return found[1];
  }
  return '';
}

function modelAfter(text) {
  for (const label of ['型号', '规格型号']) {
    const found = text.match(new RegExp(`${label}\\s*(?:为|是|:|：)?\\s*([A-Za-z0-9][A-Za-z0-9.:-]*)`, 'i'));
    if (found) return found[1];
  }
  return '';
}

function phraseAfter(text, labels) {
  for (const label of labels) {
    const found = text.match(new RegExp(`${label}\\s*(?:为|是|:|：)?\\s*[“"]?([\\u4e00-\\u9fffA-Za-z0-9._:-]+)[”"]?`, 'i'));
    const value = found?.[1]?.trim();
    if (value && !QUERY_STOP_WORDS.has(value)) return value;
  }
  return '';
}

function quotedTerm(text) { return text.match(/[“"]([^”"]+)[”"]/)?.[1]?.trim() || ''; }
function requireScope(intent, code, range, paging, filters = false) {
  if (code || range || paging.explicitLimit || filters) return null;
  return error(`请补充${intent.label}的编号、时间范围，或使用“前 N 条”限定查询范围。`);
}
function mappedValue(text, mappings) {
  const values = mappings.filter(([pattern]) => pattern.test(text)).map(([, value]) => value);
  return values.length ? [...new Set(values)].join(',') : '';
}
function dateParams(range, startKey, endKey) { return range ? { [startKey]: range.start, [endKey]: range.end } : {}; }

function kittingFilters(text) {
  const kitStatus = mappedValue(text, [[/阻塞|blocked/i, 'BLOCKED'], [/部分齐套|partial/i, 'PARTIAL'], [/缺料状态|齐套短缺|shortage/i, 'SHORTAGE'], [/完全齐套|已齐套|\bfull\b/i, 'FULL'], [/待计算|待核算|pending/i, 'PENDING']]);
  const risk = mappedValue(text, [[/高风险|\bred\b/i, 'red'], [/中风险|\byellow\b/i, 'yellow'], [/低风险|\bgreen\b/i, 'green']]);
  return { ...(kitStatus ? { kit_status: kitStatus } : {}), ...(risk ? { risk_level: risk } : {}) };
}

function orderFilters(text) {
  const status = mappedValue(text, [[/待评审|待审核|pending_review/i, 'pending_review'], [/进行中|处理中|in_progress/i, 'in_progress'], [/部分关闭|partially_closed/i, 'partially_closed'], [/已完成|完成|completed/i, 'completed'], [/已取消|取消|cancelled/i, 'cancelled']]);
  const risk = mappedValue(text, [[/高风险|\bred\b/i, 'red'], [/中风险|\byellow\b/i, 'yellow'], [/低风险|\bgreen\b/i, 'green']]);
  const customer = codeAfter(text, ['客户编码', '客户']);
  return { ...(status ? { status } : {}), ...(risk ? { risk_level: risk } : {}), ...(customer ? { customer_code: customer } : {}) };
}

function qualityFilters(text) {
  const status = mappedValue(text, [[/未关闭|未结案/i, 'open'], [/未关闭|未结案/i, 'in_progress'], [/未处理|待处理|\bopen\b/i, 'open'], [/处理中|进行中|in_progress/i, 'in_progress'], [/已关闭|已结案|\bclosed\b/i, 'closed']]);
  const defectType = phraseAfter(text, ['缺陷类型']);
  const submitDept = phraseAfter(text, ['提出部门', '部门']);
  return { ...(status ? { status } : {}), ...(defectType ? { defect_type: defectType } : {}), ...(submitDept ? { submit_dept: submitDept } : {}) };
}

function productionFilters(text) {
  const status = mappedValue(text, [[/计划中|planned/i, 'planned'], [/已下达|released/i, 'released'], [/进行中|生产中|in_progress/i, 'in_progress'], [/已完成|完成|completed/i, 'completed'], [/未知|unknown/i, 'unknown']]);
  const workshop = codeAfter(text, ['车间', 'workshop']);
  return { ...(status ? { status } : {}), ...(workshop ? { workshop } : {}) };
}

/** Converts a bounded Chinese read query to a documented execution-plane request. */
export function parseExecutionQuery(text, now = new Date()) {
  const query = String(text || '').trim();
  if (!query) return error('请输入查询内容，例如：查 HJY20260903-261 的缺料。');
  const intent = INTENTS.find((candidate) => candidate.test.test(query));
  if (!intent) return error('没识别出查询类型。可用的：缺料、齐套、订单、库存、供给、质量、生产、供应商。');
  const range = dateRange(query, now);
  if (range?.error) return range;
  const paging = pagination(query);
  if (paging?.error) return paging;
  const materialCode = codeAfter(query, ['物料编码', '物料号', '物料']);
  // 型号是机器编码，必须先用编码规则取值；不能让“的库存”等自然语言后缀混入 keyword。
  const modelOrName = modelAfter(query)
    || phraseAfter(query, ['物料名称', '名称', '关键字']) || quotedTerm(query);
  const genericCode = firstCode(query);

  if (intent.name === 'shortage') {
    const demandNo = codeAfter(query, ['订单号', '销售订单', '需求编号', '需求单']) || (!materialCode && !modelOrName ? genericCode : '');
    const selectedMaterial = materialCode || (/(?:物料|材料)/.test(query) && !modelOrName ? genericCode : '');
    if (modelOrName && !materialCode) return error('缺料查询需提供物料编码或订单/需求编号；当前接口不支持按型号或名称模糊筛选。');
    if (!demandNo && !selectedMaterial) return error('查询缺料请提供订单/需求编号或物料编码，例如：查物料编码 ABC-123 的缺料。');
    return { path: intent.path, params: withPagination({ ...(demandNo ? { demand_no: demandNo } : {}), ...(selectedMaterial ? { material_code: selectedMaterial } : {}), ...(/关键料|关键物料/.test(query) ? { is_key_material: true } : {}) }, paging) };
  }
  if (intent.name === 'kitting') {
    const demand = codeAfter(query, ['订单号', '销售订单', '需求编号', '需求单']) || genericCode;
    if (modelOrName) return error('齐套查询需提供订单/需求编号；当前接口不支持按型号或名称直接筛选。');
    if (!demand) return error('查询齐套请提供订单/需求编号，例如：查 HJY20260903-261:18 的齐套。');
    const [demandNo, demandLineNo] = demand.split(':');
    return { path: intent.path, params: withPagination({ demand_no: demandNo, ...(demandLineNo ? { demand_line_no: demandLineNo } : {}), ...kittingFilters(query), ...dateParams(range, 'required_date_start', 'required_date_end') }, paging) };
  }
  if (intent.name === 'inventory') {
    const warehouse = codeAfter(query, ['仓库', '仓位', 'warehouse']);
    const keyword = modelOrName || (!materialCode ? genericCode : '');
    if (!materialCode && !keyword) return error('查询库存请提供物料编码、型号、名称或关键字，例如：查型号为 JFX27 的库存。');
    return { path: intent.path, params: withPagination({ ...(materialCode ? { material_code: materialCode } : { keyword }), ...(warehouse ? { wh_code: warehouse } : {}) }, paging) };
  }
  if (intent.name === 'supplier') {
    const keyword = phraseAfter(query, ['供应商', 'supplier', 'vendor']) || quotedTerm(query) || genericCode;
    const missing = requireScope(intent, keyword, null, paging);
    if (missing) return missing;
    return { path: intent.path, params: withPagination(keyword ? { keyword } : {}, paging) };
  }
  if (intent.name === 'order') {
    const filters = orderFilters(query);
    const keyword = codeAfter(query, ['订单号', '销售订单', '产品', '型号', '关键字']) || modelOrName || genericCode;
    const missing = requireScope(intent, keyword, range, paging, Object.keys(filters).length > 0);
    if (missing) return missing;
    return { path: intent.path, params: withPagination({ ...(keyword ? { keyword } : {}), ...filters, ...dateParams(range, 'promised_date_start', 'promised_date_end') }, paging) };
  }
  if (intent.name === 'supply') {
    if (modelOrName && !materialCode) return error('供给查询需提供物料编码；当前接口不支持按型号或名称模糊筛选。');
    const supplyNo = codeAfter(query, ['供给单号', '采购单号', '供给单']);
    const code = materialCode || (!supplyNo ? genericCode : '');
    const supplyType = mappedValue(query, [[/采购|purchase/i, 'PURCHASE'], [/委外|外协|outsource/i, 'OUTSOURCE'], [/自制|生产供给/i, 'PRODUCTION'], [/调拨|transfer/i, 'TRANSFER']]);
    const missing = requireScope(intent, code || supplyNo, range, paging, Boolean(supplyType));
    if (missing) return missing;
    return { path: intent.path, params: withPagination({ ...(code ? { material_code: code } : {}), ...(supplyNo ? { supply_no: supplyNo } : {}), ...(supplyType ? { supply_type: supplyType } : {}), ...dateParams(range, 'expected_date_start', 'expected_date_end') }, paging) };
  }
  if (intent.name === 'quality') {
    const filters = qualityFilters(query);
    const issueNo = codeAfter(query, ['异常编号', '问题编号', '质量单号']);
    const orderNo = codeAfter(query, ['订单号', '销售订单']);
    const productCode = codeAfter(query, ['产品编码', '产品号', '物料编码']);
    const fallback = !issueNo && !orderNo && !productCode && !modelOrName ? genericCode : '';
    const identifier = issueNo ? { issue_no: issueNo } : orderNo ? { order_no: orderNo } : productCode ? { product_code: productCode } : fallback ? { order_no: fallback } : {};
    if (modelOrName && !productCode) return error('质量查询请提供产品编码、订单号或异常编号；当前接口不支持按型号或名称模糊筛选。');
    const missing = requireScope(intent, Object.values(identifier)[0], range, paging, Object.keys(filters).length > 0);
    if (missing) return missing;
    return { path: intent.path, params: withPagination({ ...identifier, ...filters, ...dateParams(range, 'occurred_start', 'occurred_end') }, paging) };
  }
  const filters = productionFilters(query);
  const workOrderNo = codeAfter(query, ['工单号', '生产工单', '工单']);
  const orderNo = codeAfter(query, ['订单号', '销售订单']);
  const productCode = codeAfter(query, ['产品编码', '产品号', '物料编码']);
  const fallback = !workOrderNo && !orderNo && !productCode && !modelOrName ? genericCode : '';
  const identifier = workOrderNo ? { work_order_no: workOrderNo } : orderNo ? { order_no: orderNo } : productCode ? { product_code: productCode } : fallback ? { work_order_no: fallback } : {};
  if (modelOrName && !productCode) return error('生产工单查询请提供工单号、订单号或产品编码；当前接口不支持按型号或名称模糊筛选。');
  const missing = requireScope(intent, Object.values(identifier)[0], range, paging, Object.keys(filters).length > 0);
  if (missing) return missing;
  return { path: intent.path, params: withPagination({ ...identifier, ...filters, ...dateParams(range, 'planned_end_start', 'planned_end_end') }, paging) };
}

export function describeExecutionQuery(query) {
  const intent = INTENTS.find((candidate) => candidate.path === query.path);
  const params = query.params || {};
  const filters = Object.entries(params).filter(([key]) => !['page', 'page_size', 'request_id'].includes(key)).map(([key, value]) => `${key}=${value}`);
  return `查询${intent?.label || '业务数据'}${filters.length ? `（${filters.join('，')}）` : ''}；第 ${params.page || 1} 页，最多 ${params.page_size || DEFAULT_PAGE_SIZE} 条`;
}

// ---------- 推理意图（reason_control_platform） ----------
const REASONING_TRIGGERS = /分析|评估|判断|风险|建议|预测|影响|是否|为什么|怎么办|能否|会不会/i;

const REASON_TASK_TYPE_BY_INTENT = {
  order: 'order_delivery_analysis',
  shortage: 'material_kitting_analysis',
  kitting: 'material_kitting_analysis',
  supply: 'supply_analysis',
  inventory: 'inventory_analysis',
  quality: 'quality_analysis',
  production: 'production_analysis',
  supplier: 'supplier_analysis',
};

/** 识别推理型问题，返回受控推理请求；非推理意图返回 null。 */
export function parseExecutionReasoning(text) {
  const query = String(text || '').trim();
  if (!query) return { error: '请输入分析内容，例如：分析订单 HJY20260903-261 的交付风险。' };
  if (!REASONING_TRIGGERS.test(query)) return null;
  const intent = INTENTS.find((candidate) => candidate.test.test(query));
  const task_type = intent ? (REASON_TASK_TYPE_BY_INTENT[intent.name] || 'operating_case_analysis') : 'operating_case_analysis';
  return {
    prompt: query,
    task_type,
    context: {},
    constraints: { read_only: true, require_evidence: true },
  };
}

export function describeExecutionReasoning(request) {
  return `中台推理（${request.task_type}）`;
}

// ---------- 通用关键词回退（按 Agent 注册的 intent 解析，供无 LLM 时兜底） ----------
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const GENERIC_CODE_RE = /(?<![A-Za-z0-9])([A-Za-z0-9]+(?:[.:_-][A-Za-z0-9]+)*)(?![A-Za-z0-9])/;

/** 按 Agent 声明的查询语义（intent）做确定性关键词解析；无法识别时返回 null。 */
export function parseExecutionQueryByIntent(text, intent) {
  const query = String(text || '').trim();
  const paths = intent?.paths;
  if (!query || !Array.isArray(paths) || !paths.length) return null;

  const pathEntry = paths.find((p) => {
    const keywords = [p.label, ...(p.keywords || [])].filter(Boolean);
    return keywords.some((keyword) => query.toLowerCase().includes(String(keyword).toLowerCase()));
  });
  if (!pathEntry) return null;

  const params = {};
  const paramList = Array.isArray(pathEntry.params) ? pathEntry.params : [];
  for (const param of paramList) {
    const labels = [param.label, ...(param.keywords || [])].filter(Boolean);
    for (const label of labels) {
      const match = query.match(new RegExp(`${escapeRegExp(label)}\\s*(?:为|是|:|：)?\\s*([A-Za-z0-9][A-Za-z0-9.:_-]*)`, 'i'));
      if (match) { params[param.name] = match[1]; break; }
    }
  }

  // 兜底：把第一个编码类 token 给第一个参数。
  if (!Object.keys(params).length && paramList.length) {
    const codeMatch = query.match(GENERIC_CODE_RE);
    if (codeMatch) params[paramList[0].name] = codeMatch[1];
  }

  return { path: pathEntry.path, params };
}
