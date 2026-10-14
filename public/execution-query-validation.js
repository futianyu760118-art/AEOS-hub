function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

/**
 * Validates pagination facts across every read-only execution query. The result
 * deliberately keeps total-match count separate from rows returned on this page.
 */
export function validateExecutionQueryResponse(path, requestParams = {}, response = {}) {
  const issues = [];
  const items = Array.isArray(response?.items) ? response.items : [];
  if (!Array.isArray(response?.items)) issues.push({ level: 'error', message: '中台响应缺少 items 数组' });

  const requestedPage = positiveInteger(requestParams?.page, 1);
  const requestedPageSize = positiveInteger(requestParams?.page_size, 20);
  const page = positiveInteger(response?.page, requestedPage);
  const pageSize = positiveInteger(response?.page_size, requestedPageSize);
  const suppliedTotal = nonNegativeInteger(response?.total);
  const total = suppliedTotal ?? items.length;
  if (suppliedTotal === null) issues.push({ level: 'warning', message: '中台未返回有效总匹配数，已按本页返回数展示' });
  if (page !== requestedPage) issues.push({ level: 'warning', message: `中台返回页码 ${page} 与请求页码 ${requestedPage} 不一致` });
  if (pageSize !== requestedPageSize) issues.push({ level: 'warning', message: `中台返回每页 ${pageSize} 条与请求每页 ${requestedPageSize} 条不一致` });
  if (total < items.length) issues.push({ level: 'error', message: `总匹配数 ${total} 小于本页返回数 ${items.length}` });
  if (items.length > pageSize) issues.push({ level: 'error', message: `本页返回数 ${items.length} 超过每页条数 ${pageSize}` });
  if (total > 0 && page > Math.ceil(total / pageSize)) issues.push({ level: 'warning', message: `当前第 ${page} 页超出总匹配数 ${total} 的可用范围` });
  if (items.length === 0 && total > 0 && page <= Math.ceil(total / pageSize)) issues.push({ level: 'warning', message: '总匹配数大于零但当前页没有返回记录' });

  return { path, items, total, page, pageSize, returned: items.length, issues };
}
