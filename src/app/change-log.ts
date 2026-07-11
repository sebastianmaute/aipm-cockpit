// Pure helpers for the Change-control Log. No React, no DOM. Sibling to raid.ts.
import type { Health } from "./health";
import { mintId } from "./id-mint-session";
import { severityRag } from "./raid";
import {
  CHANGE_STATUSES, CHANGE_TYPES,
  type ChangeImpact, type ChangeItem, type ChangeStatus, type ChangeType,
} from "./types";

const PENDING: ReadonlySet<ChangeStatus> = new Set(["Proposed", "Under Review"]);
const TERMINAL: ReadonlySet<ChangeStatus> = new Set(["Rejected", "Implemented", "Deferred"]);

export function defaultChangeStatus(): ChangeStatus {
  return "Proposed";
}
export function isPendingChange(status: ChangeStatus): boolean {
  return PENDING.has(status);
}
export function isTerminalChangeStatus(status: ChangeStatus): boolean {
  return TERMINAL.has(status);
}

/** Impact rating → RAG, reusing the RAID severity palette. */
export function changeImpactRag(impact: ChangeImpact | undefined): Health {
  return severityRag(impact);
}

/** Next id — routes through the session-scoped minter (no id reuse per session). */
export function nextChangeId(items: readonly ChangeItem[]): number {
  return mintId("change", items);
}

export function countByType(items: readonly ChangeItem[]): Record<ChangeType, number> {
  const out = Object.fromEntries(CHANGE_TYPES.map((t) => [t, 0])) as Record<ChangeType, number>;
  for (const i of items) out[i.type] += 1;
  return out;
}

export function countByStatus(items: readonly ChangeItem[]): Record<ChangeStatus, number> {
  const out = Object.fromEntries(CHANGE_STATUSES.map((s) => [s, 0])) as Record<ChangeStatus, number>;
  for (const i of items) out[i.status] += 1;
  return out;
}

/** Reverse index: task id → change items that link it. */
export function buildChangeByTaskIndex(items: readonly ChangeItem[]): Map<number, ChangeItem[]> {
  const idx = new Map<number, ChangeItem[]>();
  for (const item of items) {
    for (const tid of item.linkedTaskIds) {
      const list = idx.get(tid);
      if (list) list.push(item);
      else idx.set(tid, [item]);
    }
  }
  return idx;
}

export type ChangeSortKey =
  | "id" | "type" | "title" | "impact" | "status" | "requestedBy" | "raisedDate" | "decisionDate";

const IMPACT_RANK: Record<ChangeImpact, number> = { Low: 1, Medium: 2, High: 3, Critical: 4 };

function changeSortValue(item: ChangeItem, key: ChangeSortKey): string | number {
  switch (key) {
    case "id": return item.id;
    case "type": return CHANGE_TYPES.indexOf(item.type);
    case "title": return item.title.toLowerCase();
    case "impact": return item.impact ? IMPACT_RANK[item.impact] : 0;
    case "status": return CHANGE_STATUSES.indexOf(item.status);
    case "requestedBy": return (item.requestedBy ?? "").toLowerCase();
    case "raisedDate": return item.raisedDate ?? "";
    case "decisionDate": return item.decisionDate ?? "";
  }
}

/** Compare two change items by a column. Missing decisionDate always sorts LAST. */
export function compareChange(a: ChangeItem, b: ChangeItem, key: ChangeSortKey, dir: "asc" | "desc"): number {
  if (key === "decisionDate") {
    const av = a.decisionDate ?? "", bv = b.decisionDate ?? "";
    if (av === "" || bv === "") {
      if (av === bv) return 0;
      return av === "" ? 1 : -1;
    }
  }
  const av = changeSortValue(a, key), bv = changeSortValue(b, key);
  const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
  return dir === "asc" ? cmp : -cmp;
}

/** Pending-change backlog at/above this count drives the dashboard Scope RAG to Red. */
export const SCOPE_PENDING_RED = 5;

/** Computed Scope RAG from the pending-change backlog. null when none pending. */
export function computeScopeStatus(
  changes: readonly ChangeItem[],
  redThreshold: number = SCOPE_PENDING_RED,
): Health | null {
  const pending = changes.filter((c) => isPendingChange(c.status)).length;
  if (pending === 0) return null;
  if (pending >= redThreshold) return "R";
  return "A";
}

/** Pending changes, highest impact first (tie-break most-recently-raised, then id), capped. */
export function selectTopChanges(changes: readonly ChangeItem[], limit: number): ChangeItem[] {
  return changes
    .filter((c) => isPendingChange(c.status))
    .map((c) => ({ c, rank: c.impact ? IMPACT_RANK[c.impact] : 0 }))
    .sort((a, b) => b.rank - a.rank || b.c.raisedDate.localeCompare(a.c.raisedDate) || a.c.id - b.c.id)
    .slice(0, limit)
    .map((x) => x.c);
}
