// src/app/scheduled-jobs-store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  loadScheduledJobs, saveScheduledJobs, LOCAL_KEY, SCHEDULED_JOBS_TABLE, SCHEDULED_JOBS_V2_TABLE,
} from "./scheduled-jobs-store";
import { TABLE_NAMES } from "./turso-schema";
import { TEXTAREA_MAX } from "./sanitize-core";
import { JOB_HISTORY_CAP, type ScheduledJob, type ScheduledJobRun } from "./scheduled-jobs/types";

const job: ScheduledJob = {
  id: 1,
  name: "Daily portfolio review",
  type: "portfolioAnalysis",
  cadence: { kind: "daily", timeOfDay: "08:00" },
  enabled: true,
  projectId: null,
  timeZone: null,
  key: null,
  lastRunAt: null,
  history: [],
};


describe("scheduled-jobs-store: TABLE_NAMES guard", () => {
  it("keeps scheduled_jobs OUT of TABLE_NAMES (workspace save must never wipe it)", () => {
    expect(TABLE_NAMES).not.toContain(SCHEDULED_JOBS_TABLE);
    expect(TABLE_NAMES).not.toContain(SCHEDULED_JOBS_V2_TABLE);
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

  it("keeps projectId, trimmed capped instruction, valid timeZone and key", async () => {
    localStorage.setItem(LOCAL_KEY, JSON.stringify([{
      ...job, projectId: "p1", instruction: "  focus on risks  ", timeZone: "Europe/Berlin", key: "k-1",
    }, {
      ...job, id: 2, projectId: "p1", instruction: "x".repeat(TEXTAREA_MAX + 50), timeZone: "Not/AZone", key: "k-2",
    }]));
    const out = await loadScheduledJobs(null);
    expect(out[0]).toMatchObject({ projectId: "p1", instruction: "focus on risks", timeZone: "Europe/Berlin", key: "k-1" });
    expect(out[1].instruction).toHaveLength(TEXTAREA_MAX);
    expect(out[1].timeZone).toBeNull();
  });

  it("loads a legacy blob with projectId, timeZone and key null, no instruction, and mints no key", async () => {
    localStorage.setItem(LOCAL_KEY, JSON.stringify([{
      id: 1, name: "Old", type: "portfolioAnalysis", cadence: { kind: "daily", timeOfDay: "08:00" },
      enabled: true, lastRunAt: null, history: [],
    }]));
    const out = await loadScheduledJobs(null);
    expect(out[0].projectId).toBeNull();
    expect(out[0].timeZone).toBeNull();
    expect(out[0].key).toBeNull();
    expect("instruction" in out[0]).toBe(false);
  });

  it("drops malformed jobs and returns a clean array", async () => {
    localStorage.setItem(LOCAL_KEY, JSON.stringify([
      job,                                   // valid
      null,                                  // garbage
      { id: "nope" },                        // non-numeric id -> dropped
      { id: 3, type: "portfolioAnalysis" },  // missing/invalid cadence -> kept, read-only
      { id: 4, type: "other", cadence: { kind: "daily", timeOfDay: "07:00" } }, // unknown type -> kept, read-only
      "string-not-object",
    ]));
    const out = await loadScheduledJobs(null);
    expect(out.map((j) => [j.id, j.foreign !== undefined])).toEqual([[1, false], [3, true], [4, true]]);
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

  it("keeps a job with a cadence kind it does not know, as a foreign job carrying its stored JSON", async () => {
    const stored = { ...job, cadence: { kind: "monthly", timeOfDay: "08:00" } };
    localStorage.setItem(LOCAL_KEY, JSON.stringify([stored]));
    const [only] = await loadScheduledJobs(null);
    expect(only.foreign?.raw).toEqual(stored);
  });
});
