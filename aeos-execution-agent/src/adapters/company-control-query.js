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
