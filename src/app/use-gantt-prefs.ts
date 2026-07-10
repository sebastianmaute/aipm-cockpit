// src/app/use-gantt-prefs.ts — Gantt sort/filter/custom-order preferences.
//
// Owns the persisted `GanttPrefs` state plus the localStorage hydration and
// persistence effects, and exposes focused setters for each control. The
// raw `setPrefs` is also returned for the custom-order drag-reorder path.
import { useEffect, useRef, useState } from "react";
import { type Priority } from "./types";
import {
  DEFAULT_PREFS,
  type GanttPrefs,
  type GanttSort,
  type GanttStatusFilter,
  loadPrefs,
  savePrefs,
} from "./gantt-engine";

export type GanttPrefsApi = {
  prefs: GanttPrefs;
  setPrefs: React.Dispatch<React.SetStateAction<GanttPrefs>>;
  setSort: (sort: GanttSort) => void;
  setSearch: (search: string) => void;
  setStatusFilter: (status: GanttStatusFilter) => void;
  setPriorityFilter: (priority: Priority | "All") => void;
  setAssigneeFilter: (assignee: string) => void;
  resetFilters: () => void;
  toggleCriticalPath: () => void;
  toggleBaseline: () => void;
};

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
  function setStatusFilter(status: GanttStatusFilter) {
    setPrefs((p) => ({ ...p, status }));
  }
  function setPriorityFilter(priority: Priority | "All") {
    setPrefs((p) => ({ ...p, priority }));
  }
  function setAssigneeFilter(assignee: string) {
    setPrefs((p) => ({ ...p, assignee }));
  }
  function resetFilters() {
    setPrefs((p) => ({
      ...p,
      search: "",
      status: "all",
      priority: "All",
      assignee: "All",
    }));
  }
  function toggleCriticalPath() {
    setPrefs((p) => ({ ...p, showCriticalPath: !p.showCriticalPath }));
  }
  function toggleBaseline() {
    setPrefs((p) => ({ ...p, showBaseline: !p.showBaseline }));
  }

  return {
    prefs,
    setPrefs,
    setSort,
    setSearch,
    setStatusFilter,
    setPriorityFilter,
    setAssigneeFilter,
    resetFilters,
    toggleCriticalPath,
    toggleBaseline,
  };
}
