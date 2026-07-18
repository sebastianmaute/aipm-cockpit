// RAG (Red/Amber/Green) health derivation for steering-committee reporting.
//
// Two surfaces consume this:
//   • The task list — a colored dot before each row.
//   • The reports view — group-level aggregation.
//
// Auto-rule order, top to bottom (first match wins):
//   1. `healthOverride` set on the task     → that color
//   2. finished (Done or Cancelled)         → Green
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
import { isTaskFinished } from "./task-status";
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
  | "cancelled"
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
  // A finished task is non-active: it must not be flagged red/amber/overdue.
  // Done carries completedDate; Cancelled is terminal with no completedDate, so
  // also guard on isTaskFinished so Cancelled takes the same Green path.
  if (task.completedDate || isTaskFinished(task)) {
    return {
      color: "G",
      drivers: [task.status === "Cancelled" ? "cancelled" : "completed"],
    };
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

/** Toolbar RAG-filter selection for the task list. "all" is the no-op default. */
export type HealthFilter = "all" | "red" | "amber" | "green";

/** Map a concrete health-filter selection to the RAG color it keeps. */
export const HEALTH_FILTER_COLOR: Record<Exclude<HealthFilter, "all">, Health> = {
  red: "R",
  amber: "A",
  green: "G",
};

/**
 * Pure: keep only the tasks whose derived RAG matches the filter. "all" is a
 * no-op that returns the input array unchanged (reference-stable, so a caller's
 * memo isn't busted when no filter is active).
 */
export function filterTasksByHealth<T extends Task>(
  tasks: readonly T[],
  filter: HealthFilter,
  todayISO: string,
  holidays: ReadonlySet<string> = new Set<string>(),
): readonly T[] {
  if (filter === "all") return tasks;
  const want = HEALTH_FILTER_COLOR[filter];
  return tasks.filter(
    (task) => computeTaskHealth(task, todayISO, holidays).color === want,
  );
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
 * ("onTrack", "completed", "cancelled") so the steering view doesn't show "Group is
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
    | "healthDriverCancelled"
    | "healthDriverOnTrack"> = {
    manual: "healthDriverManual",
    overdue: "healthDriverOverdue",
    blocked: "healthDriverBlocked",
    dueToday: "healthDriverDueToday",
    dueSoon: "healthDriverDueSoon",
    completed: "healthDriverCompleted",
    cancelled: "healthDriverCancelled",
    onTrack: "healthDriverOnTrack",
  };
  const drivers = health.drivers
    .map((d) => t(lang, driverKeys[d]))
    .join(", ");
  return t(lang, "healthTooltip", name, drivers);
}

/**
 * Tailwind class for the RAG status dot, indexed by health color.
 * Uses CSS role tokens (--rag-red/amber/green) so the dot color reflows when
 * the CI style switches. AIPM token values equal bg-red-500/bg-amber-500/
 * bg-emerald-500, so the rendered look is identical for existing users.
 */
export const healthDot: Record<Health, string> = {
  R: "bg-[var(--rag-red)]",
  A: "bg-[var(--rag-amber)]",
  G: "bg-[var(--rag-green)]",
};

/**
 * Tailwind text-colour class for a RAG value. Uses CSS role tokens
 * (--rag-red-text/amber-text/green-text) so text color reflows when the CI
 * style switches. AIPM token values equal text-ui-pink-strong/text-ui-purple/
 * text-ui-green-strong, so the rendered look is identical for existing users.
 * Used to tint inline status text, e.g. the dashboard "Overall: Green" label.
 */
export const healthText: Record<Health, string> = {
  R: "text-[var(--rag-red-text)]",
  A: "text-[var(--rag-amber-text)]",
  // AA-accessible green for text on light surfaces (brand green is only 2.26:1
  // on white). See --ui-green-strong in globals.css.
  G: "text-[var(--rag-green-text)]",
};

