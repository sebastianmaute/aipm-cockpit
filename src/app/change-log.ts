// Pure helpers for the Change-control Log. No React, no DOM. Sibling to raid.ts.
import type { Health } from "./health";
import { mintId } from "./id-mint-session";
import { groupByLinkedTaskIds } from "./linked-task-index";
import { severityRag } from "./raid";
import {
  CHANGE_STATUSES, CHANGE_TYPES,
  type ChangeImpact, type ChangeItem, type ChangeStatus, type ChangeType,
  type NoteLogEntry,
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
  return groupByLinkedTaskIds(items);
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

/**
 * Put a note log back onto a change that has just been through
 * `sanitizeChangeItem`.
 *
 * ★★★ `sanitizeChangeItem` builds its output from an explicit field list and is
 * DOM-free by contract, so it DROPS `noteLog` and CANNOT be taught to keep it
 * (`sanitizeNoteLog` reaches DOMPurify). Every caller that sanitizes a row which
 * may already carry a log therefore has to re-attach it, or the log is destroyed.
 *
 * ★★ SIX sites call the sanitizer, and the SPLIT is the useful fact — a flat
 * count reads as rotten to anyone who greps. THREE hold an EXISTING row and so
 * must carry the log across:
 *   `buildChangeFromObj` (CSV + Markdown + both Turso layouts), `jsonToWorkspace`,
 *   and the AI dispatcher's `updateChange`.
 * THREE build a row from scratch, so there is no stored log to lose:
 *   the dispatcher's `createChange` (a freshly minted id), `proposalToSeed`
 *   (a model-authored proposal), and `sanitizeSeed` (template import).
 *
 * ★★ TWO of the safe three pass the sanitizer BY REFERENCE — into `buildList`
 * and `sanitizeArr` — so a call-shaped `sanitizeChangeItem(` grep sees FOUR of
 * the six and reports whatever list it produced as complete. Sweep the BARE
 * name instead:
 *   grep -rn sanitizeChangeItem src/app --include=*.ts --include=*.tsx | grep -v "\.test\."
 * It also returns the imports, the declaration and every comment mentioning the
 * name — this docblock's own included, which is the grep matching itself.
 *
 * ★ Template import DOES drop a captured log, deliberately: `templateFromWorkspace`
 * assigns `seed.changes = ws.changes` verbatim, so a template captured from a live
 * project carries real logs. Tasks and RAID drop theirs the same way
 * (`sanitizeSeedTask` / `sanitizeSeedRaidItem` name no `noteLog`), and it must
 * stay that way here: that path runs no rich pass, so a log re-attached there
 * would be stored unsanitized.
 *
 * ★ RAID needs none of this at its decode or JSON boundaries because neither
 * calls `sanitizeRaidItem`; changes call theirs, which is why this helper exists
 * at all.
 *
 * ★ Takes `unknown` for the log because the JSON boundary hands it raw parsed
 * data. A non-array is dropped rather than trusted. Returns the SAME object
 * identity when there is nothing to attach, so a caller can pass a sanitized
 * row through unconditionally without churning it.
 *
 * ★ This module is DOM-FREE (it runs under bare node in the sample generator).
 * The helper only MOVES an already-sanitized array; it must never call
 * `sanitizeNoteLog` itself.
 */
export function withStoredNoteLog(item: ChangeItem, log: unknown): ChangeItem {
  return Array.isArray(log) && log.length ? { ...item, noteLog: log as NoteLogEntry[] } : item;
}
