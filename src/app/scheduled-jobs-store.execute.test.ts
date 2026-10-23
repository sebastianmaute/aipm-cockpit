// §772 — the Turso path of the scheduled-jobs store against a REAL engine (node:sqlite). runTursoPipeline is
// replaced by a runner that executes the statements it is given, so the SQL the store sends is what is tested:
// the one-time migration from `scheduled_jobs` into `scheduled_jobs_v2`, its idempotence, and that nothing new
// is ever written to the table an old client still reads.
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineResultLike, SqlStmt } from "./turso-schema";

let db: DatabaseSync;
const sent: SqlStmt[][] = [];

vi.mock("./turso-pipeline", () => ({
  runTursoPipeline: async (_c: unknown, stmts: SqlStmt[]): Promise<PipelineResultLike[]> => {
    sent.push(stmts);
    return stmts.map((s) => {
      const args = (s.args ?? []).map((a) => a.value ?? null);
      const stmt = db.prepare(s.sql);
      if (/^\s*SELECT/i.test(s.sql)) {
        const rows = stmt.all(...args) as Record<string, unknown>[];
        const cols = (stmt.columns?.() ?? []).map((c) => ({ name: c.name }));
        return { type: "ok", response: { type: "execute", result: { cols, rows: rows.map((r) => cols.map((c) => ({ value: r[c.name] }))) } } };
      }
      stmt.run(...args);
      return { type: "ok", response: { type: "execute", result: { cols: [], rows: [] } } };
    });
  },
}));

import {
  MIGRATED_MARKER_ID, SCHEDULED_JOBS_DDL, __resetScheduledJobsStoreCache,
  loadScheduledJobs, saveScheduledJobs,
} from "./scheduled-jobs-store";
import type { ScheduledJob } from "./scheduled-jobs/types";

const CONFIG = { httpUrl: "https://jobs.example", authToken: "t" } as never;

/** A pre-§772 row has no project, key, zone or instruction; a §772-written one (an updated device, before this
 *  change) has them all in the same table. */
const legacyRow = (id: number, extra: Record<string, unknown> = {}) => JSON.stringify({
  id, name: `Job ${id}`, type: "portfolioAnalysis", cadence: { kind: "daily", timeOfDay: "09:00" },
  enabled: true, lastRunAt: null, history: [], ...extra,
});
const job = (id: number, over: Partial<ScheduledJob> = {}): ScheduledJob => ({
  id, name: `New ${id}`, type: "portfolioAnalysis", cadence: { kind: "daily", timeOfDay: "09:00" },
  enabled: true, projectId: "p1", timeZone: "UTC", key: `key-${id}`, lastRunAt: null, history: [], ...over,
});

const seedLegacy = (...rows: [string, string][]): void => {
  for (const sql of SCHEDULED_JOBS_DDL) db.exec(sql);
  for (const [id, data] of rows) db.prepare("INSERT INTO scheduled_jobs (id, data) VALUES (?, ?)").run(id, data);
};
const v2Ids = (): string[] => (db.prepare("SELECT id FROM scheduled_jobs_v2 ORDER BY id").all() as { id: string }[]).map((r) => r.id);
const legacy = (): { id: string; data: Record<string, unknown> }[] =>
  (db.prepare("SELECT id, data FROM scheduled_jobs ORDER BY id").all() as { id: string; data: string }[]).map((r) => ({ id: r.id, data: JSON.parse(r.data) }));

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  sent.length = 0;
  __resetScheduledJobsStoreCache();
});

describe("scheduled jobs: migration from scheduled_jobs to scheduled_jobs_v2 (§772)", () => {
  it("copies every field of every legacy job and loads them from v2", async () => {
    seedLegacy(
      ["1", legacyRow(1)],
      ["2", legacyRow(2, { projectId: "p9", key: "k-2", timeZone: "Europe/Berlin", instruction: "watch risks", lastRunAt: "2026-10-22T08:00:00.000Z" })],
    );
    const jobs = await loadScheduledJobs(CONFIG);
    expect(jobs.map((j) => j.id)).toEqual([1, 2]);
    expect(jobs[0]).toMatchObject({ projectId: null, key: null, enabled: true }); // a legacy job keeps no project: it does not run
    expect(jobs[1]).toMatchObject({ projectId: "p9", key: "k-2", timeZone: "Europe/Berlin", instruction: "watch risks", enabled: true });
    expect(v2Ids()).toEqual(["1", "2", MIGRATED_MARKER_ID]);
  });

  // KILLED BY: dropping the UPDATE of the legacy rows (a pre-§772 runner would go on running them).
  it("switches the legacy rows off, keeping every other field", async () => {
    seedLegacy(["1", legacyRow(1, { instruction: "keep me", projectId: "p1" })]);
    await loadScheduledJobs(CONFIG);
    const [row] = legacy();
    expect(row.data.enabled).toBe(false);
    expect(row.data).toMatchObject({ name: "Job 1", instruction: "keep me", projectId: "p1" });
  });

  // KILLED BY: moving the marker check out of the copy (a second migration would copy again).
  it("is idempotent: a second session neither copies nor changes anything", async () => {
    seedLegacy(["1", legacyRow(1)]);
    await loadScheduledJobs(CONFIG);
    db.prepare("UPDATE scheduled_jobs SET data = ? WHERE id = '1'").run(legacyRow(1, { enabled: true, name: "an old client re-enabled it" }));
    db.prepare("INSERT INTO scheduled_jobs (id, data) VALUES ('7', ?)").run(legacyRow(7));
    __resetScheduledJobsStoreCache(); // a new session
    const jobs = await loadScheduledJobs(CONFIG);
    expect(jobs.map((j) => j.id)).toEqual([1]); // job 7 (made by an old client afterwards) is not imported
    expect(legacy().find((r) => r.id === "1")?.data.enabled).toBe(true); // and the legacy table is not touched again
  });

  // KILLED BY: not reading the marker first (every session would take the write lock for a no-op migration).
  it("a later session sends no migration at all once the marker exists", async () => {
    seedLegacy(["1", legacyRow(1)]);
    await loadScheduledJobs(CONFIG);
    __resetScheduledJobsStoreCache();
    sent.length = 0;
    await loadScheduledJobs(CONFIG);
    expect(sent.some((stmts) => stmts.some((s) => s.sql === "BEGIN"))).toBe(false);
  });

  it("does not resurrect a job the user deleted once the marker exists", async () => {
    seedLegacy(["1", legacyRow(1)]);
    await loadScheduledJobs(CONFIG);
    await saveScheduledJobs(CONFIG, []);
    __resetScheduledJobsStoreCache();
    expect(await loadScheduledJobs(CONFIG)).toEqual([]);
  });

  // KILLED BY: running the migration outside one transaction guarded by the marker.
  it("two tabs migrating at once leave one copy of each job and the legacy rows off", async () => {
    seedLegacy(["1", legacyRow(1)], ["2", legacyRow(2)]);
    const [a, b] = await Promise.all([loadScheduledJobs(CONFIG), loadScheduledJobs(CONFIG)]);
    expect(a.map((j) => j.id)).toEqual([1, 2]);
    expect(b.map((j) => j.id)).toEqual([1, 2]);
    expect(v2Ids()).toEqual(["1", "2", MIGRATED_MARKER_ID]);
    expect(legacy().every((r) => r.data.enabled === false)).toBe(true);
  });

  it("migrates an empty or missing legacy table to just the marker", async () => {
    expect(await loadScheduledJobs(CONFIG)).toEqual([]);
    expect(v2Ids()).toEqual([MIGRATED_MARKER_ID]);
  });

  it("copes with a legacy row whose data is not JSON", async () => {
    seedLegacy(["1", "{not-json"], ["2", legacyRow(2)]);
    const jobs = await loadScheduledJobs(CONFIG);
    expect(jobs.map((j) => j.id)).toEqual([2]);
    const two = db.prepare("SELECT data FROM scheduled_jobs WHERE id = '2'").get() as { data: string };
    expect(JSON.parse(two.data).enabled).toBe(false);
  });

  it("sends the migration as one BEGIN…COMMIT list, after the DDL in its own call", async () => {
    seedLegacy(["1", legacyRow(1)]);
    sent.length = 0;
    await loadScheduledJobs(CONFIG);
    const tx = sent.find((s) => s[0]?.sql === "BEGIN");
    expect(tx?.[tx.length - 1].sql).toBe("COMMIT");
    expect(sent[0].map((s) => s.sql).slice(0, SCHEDULED_JOBS_DDL.length)).toEqual(SCHEDULED_JOBS_DDL);
  });
});

describe("scheduled jobs: writes go to v2 only (§772)", () => {
  // KILLED BY: pointing the save back at scheduled_jobs.
  it("a save never touches the legacy table, whatever it carries", async () => {
    seedLegacy(["1", legacyRow(1)]);
    await loadScheduledJobs(CONFIG);
    const before = JSON.stringify(legacy());
    sent.length = 0;
    await saveScheduledJobs(CONFIG, [job(1), job(2, { instruction: "x" })]);
    expect(JSON.stringify(legacy())).toBe(before);
    for (const stmts of sent) for (const s of stmts) expect(s.sql).not.toMatch(/scheduled_jobs(?!_v2)/);
    const loaded = await loadScheduledJobs(CONFIG);
    expect(loaded.map((j) => [j.id, j.key, j.projectId])).toEqual([[1, "key-1", "p1"], [2, "key-2", "p1"]]);
  });

  it("a save is one transaction and keeps the marker, with the id as a string", async () => {
    await loadScheduledJobs(CONFIG);
    sent.length = 0;
    await saveScheduledJobs(CONFIG, [job(3)]);
    const stmts = sent[sent.length - 1];
    expect(stmts[0].sql).toBe("BEGIN");
    expect(stmts[stmts.length - 1].sql).toBe("COMMIT");
    expect(v2Ids()).toEqual(["3", MIGRATED_MARKER_ID]);
  });

  it("an old client that overwrites the legacy table cannot change what a new client loads", async () => {
    seedLegacy(["1", legacyRow(1)]);
    await saveScheduledJobs(CONFIG, [job(1, { instruction: "mine" })]);
    // The old client strips the new fields and re-inserts.
    db.exec("DELETE FROM scheduled_jobs");
    db.prepare("INSERT INTO scheduled_jobs (id, data) VALUES ('1', ?)").run(legacyRow(1));
    __resetScheduledJobsStoreCache();
    const [loaded] = await loadScheduledJobs(CONFIG);
    expect(loaded).toMatchObject({ key: "key-1", projectId: "p1", instruction: "mine" });
  });
});
