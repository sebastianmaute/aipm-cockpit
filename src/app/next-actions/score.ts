// src/app/next-actions/score.ts
import type { ActionTier } from "./types";

/** All ranking weights in one place — tune here. */
export const ACTION_WEIGHTS = {
  urgencyOverdue: 40,
  urgencyToday: 30,
  urgencySoon: 15,
  riskCritical: 30, // Critical / Red RAG
  riskHigh: 15,     // High / Amber
  impactBlocksMilestone: 20,
  impactScopePending: 15,
  quickWin: 10,
  stalenessPerDay: 1,
  stalenessCap: 15,
  clarityBonus: 15,     // signal has one obvious assignable fix
  semiClarityBonus: 7,  // several levers, still actionable
  staticPenalty: 25,    // aggregate/derived red with no single lever
} as const;

export const TIER_NOW = 60;
export const TIER_SOON = 30;

export interface ScoreFactors {
  urgency?: number;
  risk?: number;
  impact?: number;
  quickWin?: number;
  staleness?: number;
  clarity?: number;        // confidence bonus (clear-fix item)
  staticPenalty?: number;  // confidence penalty (vague/static signal)
}

export function scoreAction(f: ScoreFactors): number {
  const sum =
    (f.urgency ?? 0) + (f.risk ?? 0) + (f.impact ?? 0) +
    (f.quickWin ?? 0) + (f.staleness ?? 0) +
    (f.clarity ?? 0) - (f.staticPenalty ?? 0);
  return Math.max(0, sum); // never negative — keeps sort deterministic
}

export function bandTier(score: number): ActionTier {
  if (score >= TIER_NOW) return "now";
  if (score >= TIER_SOON) return "soon";
  return "monitor";
}

/** Apply a bounded learned bias to an intrinsic score, never demoting an
 *  intrinsically-now item out of the now tier (safety floor). */
export function applyLearnedBias(intrinsic: number, kind: string, learnedBias?: Record<string, number>): number {
  const bias = learnedBias?.[kind] ?? 0;
  const biased = Math.max(0, intrinsic + bias);
  return intrinsic >= TIER_NOW ? Math.max(biased, TIER_NOW) : biased;
}

/** Staleness contribution: +1/day capped. */
export function stalenessScore(days: number): number {
  return Math.min(Math.max(0, Math.floor(days)) * ACTION_WEIGHTS.stalenessPerDay, ACTION_WEIGHTS.stalenessCap);
}
