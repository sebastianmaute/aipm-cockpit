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
/** True when `v` is one of the known change statuses. The AI write paths take
 *  the model's raw JSON, so they narrow with this before applying a status. */
export function isChangeStatus(v: unknown): v is ChangeStatus {
  return typeof v === "string" && (CHANGE_STATUSES as readonly string[]).includes(v);
}
export function isPendingChange(status: ChangeStatus): boolean {
  return PENDING.has(status);
}
export function isTerminalChangeStatus(status: ChangeStatus): boolean {
  return TERMINAL.has(status);
}

/**
 * Status transition: auto-fill `decisionDate` the first time the item leaves the
 * pending set; clear it if it returns to pending.
 *
 * ★★ EVERY path that CHANGES a change's status routes through here — the row
 * select and the edit modal (`use-change-log` / `change-panel`), bulk edit, and
 * the AI dispatcher's create + update (via `applyModelChangeStatus`). Setting
 * `status` raw leaves the pair inconsistent in BOTH directions: a decided row
 * with no date is silently dropped from the Outlook decision-date push
 * (`use-calendar-integrations` filters on `!!c.decisionDate`), and a row sent
 * back to pending keeps a stale date the select would have cleared.
 *
 * ★ It is NOT the only writer of `decisionDate` itself, and reading it that way
 * sends you hunting a bug that is not there: the Outlook two-way pull writes the
 * date alone (`withDate`), and a user or the model may set it directly on an
 * otherwise unchanged row. What is exclusive is the TRANSITION.
 *
 * ★ Nor do the seed/import paths use it — `proposalToSeed` and template import
 * build rows through `sanitizeChangeItem` alone, so a model-authored proposal
 * can still carry a decided status with no date. Deliberate: those rebuild a
 * whole register from an untrusted blob rather than transitioning a live row.
 *
 * ★ Lives in this pure module rather than beside the hook that used to own it
 * so the AI dispatcher can reach it without importing a React module.
 */
export function applyChangeStatus(item: ChangeItem, status: ChangeStatus, today: string): ChangeItem {
  if (isPendingChange(status)) {
    const next = { ...item, status };
    delete next.decisionDate;
    return next;
  }
  return { ...item, status, decisionDate: item.decisionDate ?? today };
}

/**
 * A MODEL-supplied status on an update: apply it through `applyChangeStatus`
 * when it is a real status, otherwise keep `stored` and leave the pair alone.
 *
 * ★★ The guard is not belt-and-braces. `sanitizeChangeItem` falls back to
 * "Proposed" for anything off the enum, so an unrecognised value DEMOTES a
 * decided change — and routing that merged status would then clear its decision
 * date on the way out. Ignoring it keeps both halves of the stored pair.
 *
 * ★ Gate on the model's RAW field, never on the merged row: a patch that never
 * mentions status must not stamp today's date onto a stored row that carries a
 * decided status with none (every pre-fix AI approval left one behind).
 * Mirrors the task dispatcher's `isTaskStatus(patch.status) ?
 * applyStatusChange(...) : merged`.
 */
export function applyModelChangeStatus(
  item: ChangeItem, raw: unknown, stored: ChangeStatus, today: string,
): ChangeItem {
  return isChangeStatus(raw) ? applyChangeStatus(item, raw, today) : { ...item, status: stored };
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
