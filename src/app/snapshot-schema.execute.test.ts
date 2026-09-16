// Snapshot schema — EXECUTED against a real SQLite engine.
//
// ★★ WHY. `snapshot-schema.test.ts` string-matches the generated SQL and
// never runs it, so it cannot see the one failure this file exists for: an
// EXISTING database whose `snapshot` table predates a column the INSERT now
// names. `CREATE TABLE IF NOT EXISTS` is a no-op against such a table, so the
// named-column INSERT is rejected — and because a libSQL pipeline does NOT
// abort at a failing statement, COMMIT still runs and the capture is silently
// lost. `snapshotColumnEnsureStatements` is the repair; this suite runs it,
// and the real INSERT, against `node:sqlite` (see `node-sqlite.d.ts` for why
// the import type-checks).

import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  appendStatements, rowsToSnapshots, snapshotColumnEnsureStatements,
} from "./snapshot-schema";
import type { PipelineResultLike, SqlStmt } from "./turso-schema";
import type { SnapshotRecord } from "./snapshot";

// ★★ A LITERAL COPY of the `snapshot` DDL as committed before
// `bucket_progress_json` existed (17b73ca6). It models a database created by
// an earlier release, so it must NOT be derived from `SNAPSHOT_DDL` — that
// would always describe today's table and the ensure step would have nothing
// to repair. Never update it to match the live DDL.
const OLD_SNAPSHOT_DDL = `CREATE TABLE IF NOT EXISTS snapshot (
    id TEXT PRIMARY KEY, captured_at TEXT, bucket TEXT, cadence TEXT, trigger TEXT,
    is_baseline TEXT, remaining_hours TEXT, remaining_cost TEXT, pct_complete TEXT,
    forecast_end_date TEXT, plan_end_date TEXT, spi TEXT, cpi TEXT,
    overall_rag TEXT, schedule_rag TEXT, budget_rag TEXT, scope_rag TEXT,
    currency TEXT, milestones_json TEXT, project_id TEXT
  )`;

const OLD_SERIES_DDL = `CREATE TABLE IF NOT EXISTS snapshot_series (
    snapshot_id TEXT, seq TEXT, period TEXT,
    planned_hours TEXT, actual_hours TEXT, planned_cost TEXT, actual_cost TEXT, project_id TEXT
  )`;

const rec: SnapshotRecord = {
  id: "2026-06-03T09:00:00.000Z", capturedAt: "2026-06-03T09:00:00.000Z",
  bucket: "2026-W23", cadence: "weekly", trigger: "manual", isBaseline: false,
  remainingHours: 60, remainingCost: 6000, pctComplete: 25,
  forecastEndDate: "2026-09-15", planEndDate: "2026-07-31", spi: 0.8, cpi: 1.1,
  overallRag: "A", scheduleRag: "R", budgetRag: "A", scopeRag: "",
  currency: "EUR",
  milestones: [{ id: 7, name: "M1", target: "2026-07-01", forecast: "2026-07-10" }],
  bucketProgress: [{ bucketId: 1, pctComplete: 40 }, { bucketId: 2, pctComplete: 50 }],
  series: [{ period: "2026-06", plannedHours: 50, actualHours: 60, plannedCost: 5000, actualCost: 6000 }],
};

function runStatements(db: DatabaseSync, statements: readonly SqlStmt[]): void {
  for (const s of statements) {
    if (!s.args || s.args.length === 0) {
      db.exec(s.sql);
      continue;
    }
    db.prepare(s.sql).run(...s.args.map((a) => a.value ?? null));
  }
}

/** Shape `node:sqlite` rows as the Hrana result the decoders read. */
function asPipelineResult(rows: Record<string, unknown>[], names: readonly string[]): PipelineResultLike {
  return {
    type: "ok",
    response: { type: "execute", result: {
      cols: names.map((name) => ({ name })),
      rows: rows.map((row) => names.map((n) => ({ value: row[n] }))),
    } },
  };
}

function query(db: DatabaseSync, sql: string): PipelineResultLike {
  const rows = db.prepare(sql).all();
  const names = rows.length > 0 ? Object.keys(rows[0]) : [];
  return asPipelineResult(rows, names);
}

const pragma = (db: DatabaseSync) => query(db, "PRAGMA table_info(\"snapshot\")");

describe("snapshot schema against an existing (pre-bucket-progress) database", () => {
  it("the ensure step adds the column, the insert then round-trips, and a re-run is a no-op", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(OLD_SNAPSHOT_DDL);
      db.exec(OLD_SERIES_DDL);

      const ensure = snapshotColumnEnsureStatements(pragma(db));
      expect(ensure).toHaveLength(1);
      runStatements(db, ensure);

      runStatements(db, appendStatements(rec, "p1"));

      const out = rowsToSnapshots(
        query(db, "SELECT * FROM snapshot"),
        query(db, "SELECT * FROM snapshot_series"),
      );
      expect(out).toEqual([rec]);

      expect(snapshotColumnEnsureStatements(pragma(db))).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("without the ensure step the insert is rejected (the failure this repairs)", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(OLD_SNAPSHOT_DDL);
      db.exec(OLD_SERIES_DDL);
      expect(() => runStatements(db, appendStatements(rec, "p1"))).toThrow(/bucket_progress_json/);
    } finally {
      db.close();
    }
  });
});
