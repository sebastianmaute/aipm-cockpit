// Pure helpers for the Change-control Log. No React, no DOM. Sibling to raid.ts.
import type { Health } from "./health";
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

/** Next id — monotonic, separate from task/raid ids. */
export function nextChangeId(items: readonly ChangeItem[]): number {
  let max = 0;
  for (const i of items) if (i.id > max) max = i.id;
  return max + 1;
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
