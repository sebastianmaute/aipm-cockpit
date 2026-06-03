// RAG (Red/Amber/Green) health derivation for steering-committee reporting.
//
// Two surfaces consume this:
//   • The task list — a colored dot before each row.
//   • The reports view — group-level aggregation.
//
// Auto-rule order, top to bottom (first match wins):
//   1. `healthOverride` set on the task     → that color
//   2. completedDate set                    → Green
//   3. dueDate before today (overdue)       → Red
//   4. blockers field non-empty             → Red
//   5. dueDate === today                    → Amber
//   6. workdays until dueDate ≤ 3           → Amber
//   7. otherwise                            → Green
//
// Working-day math reuses `workdaysUntil` from due-dates.ts so the Amber
// window matches the existing "Due soon (≤3 work days)" line in reports.

import { workdaysUntil } from "./due-dates";
import { type Lang, t } from "./i18n";
import type { Task } from "./types";

export type Health = "R" | "A" | "G";

export const HEALTH_VALUES: readonly Health[] = ["R", "A", "G"] as const;

/** Drivers we expose as i18n keys; the UI looks these up. The order they
 *  appear in `drivers` is the order they get joined into the comma-list
 *  the user sees ("overdue, blocked"), so keep it stable. */
export type HealthDriver =
  | "manual"
  | "overdue"
  | "blocked"
  | "dueToday"
  | "dueSoon"
  | "completed"
  | "onTrack";

export type TaskHealth = {
  color: Health;
  /** Why the task got this color. May contain "onTrack" for Green tasks. */
  drivers: HealthDriver[];
};

const AMBER_WORKDAY_THRESHOLD = 3;

/** Pure: given a single task, today's date, and the configured non-working
 *  holidays, returns the RAG color plus a list of reasons. */
export function computeTaskHealth(
  task: Task,
  todayISO: string,
  holidays: ReadonlySet<string> = new Set<string>(),
): TaskHealth {
  if (task.healthOverride) {
    return { color: task.healthOverride, drivers: ["manual"] };
  }
  if (task.completedDate) {
    return { color: "G", drivers: ["completed"] };
  }

  const drivers: HealthDriver[] = [];
  let color: Health = "G";

  if (task.dueDate && task.dueDate < todayISO) {
    color = "R";
    drivers.push("overdue");
  }

  const blockers = (task.blockers ?? "").trim();
  if (blockers.length > 0) {
    color = "R";
    drivers.push("blocked");
  }

  // Amber only applies if we haven't already gone Red.
  if (color !== "R" && task.dueDate) {
    if (task.dueDate === todayISO) {
      color = "A";
      drivers.push("dueToday");
    } else if (task.dueDate > todayISO) {
      // workdaysUntil takes a Set<string>; widen the readonly type without
      // copying when the caller already passed a Set.
      const hs =
        holidays instanceof Set ? holidays : new Set<string>(holidays);
      const days = workdaysUntil(task.dueDate, todayISO, hs);
      if (days <= AMBER_WORKDAY_THRESHOLD) {
        color = "A";
        drivers.push("dueSoon");
      }
    }
  }

  if (drivers.length === 0) drivers.push("onTrack");

  return { color, drivers };
}

export type GroupHealth = {
  color: Health;
  counts: Record<Health, number>;
  /** Aggregated reasons across the group, deduped. E.g.
   *  `["overdue", "blocked"]` if at least one task is overdue and at least
   *  one (possibly the same) is blocked. */
  drivers: HealthDriver[];
};

/**
 * Worst-case aggregation: any Red → Red; else any Amber → Amber; else Green.
 *
 * The driver list collects per-task drivers but excludes the noisy ones
 * ("onTrack", "completed") so the steering view doesn't show "Group is
 * Red — also 12 tasks are on track".
 */
export function computeGroupHealth(
  tasks: readonly Task[],
  todayISO: string,
  holidays: ReadonlySet<string> = new Set<string>(),
): GroupHealth {
  const counts: Record<Health, number> = { R: 0, A: 0, G: 0 };
  const seenDrivers = new Set<HealthDriver>();

  for (const t of tasks) {
    const h = computeTaskHealth(t, todayISO, holidays);
    counts[h.color] += 1;
    if (h.color !== "G") {
      for (const d of h.drivers) seenDrivers.add(d);
    } else if (h.drivers.includes("manual")) {
      // A user-pinned Green is a deliberate signal worth surfacing.
      seenDrivers.add("manual");
    }
  }

  const color: Health = counts.R > 0 ? "R" : counts.A > 0 ? "A" : "G";

  // Stable, human-friendly order for the joined string.
  const order: HealthDriver[] = [
    "manual",
    "overdue",
    "blocked",
    "dueToday",
    "dueSoon",
  ];
  const drivers = order.filter((d) => seenDrivers.has(d));

  return { color, counts, drivers };
}

/** Translated short name for a RAG color ("Red" / "Amber" / "Green"). */
export function healthColorName(color: Health, lang: Lang): string {
  return t(
    lang,
    color === "R" ? "healthRed" : color === "A" ? "healthAmber" : "healthGreen",
  );
}

/** "{Color}: {driver1}, {driver2}" — the string the UI shows on hover/aria. */
export function formatHealthTooltip(health: TaskHealth, lang: Lang): string {
  const name = healthColorName(health.color, lang);
  const driverKeys: Record<HealthDriver,
    | "healthDriverManual"
    | "healthDriverOverdue"
    | "healthDriverBlocked"
    | "healthDriverDueToday"
    | "healthDriverDueSoon"
    | "healthDriverCompleted"
    | "healthDriverOnTrack"> = {
    manual: "healthDriverManual",
    overdue: "healthDriverOverdue",
    blocked: "healthDriverBlocked",
    dueToday: "healthDriverDueToday",
    dueSoon: "healthDriverDueSoon",
    completed: "healthDriverCompleted",
    onTrack: "healthDriverOnTrack",
  };
  const drivers = health.drivers
    .map((d) => t(lang, driverKeys[d]))
    .join(", ");
  return t(lang, "healthTooltip", name, drivers);
}

/**
 * Tailwind class for the RAG status dot, indexed by health color.
 * Standard steering-committee palette, distinct from the AIPM-pink
 * "overdue" highlight used elsewhere.
 */
export const healthDot: Record<Health, string> = {
  R: "bg-red-500",
  A: "bg-amber-500",
  G: "bg-emerald-500",
};

/**
 * Tailwind text-colour class for a RAG value, brand palette (matches the
 * Reports group dots). Used to tint inline status text, e.g. the dashboard
 * "Overall: Green" label.
 */
export const healthText: Record<Health, string> = {
  R: "text-AIPM-pink",
  A: "text-AIPM-purple",
  G: "text-AIPM-green",
};

