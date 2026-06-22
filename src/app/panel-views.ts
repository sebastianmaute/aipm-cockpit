// report-table's SortDir is the SUPERSET ("asc"|"desc"|"off") — the Milestones
// panel cycles a column through "off" via useSortableFilter, so the persisted
// sort must be able to hold it (filters-context's SortDir omits "off", which
// would silently fail validation and drop the saved view on reload).
import type { SortDir } from "./report-table";

export type PanelViewKind = "raid" | "milestones" | "changes" | "stakeholders";
export const PANEL_VIEW_KINDS: readonly PanelViewKind[] = ["raid", "milestones", "changes", "stakeholders"];

export type PanelSort = { key: string; dir: SortDir } | null;

export interface PanelFiltersState {
  search: string;
  filters: Record<string, string>;
  sort: PanelSort;
}

export interface PanelView {
  id: number;
  name: string;
  view: PanelViewKind;
  state: PanelFiltersState;
}

export const PANEL_VIEWS_KEY = "lop-app:panel-views";
export const MAX_PANEL_VIEWS = 30;

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((v) => typeof v === "string");
}

function isValidSort(value: unknown): value is PanelSort {
  if (value === null) return true;
  if (typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return typeof s.key === "string" && (s.dir === "asc" || s.dir === "desc" || s.dir === "off");
}

function isValidState(value: unknown): value is PanelFiltersState {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return typeof s.search === "string" && isStringRecord(s.filters) && isValidSort(s.sort);
}

function isValidView(entry: unknown): entry is PanelView {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return (
    Number.isFinite(e.id) &&
    typeof e.name === "string" &&
    typeof e.view === "string" &&
    (PANEL_VIEW_KINDS as readonly string[]).includes(e.view as string) &&
    isValidState(e.state)
  );
}

export function loadPanelViews(): PanelView[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(PANEL_VIEWS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidView);
  } catch {
    return [];
  }
}

export function panelViewsFor(list: readonly PanelView[], view: PanelViewKind): PanelView[] {
  return list.filter((v) => v.view === view);
}

export function addPanelView(
  list: readonly PanelView[],
  view: PanelViewKind,
  name: string,
  state: PanelFiltersState,
): PanelView[] {
  const id = (list.length ? Math.max(...list.map((v) => v.id)) : 0) + 1;
  const next = [...list, { id, name, view, state }];
  const ofView = next.filter((v) => v.view === view);
  if (ofView.length <= MAX_PANEL_VIEWS) return next;
  const dropIds = new Set(ofView.slice(0, ofView.length - MAX_PANEL_VIEWS).map((v) => v.id));
  return next.filter((v) => !dropIds.has(v.id));
}

export function removePanelView(list: readonly PanelView[], id: number): PanelView[] {
  return list.filter((v) => v.id !== id);
}

export function savePanelViews(list: readonly PanelView[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PANEL_VIEWS_KEY, JSON.stringify(list));
  } catch {
    // ignore quota / serialization errors
  }
}
