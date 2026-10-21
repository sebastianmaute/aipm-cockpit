// Budget setup checklist: pure, i18n-free logic. The first-run Budget view
// ticks each step off from workspace state (nothing new is persisted on the
// Workspace); only the "hide it" choice is remembered, per device and project.
import type { BudgetBucket, Resource, Role } from "./types";

/** 1 = rates, 2 = people, 3 = bucket, 4 = bookings (optional). */
export type BudgetSetupStep = 1 | 2 | 3 | 4;

export interface BudgetSetupSteps {
  ratesDone: boolean;
  peopleDone: boolean;
  bucketDone: boolean;
  bookingsDone: boolean;
  /** First step not done; 4 (optional) only counts after 1-3. `null` when all done. */
  next: BudgetSetupStep | null;
  /** §762 — false when the deployment switched TimeLog off: step 4 is then not a step at
   *  all (not shown, not counted, never next). Absent means applicable. */
  bookingsApplicable?: boolean;
}

export interface BudgetSetupInput {
  roles: readonly Role[];
  resources: readonly Resource[];
  buckets: readonly BudgetBucket[];
  /** §762 — default true; the panel passes false when TimeLog is switched off. */
  bookingsApplicable?: boolean;
}

/** Total steps shown in "Budget setup: N of 4". */
export const BUDGET_SETUP_STEP_COUNT = 4;

const DISMISS_PREFIX = "aipm-cockpit:budget-setup-dismissed:";
const DISMISSED = "1";

function hasPositive(hours: Record<string, number>): boolean {
  return Object.values(hours).some((h) => h > 0);
}

/** A day-rate role stores a DERIVED hourly `internalRate`/`externalRate` (the
 *  cost math reads those, never the `*Day` fields), so reading the hourly pair
 *  is correct for both rate bases. */
function hasRate(r: Role): boolean {
  return r.internalRate > 0 || r.externalRate > 0;
}

/** Booked actuals live in `actualHours` on a bucket's role allocations and, in
 *  blended mode, on its discipline allocations. Planned `budgetHours` never count. */
function hasBookings(b: BudgetBucket): boolean {
  return b.allocations.some((a) => hasPositive(a.actualHours))
    || (b.disciplineAllocations ?? []).some((a) => hasPositive(a.actualHours));
}

export function budgetSetupSteps({ roles, resources, buckets, bookingsApplicable = true }: BudgetSetupInput): BudgetSetupSteps {
  const ratesDone = roles.some(hasRate);
  const peopleDone = resources.length > 0;
  const bucketDone = buckets.length > 0;
  const bookingsDone = buckets.some(hasBookings);
  const next: BudgetSetupStep | null =
    !ratesDone ? 1 : !peopleDone ? 2 : !bucketDone ? 3 : bookingsApplicable && !bookingsDone ? 4 : null;
  return { ratesDone, peopleDone, bucketDone, bookingsDone, next, bookingsApplicable };
}

export function budgetSetupDoneCount(s: BudgetSetupSteps): number {
  const bookings = s.bookingsApplicable !== false && s.bookingsDone;
  return [s.ratesDone, s.peopleDone, s.bucketDone, bookings].filter(Boolean).length;
}

/** The N of "N of M": BUDGET_SETUP_STEP_COUNT, less the bookings step when it does not apply. */
export function budgetSetupStepCount(s: BudgetSetupSteps): number {
  return s.bookingsApplicable === false ? BUDGET_SETUP_STEP_COUNT - 1 : BUDGET_SETUP_STEP_COUNT;
}

export function budgetSetupDismissKey(projectKey: string): string {
  return `${DISMISS_PREFIX}${projectKey}`;
}

export function isBudgetSetupDismissed(projectKey: string): boolean {
  try {
    return window.localStorage.getItem(budgetSetupDismissKey(projectKey)) === DISMISSED;
  } catch {
    return false;
  }
}

export function setBudgetSetupDismissed(projectKey: string): void {
  try {
    window.localStorage.setItem(budgetSetupDismissKey(projectKey), DISMISSED);
  } catch {
    // Storage refused: the line simply reappears on the next visit.
  }
}
