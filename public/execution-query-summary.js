import { validateExecutionQueryResponse } from './execution-query-validation.js?v=execution-query-validation-v1-20261014';

// 已知字段的中文标签（中台等系统的兜底）；未收录的字段键原样展示。
const FIELD_LABELS = {
  demand_no: '需求单号', demand_line_no: '需求行号', material_code: '物料编码', material_name: '物料名称',
  required_qty: '需求量', available_qty: '可用量', future_supply_qty: '未来供给量', shortage_qty: '缺料量',
  required_date: '需求日期', estimated_available_date: '预计可用日期', shortage_reason: '缺料原因',
  owner_department: '责任部门', kit_status: '齐套状态', kit_rate_by_item: '齐套率（按物料）', kit_rate_by_qty: '齐套率（按数量）',
  shortage_item_count: '缺料物料数', shortage_amount: '缺料金额', risk_level: '风险等级',
  on_hand_qty: '现存量', locked_qty: '锁定量', qty_in_transit: '在途量', wh_code: '仓库',
  order_no: '订单号', customer: '客户', customer_code: '客户编码', product_code: '产品编码', product_name: '产品名称',
  status: '状态', promised_date: '合同交期', order_amount: '订单金额', amount: '金额',
  supply_no: '供给单号', supply_line_no: '供给行号', supply_type: '供给类型', supply_qty: '供给数量',
  expected_available_date: '预计可用日期', confirmed_available_date: '确认可用日期', supply_status: '供给状态',
  issue_no: '异常编号', defect_type: '缺陷类型', submit_dept: '提出部门', occurred_at: '发生日期', occurred_date: '发生日期',
  work_order_no: '工单号', workshop: '车间', workshop_code: '车间', planned_end_date: '计划完工日期',
  planned_end: '计划完工日期', task_qty: '任务数量', actual_qty: '实际数量',
  supplier_code: '供应商编码', supplier_name: '供应商', supplier_short: '供应商简称',
};

function present(value) { return value !== undefined && value !== null && value !== ''; }
function rowTitle(item, candidates, fallback) { return candidates.map((key) => item[key]).find(present) || fallback; }
function rowDetails(item, fields) {
  return fields.filter((key) => present(item[key])).map((key) => `${FIELD_LABELS[key] || key}：${item[key]}`).join('，');
}

/** 把查询结果转成可读中文摘要；标题/字段由 Agent 注册的 intent.output 提供，缺省则泛化渲染。 */
export function summarizeExecutionResult(path, data, requestParams = {}, intent) {
  // 泛化：结果不是 {items:[...]} 分页结构时，直接通用提示（原始数据由调用方 <details> 兜底展示）。
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.items)) {
    return '查询完成，返回结果见下方原始数据。';
  }

  const response = validateExecutionQueryResponse(path, requestParams, data);
  const { items, total, page, pageSize, returned, issues } = response;
  const paginationFact = `本页返回 ${returned} 条（第 ${page} 页，每页 ${pageSize} 条）；符合当前条件共 ${total} 条`;
  const validationNotice = issues.length ? `\n数据校验提示：${issues.map((issue) => issue.message).join('；')}` : '';
  if (!items.length) return `${paginationFact}。\n没有查到相关记录。${validationNotice}`;

  const cap = items.slice(0, 12);
  const hiddenOnPage = items.length - cap.length;
  const remainingAfterPage = Math.max(0, total - ((page - 1) * pageSize + returned));
  const remainder = `${hiddenOnPage ? `\n本页还有 ${hiddenOnPage} 条未展开。` : ''}${remainingAfterPage ? `\n另有 ${remainingAfterPage} 条匹配记录，可查询第 ${page + 1} 页。` : ''}`;

  const output = intent?.paths?.find((candidate) => typeof path === 'string' && path.includes(candidate.path))?.output;
  const titleKeys = output?.title?.length ? output.title : ['name', 'material_name', 'order_no', 'demand_no'];
  const fieldKeys = output?.fields?.length ? output.fields : Object.keys(items[0] || {}).slice(0, 8);
  const lines = cap.map((item, index) => {
    const title = rowTitle(item, titleKeys, `记录 ${index + 1}`);
    const details = rowDetails(item, fieldKeys);
    return `${index + 1}. ${title}${details ? `（${details}）` : ''}`;
  });
  return `${paginationFact}：\n${lines.join('\n')}${remainder}${validationNotice}`;
}

/** 把推理能力结果转成可读中文摘要。 */
export function summarizeReasoningResult(result) {
  const summary = typeof result?.summary === 'string' ? result.summary : '';
  const conclusions = Array.isArray(result?.conclusions) ? result.conclusions : [];
  const dataAsOf = typeof result?.data_as_of === 'string' ? result.data_as_of : '';
  const confidence = typeof result?.data_confidence === 'string' ? result.data_confidence : '';
  const validationNote = typeof result?.validation_note === 'string' ? result.validation_note : '';

  const lines = [];
  if (summary) lines.push(`结论：${summary}`);
  conclusions.forEach((conclusion, index) => {
    const matter = conclusion?.matter || `结论 ${index + 1}`;
    lines.push(`${index + 1}. ${matter}`);
    if (conclusion?.risk) lines.push(`   风险：${conclusion.risk}`);
    if (conclusion?.recommendation) lines.push(`   建议：${conclusion.recommendation}`);
    if (conclusion?.confidence) lines.push(`   置信度：${conclusion.confidence}`);
    if (Array.isArray(conclusion?.evidence_refs) && conclusion.evidence_refs.length) lines.push(`   证据：${conclusion.evidence_refs.join('；')}`);
  });
  if (dataAsOf) lines.push(`数据时间：${dataAsOf}`);
  if (confidence) lines.push(`数据置信度：${confidence}`);
  if (validationNote) lines.push(`校验说明：${validationNote}`);
  return lines.length ? lines.join('\n') : '推理未返回有效结论。';
}
