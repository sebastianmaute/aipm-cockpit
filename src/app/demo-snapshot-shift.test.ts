import { describe, expect, it, vi, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bucketKey, type SnapshotRecord } from "./snapshot";
import { shiftDemoSnapshots, thinForCadence } from "./demo-snapshot-shift";
import { appendSnapshots, loadSnapshots } from "./snapshot-store";
import type { SqlStmt, PipelineResultLike } from "./turso-schema";
import type { TursoConfig } from "./turso-config";

const pipeline = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("./turso-pipeline", () => ({ runTursoPipeline: pipeline.run }));

const cfg: TursoConfig = { httpUrl: "https://db.example.com", authToken: "tok" };

function rec(capturedAt: string, over: Partial<SnapshotRecord> = {}): SnapshotRecord {
  return {
    id: capturedAt, capturedAt, bucket: bucketKey(new Date(capturedAt), "weekly"),
    cadence: "weekly", trigger: "auto", isBaseline: false,
    remainingHours: 100, remainingCost: 10000, pctComplete: 40,
    forecastEndDate: "2026-06-30", planEndDate: "2026-05-29", spi: 0.9, cpi: 1.0,
    overallRag: "A", scheduleRag: "A", budgetRag: "G", scopeRag: "",
    milestones: [{ id: 1, name: "Go-live", target: "2026-05-29", forecast: "2026-06-30" }],
    bucketProgress: [{ bucketId: 2, pctComplete: 50 }],
    series: [{ period: "2026-03", plannedHours: 10, actualHours: 8, plannedCost: 1000, actualCost: null }],
    ...over,
  };
}

describe("shiftDemoSnapshots", () => {
  it("moves every date, period and key by one month, and the capture into the week before today's", () => {
    // Today (Wed 2026-04-08) is in W15, so the capture moves 4 whole weeks into W14 and stays a Friday.
    const [out] = shiftDemoSnapshots([rec("2026-03-06T17:00:00.000Z")], 1, "month", "2026-04-08");
    expect(out.capturedAt).toBe("2026-04-03T17:00:00.000Z");
    expect(out.forecastEndDate).toBe("2026-07-31"); // a last-of-month date stays last-of-month
    expect(out.planEndDate).toBe("2026-06-29");
    expect(out.milestones[0].target).toBe("2026-06-29");
    expect(out.milestones[0].forecast).toBe("2026-07-31");
    expect(out.series[0].period).toBe("2026-04");
    expect(out.id).toBe(out.capturedAt);
    expect(out.bucket).toBe(bucketKey(new Date(out.capturedAt), "weekly"));
  });

  it("keeps consecutive weekly captures in consecutive weeks where a month shift would clamp them together", () => {
    // Jan 23 and Jan 30 shifted by a month would both clamp near Feb 28 and share one ISO week.
    const out = shiftDemoSnapshots(
      [rec("2026-01-23T17:00:00.000Z", { remainingHours: 1 }), rec("2026-01-30T17:00:00.000Z", { remainingHours: 2 })],
      1, "month", "2026-03-02",
    );
    expect(out.map((r) => r.capturedAt)).toEqual(["2026-02-20T17:00:00.000Z", "2026-02-27T17:00:00.000Z"]);
    expect(out.map((r) => r.remainingHours)).toEqual([1, 2]);
    expect(out.map((r) => r.bucket)).toEqual(["2026-W08", "2026-W09"]);
  });

  it("returns equal records when nothing moves", () => {
    const input = [rec("2026-03-06T17:00:00.000Z"), rec("2026-03-13T17:00:00.000Z")];
    expect(shiftDemoSnapshots(input, 0, "month", "2026-03-16")).toEqual(input);
  });

  it("does not mutate its input", () => {
    const input = [rec("2026-03-06T17:00:00.000Z")];
    const copy = structuredClone(input);
    shiftDemoSnapshots(input, 2, "month", "2026-05-20");
    expect(input).toEqual(copy);
  });
});

describe("thinForCadence", () => {
  const weekly = ["2026-03-06", "2026-03-13", "2026-03-27", "2026-04-03", "2026-04-24"]
    .map((d, i) => rec(`${d}T17:00:00.000Z`, { isBaseline: i === 0 }));

  it("leaves weekly and daily untouched", () => {
    expect(thinForCadence(weekly, "weekly")).toEqual(weekly);
    expect(thinForCadence(weekly, "daily")).toEqual(weekly);
  });

  it("keeps the last record of each calendar month and re-baselines the first kept", () => {
    const out = thinForCadence(weekly, "monthly");
    expect(out.map((r) => r.capturedAt)).toEqual(["2026-03-27T17:00:00.000Z", "2026-04-24T17:00:00.000Z"]);
    expect(out.map((r) => r.isBaseline)).toEqual([true, false]);
    expect(out.map((r) => r.cadence)).toEqual(["monthly", "monthly"]);
    expect(out.map((r) => r.bucket)).toEqual(["2026-03", "2026-04"]);
  });

  it("returns [] for no records", () => {
    expect(thinForCadence([], "monthly")).toEqual([]);
  });
});

describe("the committed demo history", () => {
  const seeded = JSON.parse(readFileSync(join(process.cwd(), "sample-demo-snapshots.json"), "utf8")) as SnapshotRecord[];

  it("shifts by one month into unique buckets, id === capturedAt, one baseline", () => {
    const out = thinForCadence(shiftDemoSnapshots(seeded, 1, "month", "2026-10-14"), "weekly");
    expect(new Set(out.map((r) => r.bucket)).size).toBe(out.length);
    expect(out.every((r) => r.id === r.capturedAt)).toBe(true);
    expect(out.filter((r) => r.isBaseline)).toHaveLength(1);
  });

  it("returns the input unchanged when nothing moves", () => {
    expect(shiftDemoSnapshots(seeded, 0, "month", "2026-09-14")).toEqual(seeded);
  });

  // The Trends charts mark a gap for every missing weekly bucket. A month shift moved each Friday to
  // a different weekday, which emptied some weeks and doubled up others ("2 gaps" on a live demo).
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])("keeps every record in its own consecutive week when the contents move %i months", (n) => {
    const out = shiftDemoSnapshots(seeded, n, "month", new Date(Date.UTC(2026, 8 + n, 15)).toISOString().slice(0, 10));
    expect(out).toHaveLength(seeded.length);
    const weeks = out.map((r) => Date.parse(r.capturedAt) / (7 * 86_400_000));
    for (let i = 1; i < weeks.length; i += 1) expect(weeks[i] - weeks[i - 1]).toBeCloseTo(1, 6);
    expect(new Set(out.map((r) => new Date(r.capturedAt).getUTCDay()))).toEqual(
      new Set(seeded.map((r) => new Date(r.capturedAt).getUTCDay())),
    );
  });
});

describe("appendSnapshots", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    pipeline.run.mockReset();
    pipeline.run.mockImplementation(async (_c: unknown, stmts: readonly SqlStmt[]) => runAgainst(db, stmts));
  });

  const many = Array.from({ length: 27 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 2, 6 + 7 * i, 17));
    return rec(d.toISOString(), { isBaseline: i === 0 });
  });

  it("writes 27 records in one batch behind one PRAGMA head", async () => {
    await appendSnapshots(cfg, many, "p1");
    expect(pipeline.run).toHaveBeenCalledTimes(2);
    const batch = pipeline.run.mock.calls[1][1] as SqlStmt[];
    expect(batch[0].sql).toBe("BEGIN");
    expect(batch[batch.length - 1].sql).toBe("COMMIT");
    expect(batch.filter((s) => s.sql === "BEGIN" || s.sql === "COMMIT")).toHaveLength(2);
  });

  it("reloads 27 rows with exactly one baseline", async () => {
    await appendSnapshots(cfg, many, "p1");
    const loaded = await loadSnapshots(cfg, "p1");
    expect(loaded).toHaveLength(27);
    expect(loaded.filter((r) => r.isBaseline)).toHaveLength(1);
    expect(loaded[0].series[0].period).toBe("2026-03");
  });

  it("makes no call for an empty list", async () => {
    await appendSnapshots(cfg, [], "p1");
    expect(pipeline.run).not.toHaveBeenCalled();
  });

  it("puts the column ALTERs once, at the front of the batch", async () => {
    db.exec("CREATE TABLE snapshot (id TEXT, captured_at TEXT, bucket TEXT, cadence TEXT, trigger TEXT, is_baseline TEXT, remaining_hours TEXT, remaining_cost TEXT, pct_complete TEXT, forecast_end_date TEXT, plan_end_date TEXT, spi TEXT, cpi TEXT, overall_rag TEXT, schedule_rag TEXT, budget_rag TEXT, scope_rag TEXT, currency TEXT, milestones_json TEXT, project_id TEXT)");
    await appendSnapshots(cfg, many.slice(0, 3), "p1");
    const batch = pipeline.run.mock.calls[1][1] as SqlStmt[];
    expect(batch.filter((s) => s.sql.startsWith("ALTER TABLE"))).toHaveLength(1);
    expect(batch[1].sql.startsWith("ALTER TABLE")).toBe(true);
    expect(await loadSnapshots(cfg, "p1")).toHaveLength(3);
  });
});

/** Runs a statement list against a real SQLite, answering in the wire shape the store decodes. */
function runAgainst(db: DatabaseSync, stmts: readonly SqlStmt[]): PipelineResultLike[] {
  return stmts.map((s) => {
    const bind = (s.args ?? []).map((a) => (a.type === "null" || a.value === undefined ? null : a.value));
    if (/^\s*(SELECT|PRAGMA)/i.test(s.sql)) {
      const rows = db.prepare(s.sql).all(...bind) as Record<string, unknown>[];
      const cols = rows.length ? Object.keys(rows[0]).map((name) => ({ name })) : [];
      return { type: "ok", response: { type: "execute", result: { cols, rows: rows.map((r) => cols.map((c) => ({ value: r[c.name] }))) } } };
    }
    if (bind.length === 0) db.exec(s.sql); else db.prepare(s.sql).run(...bind);
    return { type: "ok" };
  }) as PipelineResultLike[];
}

