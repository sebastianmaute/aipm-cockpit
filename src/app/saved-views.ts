import { createCappedListStore } from "./capped-list-store";
import type { SortKey, SortDir } from "./filters-context";
import type { HealthFilter } from "./health";
import type { Priority } from "./types";

export interface SavedViewPayload {
  search: string;
  priorityFilter: Priority | "All";
  assigneeFilter: string;
  groupFilter: string;
  labelFilter: string;
  healthFilter: HealthFilter;
  sortKey: SortKey;
  sortDir: SortDir;
  hiddenCols: string[];
}

const HEALTH_FILTERS: readonly HealthFilter[] = ["all", "red", "amber", "green"];

export interface SavedView {
  id: number;
  name: string;
  payload: SavedViewPayload;
}

export const SAVED_VIEWS_KEY = "aipm-cockpit:saved-views";
export const MAX_SAVED_VIEWS = 30;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((x) => typeof x === "string");
}

function isValidPayload(payload: unknown): payload is SavedViewPayload {
  if (typeof payload !== "object" || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return (
    typeof p.search === "string" &&
    typeof p.assigneeFilter === "string" &&
    typeof p.groupFilter === "string" &&
    typeof p.labelFilter === "string" &&
    typeof p.priorityFilter === "string" &&
    // healthFilter is newer than the original payload: accept its absence so
    // old saved views stay valid (applyView defaults it to "all"), but reject a
    // present-yet-unrecognised value.
    (p.healthFilter === undefined ||
      (typeof p.healthFilter === "string" &&
        (HEALTH_FILTERS as readonly string[]).includes(p.healthFilter))) &&
    typeof p.sortKey === "string" &&
    typeof p.sortDir === "string" &&
    isStringArray(p.hiddenCols)
  );
}

function isValidView(entry: unknown): entry is SavedView {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return Number.isFinite(e.id) && typeof e.name === "string" && isValidPayload(e.payload);
}

const store = createCappedListStore<SavedView>(
  SAVED_VIEWS_KEY,
  MAX_SAVED_VIEWS,
  (raw) => (Array.isArray(raw) ? raw.filter(isValidView) : []),
  { capOnLoad: true },
);

export function loadSavedViews(): SavedView[] {
  return store.load();
}

export function addSavedView(
  list: readonly SavedView[],
  name: string,
  payload: SavedViewPayload,
): SavedView[] {
  return store.add(list, { name, payload });
}

export function removeSavedView(list: readonly SavedView[], id: number): SavedView[] {
  return store.remove(list, id);
}

export function renameSavedView(
  list: readonly SavedView[],
  id: number,
  name: string,
): SavedView[] {
  return store.rename(list, id, name);
}

export function saveSavedViews(list: readonly SavedView[]): void {
  store.save(list);
}
