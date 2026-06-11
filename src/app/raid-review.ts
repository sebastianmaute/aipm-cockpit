import type { RaidItem, RaidStatus } from "./types";

export type RaidReviewReason = "overdue" | "stale";

export type RaidReviewItem = {
  item: RaidItem;
  reason: RaidReviewReason; // "overdue" wins when both apply
  daysOverdue: number;      // whole days past targetDate, else 0
  daysSinceReview: number;  // whole days since last touch
};

// Terminal statuses — an item in one of these is considered resolved and is not
// nudged for review. raid.ts exposes `isTerminalStatus(status, category)`, but
// that predicate is category-aware (e.g. "Resolved" is terminal only for "I",
// not "R"); review nudging treats any of these as resolved regardless of
// category, so we keep a flat set here rather than reusing that helper.
const TERMINAL: ReadonlySet<RaidStatus> = new Set<RaidStatus>([
  "Closed", "Resolved", "Delivered", "Validated", "Invalidated",
]);

function isActive(item: RaidItem): boolean {
  return !item.closedDate && !TERMINAL.has(item.status);
}

/** Whole-day difference (a - b) for two YYYY-MM-DD dates; negative if a < b. */
function dayDiff(a: string, b: string): number {
  const da = Date.parse(a + "T00:00:00Z");
  const db = Date.parse(b + "T00:00:00Z");
  return Math.round((da - db) / 86_400_000);
}

/** Last-touch date (YYYY-MM-DD): localModifiedAt date part, else raisedDate. */
function lastTouch(item: RaidItem): string {
  return item.localModifiedAt ? item.localModifiedAt.slice(0, 10) : item.raisedDate;
}

export function getRaidReviewItems(
  raid: readonly RaidItem[],
  today: string,
  reviewIntervalDays: number,
): RaidReviewItem[] {
  const out: RaidReviewItem[] = [];
  for (const item of raid) {
    if (!isActive(item)) continue;
    const daysOverdue = item.targetDate && item.targetDate < today ? dayDiff(today, item.targetDate) : 0;
    const daysSinceReview = dayDiff(today, lastTouch(item));
    const overdue = daysOverdue > 0;
    const stale = daysSinceReview >= reviewIntervalDays;
    if (!overdue && !stale) continue;
    out.push({ item, reason: overdue ? "overdue" : "stale", daysOverdue, daysSinceReview });
  }
  out.sort((a, b) => {
    if (a.reason !== b.reason) return a.reason === "overdue" ? -1 : 1;
    if (b.daysOverdue !== a.daysOverdue) return b.daysOverdue - a.daysOverdue;
    return b.daysSinceReview - a.daysSinceReview;
  });
  return out;
}

export function summarizeRaidReview(items: RaidReviewItem[]): { overdue: number; stale: number } {
  let overdue = 0;
  let stale = 0;
  for (const i of items) {
    if (i.reason === "overdue") overdue++;
    else stale++;
  }
  return { overdue, stale };
}
