// 对话内写操作意图：把“改写某订单的交付日期/备注/状态”解析为受控写请求。
// 只解析明确的订单号 + 操作 + 目标值；缺一不可，交给助手追问，不做猜测。
import { extractBusinessIdentifier } from './hub-intent-router.ts';

export type WriteOperation = 'order.update_note' | 'order.update_status' | 'order.update_delivery_date';

export type WriteIntent =
  | { kind: 'write'; operation: WriteOperation; orderNo: string; changes: Record<string, string>; raw: string }
  | { kind: 'confirm' }
  | { kind: 'cancel' };

const CONFIRM_PATTERN = /^(确认|批准|执行|同意|可以)$/;
const CANCEL_PATTERN = /^(取消|放弃|不执行|算了)$/;
const ACTION_PATTERN = /(改写|修改|更新|调整|变更)/;
const DATE_PATTERN = /(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/;

function normalizeDate(match: RegExpMatchArray): string {
  const year = match[1]!.padStart(4, '0');
  const month = match[2]!.padStart(2, '0');
  const day = match[3]!.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function cleanValue(value: string): string {
  return value.trim().replace(/^[：:，,。；;\s]+/, '').replace(/[。；;]+$/, '').trim();
}

/** 解析写操作意图；返回 null 表示不是写操作，交给原对话流程。 */
export function parseWriteIntent(text: string): WriteIntent | null {
  const raw = String(text || '').trim();
  if (!raw) return null;
  if (CONFIRM_PATTERN.test(raw)) return { kind: 'confirm' };
  if (CANCEL_PATTERN.test(raw)) return { kind: 'cancel' };
  if (!ACTION_PATTERN.test(raw)) return null;

  const orderNo = extractBusinessIdentifier(raw);
  if (!orderNo) return null;

  if (/(交付日期|交期|发货日期|出货日期)/.test(raw)) {
    const date = raw.match(DATE_PATTERN);
    if (!date) return null;
    return { kind: 'write', operation: 'order.update_delivery_date', orderNo, changes: { deliveryDate: normalizeDate(date) }, raw };
  }

  if (/(备注|说明)/.test(raw)) {
    const value = raw.match(/(?:备注|说明)(?:改为|改成|更新为|设为|为|成|：|:)\s*(.+)$/);
    const remark = cleanValue(value?.[1] ?? '');
    if (!remark) return null;
    return { kind: 'write', operation: 'order.update_note', orderNo, changes: { remark }, raw };
  }

  if (/(订单)?状态/.test(raw)) {
    const value = raw.match(/状态(?:改为|改成|更新为|设为|为|成|：|:)\s*(.+)$/);
    const status = cleanValue(value?.[1] ?? '');
    if (!status) return null;
    return { kind: 'write', operation: 'order.update_status', orderNo, changes: { status }, raw };
  }

  return null;
}
