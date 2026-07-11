// Rate-card day/hour materialization.
//
// DAY rates are the source of truth the user edits by default; the HOURLY
// `internalRate`/`externalRate` remain the cost-math source consumed everywhere
// (periodCost, budget-report, EVM, reports) — so both units are kept mutually
// consistent by materializing one from the other whenever a rate cell is edited.
//
// `rateBasis` records which unit the user drives:
//   - "day":  internalRateDay/externalRateDay authoritative → hourly derived.
//   - "hour": internalRate/externalRate authoritative → day derived.
//
// Pure + i18n-free. Never divides by zero (guards workdayHours <= 0 → 8).
import type { Role } from "./types";

/** Fallback conversion factor when the configured workday hours are invalid. */
export const DEFAULT_WORKDAY_HOURS = 8;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Return a new Role with both the day and hourly rates made consistent for the
 * current `rateBasis`. The authoritative unit is preserved; the sibling unit is
 * (re)derived from it using `workdayHours` (<= 0 falls back to 8).
 */
export function materializeRoleRates(role: Role, workdayHours: number): Role {
  const wdh = Number.isFinite(workdayHours) && workdayHours > 0 ? workdayHours : DEFAULT_WORKDAY_HOURS;
  const basis = role.rateBasis === "day" ? "day" : "hour";
  if (basis === "day") {
    const internalRateDay = round2(role.internalRateDay ?? 0);
    const externalRateDay = round2(role.externalRateDay ?? 0);
    return {
      ...role,
      rateBasis: "day",
      internalRateDay,
      externalRateDay,
      internalRate: round2(internalRateDay / wdh),
      externalRate: round2(externalRateDay / wdh),
    };
  }
  return {
    ...role,
    rateBasis: "hour",
    internalRate: round2(role.internalRate ?? 0),
    externalRate: round2(role.externalRate ?? 0),
    internalRateDay: round2((role.internalRate ?? 0) * wdh),
    externalRateDay: round2((role.externalRate ?? 0) * wdh),
  };
}

/**
 * Re-derive the hourly cost rate on every DAY-basis role from `workdayHours`.
 * Hour-basis roles are untouched (their hourly is authoritative; the day figure
 * is display-only). Returns the SAME array reference when there are no day-basis
 * roles, so a React caller can skip a needless state update / re-render.
 */
export function rematerializeDayBasisRoles(roles: readonly Role[], workdayHours: number): Role[] {
  return roles.some((r) => r.rateBasis === "day")
    ? roles.map((r) => (r.rateBasis === "day" ? materializeRoleRates(r, workdayHours) : r))
    : (roles as Role[]);
}
