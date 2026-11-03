import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface DashboardReadPlan {
  orders: { date_from: string; date_to: string };
  kitting: { required_date_start: string; required_date_end: string };
  capacity: { date_start: string; date_end: string };
}

export interface DashboardReadLimits {
  /** 单页条数，中台上限 200。 */
  pageSize: number;
  orders: number;
  shortages: number;
  kitting: number;
  quality: number;
  workOrders: number;
  capacity: number;
  productionScoped: number;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const dashboardReadConfigFile = process.env.AEOS_DASHBOARD_READ_CONFIG_FILE?.trim()
  || join(root, 'config', 'dashboard-read.json');

export const DEFAULT_DASHBOARD_READ_LIMITS: DashboardReadLimits = {
  pageSize: 200,
  orders: 3,
  shortages: 10,
  kitting: 5,
  quality: 5,
  workOrders: 5,
  capacity: 3,
  productionScoped: 5,
};

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Keeps dashboard reads within one explicit, shared and read-only time window. */
export function dashboardReadPlan(now = new Date()): DashboardReadPlan {
  const from = new Date(now);
  const to = new Date(now);
  from.setUTCDate(from.getUTCDate() - 30);
  to.setUTCDate(to.getUTCDate() + 60);
  const start = dateOnly(from);
  const end = dateOnly(to);
  return {
    orders: { date_from: start, date_to: end },
    kitting: { required_date_start: start, required_date_end: end },
    capacity: { date_start: start, date_end: end },
  };
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.trunc(parsed), max));
}

/**
 * 读取看板分页上限（config/dashboard-read.json）。文件缺失/损坏时回落默认值；
 * 上限调大更完整、更慢，调小更快但标记“部分数据”。
 */
export function loadDashboardReadLimits(file = dashboardReadConfigFile): DashboardReadLimits {
  const limits: DashboardReadLimits = { ...DEFAULT_DASHBOARD_READ_LIMITS };
  try {
    if (!existsSync(file)) return limits;
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') return limits;
    limits.pageSize = clampInt(raw.pageSize, limits.pageSize, 1, 200);
    const source = raw.limits && typeof raw.limits === 'object' && !Array.isArray(raw.limits)
      ? raw.limits as Record<string, unknown>
      : {};
    for (const key of ['orders', 'shortages', 'kitting', 'quality', 'workOrders', 'capacity', 'productionScoped'] as const) {
      limits[key] = clampInt(source[key], limits[key], 1, 50);
    }
    return limits;
  } catch {
    return limits;
  }
}
