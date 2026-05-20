"use client";

// FiltersProvider — owns filter/sort state for the task list.
//
// Slice 1 of the task-manager.tsx decomposition; see
// docs/superpowers/specs/2026-05-17-filters-context-slice1-design.md.
// State lives here so the next slice (WorkspaceProvider) can build on
// top and unlock row-level memoization without redoing the wiring.
//
// SortKey / SortDir are owned here too (they move out of task-manager
// in the same slice) so type and state co-locate.

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useDebounce } from "./use-debounce";
import { type Priority } from "./types";

export type SortKey =
  | "id"
  | "taskName"
  | "assignee"
  | "startDate"
  | "dueDate"
  | "lastUpdateDate"
  | "priority";
export type SortDir = "asc" | "desc";

interface FiltersValue {
  search: string;
  searchDebounced: string;
  priorityFilter: Priority | "All";
  assigneeFilter: string;
  groupFilter: string;
  labelFilter: string;
  sortKey: SortKey;
  sortDir: SortDir;
  raidFilterTaskId: number | null;

  // React.Dispatch<SetStateAction<...>> so callers can use either the
  // direct-value form (setX(value)) or the updater form (setX(prev =>
  // ...)). Matches what useState returns natively.
  setSearch: Dispatch<SetStateAction<string>>;
  /** Sets search + searchDebounced synchronously (bypasses the 150 ms
   *  debounce). Use for programmatic triggers like voice commands where
   *  the user expects an instant result. */
  setSearchImmediate: (value: string) => void;
  setPriorityFilter: Dispatch<SetStateAction<Priority | "All">>;
  setAssigneeFilter: Dispatch<SetStateAction<string>>;
  setGroupFilter: Dispatch<SetStateAction<string>>;
  setLabelFilter: Dispatch<SetStateAction<string>>;
  setSortKey: Dispatch<SetStateAction<SortKey>>;
  setSortDir: Dispatch<SetStateAction<SortDir>>;
  setRaidFilterTaskId: Dispatch<SetStateAction<number | null>>;

  resetFilters: () => void;
}

const FiltersContext = createContext<FiltersValue | undefined>(undefined);

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [search, setSearch] = useState("");
  const searchDebouncedHook = useDebounce(search, 150);
  // Override allows programmatic callers (e.g. voice commands) to set the
  // debounced value synchronously without waiting for the 150 ms timer.
  const [searchDebouncedOverride, setSearchDebouncedOverride] = useState<string | null>(null);
  const searchDebounced = searchDebouncedOverride ?? searchDebouncedHook;

  // When the debounce hook catches up, clear the override so normal typing
  // still benefits from debounce.
  const prevHook = useRef(searchDebouncedHook);
  if (prevHook.current !== searchDebouncedHook) {
    prevHook.current = searchDebouncedHook;
    if (searchDebouncedOverride !== null) setSearchDebouncedOverride(null);
  }

  const setSearchImmediate = useCallback((value: string) => {
    setSearch(value);
    setSearchDebouncedOverride(value);
  }, []);

  const [priorityFilter, setPriorityFilter] = useState<Priority | "All">("All");
  const [assigneeFilter, setAssigneeFilter] = useState("All");
  const [groupFilter, setGroupFilter] = useState("All");
  const [labelFilter, setLabelFilter] = useState("All");
  const [sortKey, setSortKey] = useState<SortKey>("id");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [raidFilterTaskId, setRaidFilterTaskId] = useState<number | null>(null);

  const resetFilters = useCallback(() => {
    setSearch("");
    setSearchDebouncedOverride(null);
    setPriorityFilter("All");
    setAssigneeFilter("All");
    setGroupFilter("All");
    setLabelFilter("All");
    setSortKey("id");
    setSortDir("asc");
    setRaidFilterTaskId(null);
  }, []);

  const value: FiltersValue = {
    search,
    searchDebounced,
    priorityFilter,
    assigneeFilter,
    groupFilter,
    labelFilter,
    sortKey,
    sortDir,
    raidFilterTaskId,
    setSearch,
    setSearchImmediate,
    setPriorityFilter,
    setAssigneeFilter,
    setGroupFilter,
    setLabelFilter,
    setSortKey,
    setSortDir,
    setRaidFilterTaskId,
    resetFilters,
  };

  return (
    <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>
  );
}

export function useFilters(): FiltersValue {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error("useFilters must be used within FiltersProvider");
  return ctx;
}
