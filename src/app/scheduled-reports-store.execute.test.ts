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
  REPORT_LIST_LIMIT, __resetScheduledReportsSchemaCache, listReportProjects, slotStatus, hasReportAtOrAfter, claimReport, releaseClaim, finishReport, listReports, isInterrupted, sanitizeReportData,
  type ReportData, type ScheduledReport,
} from "./scheduled-reports-store";
import { SCHEDULED_REPORTS_DDL } from "./scheduled-reports-schema";
import { PROJECT_SCOPED_SIDE_TABLES, projectSideTableSweepStatements } from "./project-side-tables";

const CONFIG = { httpUrl: "https://x", authToken: "t" } as never;
const data = (summary = "s"): ReportData => ({ jobName: "J", projectName: "P", summary, actions: [] });
const NO_PERIOD_LIMIT = "~"; // sorts after every slot text, so the NOT EXISTS never finds a row
const row = (id: string, jobKey: string, slot: string, projectId = "p1") =>
  // `periodStart` far in the future = "no period limit" for the tests that are about something else.
  ({ id, projectId, jobKey, slot, periodStart: NO_PERIOD_LIMIT, claimedBy: "dev", data: data() });
const count = (where = "1=1"): number =>
  Number((db.prepare(`SELECT COUNT(*) AS n FROM scheduled_reports WHERE ${where}`).get() as { n: number | bigint }).n);

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  sent.length = 0;
  __resetScheduledReportsSchemaCache();
});

describe("scheduled_reports store (§772)", () => {
  it("claimReport is true once and false for the same (jobKey, slot); one row remains", async () => {
    expect(await hasReportAtOrAfter(CONFIG, "k", "s1")).toBe(false);
    expect(await claimReport(CONFIG, row("a", "k", "s1"))).toBe(true);
    expect(await claimReport(CONFIG, row("b", "k", "s1"))).toBe(false);
    expect(await hasReportAtOrAfter(CONFIG, "k", "s1")).toBe(true);
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

  it("listReports sanitises a row written by another app version: missing actions, bad severity, unknown error and entity", async () => {
    await claimReport(CONFIG, row("a", "k", "2026-01-01"));
    await claimReport(CONFIG, row("b", "k", "2026-02-01"));
    await claimReport(CONFIG, row("c", "k", "2026-03-01"));
    db.prepare("UPDATE scheduled_reports SET data = ? WHERE id = 'a'").run('{"jobName":"J"}');
    db.prepare("UPDATE scheduled_reports SET data = ? WHERE id = 'b'").run(JSON.stringify({
      jobName: "J", projectName: "P", summary: "s", error: "weird",
      actions: [{ title: "t", why: "w", severity: "urgent", entity: { view: "nowhere", id: "1" } }, "junk", { title: "ok", why: "w", severity: "now", entity: { view: "raid", id: "7" } }],
    }));
    db.prepare("UPDATE scheduled_reports SET data = '[1]' WHERE id = 'c'").run();
    const list = await listReports(CONFIG);
    expect(list.map((r) => r.id)).toEqual(["b", "a"]);
    expect(list[1].data).toEqual({ jobName: "J", projectName: "", summary: "", actions: [] });
    expect(list[0].data.error).toBe("error");
    expect(list[0].data.actions).toEqual([
      { title: "t", why: "w", severity: "monitor" },
      { title: "ok", why: "w", severity: "now", entity: { view: "raid", id: "7" } },
    ]);
  });

  it("listReports keeps a gateway-failure token, so the run names the gateway's error", async () => {
    await claimReport(CONFIG, row("a", "k", "2026-01-01"));
    db.prepare("UPDATE scheduled_reports SET data = ? WHERE id = 'a'").run(JSON.stringify({
      jobName: "J", projectName: "P", summary: "", error: "ai-gateway-error", actions: [],
    }));
    const list = await listReports(CONFIG);
    expect(list[0].data.error).toBe("ai-gateway-error");
  });

  it("isInterrupted is true for a running row older than 30 minutes only", () => {
    const base: ScheduledReport = { ...row("a", "k", "s"), ranAt: "2026-10-23T00:00:00.000Z", status: "running", ok: false };
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

describe("hasReportAtOrAfter (§772 Slots: a slot is due only if it is not older than the job's last report)", () => {
  // KILLED BY: `slot >= ?` back to `slot = ?` (an edited, earlier time would be due again).
  it("is true for the exact slot and for any later report of the same job, false for an earlier-only history", async () => {
    await claimReport(CONFIG, row("a", "k", "2026-10-23T07:00:00.000Z"));
    expect(await hasReportAtOrAfter(CONFIG, "k", "2026-10-23T07:00:00.000Z")).toBe(true);
    expect(await hasReportAtOrAfter(CONFIG, "k", "2026-10-23T06:00:00.000Z")).toBe(true);
    expect(await hasReportAtOrAfter(CONFIG, "k", "2026-10-23T08:00:00.000Z")).toBe(false);
  });

  it("looks only at the job's own key", async () => {
    await claimReport(CONFIG, row("a", "other", "2026-10-23T07:00:00.000Z"));
    expect(await hasReportAtOrAfter(CONFIG, "k", "2026-10-23T06:00:00.000Z")).toBe(false);
  });
});

describe("sanitizeReportData drops a malformed action row (§772 final review)", () => {
  it("keeps an action with a title or a why, and drops one with neither", () => {
    const d = sanitizeReportData({
      summary: "s",
      actions: [{ severity: "now" }, { title: "", why: "" }, { title: "only title" }, { why: "only why", severity: "soon" }],
    });
    expect(d?.actions.map((a) => [a.title, a.why])).toEqual([["only title", ""], ["", "only why"]]);
  });
});

describe("the table is created once, and ran_at is the database's clock (§772 review wave 2)", () => {
  const ddlSends = () => sent.filter((s) => s.some((x) => /CREATE TABLE/i.test(x.sql))).length;

  // KILLED BY: sending the DDL on every call again.
  it("sends the DDL once per database, not on every call", async () => {
    await hasReportAtOrAfter(CONFIG, "k", "s");
    await hasReportAtOrAfter(CONFIG, "k", "s");
    await claimReport(CONFIG, row("a", "k", "s1"));
    await listReports(CONFIG);
    await releaseClaim(CONFIG, "a");
    expect(ddlSends()).toBe(1);
  });

  it("keeps the schema per database", async () => {
    await hasReportAtOrAfter(CONFIG, "k", "s");
    await hasReportAtOrAfter({ httpUrl: "https://other", authToken: "t" } as never, "k", "s");
    expect(ddlSends()).toBe(2);
  });

  // KILLED BY: not forgetting the schema when a call fails.
  it("sends the DDL again after a failed call (the database may have lost the table)", async () => {
    await hasReportAtOrAfter(CONFIG, "k", "s");
    db.exec("DROP TABLE scheduled_reports");
    await expect(hasReportAtOrAfter(CONFIG, "k", "s")).rejects.toThrow();
    await expect(hasReportAtOrAfter(CONFIG, "k", "s")).resolves.toBe(false);
    expect(ddlSends()).toBe(2);
  });

  // KILLED BY: binding the claimant's clock again.
  it("stores ran_at from the database's clock, as uniform ISO text", async () => {
    const before = Date.now();
    await claimReport(CONFIG, row("a", "k", "s1"));
    const ranAt = (db.prepare("SELECT ran_at FROM scheduled_reports").get() as { ran_at: string }).ran_at;
    expect(ranAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Math.abs(Date.parse(ranAt) - before)).toBeLessThan(60_000);
  });

  it("listReports carries the database's clock on every row", async () => {
    await claimReport(CONFIG, row("a", "k", "s1"));
    const [r] = await listReports(CONFIG);
    expect(Math.abs(Date.parse(r.serverNow!) - Date.now())).toBeLessThan(60_000);
  });

  // KILLED BY: comparing against the viewer's clock when the row carries the database's.
  it("isInterrupted compares the row with the database's clock, not the viewer's", () => {
    const base: ScheduledReport = {
      ...row("a", "k", "s"), status: "running", ok: false,
      ranAt: "2026-10-23T12:00:00.000Z", serverNow: "2026-10-23T12:10:00.000Z",
    };
    const farFuture = new Date("2030-01-01T00:00:00.000Z"); // a viewer clock that is hours ahead
    expect(isInterrupted(base, farFuture)).toBe(false);
    expect(isInterrupted({ ...base, serverNow: "2026-10-23T12:31:00.000Z" }, new Date("2026-10-23T12:00:00.000Z"))).toBe(true);
  });
});

describe("listReports bound and partial flag (§772 cr2)", () => {
  // KILLED BY: removing the LIMIT from the list query.
  it("reads at most REPORT_LIST_LIMIT rows, newest slot first", async () => {
    for (let i = 0; i < REPORT_LIST_LIMIT + 5; i++) {
      await claimReport(CONFIG, row(`id${i}`, `job${i}`, `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.${String(i).padStart(3, "0")}Z`));
    }
    const list = await listReports(CONFIG);
    expect(list).toHaveLength(REPORT_LIST_LIMIT);
    const slots = list.map((r) => r.slot);
    expect([...slots].sort().reverse()).toEqual(slots);
  });

  // KILLED BY: dropping partial in sanitizeReportData.
  it("keeps partial only when it is exactly true", () => {
    expect(sanitizeReportData({ summary: "s", actions: [], partial: true })?.partial).toBe(true);
    expect(sanitizeReportData({ summary: "s", actions: [], partial: "yes" })?.partial).toBeUndefined();
    expect(sanitizeReportData({ summary: "s", actions: [] })?.partial).toBeUndefined();
  });
});

describe("slotStatus: what the pre-check may remember (§772 cr3 re-review)", () => {
  const S1 = "2026-10-23T07:00:00.000Z";
  const S2 = "2026-10-24T07:00:00.000Z";
  const setStatus = (id: string, status: string, ok = 1) =>
    db.prepare("UPDATE scheduled_reports SET status = ?, ok = ? WHERE id = ?").run(status, ok, id);
  const ageClaim = (id: string, minutes: number) =>
    db.prepare("UPDATE scheduled_reports SET ran_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?) WHERE id = ?").run(`-${minutes} minutes`, id);

  it("is none with nothing at or after the slot (and for another job's rows)", async () => {
    expect(await slotStatus(CONFIG, "k", S1)).toBe("none");
    await claimReport(CONFIG, row("o", "other", S1));
    expect(await slotStatus(CONFIG, "k", S1)).toBe("none");
  });

  // KILLED BY: treating any row as final (a live claim by another device may still be released).
  it("is in-flight for a live running claim", async () => {
    await claimReport(CONFIG, row("a", "k", S1));
    expect(await slotStatus(CONFIG, "k", S1)).toBe("in-flight");
  });

  // KILLED BY: dropping the done check.
  it.each([["a finished report", 1], ["a failed report", 0]])("is final for %s", async (_n, ok) => {
    await claimReport(CONFIG, row("a", "k", S1));
    setStatus("a", "done", ok);
    expect(await slotStatus(CONFIG, "k", S1)).toBe("final");
  });

  // KILLED BY: dropping the stale check (a claim whose device vanished would block the slot for ever).
  it("is final for a running claim older than 30 minutes, on the database's clock, and in-flight at 29", async () => {
    await claimReport(CONFIG, row("a", "k", S1));
    ageClaim("a", 29);
    expect(await slotStatus(CONFIG, "k", S1)).toBe("in-flight");
    ageClaim("a", 31);
    expect(await slotStatus(CONFIG, "k", S1)).toBe("final");
  });

  // KILLED BY: treating a live row of a later slot as final (its claimant may still release it), or not scoping by the period.
  it("a live claim at a later slot of the period is in-flight, a finished one is final, and a row before the period is none", async () => {
    await claimReport(CONFIG, row("b", "k", S2));
    expect(await slotStatus(CONFIG, "k", S1)).toBe("in-flight");
    setStatus("b", "done");
    expect(await slotStatus(CONFIG, "k", S1)).toBe("final");
    expect(await slotStatus(CONFIG, "k", "2026-10-25T00:00:00.000Z")).toBe("none");
  });
});

describe("the project filter does not depend on the newest rows (§772 cr4)", () => {
  const named = (id: string, jobKey: string, slot: string, projectId: string, projectName: string): void => {
    db.prepare("INSERT INTO scheduled_reports (id, project_id, job_key, slot, status, ok, ran_at, claimed_by, data) VALUES (?, ?, ?, ?, 'done', 1, ?, 'dev', ?)")
      .run(id, projectId, jobKey, slot, slot, JSON.stringify({ jobName: "J", projectName, summary: "s", actions: [] }));
  };
  const fill = async (): Promise<void> => {
    await listReports(CONFIG); // creates the table
    named("old1", "jo", "2025-01-01T00:00:00.000Z", "old", "Old name");
    named("old2", "jo", "2025-01-02T00:00:00.000Z", "old", "Old project (newest name)");
    for (let i = 0; i < REPORT_LIST_LIMIT + 5; i++) named(`n${i}`, `jn${i}`, `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.${String(i).padStart(3, "0")}Z`, "new", "New project");
  };

  // KILLED BY: reading the project list from the (capped) list rows.
  it("lists every project that has reports, even one whose reports are all older than the newest 200 rows", async () => {
    await fill();
    const projects = await listReportProjects(CONFIG);
    expect(projects.map((p) => p.id)).toEqual(["new", "old"]); // newest project first
    expect(projects.find((p) => p.id === "old")?.name).toBe("Old project (newest name)"); // the newest report's name
    expect((await listReports(CONFIG)).some((r) => r.projectId === "old")).toBe(false); // the cap hides it from the list
  });

  // KILLED BY: ignoring the project argument.
  it("reads one project's rows from the database, reaching rows older than the cap", async () => {
    await fill();
    const rows = await listReports(CONFIG, "old");
    expect(rows.map((r) => r.id)).toEqual(["old2", "old1"]);
  });

  it("a project with no name is listed with an empty name", async () => {
    await listReports(CONFIG);
    db.prepare("INSERT INTO scheduled_reports (id, project_id, job_key, slot, status, ok, ran_at, claimed_by, data) VALUES ('z', 'pz', 'jz', '2026-01-01', 'done', 1, '2026-01-01', 'dev', '{}')").run();
    expect(await listReportProjects(CONFIG)).toEqual([{ id: "pz", name: "" }]);
  });
});

describe("the period limit is atomic in the claim (§772 cr4 re-review)", () => {
  const S1 = "2026-10-23T07:00:00.000Z";
  const S2 = "2026-10-23T08:00:00.000Z";
  const DAY = "2026-10-22T22:00:00.000Z"; // Berlin's local day began here
  const claim = (id: string, slot: string, periodStart: string, jobKey = "k") => claimReport(CONFIG, { ...row(id, jobKey, slot), periodStart });

  // KILLED BY: dropping the NOT EXISTS (the second slot of the day would win too).
  it("of two claims for different slots in one period, exactly one wins", async () => {
    expect(await claim("a", S1, DAY)).toBe(true);
    expect(await claim("b", S2, DAY)).toBe(false);
    expect(count()).toBe(1);
    expect(await claim("c", "2026-10-23T05:00:00.000Z", DAY)).toBe(false); // an EARLIER slot of the period loses as well
  });

  it("a slot of the next period wins, and so does another job's slot in the same period", async () => {
    await claim("a", S1, DAY);
    expect(await claim("n", "2026-10-24T07:00:00.000Z", "2026-10-23T22:00:00.000Z")).toBe(true);
    expect(await claim("o", S1, DAY, "other")).toBe(true);
  });

  it("the exact slot is still guarded by the unique index", async () => {
    expect(await claim("a", S1, "2026-10-23T00:00:00.000Z")).toBe(true);
    expect(await claim("b", S1, "2026-10-23T00:00:00.000Z")).toBe(false);
  });

  // KILLED BY: a statement that is not one (two tabs could both pass a separate check before either inserts).
  it("is one statement", async () => {
    await claim("a", S1, DAY);
    const claimSends = sent.filter((s) => s.some((x) => /INSERT INTO scheduled_reports/.test(x.sql)));
    expect(claimSends.every((s) => s.length === 1)).toBe(true);
    expect(claimSends[0][0].sql).toMatch(/WHERE NOT EXISTS[\s\S]*ON CONFLICT/);
  });

  it("a malformed row does not fail the project filter", async () => {
    await listReports(CONFIG);
    db.prepare("INSERT INTO scheduled_reports (id, project_id, job_key, slot, status, ok, ran_at, claimed_by, data) VALUES ('bad', 'pb', 'jb', '2026-02-01', 'done', 1, '2026-02-01', 'dev', '{not json')").run();
    db.prepare("INSERT INTO scheduled_reports (id, project_id, job_key, slot, status, ok, ran_at, claimed_by, data) VALUES ('ok', 'pg', 'jg', '2026-01-01', 'done', 1, '2026-01-01', 'dev', ?)").run(JSON.stringify({ projectName: "Good" }));
    const projects = await listReportProjects(CONFIG);
    expect(projects).toEqual([{ id: "pb", name: "" }, { id: "pg", name: "Good" }]);
  });
});
