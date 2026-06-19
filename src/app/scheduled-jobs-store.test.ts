// src/app/scheduled-jobs-store.test.ts
vi.mock("./turso-pipeline", () => ({ runTursoPipeline: vi.fn(async () => []) }));
import { runTursoPipeline } from "./turso-pipeline";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadScheduledJobs, saveScheduledJobs, LOCAL_KEY, SCHEDULED_JOBS_TABLE,
} from "./scheduled-jobs-store";
import { TABLE_NAMES } from "./turso-schema";
import { JOB_HISTORY_CAP, type ScheduledJob, type ScheduledJobRun } from "./scheduled-jobs/types";

const job: ScheduledJob = {
  id: 1,
  name: "Daily portfolio review",
  type: "portfolioAnalysis",
  cadence: { kind: "daily", timeOfDay: "08:00" },
  enabled: true,
  lastRunAt: null,
  history: [],
};

const mockPipeline = () => runTursoPipeline as unknown as ReturnType<typeof vi.fn>;

describe("scheduled-jobs-store: TABLE_NAMES guard", () => {
  it("keeps scheduled_jobs OUT of TABLE_NAMES (workspace save must never wipe it)", () => {
    expect(TABLE_NAMES).not.toContain(SCHEDULED_JOBS_TABLE);
    expect(TABLE_NAMES).not.toContain("scheduled_jobs");
  });
});

describe("scheduled-jobs-store (localStorage path, config=null)", () => {
  beforeEach(() => localStorage.clear());

  it("returns [] when empty", async () => {
    expect(await loadScheduledJobs(null)).toEqual([]);
  });

  it("round-trips save -> load", async () => {
    await saveScheduledJobs(null, [job]);
    const out = await loadScheduledJobs(null);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 1, name: "Daily portfolio review", enabled: true });
    expect(out[0].cadence).toEqual({ kind: "daily", timeOfDay: "08:00" });
  });

  it("uses the namespaced localStorage key", async () => {
    await saveScheduledJobs(null, [job]);
    expect(localStorage.getItem(LOCAL_KEY)).not.toBeNull();
  });

  it("round-trips a weekly cadence + history", async () => {
    const run: ScheduledJobRun = { ranAt: "2026-06-19T08:00:00.000Z", summary: "ok", actionCount: 3, ok: true };
    const weekly: ScheduledJob = {
      ...job, id: 2, cadence: { kind: "weekly", dayOfWeek: 1, timeOfDay: "09:30" },
      lastRunAt: run.ranAt, history: [run],
    };
    await saveScheduledJobs(null, [weekly]);
    const out = await loadScheduledJobs(null);
    expect(out[0].cadence).toEqual({ kind: "weekly", dayOfWeek: 1, timeOfDay: "09:30" });
    expect(out[0].history).toEqual([run]);
  });

  it("drops malformed jobs and returns a clean array", async () => {
    localStorage.setItem(LOCAL_KEY, JSON.stringify([
      job,                                   // valid
      null,                                  // garbage
      { id: "nope" },                        // non-numeric id -> dropped
      { id: 3, type: "portfolioAnalysis" },  // missing/invalid cadence -> dropped
      { id: 4, type: "other", cadence: { kind: "daily", timeOfDay: "07:00" } }, // bad type -> dropped
      "string-not-object",
    ]));
    const out = await loadScheduledJobs(null);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(1);
  });

  it("returns [] for non-array / garbage JSON", async () => {
    localStorage.setItem(LOCAL_KEY, "{not json");
    expect(await loadScheduledJobs(null)).toEqual([]);
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ not: "an array" }));
    expect(await loadScheduledJobs(null)).toEqual([]);
  });

  it("clamps history to JOB_HISTORY_CAP on load", async () => {
    const runs: ScheduledJobRun[] = Array.from({ length: JOB_HISTORY_CAP + 5 }, (_, i) => ({
      ranAt: `2026-06-${String(i + 1).padStart(2, "0")}T08:00:00.000Z`,
      summary: `run ${i}`, actionCount: i, ok: true,
    }));
    localStorage.setItem(LOCAL_KEY, JSON.stringify([{ ...job, history: runs }]));
    const out = await loadScheduledJobs(null);
    expect(out[0].history).toHaveLength(JOB_HISTORY_CAP);
  });

  it("coerces an invalid cadence kind by dropping the job", async () => {
    localStorage.setItem(LOCAL_KEY, JSON.stringify([
      { ...job, cadence: { kind: "monthly", timeOfDay: "08:00" } },
    ]));
    expect(await loadScheduledJobs(null)).toEqual([]);
  });
});

describe("scheduled-jobs-store (Turso path, config!=null)", () => {
  const cfg = { databaseUrl: "libsql://x", authToken: "t" } as never;
  beforeEach(() => mockPipeline().mockReset());

  it("loadScheduledJobs runs DDL + SELECT and decodes the JSON data column", async () => {
    mockPipeline().mockResolvedValueOnce([
      { type: "ok" as const }, // DDL result
      {
        type: "ok" as const,
        response: { type: "resultsOk", result: {
          cols: [{ name: "id" }, { name: "data" }],
          rows: [[{ value: "1" }, { value: JSON.stringify(job) }]],
        } },
      },
    ]);
    const out = await loadScheduledJobs(cfg);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 1, name: "Daily portfolio review", enabled: true });
  });

  it("loadScheduledJobs drops a row whose data is unparseable", async () => {
    mockPipeline().mockResolvedValueOnce([
      { type: "ok" as const },
      {
        type: "ok" as const,
        response: { type: "resultsOk", result: {
          cols: [{ name: "id" }, { name: "data" }],
          rows: [[{ value: "9" }, { value: "{not-json" }], [{ value: "1" }, { value: JSON.stringify(job) }]],
        } },
      },
    ]);
    const out = await loadScheduledJobs(cfg);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(1);
  });

  it("saveScheduledJobs issues DDL + DELETE + an INSERT per job with id as a string arg", async () => {
    await saveScheduledJobs(cfg, [job, { ...job, id: 2 }]);
    const stmts = mockPipeline().mock.calls.at(-1)![1] as { sql: string; args?: { value: string }[] }[];
    expect(stmts[0].sql).toMatch(/CREATE TABLE IF NOT EXISTS scheduled_jobs/);
    expect(stmts.some((s) => /^DELETE FROM scheduled_jobs$/.test(s.sql))).toBe(true);
    const inserts = stmts.filter((s) => /INSERT INTO scheduled_jobs/.test(s.sql));
    expect(inserts).toHaveLength(2);
    expect(inserts[0].args?.[0]?.value).toBe("1"); // id stringified
    expect(typeof inserts[0].args?.[0]?.value).toBe("string");
  });
});
