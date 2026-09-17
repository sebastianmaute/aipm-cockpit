import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_DDL, SNAPSHOT_TABLE_NAMES, appendStatements, deleteStatements,
  rowsToSnapshots, setBaselineStatements, snapshotColumnEnsureStatements, snapshotSelectStatements,
} from "./snapshot-schema";
import { TABLE_NAMES } from "./turso-schema";
import type { PipelineResultLike } from "./turso-schema";
import type { SnapshotRecord } from "./snapshot";

const rec: SnapshotRecord = {
  id: "2026-06-03T09:00:00.000Z", capturedAt: "2026-06-03T09:00:00.000Z",
  bucket: "2026-W23", cadence: "weekly", trigger: "manual", isBaseline: true,
  remainingHours: 60, remainingCost: 6000, pctComplete: 25,
  forecastEndDate: "2026-09-15", planEndDate: "2026-07-31", spi: 0.8, cpi: 1.1,
  overallRag: "A", scheduleRag: "R", budgetRag: "A", scopeRag: "",
  milestones: [{ id: 1, name: "M1", target: "2026-07-01", forecast: "2026-07-10" }],
  bucketProgress: [{ bucketId: 1, pctComplete: 40 }, { bucketId: 2, pctComplete: 50 }],
  series: [
    { period: "2026-06", plannedHours: 50, actualHours: 60, plannedCost: 5000, actualCost: 6000 },
    { period: "2026-07", plannedHours: 0, actualHours: null, plannedCost: 0, actualCost: null },
  ],
};

describe("snapshot schema", () => {
  it("REGRESSION GUARD: snapshot tables are disjoint from workspace TABLE_NAMES", () => {
    for (const name of SNAPSHOT_TABLE_NAMES) {
      expect(TABLE_NAMES).not.toContain(name);
    }
  });

  it("DDL is CREATE TABLE IF NOT EXISTS (idempotent, never DELETE/DROP)", () => {
    for (const ddl of SNAPSHOT_DDL) expect(ddl).toMatch(/CREATE TABLE IF NOT EXISTS/);
    expect(SNAPSHOT_DDL.join(" ")).not.toMatch(/DROP|DELETE/);
  });

  it("appendStatements wraps inserts in BEGIN/COMMIT and inserts series rows", () => {
    const stmts = appendStatements(rec, "p1");
    expect(stmts[0].sql).toBe("BEGIN");
    expect(stmts[stmts.length - 1].sql).toBe("COMMIT");
    const inserts = stmts.filter((s) => /INSERT INTO snapshot_series/.test(s.sql));
    expect(inserts).toHaveLength(2);
    const snapInsert = stmts.find((s) => /INSERT INTO snapshot \(/.test(s.sql));
    expect(snapInsert?.args?.some((a) => a.value === "1")).toBe(true); // is_baseline "1"
  });

  it("the snapshot INSERT names its live columns, never the retired currency column", () => {
    const snapInsert = appendStatements(rec, "p1").find((s) => /INSERT INTO snapshot \(/.test(s.sql));
    const cols = /\(([^)]*)\)/.exec(snapInsert?.sql ?? "")?.[1].split(", ") ?? [];
    expect(cols).toContain("bucket_progress_json"); // positive: a live column is named
    expect(cols).not.toContain("currency");          // absence: the retired column is not
    expect(snapInsert?.args).toHaveLength(cols.length); // arg count matches the column list
  });

  it("setBaselineStatements clears all then sets one", () => {
    const stmts = setBaselineStatements("abc", "p1");
    expect(stmts[0].sql).toMatch(/UPDATE snapshot SET is_baseline='0'/);
    expect(stmts[1].sql).toMatch(/UPDATE snapshot SET is_baseline='1' WHERE id = \?/);
    expect(stmts[1].args?.[0].value).toBe("abc");
  });

  it("deleteStatements removes the snapshot and its series rows", () => {
    const stmts = deleteStatements("abc", "p1");
    expect(stmts.some((s) => /DELETE FROM snapshot_series WHERE snapshot_id = \?/.test(s.sql))).toBe(true);
    expect(stmts.some((s) => /DELETE FROM snapshot WHERE id = \?/.test(s.sql))).toBe(true);
  });

  it("rowsToSnapshots round-trips a record (numbers, nulls, booleans, series)", () => {
    const snapshotResult: PipelineResultLike = {
      type: "ok",
      response: { type: "execute", result: {
        cols: ["id","captured_at","bucket","cadence","trigger","is_baseline","remaining_hours","remaining_cost","pct_complete","forecast_end_date","plan_end_date","spi","cpi","overall_rag","schedule_rag","budget_rag","scope_rag","milestones_json","bucket_progress_json"].map((name) => ({ name })),
        rows: [[
          rec.id, rec.capturedAt, rec.bucket, rec.cadence, rec.trigger, "1",
          "60", "6000", "25", rec.forecastEndDate, rec.planEndDate, "0.8", "1.1",
          "A", "R", "A", "", JSON.stringify(rec.milestones), JSON.stringify(rec.bucketProgress),
        ].map((value) => ({ value }))],
      } },
    };
    const seriesResult: PipelineResultLike = {
      type: "ok",
      response: { type: "execute", result: {
        cols: ["snapshot_id","seq","period","planned_hours","actual_hours","planned_cost","actual_cost"].map((name) => ({ name })),
        rows: [
          [rec.id, "0", "2026-06", "50", "60", "5000", "6000"].map((value) => ({ value })),
          [rec.id, "1", "2026-07", "0", "", "0", ""].map((value) => ({ value })),
        ],
      } },
    };
    const out = rowsToSnapshots(snapshotResult, seriesResult);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(rec);
  });
});

/** A one-row snapshot SELECT result. `progress: null` models an OLD
 *  database whose table predates the `bucket_progress_json` column. */
function snapshotRow(progress: string | null): PipelineResultLike {
  const names = ["id", "captured_at", "bucket", "milestones_json"];
  const values = [rec.id, rec.capturedAt, rec.bucket, "[]"];
  if (progress !== null) {
    names.push("bucket_progress_json");
    values.push(progress);
  }
  return {
    type: "ok",
    response: { type: "execute", result: {
      cols: names.map((name) => ({ name })),
      rows: [values.map((value) => ({ value }))],
    } },
  };
}

const decodeProgress = (progress: string | null) =>
  rowsToSnapshots(snapshotRow(progress), undefined)[0].bucketProgress;

describe("snapshot bucket progress", () => {
  it("appendStatements writes bucket_progress_json as the JSON of rec.bucketProgress", () => {
    const insert = appendStatements(rec, "p1").find((s) => /INSERT INTO snapshot \(/.test(s.sql));
    const cols = /\(([^)]*)\)/.exec(insert?.sql ?? "")?.[1].split(", ") ?? [];
    const idx = cols.indexOf("bucket_progress_json");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(insert?.args?.[idx]).toEqual({ type: "text", value: JSON.stringify(rec.bucketProgress) });
  });

  it("rowsToSnapshots decodes bucket_progress_json", () => {
    expect(decodeProgress(JSON.stringify(rec.bucketProgress))).toEqual(rec.bucketProgress);
  });

  it("a row from an old database WITHOUT the column decodes to []", () => {
    expect(decodeProgress(null)).toEqual([]);
  });

  it("unparseable JSON decodes to []", () => {
    expect(decodeProgress("not json")).toEqual([]);
  });

  it("a non-array JSON value decodes to []", () => {
    expect(decodeProgress("{\"bucketId\":1,\"pctComplete\":5}")).toEqual([]);
  });

  it("drops entries whose fields are not finite numbers", () => {
    const json = "[{\"bucketId\":1,\"pctComplete\":null},{\"bucketId\":\"x\",\"pctComplete\":5},"
      + "{\"bucketId\":3,\"pctComplete\":1e999},null,7,{\"bucketId\":2,\"pctComplete\":30}]";
    expect(decodeProgress(json)).toEqual([{ bucketId: 2, pctComplete: 30 }]);
  });
});

describe("snapshotColumnEnsureStatements", () => {
  const pragma = (names: string[]): PipelineResultLike => ({
    type: "ok",
    response: { type: "execute", result: {
      cols: ["cid", "name", "type", "notnull", "dflt_value", "pk"].map((name) => ({ name })),
      rows: names.map((n, i) => [String(i), n, "TEXT", "0", null, "0"].map((value) => ({ value }))),
    } },
  });
  const oldCols = [
    "id", "captured_at", "bucket", "cadence", "trigger", "is_baseline",
    "remaining_hours", "remaining_cost", "pct_complete", "forecast_end_date",
    "plan_end_date", "spi", "cpi", "overall_rag", "schedule_rag", "budget_rag",
    "scope_rag", "currency", "milestones_json", "project_id",
  ];

  it("adds bucket_progress_json to a table that lacks it", () => {
    expect(snapshotColumnEnsureStatements(pragma(oldCols))).toEqual([
      { sql: "ALTER TABLE \"snapshot\" ADD COLUMN \"bucket_progress_json\" TEXT" },
    ]);
  });

  it("emits nothing for an up-to-date table", () => {
    expect(snapshotColumnEnsureStatements(pragma([...oldCols, "bucket_progress_json"]))).toEqual([]);
  });

  it("emits nothing when the PRAGMA result is unreadable", () => {
    expect(snapshotColumnEnsureStatements(undefined)).toEqual([]);
    expect(snapshotColumnEnsureStatements({ type: "ok" })).toEqual([]);
  });
});

function projRec(): SnapshotRecord {
  return {
    id: "s1", capturedAt: "2026-01-01T00:00:00.000Z", bucket: "2026-W01",
    cadence: "weekly", trigger: "manual", isBaseline: false,
    remainingHours: 1, remainingCost: 2, pctComplete: 3,
    forecastEndDate: "2026-06-01", planEndDate: "2026-06-01", spi: 1, cpi: 1,
    overallRag: "G", scheduleRag: "G", budgetRag: "G", scopeRag: "G",
    milestones: [], bucketProgress: [], series: [{ period: "P1", plannedHours: 1, actualHours: 1, plannedCost: 1, actualCost: 1 }],
  };
}

describe("snapshot-schema project scoping", () => {
  it("DDL declares project_id on both snapshot tables", () => {
    const ddl = SNAPSHOT_DDL.join("\n");
    expect((ddl.match(/project_id TEXT/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("select statements scope by project_id", () => {
    const stmts = snapshotSelectStatements("p1");
    for (const s of stmts) {
      expect(s.sql).toContain("WHERE project_id = ?");
      expect(s.args?.[0]).toEqual({ type: "text", value: "p1" });
    }
  });

  it("append carries project_id on the snapshot row and every series row", () => {
    const stmts = appendStatements(projRec(), "p1");
    for (const s of stmts.filter((x) => x.sql.startsWith("INSERT"))) {
      expect(s.sql).toContain("project_id");
      expect(s.args?.[s.args.length - 1]).toEqual({ type: "text", value: "p1" });
    }
  });

  it("setBaseline scopes BOTH updates by project_id (no cross-project clobber)", () => {
    const stmts = setBaselineStatements("s1", "p1");
    expect(stmts).toHaveLength(2);
    for (const s of stmts) expect(s.sql).toContain("project_id = ?");
    expect(stmts[0].sql).toMatch(/SET is_baseline='0' WHERE project_id = \?/);
  });

  it("delete scopes by project_id", () => {
    const stmts = deleteStatements("s1", "p1");
    for (const s of stmts) expect(s.sql).toContain("project_id = ?");
  });
});
