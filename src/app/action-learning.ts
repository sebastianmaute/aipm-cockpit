// src/app/action-learning.ts — pure, i18n-free learning model for the Action Center.
export type OutcomeType = "acted" | "snoozed" | "dismissed";
export type OutcomeStats = { acted: number; snoozed: number; dismissed: number; lastAt: number };
export type LearningState = Record<string, OutcomeStats>; // key = `${source}:${why.key}`
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
