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
  /** ★★★ EVERY OTHER NARROWING THE PANE APPLIES, already rendered as text.
   *  `TaskFilterValues` is ONLY {assignee, group, label} — but the Open Points
   *  table also applies a priority filter, a debounced full-text search,
   *  hide-externals, the RAG health filter and hide-finished. Without these the
   *  digest emitted "No filters active — the table shows every task" while a
   *  search was hiding 117 of 120 rows, which is worse than silence: that
   *  sentence exists to tell the model it need not call a tool. */
  extraFilters?: readonly string[];
  /** Which Open Points surface is rendered. NOT cosmetic: the board and
   *  swimlanes do not apply hide-finished (table-only), so the caller feeds a
   *  different row set per mode — saying "table" over a board would name the
   *  wrong surface AND the wrong count. Defaults to "table". */
  surface?: "table" | "board" | "swimlanes";
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
  const filters = [...activeFilters(i.filters), ...(i.extraFilters ?? [])];
  const surface = i.surface ?? "table";
  const unit = surface === "table" ? "row(s)" : "card(s)";
  const lines = [`${i.tasks.length} task(s) visible as ${unit} in the ${surface}.`];
  if (filters.length > 0) {
    lines.push(
      `Active filters: ${filters.join(", ")}. Tasks outside these filters are NOT shown.`,
    );
  } else {
    lines.push(`No filters active — the ${surface} shows every task.`);
  }
  const sample = i.tasks
    .slice(0, VISIBLE_ROW_SAMPLE_CAP)
    .map((t) => `#${t.id} ${t.taskName} [${t.status}]`);
  // ★ Both strings derive from the surface, never hardcode "rows" — a board
  // digest that announces "card(s) in the board" and then lists "Visible rows:"
  // names the wrong surface twice per message, which is what `surface` exists
  // to prevent. (Plain plural here, not the "(s)" form used for the count.)
  const plural = surface === "table" ? "rows" : "cards";
  if (sample.length > 0) lines.push(`Visible ${plural}: ${sample.join("; ")}`);
  if (i.tasks.length > sample.length) {
    lines.push(`(${i.tasks.length - sample.length} further visible ${plural} not listed.)`);
  }
  return lines.join("\n");
};

// ★★★ THESE THREE ARE PROJECT TOTALS, NOT WHAT IS ON SCREEN, AND EACH SAYS SO.
// Only open-points above is fed the pane's true visible row set. The others read
// workspace-wide arrays because their panes filter through state this module
// cannot reach without duplicating the panel's own logic — which is exactly how
// a digest silently drifts from the chart it claims to describe. An earlier
// revision printed "Gantt showing N task(s)" under a wrapper promising "after
// their filters and sorting": two overclaims stacked. State the scope in the
// LINE, because the wrapper is shared by all four views and cannot qualify one.
const workload: DigestFn = (i) => {
  const people = (i.resources ?? []).length;
  return (
    `Workload grid over ${people} resource(s) in the project. ` +
    "This is the directory count: the pane's Hide-externals toggle and its extra rows " +
    "for unlinked assignees are NOT reflected, so it may differ from the rows on screen."
  );
};

const gantt: DigestFn = (i) =>
  `Gantt over ${i.tasks.length} task(s) and ${(i.milestones ?? []).length} milestone(s) in the project. ` +
  "These are project totals, NOT the bars drawn: the chart applies its own status, priority " +
  "and assignee filters, hides milestones when that toggle is off, and never draws a task " +
  "with no due date. Call a tool if the exact on-chart set matters.";

const budget: DigestFn = (i) =>
  `Budget planner with ${(i.budgets ?? []).length} bucket(s) in the project. ` +
  "The pane's own bucket filter is NOT reflected in this count.";

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
