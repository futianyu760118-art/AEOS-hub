// Hub 前端统一时间展示：存储/API 仍使用 UTC，页面统一显示北京时间。
export const HUB_TIME_ZONE = 'Asia/Shanghai';

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatBeijingDateTime(value, options = {}) {
  const date = toDate(value);
  if (!date) return value ? String(value) : '—';
  return date.toLocaleString('zh-CN', {
    timeZone: HUB_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    ...options,
  });
}

export function formatBeijingTime(value, options = {}) {
  const date = toDate(value);
  if (!date) return value ? String(value) : '—';
  return date.toLocaleTimeString('zh-CN', {
    timeZone: HUB_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...options,
  });
}

export function formatBeijingDate(value, options = {}) {
  const date = toDate(value);
  if (!date) return value ? String(value) : '—';
  return date.toLocaleDateString('zh-CN', {
    timeZone: HUB_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...options,
  });
}

export function isSameBeijingDay(left, right = new Date()) {
  const leftDate = toDate(left);
  const rightDate = toDate(right);
  if (!leftDate || !rightDate) return false;
  return formatBeijingDate(leftDate) === formatBeijingDate(rightDate);
}
