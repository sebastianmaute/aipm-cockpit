// Pure helpers for the RAID log. No React, no DOM — these are imported by
// the panel UI, the task-manager (for reverse-lookup badges), and the
// storage layer (for parsing severity on load).

import type { Health } from "./health";
import { mintId } from "./id-mint-session";
import {
  ASSUMPTION_STATUSES,
  DEPENDENCY_STATUSES,
  ISSUE_STATUSES,
  RAID_CATEGORIES,
  RISK_STATUSES,
  type RaidCategory,
  type RaidItem,
  type RaidSeverity,
  type RaidStatus,
  type RiskScale,
} from "./types";

/**
 * Maps a 5×5 risk-matrix score to the 4-level severity used everywhere else.
 *
 * Standard "heat-map" bands:
 *   1–5   → Low      (green)
 *   6–10  → Medium   (amber)
 *   11–15 → High     (red)
 *   16–25 → Critical (red, darker)
 */
export function riskSeverityFromMatrix(
  probability: RiskScale,
  impact: RiskScale,
): RaidSeverity {
  const score = probability * impact;
  if (score <= 5) return "Low";
  if (score <= 10) return "Medium";
  if (score <= 15) return "High";
  return "Critical";
}

/** The status picker for the row's category only shows these options. */
export function statusOptionsFor(category: RaidCategory): RaidStatus[] {
  switch (category) {
    case "R":
      return RISK_STATUSES;
    case "A":
      return ASSUMPTION_STATUSES;
    case "I":
      return ISSUE_STATUSES;
    case "D":
      return DEPENDENCY_STATUSES;
  }
}

/**
 * Whether a status counts as "done" for this category. Used to (a) auto-fill
 * `closedDate` when the user transitions into one and (b) gate "open RAID
 * items" filters.
 */
export function isTerminalStatus(
  status: RaidStatus,
  category: RaidCategory,
): boolean {
  switch (category) {
    case "R":
      return status === "Closed" || status === "Realized";
    case "A":
      return status === "Validated" || status === "Invalidated";
    case "I":
      return status === "Resolved" || status === "Closed";
    case "D":
      return status === "Delivered";
  }
}

/** Severity → RAG. Same palette as computeTaskHealth so the dot reads the
 *  same across the app. */
export function severityRag(severity: RaidSeverity | undefined): Health {
  if (!severity) return "G";
  if (severity === "Critical" || severity === "High") return "R";
  if (severity === "Medium") return "A";
  return "G";
}

/** Default status when a new item is created in this category. */
export function defaultStatusForCategory(category: RaidCategory): RaidStatus {
  switch (category) {
    case "R":
      return "Open";
    case "A":
      return "Pending";
    case "I":
      return "Open";
    case "D":
      return "Open";
  }
}

/**
 * Reverse-index of RAID items by linked task id. The task list paints a
 * "referenced by N RAID items" badge using this; the panel computes it
 * once per render in the consumer via useMemo.
 */
export function buildRaidByTaskIndex(
  raid: readonly RaidItem[],
): Map<number, RaidItem[]> {
  const idx = new Map<number, RaidItem[]>();
  for (const item of raid) {
    for (const tid of item.linkedTaskIds) {
      const list = idx.get(tid);
      if (list) list.push(item);
      else idx.set(tid, [item]);
    }
  }
  return idx;
}

/** Counts per-category for a list of RAID items. */
export function countByCategory(
  items: readonly RaidItem[],
): Record<RaidCategory, number> {
  const out: Record<RaidCategory, number> = { R: 0, A: 0, I: 0, D: 0 };
  for (const i of items) out[i.category] += 1;
  return out;
}

/**
 * Next id for a new RAID item — routes through the session-scoped minter so a
 * deleted max-id row's id is never reused within the session.
 */
export function nextRaidId(items: readonly RaidItem[]): number {
  return mintId("raid", items);
}

/**
 * Reverse index of `causedByRaidId` references: parent id → list of items
 * that point at it. Used in the panel to (a) show "→ caused N items"
 * indicators on the parent row, and (b) list children under the parent in
 * its edit modal.
 */
export function buildRaidCausesIndex(
  raid: readonly RaidItem[],
): Map<number, RaidItem[]> {
  const idx = new Map<number, RaidItem[]>();
  for (const item of raid) {
    for (const parentId of item.causedByRaidIds ?? []) {
      const list = idx.get(parentId);
      if (list) list.push(item);
      else idx.set(parentId, [item]);
    }
  }
  return idx;
}

/**
 * Returns true if adding `proposedParentId` to `childId`'s causedByRaidIds
 * would create a cycle in the directed cause graph. Walks the transitive
 * ancestor closure of `proposedParentId` (BFS through every parent of every
 * ancestor); if we hit `childId`, adding the edge would close a loop.
 *
 * Self-reference (proposedParentId === childId) is treated as a cycle so a
 * single check covers both invariants the UI cares about.
 *
 * `visited` is bounded by the population so the walk terminates even if the
 * stored data is already cyclic from a hand-edited file.
 */
export function wouldCreateCycle(
  raid: readonly RaidItem[],
  childId: number,
  proposedParentId: number,
): boolean {
  if (proposedParentId === childId) return true;
  const byId = new Map<number, RaidItem>();
  for (const r of raid) byId.set(r.id, r);
  const visited = new Set<number>();
  const stack: number[] = [proposedParentId];
  while (stack.length > 0) {
    const cursor = stack.pop() as number;
    if (cursor === childId) return true;
    if (visited.has(cursor)) continue;
    visited.add(cursor);
    const parents = byId.get(cursor)?.causedByRaidIds ?? [];
    for (const p of parents) stack.push(p);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Column comparator — backs sortable RAID table headers.
// ---------------------------------------------------------------------------

export type RaidSortKey =
  | "id"
  | "category"
  | "title"
  | "severity"
  | "status"
  | "owner"
  | "targetDate";

const SEVERITY_RANK: Record<RaidSeverity, number> = {
  Low: 1,
  Medium: 2,
  High: 3,
  Critical: 4,
};

function raidSortValue(item: RaidItem, key: RaidSortKey): string | number {
  switch (key) {
    case "id":
      return item.id;
    case "category":
      return RAID_CATEGORIES.indexOf(item.category);
    case "severity":
      return item.severity ? SEVERITY_RANK[item.severity] : 0;
    case "status":
      return item.status.toLowerCase();
    case "title":
      return item.title.toLowerCase();
    case "owner":
      return (item.owner ?? "").toLowerCase();
    case "targetDate":
      return item.targetDate ?? "";
  }
}

/**
 * Compare two RAID items by a column. Missing `targetDate` always sorts LAST,
 * regardless of direction; other missing values use their natural low/empty order.
 */
export function compareRaid(
  a: RaidItem,
  b: RaidItem,
  key: RaidSortKey,
  dir: "asc" | "desc",
): number {
  if (key === "targetDate") {
    const av = a.targetDate ?? "";
    const bv = b.targetDate ?? "";
    if (av === "" || bv === "") {
      if (av === bv) return 0;
      return av === "" ? 1 : -1;
    }
  }
  const av = raidSortValue(a, key);
  const bv = raidSortValue(b, key);
  const cmp =
    typeof av === "number" && typeof bv === "number"
      ? av - bv
      : String(av).localeCompare(String(bv));
  return dir === "asc" ? cmp : -cmp;
}
