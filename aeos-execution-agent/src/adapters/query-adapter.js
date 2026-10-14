// 查询适配器：HMAC 签名调用目标系统只读 REST 接口（Node 自实现，不依赖 Python）。
// 接入新系统时，替换本文件即可，不改 agent-core。
import { createHmac } from 'node:crypto';

// 端点白名单（与 AEOS Hub 的 mcp-company-control/mcp_server/upstream_client.py _ENDPOINT_CODES 一致）。
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

function errorWithCode(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function hmacHeaders(secret, key, path, queryString) {
  const endpointCode = ENDPOINT_CODES[path];
  if (!endpointCode) throw errorWithCode('FORBIDDEN', `不在白名单内的查询 path: ${path}`);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const stringToSign = `${timestamp}${key}${endpointCode}${queryString}`;
  const signature = createHmac('sha256', secret).update(stringToSign, 'utf8').digest('hex');
  return { 'X-App-Key': key, 'X-Timestamp': timestamp, 'X-Signature': signature };
}

/** 创建查询处理器：query(request, abortSignal) => data。 */
export function createQueryAdapter(config) {
  const baseUrl = (config.baseUrl || '').replace(/\/$/, '');
  const appKey = config.appKey || '';
  const appSecret = config.appSecret || '';

  return async function query(request, abortSignal) {
    const path = typeof request.path === 'string' ? request.path : '';
    const params = request.params && typeof request.params === 'object' ? request.params : {};
    if (!path) throw errorWithCode('INVALID_ARGUMENT', '查询输入缺少 path');
    if (!ENDPOINT_CODES[path]) throw errorWithCode('FORBIDDEN', `不在白名单内的查询 path: ${path}`);
    const queryString = new URLSearchParams(
      Object.entries(params)
        .filter(([, value]) => value !== '' && value !== null && value !== undefined)
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    const url = `${baseUrl}${path}${queryString ? `?${queryString}` : ''}`;
    const response = await fetch(url, { headers: hmacHeaders(appSecret, appKey, path, queryString), signal: abortSignal });
    if (response.status === 200) {
      const body = await response.json();
      if (body && typeof body === 'object' && 'code' in body) {
        if (body.code !== 0) throw errorWithCode('UPSTREAM_ERROR', body.message || '上游返回业务错误');
        return body.data ?? null;
      }
      return body;
    }
    throw errorWithCode(response.status >= 500 ? 'UPSTREAM_UNAVAILABLE' : 'UPSTREAM_ERROR', `上游返回 HTTP ${response.status}`);
  };
}
