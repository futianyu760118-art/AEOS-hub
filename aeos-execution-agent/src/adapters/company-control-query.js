// 公司中控（company-control）查询能力配置源：端点白名单 + HMAC 策略 + 统一信封。
// 这是「中台专用」配置；接入新系统时整体替换本模块，或直接用通用适配器自带配置。
import { createHttpQueryAdapter } from './query-adapter.js';

export const COMPANY_CONTROL_PATHS = [
  '/common/ping',
  '/external/orders/list',
  '/external/order-details/list',
  '/external/boms/tree',
  '/external/materials/list',
  '/external/suppliers/list',
  '/external/material-kitting/results',
  '/external/material-kitting/shortages',
  '/external/material-kitting/demands',
  '/external/inventory/availability',
  '/external/material-supplies/list',
  '/external/quality-issues/list',
  '/external/quality-trace/list',
  '/external/production/work-orders/list',
  '/external/production/operations/list',
  '/external/production/order-links/list',
  '/external/production/reports/list',
  '/external/production/capacity/list',
];

// 中台查询语义（intent）：Agent 自描述「自然语言 → path+params」的映射与结果渲染提示。
// 管理面据此动态生成 LLM 意图提示、渲染查询结果，不再内置中台的任何路径/字段。
export const COMPANY_CONTROL_QUERY_INTENT = {
  paths: [
    {
      path: '/external/orders/list',
      label: '订单',
      keywords: ['订单', 'order'],
      params: [
        { name: 'keyword', label: '关键字/订单号/客户/型号' },
        { name: 'status', label: '状态', enum: [{ value: 'pending_review', label: '待评审' }, { value: 'in_progress', label: '进行中' }, { value: 'partially_closed', label: '部分关闭' }, { value: 'completed', label: '已完成' }, { value: 'cancelled', label: '已取消' }] },
        { name: 'risk_level', label: '风险等级', enum: [{ value: 'red', label: '高' }, { value: 'yellow', label: '中' }, { value: 'green', label: '低' }] },
        { name: 'customer_code', label: '客户编码' },
        { name: 'promised_date_start', label: '交期起' },
        { name: 'promised_date_end', label: '交期止' },
      ],
      output: { title: ['order_no'], fields: ['customer', 'customer_code', 'product_name', 'product_code', 'status', 'promised_date', 'order_amount', 'risk_level'] },
    },
    {
      path: '/external/material-kitting/results',
      label: '齐套',
      keywords: ['齐套', '套料', 'kitting'],
      params: [
        { name: 'demand_no', label: '订单号/需求编号' },
        { name: 'demand_line_no', label: '需求行号' },
        { name: 'kit_status', label: '齐套状态', enum: [{ value: 'BLOCKED', label: '阻塞' }, { value: 'PARTIAL', label: '部分齐套' }, { value: 'SHORTAGE', label: '缺料' }, { value: 'FULL', label: '完全齐套' }, { value: 'PENDING', label: '待计算' }] },
        { name: 'risk_level', label: '风险等级', enum: [{ value: 'red', label: '高' }, { value: 'yellow', label: '中' }, { value: 'green', label: '低' }] },
        { name: 'required_date_start', label: '需求日期起' },
        { name: 'required_date_end', label: '需求日期止' },
      ],
      output: { title: ['demand_no'], fields: ['demand_line_no', 'kit_status', 'kit_rate_by_item', 'kit_rate_by_qty', 'shortage_item_count', 'shortage_amount', 'required_date', 'risk_level'] },
    },
    {
      path: '/external/material-kitting/shortages',
      label: '缺料',
      keywords: ['缺料', '短缺', 'shortage'],
      params: [
        { name: 'demand_no', label: '订单号/需求编号' },
        { name: 'material_code', label: '物料编码' },
        { name: 'is_key_material', label: '是否关键料', enum: [{ value: true, label: '关键料' }, { value: false, label: '非关键料' }] },
      ],
    },
    {
      path: '/external/inventory/availability',
      label: '库存',
      keywords: ['库存', '可用量', 'inventory'],
      params: [
        { name: 'material_code', label: '物料编码' },
        { name: 'keyword', label: '物料名称/型号' },
        { name: 'wh_code', label: '仓库' },
      ],
      output: { title: ['material_name', 'material_code'], fields: ['material_code', 'on_hand_qty', 'locked_qty', 'available_qty', 'qty_in_transit', 'wh_code'] },
    },
    {
      path: '/external/material-supplies/list',
      label: '物料供给',
      keywords: ['供给', '供应', 'supply'],
      params: [
        { name: 'material_code', label: '物料编码' },
        { name: 'supply_no', label: '供给单号/采购单号' },
        { name: 'supply_type', label: '供给类型', enum: [{ value: 'PURCHASE', label: '采购' }, { value: 'OUTSOURCE', label: '委外' }, { value: 'PRODUCTION', label: '自制' }, { value: 'TRANSFER', label: '调拨' }] },
        { name: 'expected_date_start', label: '预计日期起' },
        { name: 'expected_date_end', label: '预计日期止' },
      ],
      output: { title: ['supply_no', 'material_name', 'material_code'], fields: ['supply_line_no', 'material_code', 'supply_type', 'supply_qty', 'available_qty', 'expected_available_date', 'confirmed_available_date', 'supplier_name', 'supply_status'] },
    },
    {
      path: '/external/quality-issues/list',
      label: '质量异常',
      keywords: ['质量', 'quality'],
      params: [
        { name: 'issue_no', label: '异常编号' },
        { name: 'order_no', label: '订单号' },
        { name: 'product_code', label: '产品编码' },
        { name: 'status', label: '状态', enum: [{ value: 'open', label: '未关闭' }, { value: 'in_progress', label: '处理中' }, { value: 'closed', label: '已关闭' }] },
        { name: 'defect_type', label: '缺陷类型' },
        { name: 'submit_dept', label: '提出部门' },
        { name: 'occurred_start', label: '发生日期起' },
        { name: 'occurred_end', label: '发生日期止' },
      ],
      output: { title: ['issue_no'], fields: ['order_no', 'product_code', 'status', 'defect_type', 'submit_dept', 'occurred_at', 'occurred_date'] },
    },
    {
      path: '/external/production/work-orders/list',
      label: '生产工单',
      keywords: ['生产', '工单', 'production'],
      params: [
        { name: 'work_order_no', label: '工单号' },
        { name: 'order_no', label: '订单号' },
        { name: 'product_code', label: '产品编码' },
        { name: 'status', label: '状态', enum: [{ value: 'planned', label: '计划中' }, { value: 'released', label: '已下达' }, { value: 'in_progress', label: '进行中' }, { value: 'completed', label: '已完成' }] },
        { name: 'workshop', label: '车间' },
        { name: 'planned_end_start', label: '计划完工起' },
        { name: 'planned_end_end', label: '计划完工止' },
      ],
      output: { title: ['work_order_no'], fields: ['order_no', 'product_code', 'status', 'workshop', 'workshop_code', 'planned_end_date', 'planned_end', 'task_qty', 'actual_qty'] },
    },
    {
      path: '/external/suppliers/list',
      label: '供应商',
      keywords: ['供应商', 'supplier', 'vendor'],
      params: [{ name: 'keyword', label: '供应商名称/编码' }],
      output: { title: ['supplier_name', 'supplier_code'], fields: ['supplier_code', 'supplier_short', 'supplier_name'] },
    },
  ],
};

const ENDPOINT_CODES = {
  '/common/ping': 'int:health.ping',
  '/external/orders/list': 'orders.list',
  '/external/order-details/list': 'order_details.list',
  '/external/boms/tree': 'boms.tree',
  '/external/materials/list': 'materials.list',
  '/external/suppliers/list': 'suppliers.list',
  '/external/material-kitting/results': 'kitting.results',
  '/external/material-kitting/shortages': 'kitting.shortages',
  '/external/material-kitting/demands': 'kitting.demands',
  '/external/inventory/availability': 'inventory.availability',
  '/external/material-supplies/list': 'material.supplies',
  '/external/quality-issues/list': 'quality_issues.list',
  '/external/quality-trace/list': 'quality_trace.list',
  '/external/production/work-orders/list': 'production.work_orders.list',
  '/external/production/operations/list': 'production.operations.list',
  '/external/production/order-links/list': 'production.order_links.list',
  '/external/production/reports/list': 'production.reports.list',
  '/external/production/capacity/list': 'production.capacity.list',
};

export function createCompanyControlQueryAdapter({ baseUrl, appKey, appSecret }) {
  return createHttpQueryAdapter({
    baseUrl,
    endpoints: ENDPOINT_CODES,
    auth: { type: 'hmac', appKey, appSecret },
    unwrap: (body) => {
      if (body && typeof body === 'object' && 'code' in body) {
        if (body.code !== 0) {
          const err = new Error(body.message || '上游返回业务错误');
          err.code = 'UPSTREAM_ERROR';
          throw err;
        }
        return body.data ?? null;
      }
      return body;
    },
  });
}
