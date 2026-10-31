import type { CapabilityRegistrySnapshot } from './capability-registry.ts';
import { parseProductionSummary, type ProductionResponse, type ProductionSummary } from './production-coordination.ts';

type JsonRecord = Record<string, unknown>;

export interface DashboardRisk {
  source: 'order' | 'kitting' | 'quality' | 'production';
  orderNo: string;
  summary: string;
  customer: string;
  product: string;
  orderQty: number | null;
  completedQty: number | null;
  amountCny: number | null;
  demandType?: string;
  demandLineNo?: string;
  probability: number | null;
  riskScore: number | null;
  dueDate: string;
  shippingPlan: string;
  owner: string;
  orderStatus: string;
  riskLevel: string;
  evidenceRef: string;
  prompt: string;
  kitRateByItem: number | null;
  shortageItemCount: number | null;
  shortageQty: number | null;
  estimatedFullKitDate: string;
  issueNo?: string;
  defectType?: string;
  submitDept?: string;
  ownerOrg?: string;
  occurredAt?: string;
  inspectionResult?: string;
  blocking?: boolean | null;
}

export interface DashboardDecision {
  id: string;
  level: 'L3' | 'L4';
  title: string;
  detail: string;
  probability: number | null;
  prompt: string;
}

export interface DashboardSnapshot {
  generatedAt: string;
  domains: Record<string, { dataAsOf: string | null; confidence: string; loaded: number; total: number | null; partial: boolean; queryScope: JsonRecord }>;
  attentionSummary: { events: number; businessObjects: number };
  dataAsOf: string | null;
  source: string;
  businessData: { source: string; available: boolean; confidence: 'high' | 'medium' | 'low' | 'unknown'; message?: string };
  riskAssessment: { available: boolean; message?: string };
  kittingAssessment: { available: boolean; shortageCount: number; message?: string };
  qualityAssessment: { available: boolean; openCount: number; message?: string };
  productionAssessment: ProductionSummary;
  dataCompleteness: {
    activeOrderCount: number;
    riskSignalCount: number;
    probabilityCount: number;
    riskLevelCount: number;
    ownerCount: number;
    dueDateCount: number;
    shippingPlanCount: number;
    evidenceRefCount: number;
  };
  metrics: { capabilityCount: number; mcpServerCount: number; highRiskCount: number; attentionCount: number };
  risks: DashboardRisk[];
  attentionRisks: DashboardRisk[];
  /** 已由中台明确返回终态的近期事项；仅供 Attention 的“已闭环”列展示。 */
  closedAttentionRisks: DashboardRisk[];
  kittingRisks: DashboardRisk[];
  qualityRisks: DashboardRisk[];
  decisions: DashboardDecision[];
  mcpServers: Array<{ name: string; status: string; statusTone: string; capabilityCount: number }>;
  warnings: string[];
}

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function textPayload(response: unknown): JsonRecord {
  const envelope = record(response);
  const structured = record(envelope.structuredContent);
  if (Object.keys(structured).length) return record(structured.result ?? structured);
  const content = Array.isArray(envelope.content) ? envelope.content : [];
  for (const raw of content) {
    const item = record(raw);
    if (item.type !== 'text' || typeof item.text !== 'string') continue;
    try { return record(JSON.parse(item.text)); } catch { /* Try the next text block. */ }
  }
  return {};
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * 中控历史接口返回的 data_as_of 有时是北京时间但没有携带时区后缀。
 * 不能把这种值交给容器的 UTC 默认时区直接解析，否则会被误判为未来数据，
 * 从而把本来有效的 high/medium 置信度降成 unknown。
 */
function parseDataAsOf(value: string): number {
  const raw = value.trim();
  if (!raw) return Number.NaN;
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const normalized = hasTimezone ? raw : `${raw}+08:00`;
  return Date.parse(normalized);
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstEvidence(row: JsonRecord): string {
  if (typeof row.evidence_ref === 'string') return row.evidence_ref;
  if (Array.isArray(row.evidence_refs)) return string(row.evidence_refs[0]);
  return '';
}

function evidenceFor(row: JsonRecord, refs: string[], entity: string, id: string): string {
  const matches = (ref: string) => ref.startsWith('control-platform://' + entity + '/' + id + '@');
  const own = firstEvidence(row);
  if (own && (!own.startsWith('control-platform://') || (id && matches(own)))) return own;
  if (!id) return '';
  const matching = [...new Set(refs.filter(matches))];
  return matching.length === 1 ? matching[0] : '';
}

function deduplicate(rows: JsonRecord[], key: (row: JsonRecord) => string): JsonRecord[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    // Retain conflicting versions and distinct business lines; only exact duplicate records collapse.
    const id = key(row) + ':' + JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))));
    if (seen.has(id)) return false;
    seen.add(id); return true;
  });
}
function amount(value: unknown): number | null {
  const parsed = optionalNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

type RiskBand = 'high' | 'attention' | 'low' | 'unknown';

function riskProbability(order: JsonRecord): number | null {
  const parsed = optionalNumber(order.risk_probability);
  return parsed !== null && parsed >= 0 && parsed <= 1 ? parsed : null;
}

function riskScore(order: JsonRecord): number | null {
  const parsed = optionalNumber(order.risk_score);
  return parsed !== null && parsed >= 0 && parsed <= 100 ? parsed : null;
}

function erpStatus(order: JsonRecord): number | null {
  const parsed = optionalNumber(order.erp_status);
  return parsed !== null && Number.isInteger(parsed) && parsed >= 0 && parsed <= 3 ? parsed : null;
}

function isTerminalOrder(order: JsonRecord): boolean {
  const status = erpStatus(order);
  if (status === 3) return true;
  return status === null && optionalNumber(order.is_closed) === 1;
}

function orderStatusLabel(order: JsonRecord): string {
  const status = erpStatus(order);
  if (status === 0) return '未审核';
  if (status === 1) return '已审核';
  if (status === 2) return '部分关闭';
  if (status === 3) return string(order.delivery_completed_date) ? '已完成' : '已取消';
  const raw = (string(order.status) || string(order.order_status)).trim();
  const labels: Record<string, string> = {
    open: '进行中', in_progress: '进行中', processing: '进行中',
    closed: '已关闭', completed: '已完成', complete: '已完成',
    cancelled: '已取消', canceled: '已取消',
  };
  return labels[raw.toLowerCase()] || raw || '状态待回传';
}

function productLabel(order: JsonRecord): string {
  const name = string(order.product_name);
  const code = string(order.product_code);
  if (name && code) return `${name} · ${code}`;
  return name || code;
}

function riskBand(order: JsonRecord): RiskBand {
  const value = (string(order.risk_level) || string(order.severity)).trim().toLocaleLowerCase('zh-CN');
  if (['red', 'high', 'critical', 'severe', '高', '高风险', '红', '红色'].includes(value)) return 'high';
  if (['yellow', 'amber', 'medium', 'warning', '中', '中风险', '需关注', '黄', '黄色'].includes(value)) return 'attention';
  if (['green', 'blue', 'low', 'normal', 'info', '低', '低风险', '正常', '绿', '绿色', '蓝', '蓝色'].includes(value)) return 'low';
  return 'unknown';
}

function riskBandLabel(band: RiskBand, probability: number | null): string {
  if (band === 'high') return '高风险';
  if (band === 'attention') return '需关注';
  if (band === 'low') return '低风险';
  if (probability !== null) return probability >= 0.7 ? '高风险' : probability >= 0.4 ? '需关注' : '低风险';
  return '风险等级未知';
}

function riskBandRank(risk: Pick<DashboardRisk, 'probability' | 'riskLevel'>): number {
  if (risk.probability !== null) return risk.probability >= 0.7 ? 3 : risk.probability >= 0.4 ? 2 : 1;
  if (risk.riskLevel === '高风险') return 3;
  if (risk.riskLevel === '需关注') return 2;
  if (risk.riskLevel === '低风险') return 1;
  return 0;
}

export function buildDashboardSnapshot(options: {
  registry: CapabilityRegistrySnapshot;
  orderRiskResponse?: unknown;
  shortageResponse?: unknown;
  kittingResponse?: unknown;
  qualityResponse?: unknown;
  productionResponses?: {
    workOrders?: ProductionResponse;
    operations?: ProductionResponse;
    orderLinks?: ProductionResponse;
    reports?: ProductionResponse;
    capacity?: ProductionResponse;
  };
  source?: string;
  warnings?: string[];
  now?: number;
  maxDataAgeMs?: number;
}): DashboardSnapshot {
  const orderPayload = textPayload(options.orderRiskResponse);
  const shortagePayload = textPayload(options.shortageResponse);
  const kittingPayload = textPayload(options.kittingResponse);
  const qualityPayload = textPayload(options.qualityResponse);
  const productionSummary = parseProductionSummary(options.productionResponses ?? {});
  const orderRows = Array.isArray(orderPayload.orders)
    ? orderPayload.orders
    : Array.isArray(orderPayload.data) ? orderPayload.data : [];
  const allOrders = deduplicate(orderRows.map(record), (row) => string(row.order_no));
  const activeOrders = allOrders.filter((order) => !isTerminalOrder(order));
  const terminalOrderCount = allOrders.length - activeOrders.length;
  const rawOrders = activeOrders.filter((order) => {
    const probability = riskProbability(order);
    if (probability !== null) return probability >= 0.4;
    const band = riskBand(order);
    return band === 'high' || band === 'attention';
  });
  const rawShortages = Array.isArray(shortagePayload.shortages)
    ? shortagePayload.shortages.map(record)
    : Array.isArray(shortagePayload.data) ? shortagePayload.data.map(record) : [];
  const rawKitting = deduplicate(Array.isArray(kittingPayload.data) ? kittingPayload.data.map(record) : [], (row) => [row.demand_type, row.demand_no, row.demand_line_no, row.allocation_run_id].join('/'));
  const rawQuality = deduplicate(Array.isArray(qualityPayload.data) ? qualityPayload.data.map(record) : [], (row) => string(row.issue_no));
  const orderEvidenceRefs = Array.isArray(orderPayload.evidence_refs)
    ? orderPayload.evidence_refs.filter((value): value is string => typeof value === 'string')
    : [];
  const shortagesByOrder = new Map<string, JsonRecord>();
  for (const shortage of rawShortages) {
    const affected = Array.isArray(shortage.affected_orders) ? shortage.affected_orders : [];
    for (const orderNo of affected) if (typeof orderNo === 'string') shortagesByOrder.set(orderNo, shortage);
    const demandNo = string(shortage.demand_no);
    if (demandNo) shortagesByOrder.set(demandNo, shortage);
  }

  const toOrderRisk = (order: JsonRecord, index: number): DashboardRisk => {
    const orderNo = string(order.order_no) || '未知订单';
    const probability = riskProbability(order);
    const band = riskBand(order);
    const level = riskBandLabel(band, probability);
    const riskType = string(order.risk_type) || `${level}订单`;
    const summary = string(order.blocking_reason) || riskType;
    const evidenceRef = evidenceFor(order, orderEvidenceRefs, 'order', string(order.order_no));
    return {
      source: 'order',
      orderNo,
      summary,
      customer: string(order.customer),
      product: productLabel(order),
      orderQty: optionalNumber(order.order_qty),
      completedQty: optionalNumber(order.completed_qty),
      amountCny: amount(order.amount_cny ?? order.order_amount),
      probability,
      riskScore: riskScore(order),
      dueDate: string(order.due_date) || string(order.promised_date),
      shippingPlan: string(order.shipping_plan),
      owner: string(order.owner),
      orderStatus: orderStatusLabel(order),
      riskLevel: level,
      evidenceRef,
      prompt: `分析订单 ${orderNo} 的${riskType}（${probability === null ? `风险等级 ${level}、概率待中台提供` : `风险概率 ${Math.round(probability * 100)}%`}），说明影响、建议动作与责任人，并使用关联证据链。`,
      kitRateByItem: null,
      shortageItemCount: null,
      shortageQty: null,
      estimatedFullKitDate: '',
    };
  };
  const orderRisks = rawOrders.map(toOrderRisk);
  // Dashboard 的在途风险不会包含终态订单，但 Attention 需要看到中台已
  // 明确回传的闭环证据，才能把之前的事项归入“已闭环”。
  const closedOrderRisks = allOrders.filter(isTerminalOrder).map(toOrderRisk);
  const kittingEvidenceRefs = Array.isArray(kittingPayload.evidence_refs)
    ? kittingPayload.evidence_refs.filter((value): value is string => typeof value === 'string') : [];
  const toKittingRisk = (item: JsonRecord, index: number): DashboardRisk => {
      const orderNo = string(item.demand_no) || '未知需求对象';
      const kitStatus = string(item.kit_status).trim().toUpperCase();
      const evidenceRef = evidenceFor(item, kittingEvidenceRefs, 'kitting-result', [item.demand_type, item.demand_no, item.demand_line_no].filter((v) => v !== undefined && v !== null && v !== '').join('/'));
      const level = kitStatus === 'BLOCKED' ? '高风险' : riskBandLabel(riskBand(item), null);
      return {
        source: 'kitting',
        demandType: string(item.demand_type),
        demandLineNo: String(item.demand_line_no ?? ''),
        orderNo,
        summary: `物料齐套状态：${kitStatus}`,
        customer: string(item.customer),
        product: productLabel(item),
        orderQty: optionalNumber(item.demand_qty),
        completedQty: optionalNumber(item.completed_qty),
        amountCny: amount(item.affected_order_amount),
        probability: null,
        riskScore: null,
        dueDate: string(item.required_date),
        shippingPlan: '',
        owner: string(item.owner),
        orderStatus: kitStatus,
        riskLevel: level,
        evidenceRef,
        prompt: `分析 ${orderNo} 的物料齐套异常（状态 ${kitStatus}），下钻缺料、库存可用量与未来供给，说明影响、建议动作与责任人，并使用关联证据链。`,
        kitRateByItem: optionalNumber(item.kit_rate_by_item),
        shortageItemCount: optionalNumber(item.shortage_item_count),
        shortageQty: optionalNumber(item.shortage_qty),
        estimatedFullKitDate: string(item.estimated_full_kit_date) || string(item.estimated_kit_date),
      };
  };
  const kittingRisks = rawKitting
    .filter((item) => {
      const status = string(item.kit_status).trim().toUpperCase();
      return Boolean(status) && status !== 'FULL';
    })
    .map(toKittingRisk);
  const closedKittingRisks = rawKitting
    .filter((item) => string(item.kit_status).trim().toUpperCase() === 'FULL')
    .map(toKittingRisk);
  const qualityEvidenceRefs = Array.isArray(qualityPayload.evidence_refs)
    ? qualityPayload.evidence_refs.filter((value): value is string => typeof value === 'string') : [];
  const isTerminalQuality = (item: JsonRecord): boolean => ['closed', 'resolved', 'completed', 'cancelled', 'canceled'].includes(string(item.status).trim().toLowerCase());
  const toQualityRisk = (item: JsonRecord, index: number): DashboardRisk => {
      const issueNo = string(item.issue_no) || `未知质量异常-${index + 1}`;
      const orderNo = string(item.order_no);
      const severityBand = riskBand(item);
      const evidenceRef = evidenceFor(item, qualityEvidenceRefs, 'quality-issue', string(item.issue_no));
      return {
        source: 'quality',
        orderNo: orderNo || issueNo,
        issueNo,
        summary: string(item.title) || string(item.defect_type) || '质量异常',
        customer: '',
        product: productLabel(item),
        orderQty: optionalNumber(item.affected_qty),
        completedQty: null,
        amountCny: amount(item.affected_order_amount),
        probability: null,
        riskScore: null,
        dueDate: string(item.due_date),
        shippingPlan: '',
        owner: string(item.owner),
        orderStatus: string(item.status),
        riskLevel: riskBandLabel(severityBand, null),
        evidenceRef,
        prompt: `分析质量异常 ${issueNo}${orderNo ? `（关联订单 ${orderNo}）` : ''}，使用 quality_issues_list 与 quality_trace 核查异常、订单行和 BOM 关联，说明影响、建议动作、责任角色与 evidence_refs；缺失字段不得补造。`,
        kitRateByItem: null,
        shortageItemCount: null,
        shortageQty: null,
        estimatedFullKitDate: '',
        defectType: string(item.defect_type),
        submitDept: string(item.submit_dept),
        ownerOrg: string(item.owner_org),
        occurredAt: string(item.occurred_at),
        inspectionResult: string(item.inspection_result),
        blocking: typeof item.blocking === 'boolean' ? item.blocking : null,
      };
  };
  const qualityRisks = rawQuality.filter((item) => !isTerminalQuality(item)).map(toQualityRisk);
  const closedQualityRisks = rawQuality.filter(isTerminalQuality).map(toQualityRisk);
  const rankRisks = (left: DashboardRisk, right: DashboardRisk): number => {
    const severity = Number(right.blocking === true || right.orderStatus === 'BLOCKED') - Number(left.blocking === true || left.orderStatus === 'BLOCKED')
      || riskBandRank(right) - riskBandRank(left);
    if (severity) return severity;
    if (left.amountCny !== null && right.amountCny !== null && left.probability !== null && right.probability !== null) {
      const impact = right.amountCny * right.probability - left.amountCny * left.probability;
      if (impact) return impact;
    }
    // Unknown probability is never invented; earliest known deadline takes precedence within a band.
    return (left.dueDate || '9999').localeCompare(right.dueDate || '9999')
      || (right.amountCny ?? -1) - (left.amountCny ?? -1)
      || left.orderNo.localeCompare(right.orderNo);
  };
  orderRisks.sort(rankRisks);
  kittingRisks.sort(rankRisks);
  qualityRisks.sort(rankRisks);
  // Source payloads may repeat an item as it moves through a refresh window.
  // Attention is a decision queue, not a raw event log: retain only the most
  // urgent record for the same business object within the same domain. Keep
  // different domains separate, since an order risk and its quality issue are
  // distinct decisions even when they reference the same sales order.
  const attentionByObject = new Map<string, DashboardRisk>();
  for (const [index, risk] of [...orderRisks, ...kittingRisks, ...qualityRisks].entries()) {
    // Kitting can return several allocation rows for one demand object. The
    // manager-facing Attention queue shows one decision per demand object;
    // line-level details remain available in the kitting source data.
    const entityId = risk.source === 'quality'
      ? risk.issueNo || risk.orderNo
      : risk.orderNo;
    const key = entityId ? `${risk.source}:${entityId}` : `${risk.source}:unresolved:${risk.evidenceRef || index}`;
    const previous = attentionByObject.get(key);
    if (!previous || rankRisks(risk, previous) < 0) attentionByObject.set(key, risk);
  }
  const attentionRisks = [...attentionByObject.values()].sort(rankRisks);
  const closedAttentionRisks = [...closedOrderRisks, ...closedKittingRisks, ...closedQualityRisks].sort(rankRisks);

  const decisions = attentionRisks.slice(0, 5).map((risk): DashboardDecision => {
    const shortage = shortagesByOrder.get(risk.orderNo);
    const materialCode = string(shortage?.material_code);
    const gapDays = optionalNumber(shortage?.gap_days ?? shortage?.shortage_days);
    const shortageQty = optionalNumber(shortage?.shortage_qty);
    const ecn = /ECN-\d+/i.exec(risk.summary)?.[0];
    const title = risk.source === 'quality' ? `${risk.issueNo} 质量异常处置建议（需品质负责人确认）`
      : risk.source === 'kitting' ? `${risk.orderNo} 齐套缺口处置建议（需计划 / 采购确认）`
      : materialCode
      ? `${materialCode} 缺料处置路径选择`
      : ecn ? `是否升级 ${ecn} 为跨域优先事项` : `${risk.orderNo} 风险是否升级处理`;
    const detail = materialCode
      ? `缺口 ${shortageQty === null ? '待核实' : shortageQty.toLocaleString('zh-CN')} 件 · 预计影响 ${gapDays ?? '待核实'} 天`
      : `${risk.amountCny === null ? '影响金额待核实' : `影响 ¥${Math.round(risk.amountCny / 10_000)} 万订单`} · ${risk.owner || '责任人待确认'}`;
    return {
      id: [risk.source, risk.issueNo || risk.orderNo, risk.demandType, risk.demandLineNo].filter(Boolean).join(':'),
      level: riskBandRank(risk) >= 3 ? 'L4' : 'L3',
      title,
      detail,
      probability: risk.probability,
      prompt: risk.source !== 'order' ? `${risk.prompt} 形成可供审批的决策材料，列出方案、影响与需谁审批；你只有建议权。` : materialCode
        ? `针对 ${materialCode} 缺料，比较加急、替代料、拆单方案，输出风险、evidence_refs 与审批建议。`
        : `针对 ${risk.orderNo} 的经营风险形成管理者决策材料，列出方案、影响、evidence_refs 与审批建议。`,
    };
  });

  const mcpSystems = options.registry.systems.filter((system) => system.kind === 'mcp');
  const resultWarnings = [...(options.warnings ?? [])];
  const orderError = record(orderPayload.error);
  const kittingError = record(kittingPayload.error);
  const qualityError = record(qualityPayload.error);
  const source = options.source || string(orderPayload.source) || string(shortagePayload.source) || 'MCP Runtime';
  const orderErrorMessage = string(orderError.message);
  if (orderErrorMessage) {
    resultWarnings.push(`${source} 订单数据不可用：${string(orderError.code) || 'UNKNOWN'} · ${orderErrorMessage}`);
  }
  const kittingErrorMessage = string(kittingError.message);
  if (kittingErrorMessage) {
    resultWarnings.push(`${source} 齐套数据不可用：${string(kittingError.code) || 'UNKNOWN'} · ${kittingErrorMessage}`);
  }
  const qualityErrorMessage = string(qualityError.message);
  if (qualityErrorMessage) {
    resultWarnings.push(`${source} 质量异常数据不可用：${string(qualityError.code) || 'UNKNOWN'} · ${qualityErrorMessage}`);
  }
  if (string(orderPayload.data_confidence).toLowerCase() === 'low') {
    resultWarnings.push(`${source} 返回低置信度数据`);
  }
  if (string(kittingPayload.data_confidence).toLowerCase() === 'low') {
    resultWarnings.push(`${source} 返回低置信度齐套数据`);
  }
  if (string(qualityPayload.data_confidence).toLowerCase() === 'low') {
    resultWarnings.push(`${source} 返回低置信度质量异常数据`);
  }
  resultWarnings.push(...productionSummary.warnings);
  const hasOrderData = Array.isArray(orderPayload.orders) || Array.isArray(orderPayload.data);
  const hasKittingData = Array.isArray(kittingPayload.data);
  const hasQualityData = Array.isArray(qualityPayload.data);
  // The HTTP caller supplies a clock for freshness enforcement. Keeping this
  // mapper clock-free allows historical exports to retain their stated status.
  const now = options.now;
  const maxAge = options.maxDataAgeMs ?? 24 * 60 * 60 * 1000;
  const domains: DashboardSnapshot['domains'] = {};
  const levels: string[] = [];
  for (const [name, payload] of Object.entries({ order: orderPayload, kitting: kittingPayload, quality: qualityPayload, shortage: shortagePayload })) {
    if (!Object.keys(payload).length) continue;
    const stamp = string(payload.data_as_of) || string(payload.generated_at);
    const page = record(payload.page);
    const rows = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.orders) ? payload.orders : Array.isArray(payload.shortages) ? payload.shortages : [];
    const parsed = parseDataAsOf(stamp);
    const stale = string(record(payload.error).code) === 'STALE_DATA' || payload.stale === true
      || (now !== undefined && Number.isFinite(parsed) && now - parsed > maxAge);
    let level = string(payload.data_confidence).toLowerCase();
    if (!['high', 'medium', 'low'].includes(level)) level = 'unknown';
    if (stale || page.truncated === true) level = 'low';
    else if (!Number.isFinite(parsed) || (now !== undefined && parsed > now + 5 * 60 * 1000)) level = 'unknown';
    if (level === 'low' || level === 'unknown') resultWarnings.push(name + '：数据置信度不足' + (stale ? '，数据已过期' : '，时间、完整性或可信度待核实'));
    if (page.truncated === true) resultWarnings.push(name + '：部分数据，统计不代表全部业务数据');
    for (const warning of Array.isArray(payload.warnings) ? payload.warnings : []) if (typeof warning === 'string') resultWarnings.push(name + '：' + warning);
    domains[name] = { dataAsOf: stamp || null, confidence: level, loaded: rows.length, total: optionalNumber(page.total), partial: page.truncated === true, queryScope: record(payload.query_scope) };
    levels.push(level);
  }
  if (productionSummary.available || productionSummary.dataAsOf || productionSummary.warnings.length) {
    domains.production = {
      dataAsOf: productionSummary.dataAsOf,
      confidence: productionSummary.confidence,
      loaded: productionSummary.workOrderCount + productionSummary.operationCount + productionSummary.linkedCount + productionSummary.reportCount + productionSummary.capacityCount,
      total: null,
      partial: false,
      queryScope: { capabilities: ['production_work_orders_list', 'production_operations_list', 'production_order_links_list', 'production_reports_list', 'production_capacity_list'] },
    };
  }
  const businessConfidence: 'high' | 'medium' | 'low' | 'unknown' = levels.includes('low') ? 'low' : !levels.length || levels.includes('unknown') ? 'unknown' : levels.includes('medium') ? 'medium' : 'high';
  const missingEvidence = attentionRisks.filter((risk) => !risk.evidenceRef).length;
  if (missingEvidence) resultWarnings.push(missingEvidence + ' 项风险未能唯一绑定证据，数据置信度不足；必须重新查询核实，不得引用其他事项证据');
  const probabilityCount = activeOrders.filter((order) => riskProbability(order) !== null).length;
  const riskLevelCount = activeOrders.filter((order) => riskBand(order) !== 'unknown').length;
  const signalCount = activeOrders.filter((order) => riskProbability(order) !== null || riskBand(order) !== 'unknown').length;
  const missingRiskSignals = activeOrders.length - signalCount;
  const ownerCount = activeOrders.filter((order) => Boolean(string(order.owner))).length;
  const dueDateCount = activeOrders.filter((order) => Boolean(string(order.due_date) || string(order.promised_date))).length;
  const shippingPlanCount = activeOrders.filter((order) => Boolean(string(order.shipping_plan))).length;
  const riskAssessmentAvailable = hasOrderData && !orderErrorMessage
    && ((activeOrders.length === 0 && terminalOrderCount > 0) || signalCount > 0);
  const riskAssessmentMessage = orderErrorMessage
    ? '订单风险数据不可用'
    : !hasOrderData
      ? '中控未返回可解析的订单数组，无法评估订单风险'
      : allOrders.length === 0
        ? '当前查询范围没有订单，未形成风险评估结论'
        : activeOrders.length === 0
          ? `当前查询范围仅返回 ${terminalOrderCount} 条已关闭订单（已完成或已取消），未形成在途风险`
        : signalCount === 0
          ? `中控已返回 ${activeOrders.length} 条在途订单，但未提供有效的 risk_probability 或 risk_level，风险未评估`
          : probabilityCount === 0
            ? `中控未提供 risk_probability；已按 ${riskLevelCount} 条订单的 risk_level 识别风险，概率排序待中台补充`
            : missingRiskSignals > 0
              ? `中控已返回 ${activeOrders.length} 条在途订单，其中 ${missingRiskSignals} 条缺少有效的 risk_probability 与 risk_level，风险识别不完整`
              : probabilityCount < activeOrders.length
                ? `中控仅为 ${probabilityCount}/${activeOrders.length} 条在途订单提供 risk_probability；其余订单按 risk_level 识别`
                : '';
  if (riskAssessmentMessage && !(hasOrderData && activeOrders.length === 0 && terminalOrderCount > 0)) {
    resultWarnings.push(riskAssessmentMessage);
  }
  return {
    generatedAt: new Date().toISOString(),
    dataAsOf: Object.values(domains).map((domain) => domain.dataAsOf).filter((stamp): stamp is string => Boolean(stamp)).sort()[0] ?? null,
    domains,
    attentionSummary: { events: attentionRisks.length, businessObjects: new Set(attentionRisks.map((risk) => risk.orderNo)).size },
    source,
    businessData: {
      source,
      available: (hasOrderData && !orderErrorMessage) || (hasKittingData && !kittingErrorMessage) || (hasQualityData && !qualityErrorMessage) || productionSummary.available,
      confidence: businessConfidence,
      ...(orderErrorMessage ? { message: `${string(orderError.code) || 'UNKNOWN'} · ${orderErrorMessage}` } : {}),
    },
    riskAssessment: {
      available: riskAssessmentAvailable,
      ...(riskAssessmentMessage ? { message: riskAssessmentMessage } : {}),
    },
    kittingAssessment: {
      available: hasKittingData && !kittingErrorMessage,
      shortageCount: kittingRisks.length,
      ...(kittingErrorMessage ? { message: `${string(kittingError.code) || 'UNKNOWN'} · ${kittingErrorMessage}` } : !hasKittingData ? { message: '中控未返回可解析的齐套结果数组' } : {}),
    },
    qualityAssessment: {
      available: hasQualityData && !qualityErrorMessage,
      openCount: qualityRisks.length,
      ...(qualityErrorMessage ? { message: `${string(qualityError.code) || 'UNKNOWN'} · ${qualityErrorMessage}` } : !hasQualityData ? { message: '中控未返回可解析的质量异常数组' } : {}),
    },
    productionAssessment: productionSummary,
    dataCompleteness: {
      activeOrderCount: activeOrders.length,
      riskSignalCount: signalCount,
      probabilityCount,
      riskLevelCount,
      ownerCount,
      dueDateCount,
      shippingPlanCount,
      evidenceRefCount: orderRisks.filter((risk) => Boolean(risk.evidenceRef)).length,
    },
    metrics: {
      capabilityCount: options.registry.capabilities.length,
      mcpServerCount: mcpSystems.length,
      highRiskCount: orderRisks.filter((risk) => riskBandRank(risk) >= 3).length,
      attentionCount: attentionRisks.length,
    },
    risks: orderRisks,
    attentionRisks,
    closedAttentionRisks,
    kittingRisks,
    qualityRisks,
    decisions,
    mcpServers: mcpSystems.map((system) => ({
      name: system.name,
      status: system.status,
      statusTone: system.statusTone,
      capabilityCount: options.registry.capabilities.filter((capability) => capability.server === system.name).length,
    })),
    warnings: [...new Set([...resultWarnings, ...(options.registry.warning ? [options.registry.warning] : [])])],
  };
}
