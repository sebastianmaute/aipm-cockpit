// src/app/snapshot-schema.ts
//
// Pure SQL builders + row decoders for the snapshot tables. These tables are
// APPEND-ONLY and MUST stay disjoint from turso-schema's TABLE_NAMES so the
// workspace overwrite (DELETE FROM ... per save) never touches them.

import type { PipelineResultLike, SqlStmt } from "./turso-schema";
import type {
  SnapshotCadence, SnapshotMilestone, SnapshotRecord, SnapshotSeriesPoint, SnapshotTrigger,
} from "./snapshot";
import type { Health } from "./health";

export const SNAPSHOT_TABLE_NAMES = ["snapshot", "snapshot_series"] as const;

export const SNAPSHOT_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS snapshot (
    id TEXT PRIMARY KEY, captured_at TEXT, bucket TEXT, cadence TEXT, trigger TEXT,
    is_baseline TEXT, remaining_hours TEXT, remaining_cost TEXT, pct_complete TEXT,
    forecast_end_date TEXT, plan_end_date TEXT, spi TEXT, cpi TEXT,
    overall_rag TEXT, schedule_rag TEXT, budget_rag TEXT, scope_rag TEXT,
    currency TEXT, milestones_json TEXT, project_id TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS snapshot_series (
    snapshot_id TEXT, seq TEXT, period TEXT,
    planned_hours TEXT, actual_hours TEXT, planned_cost TEXT, actual_cost TEXT, project_id TEXT
  )`,
];

const text = (value: string) => ({ type: "text" as const, value });
const numText = (n: number | null) => text(n === null ? "" : String(n));

const SNAPSHOT_COLS = [
  "id", "captured_at", "bucket", "cadence", "trigger", "is_baseline",
  "remaining_hours", "remaining_cost", "pct_complete", "forecast_end_date",
  "plan_end_date", "spi", "cpi", "overall_rag", "schedule_rag", "budget_rag",
  "scope_rag", "currency", "milestones_json", "project_id",
] as const;

const SERIES_COLS = [
  "snapshot_id", "seq", "period", "planned_hours", "actual_hours", "planned_cost", "actual_cost", "project_id",
] as const;

function insert(table: string, cols: readonly string[], args: { type: "text"; value: string }[]): SqlStmt {
  return {
    sql: `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    args,
  };
}

/** SELECT both snapshot tables (caller prepends SNAPSHOT_DDL). Order: snapshot, series.
 *  Both selects are scoped to a single project_id for Turso multi-tenancy. */
export function snapshotSelectStatements(projectId: string): SqlStmt[] {
  return [
    { sql: "SELECT * FROM snapshot WHERE project_id = ? ORDER BY captured_at", args: [text(projectId)] },
    { sql: "SELECT * FROM snapshot_series WHERE project_id = ?", args: [text(projectId)] },
  ];
}

/** BEGIN + insert the snapshot row + its series rows + COMMIT. Every inserted
 *  row carries project_id (the trailing column of both COLS arrays). */
export function appendStatements(rec: SnapshotRecord, projectId: string): SqlStmt[] {
  const out: SqlStmt[] = [{ sql: "BEGIN" }];
  out.push(insert("snapshot", SNAPSHOT_COLS, [
    text(rec.id), text(rec.capturedAt), text(rec.bucket), text(rec.cadence), text(rec.trigger),
    text(rec.isBaseline ? "1" : "0"),
    numText(rec.remainingHours), numText(rec.remainingCost), numText(rec.pctComplete),
    text(rec.forecastEndDate), text(rec.planEndDate), numText(rec.spi), numText(rec.cpi),
    text(rec.overallRag), text(rec.scheduleRag), text(rec.budgetRag), text(rec.scopeRag),
    text(rec.currency), text(JSON.stringify(rec.milestones)), text(projectId),
  ]));
  rec.series.forEach((p, i) => {
    out.push(insert("snapshot_series", SERIES_COLS, [
      text(rec.id), text(String(i)), text(p.period),
      numText(p.plannedHours), numText(p.actualHours), numText(p.plannedCost), numText(p.actualCost),
      text(projectId),
    ]));
  });
  out.push({ sql: "COMMIT" });
  return out;
}

/** Clear then set the baseline flag. BOTH updates are scoped by project_id so a
 *  re-baseline in one project never clears another project's baseline. */
export function setBaselineStatements(id: string, projectId: string): SqlStmt[] {
  return [
    { sql: "UPDATE snapshot SET is_baseline='0' WHERE project_id = ?", args: [text(projectId)] },
    { sql: "UPDATE snapshot SET is_baseline='1' WHERE id = ? AND project_id = ?", args: [text(id), text(projectId)] },
  ];
}

export function deleteStatements(id: string, projectId: string): SqlStmt[] {
  return [
    { sql: "DELETE FROM snapshot_series WHERE snapshot_id = ? AND project_id = ?", args: [text(id), text(projectId)] },
    { sql: "DELETE FROM snapshot WHERE id = ? AND project_id = ?", args: [text(id), text(projectId)] },
  ];
}

// --- decode ---------------------------------------------------------------

function rowObjects(res: PipelineResultLike | undefined): Record<string, string>[] {
  const names = (res?.response?.result?.cols ?? []).map((c) => c?.name ?? "");
  const rows = res?.response?.result?.rows ?? [];
  return rows.map((row) => {
    const obj: Record<string, string> = {};
    names.forEach((n, i) => {
      const cell = row[i];
      obj[n] = cell == null || cell.value == null ? "" : String(cell.value);
    });
    return obj;
  });
}

const numOrNull = (s: string): number | null => (s === "" ? null : Number(s));
const ragOf = (s: string): Health | "" => (s === "R" || s === "A" || s === "G" ? s : "");

function parseMilestones(json: string): SnapshotMilestone[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((m): m is SnapshotMilestone => !!m && typeof m === "object")
      .map((m) => ({ id: Number(m.id), name: String(m.name ?? ""), target: String(m.target ?? ""), forecast: String(m.forecast ?? "") }));
  } catch {
    return [];
  }
}

/** Reassemble SnapshotRecords from the two SELECT results. Malformed rows are
 *  skipped. Series rows are attached to their snapshot by snapshot_id, ordered
 *  by numeric seq. */
export function rowsToSnapshots(
  snapshotRes: PipelineResultLike | undefined,
  seriesRes: PipelineResultLike | undefined,
): SnapshotRecord[] {
  const seriesById = new Map<string, { seq: number; point: SnapshotSeriesPoint }[]>();
  for (const r of rowObjects(seriesRes)) {
    const list = seriesById.get(r.snapshot_id) ?? [];
    list.push({
      seq: Number(r.seq || 0),
      point: {
        period: r.period,
        plannedHours: Number(r.planned_hours || 0),
        actualHours: numOrNull(r.actual_hours),
        plannedCost: Number(r.planned_cost || 0),
        actualCost: numOrNull(r.actual_cost),
      },
    });
    seriesById.set(r.snapshot_id, list);
  }
  const orderedById = new Map<string, SnapshotSeriesPoint[]>();
  for (const [id, list] of seriesById) {
    orderedById.set(id, [...list].sort((a, b) => a.seq - b.seq).map((x) => x.point));
  }
  return rowObjects(snapshotRes)
    .filter((r) => r.id)
    .map((r): SnapshotRecord => ({
      id: r.id,
      capturedAt: r.captured_at,
      bucket: r.bucket,
      cadence: (r.cadence || "weekly") as SnapshotCadence,
      trigger: (r.trigger || "auto") as SnapshotTrigger,
      isBaseline: r.is_baseline === "1",
      remainingHours: numOrNull(r.remaining_hours),
      remainingCost: numOrNull(r.remaining_cost),
      pctComplete: Number(r.pct_complete || 0),
      forecastEndDate: r.forecast_end_date,
      planEndDate: r.plan_end_date,
      spi: numOrNull(r.spi),
      cpi: numOrNull(r.cpi),
      overallRag: ragOf(r.overall_rag),
      scheduleRag: ragOf(r.schedule_rag),
      budgetRag: ragOf(r.budget_rag),
      scopeRag: ragOf(r.scope_rag),
      currency: r.currency || "EUR",
      milestones: parseMilestones(r.milestones_json),
      series: orderedById.get(r.id) ?? [],
    }));
}
