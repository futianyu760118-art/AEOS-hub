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

const RESULT_FORMATS = [
  { path: '/material-kitting/results', title: ['demand_no'], fields: ['demand_line_no', 'kit_status', 'kit_rate_by_item', 'kit_rate_by_qty', 'shortage_item_count', 'shortage_amount', 'required_date', 'risk_level'] },
  { path: '/inventory/availability', title: ['material_name', 'material_code'], fields: ['material_code', 'on_hand_qty', 'locked_qty', 'available_qty', 'qty_in_transit', 'wh_code'] },
  { path: '/orders/list', title: ['order_no'], fields: ['customer', 'customer_code', 'product_name', 'product_code', 'status', 'promised_date', 'order_amount', 'risk_level'] },
  { path: '/material-supplies/list', title: ['supply_no', 'material_name', 'material_code'], fields: ['supply_line_no', 'material_code', 'supply_type', 'supply_qty', 'available_qty', 'expected_available_date', 'confirmed_available_date', 'supplier_name', 'supply_status'] },
  { path: '/quality-issues/list', title: ['issue_no'], fields: ['order_no', 'product_code', 'status', 'defect_type', 'submit_dept', 'occurred_at', 'occurred_date'] },
  { path: '/production/work-orders/list', title: ['work_order_no'], fields: ['order_no', 'product_code', 'status', 'workshop', 'workshop_code', 'planned_end_date', 'planned_end', 'task_qty', 'actual_qty'] },
  { path: '/suppliers/list', title: ['supplier_name', 'supplier_code'], fields: ['supplier_code', 'supplier_short', 'supplier_name'] },
];

function shortageReasonLabel(reason) {
  return ({ NO_SUPPLY: '无供给', SUPPLY_LATE: '供给延后', CAPACITY_SHORT: '产能不足', QUALITY_HOLD: '质量冻结' })[reason] || reason || '';
}

function present(value) { return value !== undefined && value !== null && value !== ''; }
function rowTitle(item, candidates, fallback) { return candidates.map((key) => item[key]).find(present) || fallback; }
function rowDetails(item, fields) {
  return fields.filter((key) => present(item[key])).map((key) => `${FIELD_LABELS[key] || key}：${item[key]}`).join('，');
}

/** Renders the business fields that belong to the endpoint instead of a generic row title. */
export function summarizeExecutionResult(path, data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const total = typeof data?.total === 'number' ? data.total : items.length;
  if (!items.length) return '没有查到相关记录。';
  const cap = items.slice(0, 12);
  const more = total > cap.length;
  if (typeof path === 'string' && path.includes('/material-kitting/shortages')) {
    const totalQty = items.reduce((sum, item) => sum + (Number(item.shortage_qty) || 0), 0);
    const lines = cap.map((item, index) => {
      const title = rowTitle(item, ['material_name', 'material_code'], `记录 ${index + 1}`);
      const details = rowDetails(item, ['material_code', 'shortage_qty', 'available_qty', 'future_supply_qty', 'required_date', 'estimated_available_date', 'shortage_reason', 'owner_department']);
      const normalized = details.replace(`缺料原因：${item.shortage_reason}`, `缺料原因：${shortageReasonLabel(item.shortage_reason)}`);
      return `${index + 1}. ${title}${normalized ? `（${normalized}）` : ''}`;
    });
    return `查到缺料记录 ${total} 条，当前页合计缺料 ${totalQty} 件：\n${lines.join('\n')}${more ? `\n…其余 ${total - cap.length} 条未列出` : ''}`;
  }
  const format = RESULT_FORMATS.find((candidate) => typeof path === 'string' && path.includes(candidate.path));
  const lines = cap.map((item, index) => {
    const title = rowTitle(item, format?.title || ['name', 'material_name', 'order_no', 'demand_no'], `记录 ${index + 1}`);
    const details = rowDetails(item, format?.fields || Object.keys(item).slice(0, 8));
    return `${index + 1}. ${title}${details ? `（${details}）` : ''}`;
  });
  return `查到 ${total} 条记录：\n${lines.join('\n')}${more ? `\n…其余 ${total - cap.length} 条未列出` : ''}`;
}
