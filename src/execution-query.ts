// 从 G1 任务的 businessObjectRef 推导执行面只读查询（path + params）。
// businessObjectRef 形如 business://<source>/<encodeURIComponent(entityId)>（见 task-center.ts createFromOperatingCase）。
export interface ExecutionQuery {
  path: string;
  params: Record<string, string>;
}

export function deriveExecutionQuery(businessObjectRef: string): ExecutionQuery {
  const match = /^business:\/\/([^/]+)\/(.+)$/.exec(businessObjectRef);
  if (!match) throw new Error(`无法解析 businessObjectRef: ${businessObjectRef}`);
  const source = match[1];
  const entityId = decodeURIComponent(match[2]);

  if (source === 'kitting') {
    const colon = entityId.indexOf(':');
    const params: Record<string, string> = { demand_no: colon >= 0 ? entityId.slice(0, colon) : entityId };
    if (colon >= 0) params.demand_line_no = entityId.slice(colon + 1);
    return { path: '/external/material-kitting/results', params };
  }
  if (source === 'order') {
    return { path: '/external/orders/list', params: { keyword: entityId } };
  }
  throw new Error(`暂不支持派生查询的 source: ${source}`);
}
