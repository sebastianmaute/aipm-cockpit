import { readDeviceJson, writeDeviceJson } from "./device-store";
import type { SearchResult, SearchResultType } from "./global-search";

export const RECENTS_KEY = "aipm-cockpit:search-recents";
export const MAX_RECENTS = 8;

const TYPES: readonly SearchResultType[] = [
  "task",
  "raid",
  "change",
  "milestone",
  "stakeholder",
];

function isValidResult(value: unknown): value is SearchResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const r = value as Record<string, unknown>;
  return (
    typeof r.type === "string" &&
    TYPES.includes(r.type as SearchResultType) &&
    typeof r.id === "number" &&
    Number.isFinite(r.id) &&
    typeof r.view === "string" &&
    typeof r.title === "string" &&
    typeof r.subtitle === "string"
  );
}

/** Load recents from localStorage; [] on absent/malformed; never throws. */
export function loadRecents(): SearchResult[] {
  const parsed = readDeviceJson<unknown>(RECENTS_KEY, []);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(isValidResult).slice(0, MAX_RECENTS);
}

/** Pure: prepend r, dedupe by type+id (newest wins, moved to front), cap to MAX_RECENTS. */
export function pushRecent(
  list: readonly SearchResult[],
  r: SearchResult,
): SearchResult[] {
  return [
    r,
    ...list.filter((x) => !(x.type === r.type && x.id === r.id)),
  ].slice(0, MAX_RECENTS);
}

/** Persist; swallow errors (quota/unavailable). */
export function saveRecents(list: readonly SearchResult[]): void {
  writeDeviceJson(RECENTS_KEY, list);
}
