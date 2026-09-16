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

export function summarizeBudgetHistory(history: readonly BudgetHistoryEntry[]): BudgetHistorySummary | null {
  const i = history.findIndex((e) => e.kind === "baseline");
  if (i < 0) return null;
  const base = history[i];
  const changes = history.slice(i + 1).filter((e) => e.kind !== "baseline");
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
