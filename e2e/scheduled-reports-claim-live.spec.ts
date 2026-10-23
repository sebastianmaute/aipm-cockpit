// e2e/scheduled-reports-claim-live.spec.ts
//
// §772 — (1) the jobs migration `scheduled_jobs` -> `scheduled_jobs_v2` (json_set, json_valid, the marker row, one
// BEGIN..COMMIT) through the real pipeline, and (2) the run claim against a REAL Turso database: two concurrent `claimReport` calls for the same
// (jobKey, slot) through the real pipeline must produce exactly one `true`. Unit tests run the SQL on
// node:sqlite, which cannot show how a remote libSQL server orders two simultaneous inserts.
//
// ★★★ Runs only via `npm run e2e:live-destructive` (the `live-turso-destructive` project) and skips
// without the throwaway pair (`live-turso-env.ts`). It creates `scheduled_reports` if missing and removes
// only its own rows. Credentials are never printed.
import { test, expect } from "@playwright/test";
import { runTursoPipeline } from "../src/app/turso-pipeline";
import { rowObjects, txt } from "../src/app/turso-schema";
import { claimReport, type ReportData } from "../src/app/scheduled-reports-store";
import {
  MIGRATED_MARKER_ID, SCHEDULED_JOBS_DDL, __resetScheduledJobsStoreCache, loadScheduledJobs, migrationStatements,
} from "../src/app/scheduled-jobs-store";
import {
  THROWAWAY, LIVE, SKIP_NO_THROWAWAY, DESTRUCTIVE_RUN, pipelineBase,
} from "./live-turso-env";

const CONFIG = { httpUrl: pipelineBase(THROWAWAY.url), authToken: THROWAWAY.token };
const DATA: ReportData = { jobName: "probe", projectName: "probe", summary: "", actions: [] };
const SUFFIX = `${process.pid}-${Date.now()}`;
const JOB_KEY = `claim-probe-${SUFFIX}`;

test.describe("§772 — two devices claiming one slot", () => {
  test.skip(!LIVE, SKIP_NO_THROWAWAY);
  test.skip(!DESTRUCTIVE_RUN, "Run via `npm run e2e:live-destructive` (E2E_LIVE_DESTRUCTIVE=1): this probe creates scheduled_reports if missing and deletes only its own rows.");

  const ids = [`probe-a-${SUFFIX}`, `probe-b-${SUFFIX}`];

  test.afterAll(async () => {
    await runTursoPipeline(CONFIG, [{ sql: `DELETE FROM scheduled_reports WHERE job_key = ?`, args: [txt(JOB_KEY)] }]).catch(() => undefined);
  });

  test("exactly one of two concurrent claims wins", async () => {
    const periodStart = "2026-01-01T00:00:00.000Z"; // the start of the probe job's cadence period
    const slot = "2026-01-01T09:00:00.000Z";
    const wins = await Promise.all(ids.map((id, i) =>
      claimReport(CONFIG, { id, projectId: "probe", jobKey: JOB_KEY, slot, periodStart, claimedBy: `dev-${i}`, data: DATA })));
    expect(wins.filter(Boolean)).toHaveLength(1);
    // The `true` must come from the insert that STORED the row: exactly one row exists for the slot, and its id is
    // the winner's.
    const winnerId = ids[wins.indexOf(true)];
    const [stored] = await runTursoPipeline(CONFIG, [{ sql: `SELECT id FROM scheduled_reports WHERE job_key = ? AND slot = ?`, args: [txt(JOB_KEY), txt(slot)] }]);
    expect(rowObjects(stored).map((r) => r.id)).toEqual([winnerId]);
    // The period limit lives in the same statement: another slot of the SAME period loses, the next period's wins.
    const sameDay = await claimReport(CONFIG, { id: `probe-c-${SUFFIX}`, projectId: "probe", jobKey: JOB_KEY, slot: "2026-01-01T10:00:00.000Z", periodStart, claimedBy: "dev-c", data: DATA });
    expect(sameDay).toBe(false);
    const nextDay = await claimReport(CONFIG, { id: `probe-d-${SUFFIX}`, projectId: "probe", jobKey: JOB_KEY, slot: "2026-01-02T09:00:00.000Z", periodStart: "2026-01-02T00:00:00.000Z", claimedBy: "dev-d", data: DATA });
    expect(nextDay).toBe(true);
  });
});

test.describe("§772 — the scheduled-jobs migration on libSQL", () => {
  test.skip(!LIVE, SKIP_NO_THROWAWAY);
  test.skip(!DESTRUCTIVE_RUN, "Run via `npm run e2e:live-destructive` (E2E_LIVE_DESTRUCTIVE=1): this probe empties scheduled_jobs and scheduled_jobs_v2 of the THROWAWAY database.");

  const LEGACY = {
    id: 41, name: "Legacy probe", type: "portfolioAnalysis", cadence: { kind: "daily", timeOfDay: "09:00" },
    enabled: true, projectId: "p-probe", instruction: "keep this", timeZone: "Europe/Berlin", key: "key-probe",
    lastRunAt: "2026-10-22T08:00:00.000Z", history: [],
  };
  const clear = async (): Promise<void> => {
    await runTursoPipeline(CONFIG, [
      ...SCHEDULED_JOBS_DDL.map((sql) => ({ sql })),
      { sql: "DELETE FROM scheduled_jobs_v2" },
      { sql: "DELETE FROM scheduled_jobs" },
    ]);
  };
  const dump = async (): Promise<{ v2: string[][]; legacy: string[][] }> => {
    const [v2, legacy] = await runTursoPipeline(CONFIG, [
      { sql: "SELECT id, data FROM scheduled_jobs_v2 ORDER BY id" },
      { sql: "SELECT id, data FROM scheduled_jobs ORDER BY id" },
    ]);
    const rows = (r: typeof v2) => rowObjects(r).map((o) => [o.id, o.data]);
    return { v2: rows(v2), legacy: rows(legacy) };
  };

  test.beforeEach(async () => {
    __resetScheduledJobsStoreCache();
    await clear();
  });
  test.afterAll(async () => {
    await clear().catch(() => undefined);
  });

  test("copies every field, switches the legacy row off, writes the marker; the marker skips a second session and the guarded SQL itself changes nothing when re-sent", async () => {
    await runTursoPipeline(CONFIG, [
      ...SCHEDULED_JOBS_DDL.map((sql) => ({ sql })),
      { sql: "INSERT INTO scheduled_jobs (id, data) VALUES (?, ?)", args: [txt("41"), txt(JSON.stringify(LEGACY))] },
    ]);
    const jobs = await loadScheduledJobs(CONFIG);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ id: 41, projectId: "p-probe", key: "key-probe", timeZone: "Europe/Berlin", instruction: "keep this", enabled: true });

    const first = await dump();
    expect(first.v2.map((r) => r[0])).toEqual(["41", MIGRATED_MARKER_ID]);
    expect(JSON.parse(first.v2[0][1])).toEqual(LEGACY); // every field, still enabled
    expect(JSON.parse(first.legacy[0][1])).toEqual({ ...LEGACY, enabled: false }); // json_set switched it off, nothing else changed

    __resetScheduledJobsStoreCache(); // a new session migrates again
    await loadScheduledJobs(CONFIG);
    expect(await dump()).toEqual(first); // the marker short-circuit

    // The guarded SQL on its own, with the short-circuit bypassed: the marker's NOT EXISTS must make it a no-op.
    await runTursoPipeline(CONFIG, migrationStatements());
    expect(await dump()).toEqual(first);
  });
});
