type Row = Record<string, unknown>;
export function payloadOf(response: unknown): Row {
  const envelope = (response ?? {}) as Row;
  if (envelope.structuredContent && typeof envelope.structuredContent === 'object') {
    const structured = envelope.structuredContent as Row;
    return (structured.result ?? structured) as Row;
  }
  for (const item of Array.isArray(envelope.content) ? envelope.content as Row[] : []) {
    if (item.type === 'text' && typeof item.text === 'string') {
      try { return JSON.parse(item.text); } catch { /* Try next block. */ }
    }
  }
  return envelope;
}

/** Bounded cursor-aware pages; never silently present a partial result as complete. */
export async function collectMcpPages(
  call: (args: Row) => Promise<unknown>, args: Row, maxPages = 20, pageSize = 100,
): Promise<unknown> {
  const rows: unknown[] = [];
  const refs = new Set<string>();
  const warnings: string[] = [];
  let first: Row = {};
  let total: number | null = null;
  let complete = false;
  let asOf = '';
  let confidence = 'high';
  const seenPages = new Set<string>();
  let requestPage = 1;
  const visitedPages = new Set<number>();
  for (let attempt = 1; attempt <= maxPages; attempt++) {
    if (visitedPages.has(requestPage)) {
      warnings.push(`分页游标重复指向第 ${requestPage} 页，已停止翻页`);
      break;
    }
    visitedPages.add(requestPage);
    let payload: Row;
    try { payload = payloadOf(await call({ ...args, page: requestPage, page_size: pageSize })); }
    catch (error) {
      if (attempt === 1) throw error;
      warnings.push(`第 ${requestPage} 页读取失败：${(error as Error).message}`);
      break;
    }
    if (attempt === 1) first = payload;
    if (payload.error) {
      if (attempt === 1) return { structuredContent: payload };
      warnings.push(`第 ${requestPage} 页不可用：${JSON.stringify(payload.error)}`);
      break;
    }
    if (!Array.isArray(payload.data)) { warnings.push('未返回可解析的数据数组'); break; }
    const batch = payload.data;
    const signature = JSON.stringify(batch);
    if (batch.length && seenPages.has(signature)) { warnings.push('上游重复返回同一页，已停止翻页'); break; }
    seenPages.add(signature);
    rows.push(...batch);
    for (const ref of Array.isArray(payload.evidence_refs) ? payload.evidence_refs : []) {
      if (typeof ref === 'string') refs.add(ref);
    }
    const stamp = typeof payload.data_as_of === 'string' ? payload.data_as_of : '';
    if (stamp && (!asOf || stamp < asOf)) asOf = stamp;
    if (!stamp) warnings.push(`第 ${requestPage} 页未返回数据时间`);
    const level = payload.data_confidence;
    if (level === 'low') confidence = 'low';
    else if (level === 'medium' && confidence === 'high') confidence = 'medium';
    else if (level !== 'high' && level !== 'medium' && confidence !== 'low') confidence = 'unknown';
    const meta = (payload.page ?? {}) as Row;
    if (typeof meta.total === 'number' && Number.isFinite(meta.total)) total = meta.total;
    const hasMore = meta.truncated === true || Boolean(meta.next_cursor) || (total !== null && rows.length < total);
    const upstreamPageSize = typeof meta.page_size === 'number' && Number.isFinite(meta.page_size) && meta.page_size > 0 ? meta.page_size : pageSize;
    if (!hasMore && (meta.truncated === false || total !== null || batch.length < upstreamPageSize)) { complete = true; break; }
    if (!batch.length) { warnings.push('分页尚未完成但上游返回空页'); break; }
    if (typeof meta.next_cursor === 'string' && meta.next_cursor.trim()) {
      const nextPage = Number(meta.next_cursor.trim());
      if (!Number.isInteger(nextPage) || nextPage < 1) {
        warnings.push('部分数据：中台返回的分页游标无法解析，统计不代表全部业务数据');
        break;
      }
      requestPage = nextPage;
    } else {
      requestPage += 1;
    }
  }
  if (!complete) warnings.push('部分数据：分页未完成，统计不代表全部业务数据');
  return { structuredContent: {
    ...first, data: rows, evidence_refs: [...refs], data_as_of: asOf || null,
    data_confidence: complete ? confidence : 'low',
    page: { total, loaded: rows.length, truncated: !complete },
    query_scope: args, warnings: [...new Set(warnings)],
  } };
}
