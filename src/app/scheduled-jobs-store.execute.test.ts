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
import { appendRun } from "./scheduled-jobs/schedule";
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

describe("scheduled jobs: a newer version's data survives this version's writes (§772 cr3)", () => {
  const stored = (id: string): Record<string, unknown> =>
    JSON.parse((db.prepare("SELECT data FROM scheduled_jobs_v2 WHERE id = ?").get(id) as { data: string }).data);

  // KILLED BY: rebuilding a job from the known fields only (an unknown field would be stripped on every save).
  it("keeps a field it does not know through a recordRun", async () => {
    await loadScheduledJobs(CONFIG); // migrates (nothing to copy) and writes the marker
    const future = { ...job(1), futureField: { nested: [1, 2, 3] }, another: "x" };
    db.prepare("INSERT INTO scheduled_jobs_v2 (id, data) VALUES ('1', ?)").run(JSON.stringify(future));
    const [loaded] = await loadScheduledJobs(CONFIG);
    expect(loaded.extra).toEqual({ futureField: { nested: [1, 2, 3] }, another: "x" });
    await saveScheduledJobs(CONFIG, [appendRun(loaded, { ranAt: "2026-10-23T09:00:00.000Z", summary: "s", actionCount: 0, ok: true })]);
    expect(stored("1")).toMatchObject({ futureField: { nested: [1, 2, 3] }, another: "x", lastRunAt: "2026-10-23T09:00:00.000Z" });
  });

  // KILLED BY: dropping a job whose type or cadence is unknown (its row would be deleted by the next save).
  it.each([
    ["a type", { type: "future" }],
    ["a cadence kind", { cadence: { kind: "monthly", dayOfMonth: 3, timeOfDay: "09:00" } }],
  ])("keeps a job with %s it does not know, verbatim, through a save of another job", async (_n, override) => {
    await loadScheduledJobs(CONFIG);
    const foreign = { ...job(2), ...override, extraThing: true };
    db.prepare("INSERT INTO scheduled_jobs_v2 (id, data) VALUES ('1', ?)").run(JSON.stringify(job(1)));
    db.prepare("INSERT INTO scheduled_jobs_v2 (id, data) VALUES ('2', ?)").run(JSON.stringify(foreign));
    const loaded = await loadScheduledJobs(CONFIG);
    expect(loaded.map((j) => [j.id, j.foreign !== undefined])).toEqual([[1, false], [2, true]]);
    await saveScheduledJobs(CONFIG, loaded.map((j) => (j.id === 1 ? { ...j, name: "renamed" } : j)));
    expect(stored("2")).toEqual(foreign);
    expect(stored("1").name).toBe("renamed");
  });

  it("a foreign job can be deleted by dropping it from the list", async () => {
    await loadScheduledJobs(CONFIG);
    db.prepare("INSERT INTO scheduled_jobs_v2 (id, data) VALUES ('2', ?)").run(JSON.stringify({ ...job(2), type: "future" }));
    const loaded = await loadScheduledJobs(CONFIG);
    await saveScheduledJobs(CONFIG, loaded.filter((j) => j.id !== 2));
    expect(v2Ids()).toEqual([MIGRATED_MARKER_ID]);
  });
});

describe("scheduled jobs: a job with a non-numeric id survives (§772 cr3 re-review)", () => {
  // KILLED BY: dropping a job whose id is not a number (the next save would delete its row).
  it("is kept verbatim under its own row id through a save of another job, and can be deleted", async () => {
    await loadScheduledJobs(CONFIG);
    const odd = { ...job(2), id: "job-abc", note: "from a newer version" };
    db.prepare("INSERT INTO scheduled_jobs_v2 (id, data) VALUES ('1', ?)").run(JSON.stringify(job(1)));
    db.prepare("INSERT INTO scheduled_jobs_v2 (id, data) VALUES ('job-abc', ?)").run(JSON.stringify(odd));
    const loaded = await loadScheduledJobs(CONFIG);
    const foreign = loaded.find((j) => j.foreign !== undefined);
    expect(foreign?.foreign?.rowId).toBe("job-abc");
    expect(foreign?.id).toBeLessThan(0);
    await saveScheduledJobs(CONFIG, loaded.map((j) => (j.id === 1 ? { ...j, name: "renamed" } : j)));
    const row = db.prepare("SELECT data FROM scheduled_jobs_v2 WHERE id = 'job-abc'").get() as { data: string };
    expect(JSON.parse(row.data)).toEqual(odd);
    // The placeholder id is stable across reads, so a delete by id reaches the same job.
    const again = await loadScheduledJobs(CONFIG);
    expect(again.find((j) => j.foreign !== undefined)?.id).toBe(foreign?.id);
    await saveScheduledJobs(CONFIG, again.filter((j) => j.id !== foreign?.id));
    expect(v2Ids()).toEqual(["1", MIGRATED_MARKER_ID]);
  });
});
