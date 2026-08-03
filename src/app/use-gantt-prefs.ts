// src/app/use-gantt-prefs.ts — Gantt sort/filter/custom-order preferences.
//
// Owns the persisted `GanttPrefs` state plus the localStorage hydration and
// persistence effects, and exposes focused setters for each control. The
// raw `setPrefs` is also returned for the custom-order drag-reorder path.
import { useEffect, useRef, useState } from "react";
import { type Priority } from "./types";
import {
  ALL_GANTT_STATUSES,
  DEFAULT_PREFS,
  type GanttPrefs,
  type GanttSort,
  type GanttStatus,
  loadPrefs,
  savePrefs,
} from "./gantt-engine";

export type GanttPrefsApi = {
  prefs: GanttPrefs;
  setPrefs: React.Dispatch<React.SetStateAction<GanttPrefs>>;
  setSort: (sort: GanttSort) => void;
  setSearch: (search: string) => void;
  toggleStatus: (status: GanttStatus) => void;
  togglePriority: (priority: Priority) => void;
  toggleAssignee: (assignee: string) => void;
  resetFilters: () => void;
  toggleCriticalPath: () => void;
  toggleBaseline: () => void;
  toggleMilestonePlacement: () => void;
  toggleHolidays: () => void;
  toggleAbsences: () => void;
  toggleDependencies: () => void;
  toggleMilestones: () => void;
  toggleGrid: () => void;
};

/** Toggle a value's membership in an array (add if absent, remove if present),
 *  preserving order. Pure. */
function toggleIn<T>(xs: readonly T[], value: T): T[] {
  return xs.includes(value) ? xs.filter((x) => x !== value) : [...xs, value];
}

export function useGanttPrefs(): GanttPrefsApi {
  // --- prefs: sort + filters + custom order, persisted in localStorage ---
  const [prefs, setPrefs] = useState<GanttPrefs>(DEFAULT_PREFS);
  const prefsHydratedRef = useRef(false);

  // Mount-time hydration. We intentionally start with DEFAULT_PREFS so the
  // server-rendered HTML and the first client render match; the real values
  // are applied via setState after mount, triggering a single re-render.
  useEffect(() => {
    if (prefsHydratedRef.current) return;
    prefsHydratedRef.current = true;
    setPrefs(loadPrefs());
  }, []);

  // Persist on every change after hydration.
  useEffect(() => {
    if (!prefsHydratedRef.current) return;
    savePrefs(prefs);
  }, [prefs]);

  function setSort(sort: GanttSort) {
    setPrefs((p) => ({ ...p, sort }));
  }
  function setSearch(search: string) {
    setPrefs((p) => ({ ...p, search }));
  }
  function toggleStatus(status: GanttStatus) {
    setPrefs((p) => ({ ...p, statuses: toggleIn(p.statuses, status) }));
  }
  function togglePriority(priority: Priority) {
    setPrefs((p) => ({ ...p, priorities: toggleIn(p.priorities, priority) }));
  }
  function toggleAssignee(assignee: string) {
    setPrefs((p) => ({ ...p, assignees: toggleIn(p.assignees, assignee) }));
  }
  function resetFilters() {
    // "No filter" is every status TICKED under the v2 semantics — an empty
    // list would reset the chart to showing nothing. Priorities and assignees
    // keep empty-means-all, so they still clear to [].
    setPrefs((p) => ({
      ...p,
      search: "",
      statuses: [...ALL_GANTT_STATUSES],
      priorities: [],
      assignees: [],
    }));
  }
  function toggleCriticalPath() {
    setPrefs((p) => ({ ...p, showCriticalPath: !p.showCriticalPath }));
  }
  function toggleBaseline() {
    setPrefs((p) => ({ ...p, showBaseline: !p.showBaseline }));
  }
  function toggleMilestonePlacement() {
    setPrefs((p) => ({
      ...p,
      milestonePlacement: p.milestonePlacement === "inline" ? "below" : "inline",
    }));
  }
  function toggleHolidays() {
    setPrefs((p) => ({ ...p, showHolidays: !p.showHolidays }));
  }
  function toggleAbsences() {
    setPrefs((p) => ({ ...p, showAbsences: !p.showAbsences }));
  }
  function toggleDependencies() {
    setPrefs((p) => ({ ...p, showDependencies: !p.showDependencies }));
  }
  function toggleMilestones() {
    setPrefs((p) => ({ ...p, showMilestones: !p.showMilestones }));
  }
  function toggleGrid() {
    setPrefs((p) => ({ ...p, showGrid: !p.showGrid }));
  }

  return {
    prefs,
    setPrefs,
    setSort,
    setSearch,
    toggleStatus,
    togglePriority,
    toggleAssignee,
    resetFilters,
    toggleCriticalPath,
    toggleBaseline,
    toggleMilestonePlacement,
    toggleHolidays,
    toggleAbsences,
    toggleDependencies,
    toggleMilestones,
    toggleGrid,
  };
}
