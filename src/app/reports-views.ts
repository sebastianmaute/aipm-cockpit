// Reports has THREE independent sortable+filterable tables; a saved view stores
// each table's sort + filter. report-table's SortDir is the SUPERSET
// ("asc"|"desc"|"off") — the tables cycle through "off" via useSortableFilter,
// so the persisted sort must hold it (a narrower union would fail validation
// and silently drop the saved view on reload).
import type { SortDir } from "./report-table";

export interface ReportsTableState {
  filter: string;
  sort: { key: string; dir: SortDir } | null;
}

export interface ReportsViewState {
  assignee: ReportsTableState;
  group: ReportsTableState;
  label: ReportsTableState;
}

export interface ReportsSavedView {
  id: number;
  name: string;
  state: ReportsViewState;
}

export const REPORTS_VIEWS_KEY = "aipm-cockpit:reports-views";
export const MAX_REPORTS_VIEWS = 30;

function isValidSort(value: unknown): value is ReportsTableState["sort"] {
  if (value === null) return true;
  if (typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return typeof s.key === "string" && (s.dir === "asc" || s.dir === "desc" || s.dir === "off");
}

function isValidTable(value: unknown): value is ReportsTableState {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return typeof s.filter === "string" && isValidSort(s.sort);
}

function isValidState(value: unknown): value is ReportsViewState {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return isValidTable(s.assignee) && isValidTable(s.group) && isValidTable(s.label);
}

function isValidView(entry: unknown): entry is ReportsSavedView {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return Number.isFinite(e.id) && typeof e.name === "string" && isValidState(e.state);
}

export function loadReportsViews(): ReportsSavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(REPORTS_VIEWS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidView);
  } catch {
    return [];
  }
}

export function addReportsView(
  list: readonly ReportsSavedView[],
  name: string,
  state: ReportsViewState,
): ReportsSavedView[] {
  const id = (list.length ? Math.max(...list.map((v) => v.id)) : 0) + 1;
  const next = [...list, { id, name, state }];
  if (next.length <= MAX_REPORTS_VIEWS) return next;
  return next.slice(next.length - MAX_REPORTS_VIEWS);
}

export function removeReportsView(list: readonly ReportsSavedView[], id: number): ReportsSavedView[] {
  return list.filter((v) => v.id !== id);
}

export function saveReportsViews(list: readonly ReportsSavedView[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(REPORTS_VIEWS_KEY, JSON.stringify(list));
  } catch {
    // ignore quota / serialization errors
  }
}
