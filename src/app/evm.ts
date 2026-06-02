// Pure Earned Value Management (EVM) logic. No React, no I/O — testable core.
import type { Role, Task } from "./types";

export type EvmMetrics = {
  pv: number; // hours
  ev: number; // hours
  ac: number; // hours
  spi: number | null; // null when pv === 0
  cpi: number | null; // null when ac === 0
  sv: number; // hours (ev - pv)
  cv: number; // hours (ev - ac)
  money: { pv: number; ev: number; ac: number; sv: number; cv: number } | null; // null when no rate
  coverage: { withEstimate: number; total: number };
};

const MIN_PER_HOUR = 60;

/** Arithmetic mean of role internal rates (EUR/h); 0 when there are no roles. */
export function projectBlendedInternalRate(roles: readonly Role[]): number {
  if (roles.length === 0) return 0;
  const sum = roles.reduce((acc, r) => acc + (r.internalRate ?? 0), 0);
  return sum / roles.length;
}

/** Task-effort EVM as of `todayISO`. A task participates iff originalEstimateMinutes > 0.
 *  PV = estimate of tasks due by today; EV = estimate of completed tasks; AC = time spent. */
export function computeEvm(
  tasks: readonly Task[],
  todayISO: string,
  opts: { blendedRate?: number } = {},
): EvmMetrics {
  let pvMin = 0;
  let evMin = 0;
  let acMin = 0;
  let withEstimate = 0;
  for (const t of tasks) {
    const est = t.originalEstimateMinutes ?? 0;
    if (est <= 0) continue;
    withEstimate++;
    if (t.dueDate && t.dueDate <= todayISO) pvMin += est;
    if (t.completedDate && t.completedDate <= todayISO) evMin += est;
    acMin += t.timeSpentMinutes ?? 0;
  }
  const pv = pvMin / MIN_PER_HOUR;
  const ev = evMin / MIN_PER_HOUR;
  const ac = acMin / MIN_PER_HOUR;
  const spi = pv > 0 ? ev / pv : null;
  const cpi = ac > 0 ? ev / ac : null;
  const sv = ev - pv;
  const cv = ev - ac;
  const rate = opts.blendedRate ?? 0;
  const money = rate > 0
    ? { pv: pv * rate, ev: ev * rate, ac: ac * rate, sv: sv * rate, cv: cv * rate }
    : null;
  return { pv, ev, ac, spi, cpi, sv, cv, money, coverage: { withEstimate, total: tasks.length } };
}
