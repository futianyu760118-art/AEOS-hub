export interface DashboardReadPlan {
  orders: { date_from: string; date_to: string };
  kitting: { required_date_start: string; required_date_end: string };
  capacity: { date_start: string; date_end: string };
}

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
