// Reports has THREE independent sortable+filterable tables; a saved view stores
// each table's sort + filter. report-table's SortDir is the SUPERSET
// ("asc"|"desc"|"off") — the tables cycle through "off" via useSortableFilter,
// so the persisted sort must hold it (a narrower union would fail validation
// and silently drop the saved view on reload).
import { createCappedListStore } from "./capped-list-store";
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

const store = createCappedListStore<ReportsSavedView>(
  REPORTS_VIEWS_KEY,
  MAX_REPORTS_VIEWS,
  (raw) => (Array.isArray(raw) ? raw.filter(isValidView) : []),
);

export function loadReportsViews(): ReportsSavedView[] {
  return store.load();
}

export function addReportsView(
  list: readonly ReportsSavedView[],
  name: string,
  state: ReportsViewState,
): ReportsSavedView[] {
  return store.add(list, { name, state });
}

export function removeReportsView(list: readonly ReportsSavedView[], id: number): ReportsSavedView[] {
  return store.remove(list, id);
}

export function saveReportsViews(list: readonly ReportsSavedView[]): void {
  store.save(list);
}
