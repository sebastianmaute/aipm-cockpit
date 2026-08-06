"use client";
// src/app/use-view-digest.ts
// Glue between the LIVE pane state and the pure `view-ai-digest` engine.
//
// ★★★ WHY THIS FILE EXISTS AT ALL. The digest tells the model what the user can
// SEE, and getting that wrong is worse than omitting it — the VIEW STATE block
// tells the model it need not call a tool, so a wrong digest actively suppresses
// the tool call that would have corrected it. Assembling the input needs pane
// state the dispatcher does not hold (the RAG health filter, the debounced
// search, the effective view mode). Keep it out of `use-chat-dispatcher.ts`:
// that file has little headroom under the 800-line gate, and this assembly only
// grows as panes gain filters.
//
// ★★ It calls `visibleTaskRows` — the SAME function the Open Points table and
// useBulkOperations call — rather than reimplementing the narrowing. That file's
// own header records what happens otherwise: an earlier consumer read
// `filteredSortedTasks`, which is upstream of BOTH the health filter and
// hide-finished, and "reported on — and acted on — rows the table was not
// rendering". This digest shipped with exactly that bug.
import { useMemo, useSyncExternalStore } from "react";
import { useFilters } from "./filters-context";
import { getAppearanceSnapshot, subscribeAppearance } from "./project-appearance-prefs";
import { filterTasksByHealth } from "./health";
import { visibleTaskRows } from "./visible-task-rows";
import { digestForView } from "./view-ai-digest";
import { FILTER_ALL, type TaskFilterValues } from "./task-filters";
import type { AppView } from "./nav-config";
import type { Task, Milestone, BudgetBucket, Resource } from "./types";
import type { Settings } from "./settings-types";

export interface ViewDigestInput {
  view: AppView;
  /** Workspace-wide tasks — what the non-open-points digests report over. */
  tasks: readonly Task[];
  /** Upstream of the pane's health/hide-finished narrowing; never emit this
   *  directly as "visible" (see the header). */
  filteredSortedTasks: readonly Task[];
  effectiveFilters: TaskFilterValues;
  resources: readonly Resource[];
  budgets: readonly BudgetBucket[];
  milestones: readonly Milestone[];
  today: string;
  settings: Settings;
  /** Threaded from task-manager, never minted here — see the dispatcher arg. */
  holidaySet: ReadonlySet<string>;
  /** Canonical settings key — resolves this project's appearance override, the
   *  only place `tasksViewMode` can differ from the device default. */
  settingsProjectId: string;
}

export function useViewDigest(input: ViewDigestInput): string | undefined {
  // Destructured to locals because react-hooks/exhaustive-deps REJECTS an
  // `obj.member` dependency, and the memo below needs all of these.
  const {
    view, tasks, filteredSortedTasks, effectiveFilters,
    resources, budgets, milestones, today, settings, settingsProjectId, holidaySet,
  } = input;
  // ★★ `searchDebounced`, NOT the raw box value. `filteredSortedTasks` filters on
  // the debounced one, so reading raw skews BOTH ways — and the clear direction
  // is the dangerous one: emptying the box drops raw to "" instantly while the
  // rows stay filtered for ~150 ms, emitting "No filters active — the table
  // shows every task" over a still-narrowed set. That is the exact under-report
  // this whole list exists to prevent. Reading the same value the rows use makes
  // the two consistent in both directions by construction.
  const { healthFilter, priorityFilter, searchDebounced } = useFilters();
  // ★ `|| "default"`, not `??` — the callers build this id with `?? "default"`,
  // which does NOT catch an empty string. An "" id would read the appearance
  // override from a different bucket than the pane (`useEffectiveSettings` and
  // tasks-section both fall back on falsiness), so the digest could name a
  // surface the user is not looking at. Same defensive fallback as the hook the
  // pane goes through.
  const pid = settingsProjectId || "default";
  const appearance = useSyncExternalStore(
    subscribeAppearance,
    () => getAppearanceSnapshot(pid),
    () => getAppearanceSnapshot(pid),
  );
  // EFFECTIVE view mode: this project's appearance override wins over the device
  // default. VALUE-equivalent to tasks-section's `useEffectiveSettings(pid)`,
  // not mechanism-equivalent — that resolves policy overrides too, and this is
  // only safe because `tasksViewMode` is not policy-overridable (pinned by the
  // compile-time guard in use-view-digest.test.tsx).
  const viewMode = appearance.tasksViewMode ?? settings.tasksViewMode ?? "table";
  const hideFinished = settings.hideFinishedTasks ?? false;
  const hideExternal = settings.hideExternalTasks === true;

  return useMemo(() => {
    if (view !== "open-points") {
      return digestForView(view, { tasks, resources, budgets, milestones, today });
    }
    // ★★★ OPEN POINTS HAS THREE MODES AND THEY NARROW DIFFERENTLY. The table
    // applies the health filter THEN hide-finished (`visibleTaskRows`); the
    // board and swimlanes render `healthFilteredTasks` — health only — because
    // hide-finished is deliberately table-only, so their Done/Cancelled columns
    // still populate (`tasks-section.tsx` says so at both render sites).
    // ★ Precisely: the SHIPPED digest (0.215.0) applied NEITHER filter — it fed
    // raw `filteredSortedTasks` — so on a board it OVER-reported, counting
    // finished and health-filtered cards the board never renders, and called
    // them "rows in the table". An intermediate draft of this fix then applied
    // hide-finished unconditionally, which would have UNDER-reported a board by
    // every finished card. Both are wrong in opposite directions; the mode
    // split below is what makes the count match the surface.
    const isTable = viewMode === "table";
    const rows = isTable
      ? visibleTaskRows(filteredSortedTasks, healthFilter, hideFinished, { today, holidaySet })
      : filterTasksByHealth(filteredSortedTasks, healthFilter, today, holidaySet);
    // ★★ EVERY narrowing that is NOT one of the three TaskFilterValues keys.
    // Without these the digest printed "No filters active — the table shows
    // every task" while a search hid all but a handful of rows — worse than
    // silence, because that sentence tells the model it need not call a tool.
    const extraFilters: string[] = [];
    if (priorityFilter !== FILTER_ALL) extraFilters.push(`priority=${priorityFilter}`);
    if (searchDebounced.trim()) extraFilters.push(`search="${searchDebounced.trim()}"`);
    if (healthFilter !== "all") extraFilters.push(`health=${healthFilter}`);
    // ★ Only claimed in table mode — see the mode split above. Naming it on a
    // board would be a filter the user cannot see the effect of.
    if (isTable && hideFinished) extraFilters.push("finished tasks hidden");
    if (hideExternal) extraFilters.push("external people's tasks hidden");
    return digestForView(view, {
      tasks: rows,
      surface: isTable ? "table" : viewMode === "swimlane" ? "swimlanes" : "board",
      filters: effectiveFilters,
      extraFilters,
      resources,
      budgets,
      milestones,
      today,
    });
  }, [
    view, tasks, filteredSortedTasks, effectiveFilters, resources, budgets,
    milestones, today, healthFilter, priorityFilter, searchDebounced, hideFinished,
    hideExternal, holidaySet, viewMode,
  ]);
}
