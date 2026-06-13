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
} as const;

export const TIER_NOW = 60;
export const TIER_SOON = 30;

export interface ScoreFactors {
  urgency?: number;
  risk?: number;
  impact?: number;
  quickWin?: number;
  staleness?: number;
}

export function scoreAction(f: ScoreFactors): number {
  return (f.urgency ?? 0) + (f.risk ?? 0) + (f.impact ?? 0) + (f.quickWin ?? 0) + (f.staleness ?? 0);
}

export function bandTier(score: number): ActionTier {
  if (score >= TIER_NOW) return "now";
  if (score >= TIER_SOON) return "soon";
  return "monitor";
}

/** Staleness contribution: +1/day capped. */
export function stalenessScore(days: number): number {
  return Math.min(Math.max(0, Math.floor(days)) * ACTION_WEIGHTS.stalenessPerDay, ACTION_WEIGHTS.stalenessCap);
}
