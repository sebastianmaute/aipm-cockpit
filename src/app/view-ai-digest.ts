// src/app/view-ai-digest.ts
// Pure, i18n-free, CLOCK-FREE digests of what is currently on screen for the
// four views where the visible state IS the question. Deliberately Partial:
// the other 30 views cost nothing and nobody should fill them in for symmetry.
//
// Output lands in the VOLATILE prompt suffix (buildViewStateBlock). Keep each
// digest SHORT — it is paid on every message sent from that view.
import type { AppView } from "./nav-config";
import { FILTER_ALL, GROUP_NONE, type TaskFilterValues } from "./task-filters";

/** Real truncation, not a silent one — the digest says so when it caps. A
 *  silent cap reads as "these are all the rows", which is the failure mode
 *  this whole feature exists to remove. */
const VISIBLE_ROW_SAMPLE_CAP = 15;

export interface DigestInput {
  tasks: readonly {
    id: number;
    taskName: string;
    status: string;
    assignee: string;
    dueDate: string;
  }[];
  /** The view's ACTIVE filter state — pass `effectiveFilters`, never the raw
   *  filter state (an orphaned filter can point at a value no task carries
   *  any more; `effectiveFilters` is what the table and the <select>s both
   *  actually apply, see AGENTS.md "Orphaned list filters"). Sentinel for
   *  "no filter" is the shared `FILTER_ALL` ("All"). */
  filters?: TaskFilterValues;
  /** Only `.length` is read today (workload/gantt/budget report counts, not
   *  fields) — widen to a concrete shape when a digest needs actual fields. */
  resources?: readonly unknown[];
  /** Only `.length` is read today — see `resources`. */
  budgets?: readonly unknown[];
  /** Only `.length` is read today — see `resources`. */
  milestones?: readonly unknown[];
  /** Today, passed IN. Unread by all four digests today — kept required so
   *  the first date-based digest (an overdue count for open-points is the
   *  obvious next one) doesn't have to touch every call site and test to add
   *  it. Never read a clock here — a clock makes the digest untestable and
   *  non-deterministic. */
  today: string;
}

export type DigestFn = (input: DigestInput) => string;

/** Filters out FILTER_ALL entries; keeps everything else, including an empty
 *  string (GROUP_NONE = "no group" is a real, active filter value — not the
 *  same thing as "All"). */
function activeFilters(filters: TaskFilterValues | undefined): string[] {
  if (!filters) return [];
  return Object.entries(filters)
    .filter(([, v]) => v !== FILTER_ALL)
    .map(([k, v]) => `${k}=${v === GROUP_NONE ? "(none)" : v}`);
}

const openPoints: DigestFn = (i) => {
  const filters = activeFilters(i.filters);
  const lines = [`${i.tasks.length} task(s) visible in the table.`];
  if (filters.length > 0) {
    lines.push(
      `Active filters: ${filters.join(", ")}. Rows outside these filters are NOT shown.`,
    );
  } else {
    lines.push("No filters active — the table shows every task.");
  }
  const sample = i.tasks
    .slice(0, VISIBLE_ROW_SAMPLE_CAP)
    .map((t) => `#${t.id} ${t.taskName} [${t.status}]`);
  if (sample.length > 0) lines.push(`Visible rows: ${sample.join("; ")}`);
  if (i.tasks.length > sample.length) {
    lines.push(`(${i.tasks.length - sample.length} further visible rows not listed.)`);
  }
  return lines.join("\n");
};

const workload: DigestFn = (i) => {
  const people = (i.resources ?? []).length;
  return `Workload grid for ${people} resource(s).`;
};

const gantt: DigestFn = (i) =>
  `Gantt showing ${i.tasks.length} task(s) and ${(i.milestones ?? []).length} milestone(s).`;

const budget: DigestFn = (i) => `Budget planner with ${(i.budgets ?? []).length} bucket(s).`;

export const VIEW_AI_DIGEST: Partial<Record<AppView, DigestFn>> = {
  "open-points": openPoints,
  workload,
  gantt,
  budget,
};

export function digestForView(view: AppView, input: DigestInput): string | undefined {
  const fn = VIEW_AI_DIGEST[view];
  return fn ? fn(input) : undefined;
}
