// 每日风险简报：把“需求日期 = 今天”的红色齐套风险
// 整理成可直接汇报的结构化数据与 Markdown。纯函数，便于测试；数据读取由 server 通过只读 MCP 完成。

export interface DailyBriefingItem {
  orderNo: string;
  lineNo: string;
  requiredDate: string;
  affectedAmount: number | null;
  shortageItemCount: number | null;
  kitRate: number | null;
  estimatedKitDate: string | null;
  evidenceRef: string;
}

export interface DailyBriefing {
  generatedAt: string;
  windowEnd: string;
  dataAsOf: string | null;
  confidence: string;
  stale: boolean | null;
  warnings: string[];
  totals: {
    rows: number;
    orders: number;
    /** 按订单去重（取该订单行级最大影响金额）后的合计，避免同一订单多行重复放大。 */
    affectedAmount: number;
  };
  top: DailyBriefingItem[];
}

export interface BuildDailyBriefingInput {
  rows: unknown[];
  /** YYYY-MM-DD（北京时间）。只统计 required_date = 该日期的行。 */
  windowEnd: string;
  dataAsOf?: string | null;
  confidence?: string | null;
  stale?: boolean | null;
  warnings?: string[];
  generatedAt?: string;
  topLimit?: number;
}

type Row = Record<string, unknown>;

function record(value: unknown): Row | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : null;
}

function pickText(row: Row, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function pickNumber(row: Row, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function money(value: number): string {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function cell(value: string): string {
  return String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function isoDate(value: string): string {
  const match = /^\d{4}-\d{2}-\d{2}/.exec(value);
  return match ? match[0] : value;
}

export function buildDailyBriefing(input: BuildDailyBriefingInput): DailyBriefing {
  const windowEnd = String(input.windowEnd || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(windowEnd)) throw new Error('windowEnd 必须是 YYYY-MM-DD');
  const sourceRows = Array.isArray(input.rows) ? input.rows : [];
  const warnings = [...(input.warnings ?? [])];
  const items: DailyBriefingItem[] = [];
  const orderAmounts = new Map<string, number>();
  let undated = 0;
  let missingOrder = 0;
  let future = 0;
  let past = 0;

  for (const raw of sourceRows) {
    const row = record(raw);
    if (!row) continue;
    const requiredDate = isoDate(pickText(row, ['required_date', 'requiredDate', 'due_date', 'demand_date']));
    if (!requiredDate) { undated += 1; continue; }
    if (requiredDate > windowEnd) { future += 1; continue; }
    if (requiredDate < windowEnd) { past += 1; continue; }
    const orderNo = pickText(row, ['demand_no', 'order_no', 'orderNo', 'sales_order_no']);
    if (!orderNo) { missingOrder += 1; continue; }
    const lineNo = pickText(row, ['demand_line_no', 'line_no', 'lineNo']);
    const amount = pickNumber(row, ['affected_order_amount', 'order_amount', 'shortage_amount']);
    const shortage = pickNumber(row, ['shortage_item_count', 'shortage_items']);
    const kitRate = pickNumber(row, ['kit_rate_by_item', 'kit_rate']);
    const estimatedKitDate = pickText(row, ['estimated_kit_date', 'estimatedKitDate']) || null;
    if (amount !== null) orderAmounts.set(orderNo, Math.max(orderAmounts.get(orderNo) ?? 0, amount));
    items.push({
      orderNo,
      lineNo,
      requiredDate,
      affectedAmount: amount,
      shortageItemCount: shortage,
      kitRate,
      estimatedKitDate,
      evidenceRef: `control-platform://kitting/result/${orderNo}${lineNo ? `:${lineNo}` : ''}`,
    });
  }

  if (undated) warnings.push(`${undated} 条齐套行缺少需求日期，未纳入简报`);
  if (missingOrder) warnings.push(`${missingOrder} 条齐套行缺少订单号，未纳入简报`);
  if (future) warnings.push(`${future} 条齐套行需求日期在 ${windowEnd} 之后，未纳入简报`);
  if (past) warnings.push(`${past} 条齐套行需求日期早于 ${windowEnd}，未纳入简报`);

  const limit = Math.max(1, Math.min(input.topLimit ?? 10, 50));
  const top = [...items]
    .sort((left, right) => {
      const amountDiff = (right.affectedAmount ?? -1) - (left.affectedAmount ?? -1);
      if (amountDiff !== 0) return amountDiff;
      if (left.requiredDate !== right.requiredDate) return left.requiredDate.localeCompare(right.requiredDate);
      if (left.orderNo !== right.orderNo) return left.orderNo.localeCompare(right.orderNo, 'zh-CN');
      return left.lineNo.localeCompare(right.lineNo);
    })
    .slice(0, limit);

  const affectedAmount = [...orderAmounts.values()].reduce((sum, value) => sum + value, 0);

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    windowEnd,
    dataAsOf: input.dataAsOf ?? null,
    confidence: input.confidence ?? 'unknown',
    stale: input.stale ?? null,
    warnings,
    totals: {
      rows: items.length,
      orders: orderAmounts.size,
      affectedAmount,
    },
    top,
  };
}

/**
 * 选出要分发的订单：按影响金额降序去重，最多取 limit 个订单。
 * 执行面的推理能力只分析具体对象，必须逐订单派发，不能用整份简报的聚合锚点。
 */
export function selectBriefingDispatchOrders(briefing: DailyBriefing, limit = 3): string[] {
  const orders: string[] = [];
  for (const item of briefing.top) {
    if (orders.includes(item.orderNo)) continue;
    if (orders.length >= Math.max(1, limit)) break;
    orders.push(item.orderNo);
  }
  return orders;
}

/** 单订单分发的提示词：只把该订单的风险行交给执行面 Agent 做只读核查。 */
export function formatBriefingOrderPrompt(briefing: DailyBriefing, orderNo: string): string {
  const rows = briefing.top.filter((item) => item.orderNo === orderNo);
  const lines = [
    `以下是 AEOS Hub 今日物料齐套风险简报（需求日期 = ${briefing.windowEnd}，仅统计今天到期）中订单 ${orderNo} 的风险行。`,
    `整体口径：共 ${briefing.totals.rows} 行红色风险，涉及 ${briefing.totals.orders} 个订单，影响金额合计 ${money(briefing.totals.affectedAmount)}；数据快照 ${briefing.dataAsOf ?? '未回传'}${briefing.stale === true ? '（已过期）' : ''}；查询置信度 ${briefing.confidence}。`,
    '',
    `订单 ${orderNo} 的风险行：`,
  ];
  rows.forEach((item, index) => {
    const parts = [
      item.lineNo ? `行 ${item.lineNo}` : '',
      `需求日期 ${item.requiredDate}`,
      item.affectedAmount === null ? '影响金额 未回传' : `影响金额 ${money(item.affectedAmount)}`,
      item.shortageItemCount === null ? '' : `缺料项 ${item.shortageItemCount}`,
      item.kitRate === null ? '' : `齐套率 ${item.kitRate}%`,
      `预计齐套 ${item.estimatedKitDate ?? '未回传'}`,
      `依据 ${item.evidenceRef}`,
    ].filter(Boolean);
    lines.push(`${index + 1}. ${parts.join('，')}`);
  });
  if (briefing.warnings.length) lines.push('', `数据说明：${briefing.warnings.join('；')}`);
  lines.push(
    '',
    '请仅使用只读能力核查该订单的齐套缺口，并按以下结构输出：',
    '1. 关键缺料项、库存与供给情况、预计齐套时间；',
    '2. 对交付的影响（金额、时间）与处置优先级；',
    '3. 处置建议、责任角色与时限，并标注需人工确认的事项；',
    '4. 数据缺失或快照过期时，明确说明数据置信度不足。',
    '结论必须引用 evidence_refs，不得编造数据，不得执行任何写操作。',
  );
  return lines.join('\n');
}

export function formatDailyBriefingMarkdown(briefing: DailyBriefing): string {
  const lines: string[] = [
    `# AEOS 今日风险简报 · ${briefing.windowEnd}`,
    '',
    `数据口径：需求日期 = ${briefing.windowEnd}（仅统计今天到期）`,
    `数据快照：${briefing.dataAsOf ?? '未回传'}${briefing.stale === true ? '（已过期）' : ''}`,
    `查询置信度：${briefing.confidence}`,
    `生成时间：${briefing.generatedAt}`,
    '',
    '## 总览',
    '',
    `- 红色风险：${briefing.totals.rows} 行，涉及 ${briefing.totals.orders} 个订单`,
    `- 影响金额（按订单去重，取行级最大值）：${money(briefing.totals.affectedAmount)}`,
    '',
    `## 风险最高 ${briefing.top.length} 项`,
    '',
    '| 订单号 | 行 | 需求日期 | 影响金额 | 缺料项 | 齐套率 | 预计齐套 | 依据 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const item of briefing.top) {
    lines.push([
      cell(item.orderNo),
      cell(item.lineNo || '—'),
      cell(item.requiredDate),
      item.affectedAmount === null ? '—' : money(item.affectedAmount),
      item.shortageItemCount === null ? '—' : String(item.shortageItemCount),
      item.kitRate === null ? '—' : `${item.kitRate}%`,
      cell(item.estimatedKitDate || '未回传'),
      cell(item.evidenceRef),
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }

  if (briefing.warnings.length) {
    lines.push('', '## 数据说明', '');
    for (const warning of briefing.warnings) lines.push(`- ${warning}`);
  }
  lines.push(
    '',
    '---',
    '本简报由 AEOS Hub 只读生成，未修改任何业务数据；完整依据与执行记录见「证据与审计」。',
  );
  return lines.join('\n');
}
