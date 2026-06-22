import type { SortKey, SortDir } from "./filters-context";
import type { Priority } from "./types";

export interface SavedViewPayload {
  search: string;
  priorityFilter: Priority | "All";
  assigneeFilter: string;
  groupFilter: string;
  labelFilter: string;
  sortKey: SortKey;
  sortDir: SortDir;
  hiddenCols: string[];
}

export interface SavedView {
  id: number;
  name: string;
  payload: SavedViewPayload;
}

export const SAVED_VIEWS_KEY = "lop-app:saved-views";
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

export function loadSavedViews(): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter(isValidView);
    return valid.length > MAX_SAVED_VIEWS ? valid.slice(valid.length - MAX_SAVED_VIEWS) : valid;
  } catch {
    return [];
  }
}

export function addSavedView(
  list: readonly SavedView[],
  name: string,
  payload: SavedViewPayload,
): SavedView[] {
  const id = (list.length ? Math.max(...list.map((v) => v.id)) : 0) + 1;
  const view: SavedView = { id, name, payload };
  const next = [...list, view];
  return next.length > MAX_SAVED_VIEWS ? next.slice(next.length - MAX_SAVED_VIEWS) : next;
}

export function removeSavedView(list: readonly SavedView[], id: number): SavedView[] {
  return list.filter((v) => v.id !== id);
}

export function renameSavedView(
  list: readonly SavedView[],
  id: number,
  name: string,
): SavedView[] {
  return list.map((v) => (v.id === id ? { ...v, name } : v));
}

export function saveSavedViews(list: readonly SavedView[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(list));
  } catch {
    // ignore quota / serialization errors
  }
}
