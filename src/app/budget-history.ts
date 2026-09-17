/**
 * Append-only budget-at-completion series (spec 2026-09-16 §4.3). Values are the
 * project OWN basis in hours and EUR — EUR by construction (§465), so no stored
 * currency. Written only from the budget commit boundary — the first recorded
 * change seeds a `baseline` entry from the BAC before that change; undo and
 * version restore bypass this write path entirely and their BAC movement
 * surfaces as unattributed variance instead.
 */
import { sanitizeIsoDate } from "./sanitize-core";

export type BudgetHistoryKind = "baseline" | "created" | "updated" | "deleted";
export type BudgetHistoryEntry = {
  id: string; at: string; date: string; kind: BudgetHistoryKind;
  bucketId: number | null; bucketName: string;
  projectBacHours: number; projectBacValue: number;
  deltaHours: number; deltaValue: number;
};
export type ProjectBac = { hours: number; value: number };
export type BudgetChange = {
  kind: Exclude<BudgetHistoryKind, "baseline">; bucketId: number; bucketName: string;
  before: ProjectBac; after: ProjectBac; at: string; date: string; newId: () => string;
};
export const BAC_EPSILON = 1e-6;

const KINDS: ReadonlySet<string> = new Set<BudgetHistoryKind>(["baseline", "created", "updated", "deleted"]);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function sanitizeEntry(input: unknown): BudgetHistoryEntry | null {
  if (!input || typeof input !== "object") return null;
  const e = input as Record<string, unknown>;
  if (typeof e.id !== "string" || e.id === "" || typeof e.at !== "string") return null;
  if (typeof e.kind !== "string" || !KINDS.has(e.kind)) return null;
  const date = typeof e.date === "string" ? sanitizeIsoDate(e.date) : "";
  if (!date) return null;
  const bucketId = e.kind === "baseline" ? null : finite(e.bucketId) ? e.bucketId : NaN;
  if (Number.isNaN(bucketId)) return null;
  if (![e.projectBacHours, e.projectBacValue, e.deltaHours, e.deltaValue].every(finite)) return null;
  return {
    id: e.id, at: e.at, date, kind: e.kind as BudgetHistoryKind, bucketId,
    bucketName: typeof e.bucketName === "string" ? e.bucketName : "",
    projectBacHours: e.projectBacHours as number, projectBacValue: e.projectBacValue as number,
    deltaHours: e.deltaHours as number, deltaValue: e.deltaValue as number,
  };
}

export function sanitizeBudgetHistory(input: unknown): BudgetHistoryEntry[] {
  if (!Array.isArray(input)) return [];
  return input.map(sanitizeEntry).filter((e): e is BudgetHistoryEntry => e !== null);
}

/**
 * Union by `id` for a same-project load (`applyWorkspace`'s "merge" mode):
 * `prev` in its order first, then the ids only `next` holds, in `next`'s order.
 * `prev` wins a duplicate id (ids are minted once, so both copies are equal).
 * NEVER capped, unlike `mergeActivityLogs`. ALWAYS returns a new array — the
 * Turso dirty check is reference equality, so returning an input would skip
 * the save.
 */
export function mergeBudgetHistories(
  prev: readonly BudgetHistoryEntry[] | undefined,
  next: readonly BudgetHistoryEntry[] | undefined,
): BudgetHistoryEntry[] {
  const out = [...(prev ?? [])];
  const seen = new Set(out.map((e) => e.id));
  for (const e of next ?? []) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

/**
 * Chronological order for display. `mergeBudgetHistories` unions prev-then-new
 * ids, so a same-project load from a second device can hand the entries back in
 * an order that is NOT chronological — any surface that steps a running figure
 * over them (the chart's BAC steps, the change table's cumulative column) must
 * order first or its running total is wrong. Sorted on `at` (the wall-clock
 * stamp), falling back to `date` for an entry whose `at` is blank; ties keep
 * the caller's order (Array#sort is stable).
 */
export function orderBudgetChanges(changes: readonly BudgetHistoryEntry[]): BudgetHistoryEntry[] {
  const key = (e: BudgetHistoryEntry) => e.at || e.date;
  return [...changes].sort((a, b) => {
    const ka = key(a), kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

export function recordBudgetChange(
  history: readonly BudgetHistoryEntry[], change: BudgetChange,
): readonly BudgetHistoryEntry[] {
  const dh = change.after.hours - change.before.hours;
  const dv = change.after.value - change.before.value;
  if (Math.abs(dh) < BAC_EPSILON && Math.abs(dv) < BAC_EPSILON) return history;
  const seeded: BudgetHistoryEntry[] = history.some((e) => e.kind === "baseline") ? [] : [{
    id: change.newId(), at: change.at, date: change.date, kind: "baseline", bucketId: null, bucketName: "",
    projectBacHours: change.before.hours, projectBacValue: change.before.value, deltaHours: 0, deltaValue: 0,
  }];
  return [...history, ...seeded, {
    id: change.newId(), at: change.at, date: change.date, kind: change.kind,
    bucketId: change.bucketId, bucketName: change.bucketName,
    projectBacHours: change.after.hours, projectBacValue: change.after.value, deltaHours: dh, deltaValue: dv,
  }];
}

export type BudgetHistorySummary = {
  baselineDate: string; baseline: ProjectBac; attributed: ProjectBac;
  changes: readonly BudgetHistoryEntry[];
};

/**
 * Orders the history with `orderBudgetChanges` FIRST — `mergeBudgetHistories`
 * unions prev-then-new ids, so array position is not date order — then locates
 * the baseline in that chronological order. When a second device seeded its
 * own baseline before syncing, several `baseline` entries can exist; the
 * EARLIEST one (first after ordering) wins and every later one is dropped by
 * the `kind !== "baseline"` filter below, same as any other baseline. A change
 * dated before the earliest baseline is excluded from `attributed` — only
 * corrupted or hand-edited data reaches that shape, since `recordBudgetChange`
 * always seeds the baseline before its first change.
 */
export function summarizeBudgetHistory(history: readonly BudgetHistoryEntry[]): BudgetHistorySummary | null {
  const ordered = orderBudgetChanges(history);
  const i = ordered.findIndex((e) => e.kind === "baseline");
  if (i < 0) return null;
  const base = ordered[i];
  const changes = ordered.slice(i + 1).filter((e) => e.kind !== "baseline");
  return {
    baselineDate: base.date,
    baseline: { hours: base.projectBacHours, value: base.projectBacValue },
    attributed: {
      hours: changes.reduce((s, e) => s + e.deltaHours, 0),
      value: changes.reduce((s, e) => s + e.deltaValue, 0),
    },
    changes,
  };
}

export type VarianceSplit = { vac: number; performance: number; attributed: number; unattributed: number };

/** Closed by construction: performance + attributed + unattributed === vac. */
export function splitVariance(baseline: number, attributed: number, bac: number, eac: number): VarianceSplit {
  return { vac: bac - eac, performance: baseline - eac, attributed, unattributed: bac - baseline - attributed };
}
