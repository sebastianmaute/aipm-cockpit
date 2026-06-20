// src/app/next-actions/trends.ts
//
// Pure trend derivation for the confidence ranking. Compares the latest snapshot
// to an earlier one and reports a direction per aggregate metric. No React, no
// Turso import — the surface passes the result in via ActionInput.trends.
import type { SnapshotRecord } from "../snapshot";

export type TrendDir = "worsening" | "flat" | "improving";

export interface ActionTrends {
  budget?: TrendDir;
  schedule?: TrendDir;
}

export const TREND_LOOKBACK = 1;       // snapshots back to compare against (Nth prior snapshot)
const COST_EPSILON = 1;                 // currency units treated as "no change"
const SPI_EPSILON = 0.01;
const RAG_ORDER: Record<string, number> = { G: 0, A: 1, R: 2 };

export function computeActionTrends(
  snapshots: readonly SnapshotRecord[],
  lookback: number = TREND_LOOKBACK,
): ActionTrends | undefined {
  if (snapshots.length < 2) return undefined;
  const sorted = [...snapshots].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const latest = sorted[sorted.length - 1];
  const prev = sorted[Math.max(0, sorted.length - 1 - lookback)];

  const out: ActionTrends = {};
  const budget = costTrend(prev, latest);
  if (budget) out.budget = budget;
  const schedule = spiTrend(prev, latest);
  if (schedule) out.schedule = schedule;
  return out;
}

// Higher remaining cost = worsening; null cost on either side → RAG movement.
function costTrend(prev: SnapshotRecord, latest: SnapshotRecord): TrendDir | undefined {
  if (prev.remainingCost != null && latest.remainingCost != null) {
    const d = latest.remainingCost - prev.remainingCost;
    return Math.abs(d) <= COST_EPSILON ? "flat" : d > 0 ? "worsening" : "improving";
  }
  const a = RAG_ORDER[prev.budgetRag];
  const b = RAG_ORDER[latest.budgetRag];
  if (a == null || b == null) return undefined; // "" RAG → no signal
  return a === b ? "flat" : b > a ? "worsening" : "improving";
}

// Lower SPI = worsening.
function spiTrend(prev: SnapshotRecord, latest: SnapshotRecord): TrendDir | undefined {
  if (prev.spi == null || latest.spi == null) return undefined;
  const d = latest.spi - prev.spi;
  return Math.abs(d) <= SPI_EPSILON ? "flat" : d < 0 ? "worsening" : "improving";
}

// Compact, token-bounded one-line trend summary for the AI weight-suggestion
// prompt. Pure (no React/i18n) so it stays unit-testable. Emits "schedule: X,
// budget: Y" from the aggregate-metric directions; returns a clear sentinel
// when there is no usable trend data.
export function summarizeTrendsForPrompt(trends: ActionTrends | undefined): string {
  if (!trends) return "(no trend data)";
  const parts: string[] = [];
  if (trends.schedule) parts.push(`schedule: ${trends.schedule}`);
  if (trends.budget) parts.push(`budget: ${trends.budget}`);
  return parts.length === 0 ? "(no trend data)" : parts.join(", ");
}
