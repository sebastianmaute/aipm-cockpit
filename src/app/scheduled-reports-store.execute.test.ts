// §772 — the scheduled_reports store against a REAL engine (node:sqlite). runTursoPipeline is replaced by a
// runner that executes the statements it is given, so the SQL the store sends is what is tested.
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineResultLike, SqlStmt } from "./turso-schema";
import { TABLE_NAMES } from "./turso-schema";

let db: DatabaseSync;
const sent: SqlStmt[][] = [];

vi.mock("./turso-pipeline", () => ({
  runTursoPipeline: async (_c: unknown, stmts: SqlStmt[]): Promise<PipelineResultLike[]> => {
    sent.push(stmts);
    return stmts.map((s) => {
      const args = (s.args ?? []).map((a) => a.value ?? null);
      const stmt = db.prepare(s.sql);
      if (/^\s*(SELECT|INSERT[\s\S]*RETURNING)/i.test(s.sql)) {
        const rows = stmt.all(...args) as Record<string, unknown>[];
        const cols = rows[0] ? Object.keys(rows[0]).map((name) => ({ name })) : (stmt.columns?.() ?? []).map((c) => ({ name: c.name }));
        return { type: "ok", response: { type: "execute", result: { cols, rows: rows.map((r) => Object.values(r).map((v) => ({ value: v }))) } } };
      }
      stmt.run(...args);
      return { type: "ok", response: { type: "execute", result: { cols: [], rows: [] } } };
    });
  },
}));

import {
  REPORT_RETENTION_PER_JOB, RUNNING_STALE_MS,
  hasReport, claimReport, releaseClaim, finishReport, listReports, isInterrupted,
  type ReportData, type ScheduledReport,
} from "./scheduled-reports-store";
import { SCHEDULED_REPORTS_DDL } from "./scheduled-reports-schema";
import { PROJECT_SCOPED_SIDE_TABLES, projectSideTableSweepStatements } from "./project-side-tables";

const CONFIG = { httpUrl: "https://x", authToken: "t" } as never;
const data = (summary = "s"): ReportData => ({ jobName: "J", projectName: "P", summary, actions: [] });
const row = (id: string, jobKey: string, slot: string, projectId = "p1") =>
  ({ id, projectId, jobKey, slot, ranAt: "2026-10-23T00:00:00.000Z", claimedBy: "dev", data: data() });
const count = (where = "1=1"): number =>
  Number((db.prepare(`SELECT COUNT(*) AS n FROM scheduled_reports WHERE ${where}`).get() as { n: number | bigint }).n);

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  sent.length = 0;
});

describe("scheduled_reports store (§772)", () => {
  it("claimReport is true once and false for the same (jobKey, slot); one row remains", async () => {
    expect(await hasReport(CONFIG, "k", "s1")).toBe(false);
    expect(await claimReport(CONFIG, row("a", "k", "s1"))).toBe(true);
    expect(await claimReport(CONFIG, row("b", "k", "s1"))).toBe(false);
    expect(await hasReport(CONFIG, "k", "s1")).toBe(true);
    expect(count()).toBe(1);
    expect((db.prepare("SELECT status FROM scheduled_reports").get() as { status: string }).status).toBe("running");
  });

  it("claimReport sends its DDL in its own preceding call, never inside a transaction", async () => {
    await claimReport(CONFIG, row("a", "k", "s1"));
    expect(sent[0].map((s) => s.sql)).toEqual(SCHEDULED_REPORTS_DDL);
    expect(sent[1]).toHaveLength(1);
  });

  it("finishReport sets status, ok and data, and keeps the newest 50 per job only", async () => {
    for (let i = 0; i < 52; i++) {
      const slot = `2026-01-${String(i + 1).padStart(2, "0")}`;
      await claimReport(CONFIG, row(`id${i}`, "k", slot));
      await finishReport(CONFIG, `id${i}`, "k", i % 2 === 0, data(`done${i}`));
    }
    await claimReport(CONFIG, row("o1", "other", "2025-01-01"));
    await finishReport(CONFIG, "o1", "other", true, data());
    expect(REPORT_RETENTION_PER_JOB).toBe(50);
    expect(count("job_key = 'k'")).toBe(REPORT_RETENTION_PER_JOB);
    expect(count("job_key = 'k' AND (id = 'id0' OR id = 'id1')")).toBe(0);
    expect(count("job_key = 'other'")).toBe(1);
    const r = db.prepare("SELECT status, ok, data FROM scheduled_reports WHERE id = 'id51'").get() as { status: string; ok: number; data: string };
    expect(r.status).toBe("done");
    expect(Number(r.ok)).toBe(0);
    expect(JSON.parse(r.data).summary).toBe("done51");
  });

  it("finishReport goes out as one BEGIN…COMMIT list", async () => {
    await claimReport(CONFIG, row("a", "k", "s1"));
    sent.length = 0;
    await finishReport(CONFIG, "a", "k", true, data());
    const tx = sent[sent.length - 1].map((s) => s.sql.trim().split(/\s+/)[0].toUpperCase());
    expect(tx).toEqual(["BEGIN", "UPDATE", "DELETE", "COMMIT"]);
  });

  it("finishReport never overwrites a row that is already done", async () => {
    await claimReport(CONFIG, row("a", "k", "s1"));
    await finishReport(CONFIG, "a", "k", true, data("good"));
    await finishReport(CONFIG, "a", "k", false, data("late failure"));
    const r = db.prepare("SELECT ok, data FROM scheduled_reports WHERE id = 'a'").get() as { ok: number; data: string };
    expect(Number(r.ok)).toBe(1);
    expect(JSON.parse(r.data).summary).toBe("good");
  });

  it("releaseClaim deletes a running row and leaves a done row", async () => {
    await claimReport(CONFIG, row("a", "k", "s1"));
    await claimReport(CONFIG, row("b", "k", "s2"));
    await finishReport(CONFIG, "b", "k", true, data());
    await releaseClaim(CONFIG, "a");
    await releaseClaim(CONFIG, "b");
    expect((db.prepare("SELECT id FROM scheduled_reports").all() as { id: string }[]).map((r) => r.id)).toEqual(["b"]);
  });

  it("listReports orders by slot descending, decodes rows and skips unparseable data", async () => {
    await claimReport(CONFIG, row("a", "k", "2026-01-01"));
    await claimReport(CONFIG, row("b", "k", "2026-03-01"));
    await claimReport(CONFIG, row("c", "k", "2026-02-01"));
    await claimReport(CONFIG, row("d", "k", "2026-04-01"));
    db.prepare("UPDATE scheduled_reports SET data = '{' WHERE id = 'd'").run();
    const list = await listReports(CONFIG);
    expect(list.map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(list[0]).toMatchObject({ projectId: "p1", jobKey: "k", status: "running", ok: false, claimedBy: "dev" });
    expect(list[0].data.jobName).toBe("J");
  });

  it("isInterrupted is true for a running row older than 30 minutes only", () => {
    const base: ScheduledReport = { ...row("a", "k", "s"), status: "running", ok: false };
    const now = new Date("2026-10-23T12:00:00.000Z");
    const at = (min: number) => ({ ...base, ranAt: new Date(now.getTime() - min * 60_000).toISOString() });
    expect(RUNNING_STALE_MS).toBe(30 * 60_000);
    expect(isInterrupted(at(31), now)).toBe(true);
    expect(isInterrupted(at(29), now)).toBe(false);
    expect(isInterrupted({ ...at(31), status: "done" }, now)).toBe(false);
  });
});

describe("scheduled_reports registration (§772)", () => {
  it("is a project-scoped side table, outside TABLE_NAMES, and the sweep deletes p1 only", async () => {
    expect(PROJECT_SCOPED_SIDE_TABLES.map((e) => e.table)).toContain("scheduled_reports");
    expect(TABLE_NAMES).not.toContain("scheduled_reports");
    await claimReport(CONFIG, row("a", "k", "s1", "p1"));
    await claimReport(CONFIG, row("b", "k2", "s1", "p2"));
    for (const s of projectSideTableSweepStatements("p1")) {
      const sqlText = s.sql;
      if (/scheduled_reports/.test(sqlText)) db.prepare(sqlText).run(...(s.args ?? []).map((a) => a.value ?? null));
    }
    expect((db.prepare("SELECT id FROM scheduled_reports").all() as { id: string }[]).map((r) => r.id)).toEqual(["b"]);
  });
});
