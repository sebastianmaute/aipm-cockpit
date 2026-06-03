// src/app/snapshot.ts
//
// Pure snapshot domain logic for the Baseline + Variance / Burndown Trends
// feature. No React, no I/O. Snapshots capture project KPIs at a moment in time
// (persisted Turso-only) so slippage can be shown over time.

import type { Health } from "./health";
import type { DashboardModel } from "./dashboard";
import type { Milestone, Task } from "./types";

export type SnapshotCadence = "weekly" | "daily" | "monthly";
export type SnapshotTrigger = "auto" | "manual";

export interface SnapshotSeriesPoint {
  period: string;
  plannedHours: number;
  actualHours: number | null;
  plannedCost: number;
  actualCost: number | null;
}

export interface SnapshotMilestone {
  id: number;
  name: string;
  target: string;   // YYYY-MM-DD
  forecast: string;  // YYYY-MM-DD
}

export interface SnapshotRecord {
  id: string;            // client-generated = capturedAt (ISO ms), unique per capture
  capturedAt: string;    // ISO timestamp
  bucket: string;        // bucketKey(capturedAt, cadence)
  cadence: SnapshotCadence;
  trigger: SnapshotTrigger;
  isBaseline: boolean;
  remainingHours: number | null;
  remainingCost: number | null;
  pctComplete: number;
  forecastEndDate: string;  // YYYY-MM-DD
  planEndDate: string;      // YYYY-MM-DD
  spi: number | null;
  cpi: number | null;
  overallRag: Health | "";
  scheduleRag: Health | "";
  budgetRag: Health | "";
  scopeRag: Health | "";
  currency: string;
  milestones: SnapshotMilestone[];
  series: SnapshotSeriesPoint[];
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** ISO-8601 week number + week-year for a date (Mon-based, week 1 contains the
 *  first Thursday). Returns { year, week }. */
function isoWeek(date: Date): { year: number; week: number } {
  // Work in UTC to avoid TZ drift; copy so we don't mutate the input.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // Sun=0 -> 7
  d.setUTCDate(d.getUTCDate() + 4 - day); // shift to the Thursday of this week
  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year, week };
}

/** Cadence bucket key for a capture instant. */
export function bucketKey(date: Date, cadence: SnapshotCadence): string {
  const y = date.getUTCFullYear();
  const m = pad2(date.getUTCMonth() + 1);
  const d = pad2(date.getUTCDate());
  if (cadence === "daily") return `${y}-${m}-${d}`;
  if (cadence === "monthly") return `${y}-${m}`;
  const { year, week } = isoWeek(date);
  return `${year}-W${pad2(week)}`;
}

function startOfBucket(date: Date, cadence: SnapshotCadence): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (cadence === "daily") return d;
  if (cadence === "monthly") return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  // weekly: step back to Monday
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d;
}

function advance(date: Date, cadence: SnapshotCadence): Date {
  const d = new Date(date);
  if (cadence === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (cadence === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

/** Inclusive list of cadence bucket keys from `from` to `to`. Empty if to < from. */
export function expectedBuckets(from: Date, to: Date, cadence: SnapshotCadence): string[] {
  const out: string[] = [];
  let cursor = startOfBucket(from, cadence);
  const end = startOfBucket(to, cadence);
  // Guard against pathological inputs: cap at 1000 buckets.
  for (let i = 0; cursor.getTime() <= end.getTime() && i < 1000; i++) {
    out.push(bucketKey(cursor, cadence));
    cursor = advance(cursor, cadence);
  }
  return out;
}

/** Expected buckets between the earliest snapshot and `today` that have no
 *  snapshot. Empty when there are no snapshots. */
export function detectGaps(
  snapshots: readonly SnapshotRecord[],
  cadence: SnapshotCadence,
  today: Date,
): string[] {
  if (snapshots.length === 0) return [];
  const sorted = [...snapshots].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const first = new Date(sorted[0].capturedAt);
  const have = new Set(snapshots.map((s) => s.bucket));
  return expectedBuckets(first, today, cadence).filter((b) => !have.has(b));
}
