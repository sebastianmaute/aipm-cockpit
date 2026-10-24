// src/app/action-learning.ts — pure, i18n-free learning model for the Action Center.
import { canonicalLearningKind } from "./next-actions/learning-kind";

export type OutcomeType = "acted" | "snoozed" | "dismissed";
export type OutcomeStats = { acted: number; snoozed: number; dismissed: number; lastAt: number };
/** key = the learning kind, `learningKindOf` in next-actions/learning-kind.ts (§778). */
export type LearningState = Record<string, OutcomeStats>;
export type LearningOverride = "auto" | "surface" | "suppress" | "off";
export type LearningOverrides = Record<string, LearningOverride>;

export const BIAS_CAP = 20;
export const MIN_EVIDENCE = 3;
export const DECAY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;
const W_ACTED = 1, W_SNOOZED = 0.5, W_DISMISSED = 1;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function decayStats(s: OutcomeStats, now: number): OutcomeStats {
  if (now <= s.lastAt) return s;
  const f = 0.5 ** ((now - s.lastAt) / DECAY_HALF_LIFE_MS);
  return { acted: s.acted * f, snoozed: s.snoozed * f, dismissed: s.dismissed * f, lastAt: now };
}

export function recordOutcome(state: LearningState, kind: string, type: OutcomeType, now: number): LearningState {
  const prev = state[kind] ?? { acted: 0, snoozed: 0, dismissed: 0, lastAt: 0 };
  const decayed = decayStats(prev, now);
  return { ...state, [kind]: { ...decayed, [type]: decayed[type] + 1, lastAt: now } };
}

export function learnedBias(s: OutcomeStats): number {
  const total = s.acted + s.snoozed + s.dismissed;
  if (total < MIN_EVIDENCE) return 0;
  const net = W_ACTED * s.acted - W_SNOOZED * s.snoozed - W_DISMISSED * s.dismissed;
  return clamp(Math.round(BIAS_CAP * (net / total)), -BIAS_CAP, BIAS_CAP);
}

export function effectiveBias(s: OutcomeStats, override: LearningOverride): number {
  switch (override) {
    case "surface": return BIAS_CAP;
    case "suppress": return -BIAS_CAP;
    case "off": return 0;
    default: return learnedBias(s);
  }
}

export function buildBiasMap(state: LearningState, overrides: LearningOverrides, now: number): Record<string, number> {
  const kinds = new Set<string>([...Object.keys(state), ...Object.keys(overrides)]);
  const out: Record<string, number> = {};
  const zero: OutcomeStats = { acted: 0, snoozed: 0, dismissed: 0, lastAt: 0 };
  for (const k of kinds) {
    const bias = effectiveBias(decayStats(state[k] ?? zero, now), overrides[k] ?? "auto");
    if (bias !== 0) out[k] = bias;
  }
  return out;
}

/** Combine two rows of one kind: each decayed to the later `lastAt`, then summed —
 *  the same state `recordOutcome` would have reached had every outcome been
 *  recorded under one kind. */
function mergeStats(a: OutcomeStats, b: OutcomeStats): OutcomeStats {
  const at = Math.max(a.lastAt, b.lastAt);
  const da = decayStats(a, at);
  const db = decayStats(b, at);
  return { acted: da.acted + db.acted, snoozed: da.snoozed + db.snoozed, dismissed: da.dismissed + db.dismissed, lastAt: at };
}

/**
 * §778 — read-time normalisation of a stored learning snapshot: every row and
 * override stored under a count-variant kind ("…One") moves to its canonical
 * kind (`canonicalLearningKind`), so data written before the merge is neither
 * lost nor left as a second row whose override no longer applies.
 *
 * Rows of one canonical kind are combined by `mergeStats`. Overrides: an
 * explicit (non-"auto") override already stored under the CANONICAL kind wins;
 * otherwise an explicit one from a variant kind is kept; otherwise the
 * canonical kind's own value ("auto", or nothing). Idempotent: a canonical
 * snapshot comes back equal, so the full-rewrite save that follows is safe to
 * repeat.
 */
export function normalizeLearningSnapshot(snap: { state: LearningState; overrides: LearningOverrides }): {
  state: LearningState;
  overrides: LearningOverrides;
} {
  const state: LearningState = {};
  for (const [kind, s] of Object.entries(snap.state)) {
    const k = canonicalLearningKind(kind);
    state[k] = Object.hasOwn(state, k) ? mergeStats(state[k], s) : s;
  }
  // Two passes, so the result does not depend on key order: the canonical
  // kinds' own overrides first, then a variant's fills a gap or an "auto".
  const overrides: LearningOverrides = {};
  const entries = Object.entries(snap.overrides);
  for (const [kind, ov] of entries) {
    if (canonicalLearningKind(kind) === kind) overrides[kind] = ov;
  }
  for (const [kind, ov] of entries) {
    const k = canonicalLearningKind(kind);
    if (k === kind) continue;
    const current = Object.hasOwn(overrides, k) ? overrides[k] : undefined;
    if (current === undefined || current === "auto") overrides[k] = ov;
  }
  return { state, overrides };
}
