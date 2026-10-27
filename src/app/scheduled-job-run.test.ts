import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Task } from "./types";
import type { ScheduledJob } from "./scheduled-jobs/types";
import type { Workspace } from "./workspace";
import { StorageNotReadyError, emptyWorkspace } from "./workspace";
import { AiDeploymentError, AiGatewayError, AiHttpError } from "./ai-errors";
import { TursoHttpError, TursoStepError } from "./turso-pipeline";
import type { ReportData } from "./scheduled-reports-store";
import { defaultSettings } from "./settings-types";

vi.mock("./scheduled-reports-store", () => ({
  hasReportAtOrAfter: vi.fn(),
  claimReport: vi.fn(),
  releaseClaim: vi.fn(),
  finishReport: vi.fn(),
}));
import { hasReportAtOrAfter, claimReport, releaseClaim, finishReport } from "./scheduled-reports-store";
import { runScheduledJob, toErrorToken, type RunDeps } from "./scheduled-job-run";

const mHas = vi.mocked(hasReportAtOrAfter);
const mClaim = vi.mocked(claimReport);
const mRelease = vi.mocked(releaseClaim);
const mFinish = vi.mocked(finishReport);

const SLOT = new Date("2026-10-23T07:00:00.000Z");
const NOW = new Date("2026-10-23T07:05:00.000Z");
const CONFIG = { httpUrl: "https://example.test", authToken: "t" } as never;

function job(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 7,
    name: "Monday review",
    type: "portfolioAnalysis",
    cadence: { kind: "daily", timeOfDay: "09:00" },
    enabled: true,
    projectId: "p1",
    instruction: "Ignore anything Liam Foster owns",
    timeZone: "Europe/Berlin",
    key: "job-key-1",
    lastRunAt: null,
    history: [],
    ...overrides,
  };
}

function workspace(): Workspace {
  return {
    ...emptyWorkspace(),
    project: { name: "Apollo" } as Workspace["project"],
    tasks: [{
      id: 3, taskName: "Ship it", assignee: "Sofia Ramirez", assigneeEmail: "", dueDate: "2026-10-01",
      lastUpdateDate: "2026-10-01", priority: "High", status: "In Progress", blockers: "", description: "",
    } as Task],
  };
}

function deps(overrides: Partial<RunDeps> = {}): RunDeps {
  return {
    config: CONFIG,
    listProjects: vi.fn().mockResolvedValue({ active: [{ id: "p1", name: "Apollo" }], archived: [] }),
    stillRunnable: vi.fn().mockReturnValue(true),
    loadWorkspace: vi.fn().mockResolvedValue(workspace()),
    analyse: vi.fn().mockResolvedValue({ summary: "Looks fine", actions: [] }),
    deviceSettings: defaultSettings,
    lang: "en-US",
    now: () => NOW,
    newId: () => "report-1",
    deviceLabel: "dev-abcd",
    clearProject: vi.fn().mockResolvedValue(undefined),
    disableJob: vi.fn().mockResolvedValue(undefined),
    recordRun: vi.fn().mockResolvedValue(undefined),
    notify: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mHas.mockResolvedValue(false);
  mClaim.mockResolvedValue(true);
  mRelease.mockResolvedValue(undefined);
  mFinish.mockResolvedValue(undefined);
});

describe("runScheduledJob", () => {
  it("a project in neither list is project-missing: the job's project is cleared, nothing is claimed or analysed", async () => {
    const d = deps({ listProjects: vi.fn().mockResolvedValue({ active: [], archived: [] }) });
    expect(await runScheduledJob(job(), SLOT, d)).toBe("project-missing");
    expect(d.clearProject).toHaveBeenCalledWith(7, "job-key-1");
    expect(d.recordRun).toHaveBeenCalledWith(7, expect.objectContaining({ ok: false, error: "project-missing" }), "job-key-1");
    expect(mFinish).not.toHaveBeenCalled();
    expect(mClaim).not.toHaveBeenCalled();
    expect(d.analyse).not.toHaveBeenCalled();
  });

  it("an archived project is claimed once, finished as project-archived, and the job is disabled", async () => {
    const d = deps({
      listProjects: vi.fn().mockResolvedValue({ active: [], archived: [{ id: "p1", name: "Apollo" }] }),
    });
    expect(await runScheduledJob(job(), SLOT, d)).toBe("project-archived");
    expect(mClaim).toHaveBeenCalledTimes(1);
    expect(mFinish).toHaveBeenCalledTimes(1);
    const [, id, jobKey, ok, data] = mFinish.mock.calls[0];
    expect([id, jobKey, ok]).toEqual(["report-1", "job-key-1", false]);
    expect((data as ReportData).error).toBe("project-archived");
    expect(d.disableJob).toHaveBeenCalledWith(7, "job-key-1");
    expect(d.analyse).not.toHaveBeenCalled();
  });

  it("a slot that already has a report is skipped before anything else runs", async () => {
    mHas.mockResolvedValue(true);
    const d = deps();
    expect(await runScheduledJob(job(), SLOT, d)).toBe("skipped");
    expect(d.listProjects).not.toHaveBeenCalled();
    expect(mClaim).not.toHaveBeenCalled();
    expect(d.analyse).not.toHaveBeenCalled();
    expect(d.recordRun).not.toHaveBeenCalled();
  });

  // KILLED BY: deleting the pre-claim `hasReportAtOrAfter` return (the edited slot would be claimed and billed).
  it("an earlier slot than the job's last report is skipped: no claim, no analysis", async () => {
    const existing = [{ key: "job-key-1", slot: "2026-10-23T07:00:00.000Z" }];
    mHas.mockImplementation(async (_c, key, slot) => existing.some((r) => r.key === key && r.slot >= slot));
    const d = deps();
    const edited = new Date("2026-10-23T06:00:00.000Z"); // the job was moved to an earlier time after it ran at 07:00Z
    expect(await runScheduledJob(job(), edited, d)).toBe("skipped");
    // The guard asks about the whole period (Berlin's local day began at 22:00Z the evening before), not the slot.
    expect(mHas).toHaveBeenCalledWith(CONFIG, "job-key-1", "2026-10-22T22:00:00.000Z");
    expect(mClaim).not.toHaveBeenCalled();
    expect(d.analyse).not.toHaveBeenCalled();
  });
});

// Owner decision: a job runs at most once per cadence period (local day for daily, ISO week for weekly), in its
// CURRENT zone. Reports are modelled as the report table would answer: any row at or after the asked-about instant.
describe("runScheduledJob: at most one run per day or week (owner decision)", () => {
  const reportAt = (...slots: string[]) => mHas.mockImplementation(async (_c, key, since) => key === "job-key-1" && slots.some((s) => s >= since));
  const berlinDaily = (time: string) => job({ cadence: { kind: "daily", timeOfDay: time }, timeZone: "Europe/Berlin" });
  const weeklyBerlin = (dayOfWeek: number) => job({ cadence: { kind: "weekly", dayOfWeek, timeOfDay: "09:00" }, timeZone: "Europe/Berlin" });

  // KILLED BY: asking about the slot (a later slot the same day would be due again) instead of the period.
  it("daily: ran at 09:00, moved to 10:00 the same day -> skipped", async () => {
    reportAt("2026-10-23T07:00:00.000Z");
    const d = deps();
    expect(await runScheduledJob(berlinDaily("10:00"), new Date("2026-10-23T08:00:00.000Z"), d)).toBe("skipped");
    expect(mClaim).not.toHaveBeenCalled();
    expect(d.analyse).not.toHaveBeenCalled();
  });

  it("daily: ran at 09:00 Berlin, zone moved west so the new slot is later in UTC -> skipped", async () => {
    reportAt("2026-10-23T07:00:00.000Z");
    const d = deps();
    const newYork = job({ cadence: { kind: "daily", timeOfDay: "09:00" }, timeZone: "America/New_York" }); // 13:00Z
    expect(await runScheduledJob(newYork, new Date("2026-10-23T13:00:00.000Z"), d)).toBe("skipped");
    expect(d.analyse).not.toHaveBeenCalled();
  });

  it("daily: ran yesterday at 09:00, moved to 08:00 today -> runs today", async () => {
    reportAt("2026-10-22T07:00:00.000Z");
    const d = deps();
    expect(await runScheduledJob(berlinDaily("08:00"), new Date("2026-10-23T06:00:00.000Z"), d)).toBe("done");
    expect(d.analyse).toHaveBeenCalledTimes(1);
  });

  it("weekly: ran Monday, moved to Thursday of the same week -> skipped", async () => {
    reportAt("2026-10-19T07:00:00.000Z");
    const d = deps();
    expect(await runScheduledJob(weeklyBerlin(4), new Date("2026-10-22T07:00:00.000Z"), d)).toBe("skipped");
    expect(d.analyse).not.toHaveBeenCalled();
  });

  it("weekly: ran Monday, next week's slot -> runs", async () => {
    reportAt("2026-10-19T07:00:00.000Z");
    const d = deps();
    expect(await runScheduledJob(weeklyBerlin(1), new Date("2026-10-26T08:00:00.000Z"), d)).toBe("done");
    expect(d.analyse).toHaveBeenCalledTimes(1);
  });

  // KILLED BY: a fixed 24-hour day (the boundary would be an hour off on the days the clocks change).
  it.each([
    ["Berlin spring-forward day (23 h)", "Europe/Berlin", "2027-03-28T07:00:00.000Z", "2027-03-27T22:30:00.000Z", "2027-03-27T23:30:00.000Z"],
    ["New York spring-forward day (23 h)", "America/New_York", "2026-03-08T13:00:00.000Z", "2026-03-08T04:30:00.000Z", "2026-03-08T05:30:00.000Z"],
    ["Berlin fall-back day (25 h)", "Europe/Berlin", "2026-10-25T08:00:00.000Z", "2026-10-24T21:30:00.000Z", "2026-10-24T22:30:00.000Z"],
    ["New York fall-back day (25 h)", "America/New_York", "2026-11-01T14:00:00.000Z", "2026-11-01T03:30:00.000Z", "2026-11-01T04:30:00.000Z"],
    ["Santiago, the day its midnight does not exist", "America/Santiago", "2026-09-06T12:00:00.000Z", "2026-09-06T03:30:00.000Z", "2026-09-06T04:30:00.000Z"],
    ["Havana, the day its midnight does not exist", "America/Havana", "2026-03-08T13:00:00.000Z", "2026-03-08T04:30:00.000Z", "2026-03-08T05:30:00.000Z"],
  ])("on %s a report just before local midnight does not block, one just after does", async (_n, tz, slotAt, before, after) => {
    const daily = job({ cadence: { kind: "daily", timeOfDay: "09:00" }, timeZone: tz });
    reportAt(before);
    const d1 = deps();
    expect(await runScheduledJob(daily, new Date(slotAt), d1)).toBe("done");
    reportAt(after);
    const d2 = deps();
    expect(await runScheduledJob(daily, new Date(slotAt), d2)).toBe("skipped");
  });
});

describe("runScheduledJob (continued)", () => {

  it("losing the claim is claimed-elsewhere: no load, no analysis", async () => {
    mClaim.mockResolvedValue(false);
    const d = deps();
    expect(await runScheduledJob(job(), SLOT, d)).toBe("claimed-elsewhere");
    expect(d.loadWorkspace).not.toHaveBeenCalled();
    expect(d.analyse).not.toHaveBeenCalled();
  });

  it("an archived project still disables the job when the finish write throws", async () => {
    mFinish.mockRejectedValue(new Error("Turso error: boom"));
    const d = deps({
      listProjects: vi.fn().mockResolvedValue({ active: [], archived: [{ id: "p1", name: "Apollo" }] }),
    });
    expect(await runScheduledJob(job(), SLOT, d)).toBe("project-archived");
    expect(d.disableJob).toHaveBeenCalledWith(7, "job-key-1");
  });

  it("a deterministic Turso error while loading is NOT transient: finished as failed with the turso token and recorded", async () => {
    const d = deps({ loadWorkspace: vi.fn().mockRejectedValue(new TursoStepError(2, "no such column")) });
    expect(await runScheduledJob(job(), SLOT, d)).toBe("failed");
    expect(mRelease).not.toHaveBeenCalled();
    expect((mFinish.mock.calls[0][4] as ReportData).error).toBe("turso");
    expect(JSON.stringify(mFinish.mock.calls[0])).not.toContain("no such column");
    expect(d.recordRun).toHaveBeenCalledWith(7, expect.objectContaining({ ok: false, error: "turso" }), "job-key-1");
  });

  it("a finish that throws on the success path returns failed with no second finish and no run record", async () => {
    mFinish.mockRejectedValue(new Error("Turso error: boom"));
    const d = deps();
    expect(await runScheduledJob(job(), SLOT, d)).toBe("failed");
    expect(mFinish).toHaveBeenCalledTimes(1);
    expect(d.recordRun).not.toHaveBeenCalled();
    expect(d.notify).not.toHaveBeenCalled();
  });

  it("a notify that throws after an ok finish leaves the stored report ok", async () => {
    const d = deps({ notify: vi.fn().mockImplementation(() => { throw new Error("no permission"); }) });
    expect(await runScheduledJob(job(), SLOT, d)).toBe("done");
    expect(mFinish).toHaveBeenCalledTimes(1);
    expect(mFinish.mock.calls[0][3]).toBe(true);
  });

  it("a storage failure while loading is transient: the claim is released, nothing is finished or recorded", async () => {
    const d = deps({ loadWorkspace: vi.fn().mockRejectedValue(new StorageNotReadyError("busy")) });
    expect(await runScheduledJob(job(), SLOT, d)).toBe("transient");
    expect(mRelease).toHaveBeenCalledWith(CONFIG, "report-1");
    expect(mFinish).not.toHaveBeenCalled();
    expect(d.recordRun).not.toHaveBeenCalled();
    expect(d.analyse).not.toHaveBeenCalled();
  });

  it("a rate limit finishes the report as failed with the limit token and never stores the thrown text", async () => {
    const err = new AiHttpError(429, "rate_limit_error", "secret server text");
    const d = deps({ analyse: vi.fn().mockRejectedValue(err) });
    expect(await runScheduledJob(job(), SLOT, d)).toBe("failed");
    const [, , , ok, data] = mFinish.mock.calls[0];
    expect(ok).toBe(false);
    expect((data as ReportData).error).toBe("limit");
    expect(JSON.stringify(mFinish.mock.calls[0])).not.toContain("secret server text");
    expect(d.recordRun).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.recordRun).mock.calls[0][1]).toMatchObject({ ok: false, error: "limit" });
    expect(d.notify).not.toHaveBeenCalled();
  });

  it("analyse gets a context that contains the job's instruction section exactly once", async () => {
    const d = deps();
    await runScheduledJob(job(), SLOT, d);
    const ctx = vi.mocked(d.analyse).mock.calls[0][0];
    expect(ctx).toContain("## Job instruction");
    expect(ctx.split("Ignore anything Liam Foster owns")).toHaveLength(2);
  });

  it("success keeps a grounded entity, drops an ungrounded one, finishes ok, records and notifies", async () => {
    const d = deps({
      analyse: vi.fn().mockResolvedValue({
        summary: "Two things to look at",
        actions: [
          { title: "Chase task", why: "late", severity: "now", entity: { view: "open-points", id: "3" } },
          { title: "Phantom", why: "invented", severity: "soon", entity: { view: "open-points", id: "999" } },
        ],
      }),
    });
    expect(await runScheduledJob(job(), SLOT, d)).toBe("done");
    const [, , , ok, data] = mFinish.mock.calls[0];
    const report = data as ReportData;
    expect(ok).toBe(true);
    expect(report.projectName).toBe("Apollo");
    expect(report.summary).toBe("Two things to look at");
    expect(report.actions[0].entity).toEqual({ view: "open-points", id: "3" });
    expect(report.actions[1]).toEqual({ title: "Phantom", why: "invented", severity: "soon" });
    expect("entity" in report.actions[1]).toBe(false);
    expect(d.recordRun).toHaveBeenCalledWith(7, expect.objectContaining({ ok: true, actionCount: 2 }), "job-key-1");
    expect(d.notify).toHaveBeenCalledWith("Monday review", "Apollo: Two things to look at");
  });

  it("captures the job name and project name at claim time", async () => {
    const j = job();
    const d = deps({
      analyse: vi.fn().mockImplementation(async () => {
        j.name = "Renamed meanwhile";
        return { summary: "s", actions: [] };
      }),
    });
    await runScheduledJob(j, SLOT, d);
    expect((mFinish.mock.calls[0][4] as ReportData).jobName).toBe("Monday review");
    expect((mClaim.mock.calls[0][1].data as ReportData).jobName).toBe("Monday review");
  });

  it("a recordRun for a job deleted mid-run does not throw", async () => {
    const d = deps({ recordRun: vi.fn().mockRejectedValue(new Error("gone")) });
    await expect(runScheduledJob(job(), SLOT, d)).resolves.toBe("done");
  });
});

describe("toErrorToken", () => {
  it("maps each failure to the closed token set", () => {
    expect(toErrorToken(new AiHttpError(429))).toBe("limit");
    expect(toErrorToken(new AiHttpError(401))).toBe("401");
    expect(toErrorToken(new AiHttpError(403))).toBe("403");
    expect(toErrorToken(new AiHttpError(500))).toBe("error");
    expect(toErrorToken(new Error("parse"))).toBe("parse");
    expect(toErrorToken(new StorageNotReadyError("x"))).toBe("storage-unreachable");
    expect(toErrorToken(new TursoStepError(1, "boom"))).toBe("turso");
    expect(toErrorToken(new Error("Turso error: boom"))).toBe("turso");
    expect(toErrorToken(new Error("anything else"))).toBe("error");
    expect(toErrorToken("nope")).toBe("error");
  });

  it("records a transport failure as its own token, never the generic one or a key verdict", () => {
    expect(toErrorToken(new AiDeploymentError("off"))).toBe("ai-off");
    expect(toErrorToken(new AiDeploymentError("invalid"))).toBe("ai-invalid");
    expect(toErrorToken(new AiDeploymentError("route-changed"))).toBe("ai-route-changed");
    expect(toErrorToken(new AiDeploymentError("unconfirmed"))).toBe("ai-unconfirmed");
    expect(toErrorToken(new AiGatewayError("ai-gateway-rejected"))).toBe("ai-gateway-rejected");
    expect(toErrorToken(new AiGatewayError("ai-gateway-error"))).toBe("ai-gateway-error");
  });
});

describe("runScheduledJob: busy database, live re-check, orphan guard (§772 review wave 2)", () => {
  // KILLED BY: isTransient back to StorageNotReadyError only.
  it.each([
    ["a plain busy error", new Error("Turso error: SQLITE_BUSY: database is locked")],
    ["a busy step error", new TursoStepError(2, "database is locked")],
  ])("%s while loading is transient: the claim is released, nothing is finished or recorded", async (_n, err) => {
    const d = deps({ loadWorkspace: vi.fn().mockRejectedValue(err) });
    expect(await runScheduledJob(job(), SLOT, d)).toBe("transient");
    expect(mRelease).toHaveBeenCalledWith(CONFIG, "report-1");
    expect(mFinish).not.toHaveBeenCalled();
    expect(d.recordRun).not.toHaveBeenCalled();
    expect(d.analyse).not.toHaveBeenCalled();
  });

  it("any other Turso error while loading still finishes the report as failed (turso)", async () => {
    const d = deps({ loadWorkspace: vi.fn().mockRejectedValue(new TursoStepError(2, "no such column: x")) });
    expect(await runScheduledJob(job(), SLOT, d)).toBe("failed");
    expect(mRelease).not.toHaveBeenCalled();
    expect((mFinish.mock.calls[0][4] as ReportData).error).toBe("turso");
  });

  // KILLED BY: deleting the `stillRunnable` check (the stale job would claim, and a missing project would be cleared).
  it("a job that is no longer runnable is skipped before anything is written, even when its project looks gone", async () => {
    const d = deps({
      stillRunnable: vi.fn().mockReturnValue(false),
      listProjects: vi.fn().mockResolvedValue({ active: [], archived: [] }),
    });
    expect(await runScheduledJob(job(), SLOT, d)).toBe("skipped");
    expect(d.stillRunnable).toHaveBeenCalledWith(expect.objectContaining({ key: "job-key-1" }));
    expect(mClaim).not.toHaveBeenCalled();
    expect(d.clearProject).not.toHaveBeenCalled();
    expect(d.recordRun).not.toHaveBeenCalled();
    expect(d.analyse).not.toHaveBeenCalled();
  });

  // KILLED BY: deleting the second project check after the claim.
  it("a project hard-deleted between the list read and the claim leaves no row: released, cleared, project-missing", async () => {
    const listProjects = vi.fn()
      .mockResolvedValueOnce({ active: [{ id: "p1", name: "Apollo" }], archived: [] })
      .mockResolvedValueOnce({ active: [], archived: [] });
    const d = deps({ listProjects });
    expect(await runScheduledJob(job(), SLOT, d)).toBe("project-missing");
    expect(mClaim).toHaveBeenCalledTimes(1);
    expect(mRelease).toHaveBeenCalledWith(CONFIG, "report-1");
    expect(d.clearProject).toHaveBeenCalledWith(7, "job-key-1");
    expect(d.loadWorkspace).not.toHaveBeenCalled();
    expect(d.analyse).not.toHaveBeenCalled();
  });

  // KILLED BY: removing the stillRunnable re-check after the load.
  it("a job disabled while its project loads: claim released, no AI call, no report, no run record", async () => {
    let runnable = true;
    const d = deps({
      stillRunnable: vi.fn(() => runnable),
      loadWorkspace: vi.fn(async () => { runnable = false; return workspace(); }),
    });
    expect(await runScheduledJob(job(), SLOT, d)).toBe("skipped");
    expect(mClaim).toHaveBeenCalledTimes(1);
    expect(mRelease).toHaveBeenCalledWith(CONFIG, "report-1");
    expect(d.analyse).not.toHaveBeenCalled();
    expect(mFinish).not.toHaveBeenCalled();
    expect(d.recordRun).not.toHaveBeenCalled();
    expect(d.notify).not.toHaveBeenCalled();
  });

  // KILLED BY: widening BUSY back to any "busy" text.
  it("a load error that merely mentions the word busy is not transient", async () => {
    const d = deps({ loadWorkspace: vi.fn().mockRejectedValue(new Error("Turso error: row 5 is busy-looking")) });
    expect(await runScheduledJob(job(), SLOT, d)).toBe("failed");
    expect(mRelease).not.toHaveBeenCalled();
  });

  it("an unreadable project list after the claim releases the claim as transient", async () => {
    const listProjects = vi.fn()
      .mockResolvedValueOnce({ active: [{ id: "p1", name: "Apollo" }], archived: [] })
      .mockRejectedValueOnce(new StorageNotReadyError("storage-unreachable"));
    const d = deps({ listProjects });
    expect(await runScheduledJob(job(), SLOT, d)).toBe("transient");
    expect(mRelease).toHaveBeenCalledWith(CONFIG, "report-1");
    expect(d.analyse).not.toHaveBeenCalled();
  });
});

describe("runScheduledJob: a partly read project is said so (§772 cr2)", () => {
  // KILLED BY: dropping the partial flag from the finished report.
  it("marks the report partial when the load lost part of the project", async () => {
    const d = deps({ lastLoadPartial: () => true });
    expect(await runScheduledJob(job(), SLOT, d)).toBe("done");
    expect((mFinish.mock.calls[0][4] as ReportData).partial).toBe(true);
  });

  it("leaves a clean load unmarked", async () => {
    expect(await runScheduledJob(job(), SLOT, deps({ lastLoadPartial: () => false }))).toBe("done");
    expect((mFinish.mock.calls[0][4] as ReportData).partial).toBeUndefined();
  });
});

describe("runScheduledJob: a Turso server blip is transient, by status (§772 cr3)", () => {
  // KILLED BY: dropping isServerBlip (the slot would be burnt as a failed "turso" report).
  it.each([429, 500, 502, 503])("HTTP %i while loading releases the claim and writes no report", async (status) => {
    const d = deps({ loadWorkspace: vi.fn().mockRejectedValue(new TursoHttpError(status)) });
    expect(await runScheduledJob(job(), SLOT, d)).toBe("transient");
    expect(mRelease).toHaveBeenCalledWith(CONFIG, "report-1");
    expect(mFinish).not.toHaveBeenCalled();
    expect(d.recordRun).not.toHaveBeenCalled();
  });

  it.each([400, 404])("HTTP %i is deterministic: finished as failed with the turso token", async (status) => {
    const d = deps({ loadWorkspace: vi.fn().mockRejectedValue(new TursoHttpError(status)) });
    expect(await runScheduledJob(job(), SLOT, d)).toBe("failed");
    expect(mRelease).not.toHaveBeenCalled();
    expect((mFinish.mock.calls[0][4] as ReportData).error).toBe("turso");
  });

  it("a deterministic SQL error is still a failed report", async () => {
    const d = deps({ loadWorkspace: vi.fn().mockRejectedValue(new TursoStepError(1, "no such table: tasks")) });
    expect(await runScheduledJob(job(), SLOT, d)).toBe("failed");
    expect((mFinish.mock.calls[0][4] as ReportData).error).toBe("turso");
  });

  it("maps the typed HTTP error to the turso token", () => {
    expect(toErrorToken(new TursoHttpError(503))).toBe("turso");
  });
});

describe("runScheduledJob: every run record carries the slot it ran for (§772 cr4 re-review)", () => {
  const slotIso = SLOT.toISOString();

  // KILLED BY: leaving the slot off a record (the period guard would have to judge by the end time again).
  it("the success record", async () => {
    const d = deps();
    await runScheduledJob(job(), SLOT, d);
    expect(d.recordRun).toHaveBeenCalledWith(7, expect.objectContaining({ ok: true, slot: slotIso }), "job-key-1");
  });

  it("a failed record", async () => {
    const d = deps({ analyse: vi.fn().mockRejectedValue(new Error("parse")) });
    await runScheduledJob(job(), SLOT, d);
    expect(d.recordRun).toHaveBeenCalledWith(7, expect.objectContaining({ ok: false, slot: slotIso }), "job-key-1");
  });

  it("a project-missing record, before and after the claim", async () => {
    const before = deps({ listProjects: vi.fn().mockResolvedValue({ active: [], archived: [] }) });
    await runScheduledJob(job(), SLOT, before);
    expect(before.recordRun).toHaveBeenCalledWith(7, expect.objectContaining({ error: "project-missing", slot: slotIso }), "job-key-1");
    const after = deps({
      listProjects: vi.fn()
        .mockResolvedValueOnce({ active: [{ id: "p1", name: "Apollo" }], archived: [] })
        .mockResolvedValueOnce({ active: [], archived: [] }),
    });
    await runScheduledJob(job(), SLOT, after);
    expect(after.recordRun).toHaveBeenCalledWith(7, expect.objectContaining({ error: "project-missing", slot: slotIso }), "job-key-1");
  });

  it("a project-archived record", async () => {
    const d = deps({ listProjects: vi.fn().mockResolvedValue({ active: [], archived: [{ id: "p1", name: "Apollo" }] }) });
    await runScheduledJob(job(), SLOT, d);
    expect(d.recordRun).toHaveBeenCalledWith(7, expect.objectContaining({ error: "project-archived", slot: slotIso }), "job-key-1");
  });

  // KILLED BY: not passing the period start to the claim.
  it("the claim is given the period start", async () => {
    await runScheduledJob(job(), SLOT, deps());
    expect(mClaim.mock.calls[0][1]).toMatchObject({ slot: slotIso, periodStart: "2026-10-22T22:00:00.000Z" });
  });
});
