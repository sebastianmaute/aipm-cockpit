import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useScheduledJobRunner, type ScheduledJobRunnerArgs } from "./use-scheduled-job-runner";
import type { ScheduledJob, ScheduledJobRun } from "./scheduled-jobs/types";
import { newConsent, publishAiConsentState, publishBackgroundCapState } from "./ai-consent";
import { defaultAiConfig } from "./settings-types";

// The runner builds the run deps itself: the AI call, the portfolio lists, the project load and the report
// store are mocked at their module edge, so the REAL runScheduledJob runs in every test below.
vi.mock("./scheduled-job-analysis", () => ({
  runJobAnalysis: vi.fn(),
}));
// The deployment check asks the server; here it answers "on, same route" unless a test says otherwise.
vi.mock("./ai-transport", () => ({
  confirmAiDeployment: vi.fn(),
}));
vi.mock("./turso-portfolio", () => ({
  listProjectRefs: vi.fn(),
}));
// The job store as ANOTHER tab or device would leave it: the runner judges jobs against a fresh read of it, not
// against the copy its hook read at mount. `baseArgs` seeds it with the same jobs the hook was given.
const storeState = vi.hoisted(() => ({ jobs: [] as unknown[], fail: false, reads: 0 }));
vi.mock("./scheduled-jobs-store", () => ({
  loadScheduledJobs: vi.fn(async () => {
    storeState.reads += 1;
    if (storeState.fail) throw new Error("store down");
    return storeState.jobs;
  }),
}));
const backendState = vi.hoisted(() => ({
  failures: [] as string[], truncated: { entries: 0, blocks: 0 }, onLoad: undefined as undefined | (() => void),
}));
vi.mock("./turso-backend", () => ({
  TursoBackend: vi.fn().mockImplementation(function () {
    return {
      load: async () => { backendState.onLoad?.(); return emptyWorkspace(); },
      get lastDecodeFailures() { return backendState.failures; },
      get lastLoadTruncation() { return backendState.truncated; },
    };
  }),
}));
vi.mock("./scheduled-reports-store", () => ({
  hasReportAtOrAfter: vi.fn(),
  slotStatus: vi.fn(),
  claimReport: vi.fn(),
  releaseClaim: vi.fn(),
  finishReport: vi.fn(),
}));
import { runJobAnalysis } from "./scheduled-job-analysis";
import { confirmAiDeployment } from "./ai-transport";
import { AiDeploymentError } from "./ai-errors";
import { listProjectRefs } from "./turso-portfolio";
import { hasReportAtOrAfter, slotStatus, claimReport, finishReport, releaseClaim } from "./scheduled-reports-store";
import { emptyWorkspace } from "./workspace";
import { defaultSettings } from "./settings-types";
const mockRun = vi.mocked(runJobAnalysis);
const mClaim = vi.mocked(claimReport);

// A daily 09:00 UTC job, assigned to a project, never run yet.
function dailyJob(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 1,
    name: "Daily portfolio",
    type: "portfolioAnalysis",
    cadence: { kind: "daily", timeOfDay: "09:00" },
    enabled: true,
    projectId: "p1", timeZone: "UTC", key: "job-key-1",
    lastRunAt: null,
    history: [],
    ...overrides,
  };
}

// Past the 09:00 UTC slot → due.
const afternoon = () => new Date("2026-10-23T14:00:00.000Z");
// Before the slot → not due.
const earlyMorning = () => new Date("2026-10-23T07:00:00.000Z");

function baseArgs(overrides: Partial<ScheduledJobRunnerArgs> = {}): ScheduledJobRunnerArgs {
  const args: ScheduledJobRunnerArgs = {
    enabled: true,
    guidesReady: true,
    jobs: [dailyJob()],
    jobsSource: "https://example.test",
    recordRun: vi.fn(),
    config: { httpUrl: "https://example.test", authToken: "t" } as never,
    available: true,
    deviceSettings: defaultSettings,
    lang: "en-US",
    clearProject: vi.fn().mockResolvedValue(undefined),
    disableJob: vi.fn().mockResolvedValue(undefined),
    ai: { apiKey: "k", model: "m" },
    notify: vi.fn(),
    now: afternoon,
    ...overrides,
  };
  storeState.jobs = [...args.jobs];
  return args;
}

function resetStore(): void {
  vi.mocked(confirmAiDeployment).mockReset().mockResolvedValue(undefined);
  vi.mocked(hasReportAtOrAfter).mockReset().mockResolvedValue(false);
  vi.mocked(slotStatus).mockReset().mockResolvedValue("none");
  mClaim.mockReset().mockResolvedValue(true);
  vi.mocked(finishReport).mockReset().mockResolvedValue(undefined);
  vi.mocked(listProjectRefs).mockReset().mockResolvedValue({ active: [{ id: "p1", name: "Apollo" }], archived: [] });
  backendState.failures = [];
  backendState.truncated = { entries: 0, blocks: 0 };
  backendState.onLoad = undefined;
  storeState.fail = false;
  storeState.reads = 0;
}

// The hook asks the published background gate before each claim, so every test starts with a live consent.
beforeEach(() => {
  publishAiConsentState({ ...defaultAiConfig, enabled: true, consent: newConsent(new Date(0)), backgroundConsent: newConsent(new Date(0)) });
  publishBackgroundCapState(false);
});
afterEach(() => {
  publishBackgroundCapState(false);
  publishAiConsentState(undefined);
});

describe("useScheduledJobRunner: a later job re-checks the live state before its claim (§772 review wave 2)", () => {
  type Args = ScheduledJobRunnerArgs;
  const first = () => dailyJob({ id: 1, key: "k1", name: "First" });
  const second = () => dailyJob({ id: 2, key: "k2", name: "Second" });
  // A job change is made in the STORE (another tab or device); a switch or the key changes in this tab's args.
  const changes: [string, (a: Args) => Partial<Args>, ((jobs: ScheduledJob[]) => ScheduledJob[]) | undefined][] = [
    ["is disabled in the store", () => ({}), (jobs) => jobs.map((j) => (j.key === "k2" ? { ...j, enabled: false } : j))],
    ["is deleted in the store", () => ({}), (jobs) => jobs.filter((j) => j.key !== "k2")],
    ["is pointed at another project in the store", () => ({}), (jobs) => jobs.map((j) => (j.key === "k2" ? { ...j, projectId: "p2" } : j))],
    ["is re-timed in the store", () => ({}), (jobs) => jobs.map((j) => (j.key === "k2" ? { ...j, cadence: { kind: "daily", timeOfDay: "10:00" } } : j))],
    ["has scheduled jobs / AI switched off", () => ({ enabled: false }), undefined],
    ["loses the AI key", (a) => ({ ai: { ...a.ai, apiKey: "" } }), undefined],
  ];

  // KILLED BY: deleting the `stillRunnable` dep (each later job would be claimed and billed from the stale snapshot).
  it.each(changes)("a job that %s during the first job's run is neither claimed nor analysed", async (_name, change, storeChange) => {
    mockRun.mockReset();
    resetStore();
    let finishFirst: (v: { summary: string; actions: [] }) => void = () => {};
    mockRun.mockReturnValueOnce(new Promise((r) => { finishFirst = r; })).mockResolvedValue({ summary: "s", actions: [] });
    const initial = baseArgs({ jobs: [first(), second()] });
    const { rerender } = renderHook((p: { args: Args }) => useScheduledJobRunner(p.args), { initialProps: { args: initial } });
    await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); });
    expect(mockRun).toHaveBeenCalledTimes(1); // the first job is in flight
    if (storeChange) storeState.jobs = storeChange(storeState.jobs as ScheduledJob[]);
    rerender({ args: { ...initial, ...change(initial) } });
    await act(async () => {
      finishFirst({ summary: "s", actions: [] });
      for (let i = 0; i < 40; i++) await Promise.resolve();
    });
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mClaim).toHaveBeenCalledTimes(1);
    expect(mClaim.mock.calls[0][1].jobKey).toBe("k1");
  });

  it("control: an unchanged second job still runs after the first", async () => {
    mockRun.mockReset();
    resetStore();
    mockRun.mockResolvedValue({ summary: "s", actions: [] });
    renderHook(() => useScheduledJobRunner(baseArgs({ jobs: [first(), second()] })));
    await act(async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); });
    expect(mockRun).toHaveBeenCalledTimes(2);
  });
});

describe("useScheduledJobRunner: jobs are judged on a fresh read of the store (§772 cr3)", () => {
  const settle = async () => act(async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); });
  beforeEach(() => {
    mockRun.mockReset().mockResolvedValue({ summary: "s", actions: [] });
    resetStore();
  });

  // KILLED BY: judging the mount-time copy (dueJobs(a.jobs) instead of the fresh read).
  it.each([
    ["deleted", (jobs: ScheduledJob[]) => jobs.filter(() => false)],
    ["switched off", (jobs: ScheduledJob[]) => jobs.map((j) => ({ ...j, enabled: false }))],
    ["pointed at another project", (jobs: ScheduledJob[]) => jobs.map((j) => ({ ...j, projectId: "p2" }))],
  ])("a job another tab %s before this tab's tick is never run on its old project", async (_n, change) => {
    const args = baseArgs();
    storeState.jobs = change(storeState.jobs as ScheduledJob[]);
    renderHook(() => useScheduledJobRunner(args));
    await settle();
    expect(mockRun).not.toHaveBeenCalled();
    expect(mClaim).not.toHaveBeenCalled();
  });

  // KILLED BY: ignoring a failed store read (the stale copy would run).
  it("claims nothing when the store cannot be read", async () => {
    const args = baseArgs();
    storeState.fail = true;
    renderHook(() => useScheduledJobRunner(args));
    await settle();
    expect(storeState.reads).toBeGreaterThan(0);
    expect(vi.mocked(slotStatus)).not.toHaveBeenCalled();
    expect(mClaim).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
  });

  // KILLED BY: re-checking the in-memory copy before the billed call (stillRunnable must re-read the store).
  it("a job deleted in the store while its project loads is released and never analysed", async () => {
    const args = baseArgs();
    backendState.onLoad = () => { storeState.jobs = []; };
    renderHook(() => useScheduledJobRunner(args));
    await settle();
    expect(mClaim).toHaveBeenCalledTimes(1);
    expect(vi.mocked(releaseClaim)).toHaveBeenCalledTimes(1);
    expect(mockRun).not.toHaveBeenCalled();
    expect(vi.mocked(finishReport)).not.toHaveBeenCalled();
  });

  // KILLED BY: not remembering a FINISHED slot (every tick of the day would ask the report table again).
  it("does not ask the report table again for a slot it saw finished", async () => {
    vi.mocked(slotStatus).mockReset().mockResolvedValue("final");
    const args = baseArgs();
    renderHook(() => useScheduledJobRunner(args));
    await settle();
    expect(vi.mocked(slotStatus)).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(vi.mocked(slotStatus)).toHaveBeenCalledTimes(1);
    expect(mockRun).not.toHaveBeenCalled();
  });

  // KILLED BY: remembering a live claim as if it were final (the slot would be lost when the claimant releases it).
  it("another device's live claim is skipped but not remembered: the slot runs once it is released", async () => {
    vi.mocked(slotStatus).mockReset().mockResolvedValueOnce("in-flight").mockResolvedValue("none");
    renderHook(() => useScheduledJobRunner(baseArgs()));
    await settle();
    expect(mockRun).not.toHaveBeenCalled();
    expect(mClaim).not.toHaveBeenCalled();
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(vi.mocked(slotStatus)).toHaveBeenCalledTimes(2);
    expect(mockRun).toHaveBeenCalledTimes(1);
    // AI-01 — an unattended run: every request asks the background consent.
    expect(mockRun.mock.calls[0][1]).toMatchObject({ level: "background" });
  });

  // KILLED BY: remembering "claimed-elsewhere" (that claim may be released as transient).
  it("losing the claim race is not remembered: a later tick runs the slot if the winner let go", async () => {
    mClaim.mockReset().mockResolvedValueOnce(false).mockResolvedValue(true);
    renderHook(() => useScheduledJobRunner(baseArgs()));
    await settle();
    expect(mockRun).not.toHaveBeenCalled();
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(mClaim).toHaveBeenCalledTimes(2);
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  // KILLED BY: deciding "anything due" on the copy the hook read at mount.
  it("picks up a job another device created or moved, within one tick, though the mount copy has none", async () => {
    const args = baseArgs({ jobs: [] });
    renderHook(() => useScheduledJobRunner(args));
    await settle();
    expect(mockRun).not.toHaveBeenCalled();
    storeState.jobs = [dailyJob({ id: 5, key: "k5" })]; // created elsewhere
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mClaim.mock.calls[0][1].jobKey).toBe("k5");
  });

  it("never runs a foreign job (a type or cadence this version does not know)", async () => {
    const args = baseArgs({ jobs: [dailyJob({ foreign: { raw: { id: 1, type: "future" } } })] });
    renderHook(() => useScheduledJobRunner(args));
    await settle();
    expect(mockRun).not.toHaveBeenCalled();
    expect(mClaim).not.toHaveBeenCalled();
  });
});

describe("useScheduledJobRunner", () => {
  beforeEach(() => {
    mockRun.mockReset();
    resetStore();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs a due job on mount → recordRun(ok:true) with actionCount, then notify", async () => {
    mockRun.mockResolvedValue({ summary: "all good", actions: [{ title: "t", why: "w", severity: "now" }] });
    const recordRun = vi.fn();
    const notify = vi.fn();
    await act(async () => {
      renderHook(() => useScheduledJobRunner(baseArgs({ recordRun, notify })));
    });
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(recordRun).toHaveBeenCalledTimes(1);
    const [jobId, run] = recordRun.mock.calls[0];
    expect(jobId).toBe(1);
    expect(run.ok).toBe(true);
    expect(run.summary).toBe("all good");
    expect(run.actionCount).toBe(1);
    expect(typeof run.ranAt).toBe("string");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("Daily portfolio", "Apollo: all good");
  });

  it("does nothing for a not-due job", async () => {
    const recordRun = vi.fn();
    await act(async () => {
      renderHook(() => useScheduledJobRunner(baseArgs({ recordRun, now: earlyMorning })));
    });
    expect(mockRun).not.toHaveBeenCalled();
    expect(recordRun).not.toHaveBeenCalled();
  });

  it("runs nothing when enabled is false", async () => {
    const recordRun = vi.fn();
    const notify = vi.fn();
    await act(async () => {
      renderHook(() => useScheduledJobRunner(baseArgs({ enabled: false, recordRun, notify })));
    });
    expect(mockRun).not.toHaveBeenCalled();
    expect(recordRun).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("records ok:false with a closed error token on a failed analysis and does NOT notify", async () => {
    mockRun.mockRejectedValue(new Error("500"));
    const recordRun = vi.fn();
    const notify = vi.fn();
    await act(async () => {
      renderHook(() => useScheduledJobRunner(baseArgs({ recordRun, notify })));
    });
    expect(recordRun).toHaveBeenCalledTimes(1);
    const [, run] = recordRun.mock.calls[0];
    expect(run.ok).toBe(false);
    expect(run.error).toBe("error"); // never the thrown message
    expect(run.summary).toBe("");
    expect(run.actionCount).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it("runs nothing while the portfolio is unavailable", async () => {
    const recordRun = vi.fn();
    await act(async () => {
      renderHook(() => useScheduledJobRunner(baseArgs({ available: false, recordRun })));
    });
    expect(mockRun).not.toHaveBeenCalled();
    expect(mClaim).not.toHaveBeenCalled();
    expect(recordRun).not.toHaveBeenCalled();
  });

  it("never passes a job that is not runnable", async () => {
    mockRun.mockResolvedValue({ summary: "s", actions: [] });
    const jobs = [
      dailyJob({ id: 1, projectId: null }),
      dailyJob({ id: 2, key: null }),
      dailyJob({ id: 3, timeZone: null }),
      dailyJob({ id: 4, enabled: false }),
    ];
    await act(async () => {
      renderHook(() => useScheduledJobRunner(baseArgs({ jobs })));
    });
    expect(mClaim).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("runs two due jobs one after the other", async () => {
    const order: string[] = [];
    mockRun.mockImplementation(async () => {
      order.push("start");
      await Promise.resolve();
      await Promise.resolve();
      order.push("end");
      return { summary: "s", actions: [] };
    });
    const jobs = [dailyJob({ id: 1, key: "k1" }), dailyJob({ id: 2, key: "k2", name: "Second" })];
    await act(async () => {
      renderHook(() => useScheduledJobRunner(baseArgs({ jobs })));
      for (let i = 0; i < 40; i++) await Promise.resolve();
    });
    expect(order).toEqual(["start", "end", "start", "end"]);
  });

  // KILLED BY: deleting the `jobsSource !== config.httpUrl` guard in the tick.
  it("does not tick while the job list still belongs to another portfolio", async () => {
    mockRun.mockResolvedValue({ summary: "s", actions: [] });
    await act(async () => {
      renderHook(() => useScheduledJobRunner(baseArgs({ jobsSource: "https://previous.example" })));
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    expect(storeState.reads).toBe(0);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("does not tick before the first job read has landed", async () => {
    await act(async () => {
      renderHook(() => useScheduledJobRunner(baseArgs({ jobsSource: undefined })));
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    expect(storeState.reads).toBe(0);
  });

  it("two runner instances ticking at once obey the claim result: only the claim winner analyses", async () => {
    // A store whose claim is first-come-first-served, and a slot check that holds BOTH ticks at the gate
    // until both have started: neither can see the other's claim before it makes its own.
    const claimed = new Set<string>();
    mClaim.mockReset().mockImplementation(async (_c, row) => {
      const k = `${row.jobKey}|${row.slot}`;
      if (claimed.has(k)) return false;
      claimed.add(k);
      return true;
    });
    let openGate: () => void = () => {};
    const gate = new Promise<void>((r) => { openGate = r; });
    vi.mocked(slotStatus).mockReset().mockImplementation(async () => { await gate; return "none"; });
    mockRun.mockResolvedValue({ summary: "s", actions: [] });
    await act(async () => {
      renderHook(() => useScheduledJobRunner(baseArgs()));
      renderHook(() => useScheduledJobRunner(baseArgs()));
      await Promise.resolve();
    });
    expect(vi.mocked(slotStatus)).toHaveBeenCalledTimes(2); // both ticks are in flight, before either claims
    expect(mClaim).not.toHaveBeenCalled();
    await act(async () => {
      openGate();
      for (let i = 0; i < 40; i++) await Promise.resolve();
    });
    expect(mClaim).toHaveBeenCalledTimes(2);
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it("job-store writes are dropped when the portfolio switched mid-run (ids collide across portfolios)", async () => {
    let finishAnalysis: (v: { summary: string; actions: [] }) => void = () => {};
    mockRun.mockReturnValue(new Promise((r) => { finishAnalysis = r; }));
    const recordRun = vi.fn();
    const portfolioA = { httpUrl: "https://a.example.test", authToken: "t" } as never;
    const portfolioB = { httpUrl: "https://b.example.test", authToken: "t" } as never;
    const { rerender } = renderHook(
      (p: { config: never }) => useScheduledJobRunner(baseArgs({ config: p.config, recordRun, jobsSource: "https://a.example.test" })),
      { initialProps: { config: portfolioA } },
    );
    await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });
    expect(mockRun).toHaveBeenCalledTimes(1); // the run is in flight on portfolio A
    rerender({ config: portfolioB });
    await act(async () => {
      finishAnalysis({ summary: "s", actions: [] });
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    expect(recordRun).not.toHaveBeenCalled();
  });

  it("an archived-project disable is dropped when the portfolio switched during the finish", async () => {
    vi.mocked(listProjectRefs).mockResolvedValue({ active: [], archived: [{ id: "p1", name: "Apollo" }] });
    let finish: () => void = () => {};
    vi.mocked(finishReport).mockReset().mockReturnValue(new Promise<void>((r) => { finish = r; }));
    const disableJob = vi.fn().mockResolvedValue(undefined);
    const portfolioA = { httpUrl: "https://a.example.test", authToken: "t" } as never;
    const portfolioB = { httpUrl: "https://b.example.test", authToken: "t" } as never;
    const { rerender } = renderHook(
      (p: { config: never }) => useScheduledJobRunner(baseArgs({ config: p.config, disableJob, jobsSource: "https://a.example.test" })),
      { initialProps: { config: portfolioA } },
    );
    await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });
    expect(vi.mocked(finishReport)).toHaveBeenCalledTimes(1);
    rerender({ config: portfolioB });
    await act(async () => { finish(); for (let i = 0; i < 20; i++) await Promise.resolve(); });
    expect(disableJob).not.toHaveBeenCalled();
  });

  it("passes the job's key to the job-store writers on the same portfolio", async () => {
    mockRun.mockResolvedValue({ summary: "s", actions: [] });
    const recordRun = vi.fn();
    await act(async () => {
      renderHook(() => useScheduledJobRunner(baseArgs({ recordRun })));
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    expect(recordRun.mock.calls[0][2]).toBe("job-key-1");
  });

  it("announces a written report on window so the view can reload", async () => {
    mockRun.mockResolvedValue({ summary: "s", actions: [] });
    const heard = vi.fn();
    window.addEventListener("aipm-cockpit:scheduled-report", heard);
    await act(async () => {
      renderHook(() => useScheduledJobRunner(baseArgs()));
      for (let i = 0; i < 40; i++) await Promise.resolve();
    });
    window.removeEventListener("aipm-cockpit:scheduled-report", heard);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("guards overlapping ticks — only one run is in flight", async () => {
    // A slow analysis: resolve manually so we can fire a second tick mid-flight.
    let resolve: (v: { summary: string; actions: [] }) => void = () => {};
    mockRun.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const recordRun = vi.fn();
    let rendered: ReturnType<typeof renderHook> | undefined;
    await act(async () => {
      rendered = renderHook(() => useScheduledJobRunner(baseArgs({ recordRun })));
    });
    // Mount fired tick #1 (in flight, not yet resolved). Fire a second tick via
    // a visibility change while the first is still running.
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(mockRun).toHaveBeenCalledTimes(1);
    // Now let the first run finish.
    await act(async () => {
      resolve({ summary: "done", actions: [] });
      await Promise.resolve();
    });
    expect(mockRun).toHaveBeenCalledTimes(1);
    rendered?.unmount();
  });
});

// §701 — the runner hands `aiRef.current` to the call, so a guide edited after mount
// reaches the next interval tick. Nothing is due at mount; the job turns due with the
// rerender, so the only call is the tick after it, and a runner reading its mount-time
// `args.ai` would send "GUIDE-A".
describe("useScheduledJobRunner — operating guides (§701)", () => {
  beforeEach(() => { mockRun.mockReset(); resetStore(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("a tick sends the latest guide text, not the one it mounted with", async () => {
    mockRun.mockResolvedValue({ summary: "s", actions: [] });
    const { rerender } = renderHook(
      (p: { now: () => Date; guideText: string }) =>
        useScheduledJobRunner(baseArgs({ now: p.now, ai: { apiKey: "k", model: "m", guideText: p.guideText } })),
      { initialProps: { now: earlyMorning, guideText: "GUIDE-A" } },
    );
    await act(async () => { await Promise.resolve(); });
    expect(mockRun).not.toHaveBeenCalled(); // control: not due at mount
    rerender({ now: afternoon, guideText: "GUIDE-B" });
    await act(async () => { vi.advanceTimersByTime(5 * 60 * 1000); for (let i = 0; i < 10; i++) await Promise.resolve(); });
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockRun.mock.calls[0][1].guideText).toBe("GUIDE-B");
    // One due job is one request: caching it would pay the write for nothing.
    expect(mockRun.mock.calls[0][1].cacheGuides).toBe(false);
  });

  it("asks to cache the guide prefix when one tick runs several due jobs", async () => {
    mockRun.mockResolvedValue({ summary: "s", actions: [] });
    renderHook(() => useScheduledJobRunner(baseArgs({ jobs: [dailyJob({ id: 1, key: "k1" }), dailyJob({ id: 2, key: "k2", name: "Second" })] })));
    await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
    expect(mockRun).toHaveBeenCalledTimes(2);
    expect(mockRun.mock.calls.map((c) => c[1].cacheGuides)).toEqual([true, true]);
  });

  // The run on app open waits for the guides, then happens at once — not at
  // the next 5-minute interval.
  // KILLED BY: cacheGuides from `due.length` (the lone real request would pay a cache write nobody reads).
  it("does not cache the guide prefix when only one of two due jobs will really run", async () => {
    vi.mocked(slotStatus).mockReset().mockImplementation(async (_c, key) => (key === "k1" ? "final" : "none"));
    mockRun.mockResolvedValue({ summary: "s", actions: [] });
    renderHook(() => useScheduledJobRunner(baseArgs({ jobs: [dailyJob({ id: 1, key: "k1" }), dailyJob({ id: 2, key: "k2", name: "Second" })] })));
    await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); });
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockRun.mock.calls[0][1].cacheGuides).toBe(false);
  });

  // KILLED BY: removing the lastRunAt guard from the tick's due filter.
  it("does not run a job that already ran for today's slot (a legacy job given its project today)", async () => {
    mockRun.mockResolvedValue({ summary: "s", actions: [] });
    renderHook(() => useScheduledJobRunner(baseArgs({ jobs: [dailyJob({ lastRunAt: "2026-10-23T09:30:00.000Z" })] })));
    await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); });
    expect(mockRun).not.toHaveBeenCalled();
    expect(vi.mocked(slotStatus)).not.toHaveBeenCalled();
  });

  // KILLED BY: judging lastRunAt against the slot instead of the period (an edited, later time would run again).
  it("does not run a job that already ran earlier the same local day, whatever slot it was edited to", async () => {
    mockRun.mockResolvedValue({ summary: "s", actions: [] });
    // The job is at 09:00 UTC; it ran for a 05:00 UTC slot today (an earlier time it has since been edited away from).
    const earlier = { ranAt: "2026-10-23T05:05:00.000Z", summary: "s", actionCount: 0, ok: true, slot: "2026-10-23T05:00:00.000Z" };
    renderHook(() => useScheduledJobRunner(baseArgs({ jobs: [dailyJob({ lastRunAt: earlier.ranAt, history: [earlier] })] })));
    await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); });
    expect(mockRun).not.toHaveBeenCalled();
    expect(vi.mocked(slotStatus)).not.toHaveBeenCalled();
  });

  it("runs a job whose last run was on an earlier local day", async () => {
    mockRun.mockResolvedValue({ summary: "s", actions: [] });
    renderHook(() => useScheduledJobRunner(baseArgs({ jobs: [dailyJob({ lastRunAt: "2026-10-22T23:00:00.000Z" })] })));
    await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); });
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  // KILLED BY: remembering by slot (an edited time would look like a new, unspent slot).
  it("a spent day stays remembered after the job's time is edited later the same day", async () => {
    vi.mocked(slotStatus).mockReset().mockResolvedValue("final");
    const args = baseArgs();
    renderHook(() => useScheduledJobRunner(args));
    await act(async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); });
    expect(vi.mocked(slotStatus)).toHaveBeenCalledTimes(1);
    // The report table is asked about the whole period (UTC midnight for this UTC job), not the slot.
    expect(vi.mocked(slotStatus).mock.calls[0][2]).toBe("2026-10-23T00:00:00.000Z");
    storeState.jobs = [dailyJob({ cadence: { kind: "daily", timeOfDay: "10:00" } })];
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); });
    expect(vi.mocked(slotStatus)).toHaveBeenCalledTimes(1);
  });

  // KILLED BY: removing the `project-missing` exception in the due filter.
  it("a job whose last record is project-missing (no report written) is still due after a new project", async () => {
    mockRun.mockResolvedValue({ summary: "s", actions: [] });
    const missing = { ranAt: "2026-10-23T09:30:00.000Z", summary: "", actionCount: 0, ok: false, error: "project-missing" };
    renderHook(() => useScheduledJobRunner(baseArgs({ jobs: [dailyJob({ lastRunAt: missing.ranAt, history: [missing] })] })));
    await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); });
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  // KILLED BY: not reading the backend's decode diagnostics after the load.
  it.each([
    ["a slice that failed to decode", () => { backendState.failures = ["raid"]; }],
    ["truncated entries", () => { backendState.truncated = { entries: 3, blocks: 0 }; }],
    ["truncated blocks", () => { backendState.truncated = { entries: 0, blocks: 2 }; }],
  ])("the report is marked partial after %s", async (_n, setup) => {
    setup();
    mockRun.mockResolvedValue({ summary: "s", actions: [] });
    renderHook(() => useScheduledJobRunner(baseArgs()));
    await act(async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); });
    expect((vi.mocked(finishReport).mock.calls[0][4] as { partial?: boolean }).partial).toBe(true);
  });

  it("a clean load is not marked partial", async () => {
    mockRun.mockResolvedValue({ summary: "s", actions: [] });
    renderHook(() => useScheduledJobRunner(baseArgs()));
    await act(async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); });
    expect((vi.mocked(finishReport).mock.calls[0][4] as { partial?: boolean }).partial).toBeUndefined();
  });

  it("holds the tick while the guides load, then runs straight away when they arrive", async () => {
    mockRun.mockResolvedValue({ summary: "s", actions: [] });
    const { rerender } = renderHook(
      (p: { guidesReady: boolean }) => useScheduledJobRunner(baseArgs({ guidesReady: p.guidesReady })),
      { initialProps: { guidesReady: false } },
    );
    await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
    expect(mockRun).not.toHaveBeenCalled();
    rerender({ guidesReady: true });
    await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); }); // no timer advance
    expect(mockRun).toHaveBeenCalledTimes(1);
  });
});

// §701 review 7 — the production startup order: the guides (a quick local
// read) are ready BEFORE the AI settings (a sealed key, decrypted async)
// switch the runner on. The first run must follow the switch-on, not wait
// for the 5-minute interval.
describe("useScheduledJobRunner — startup order (§701)", () => {
  beforeEach(() => { mockRun.mockReset(); resetStore(); });
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

  it("runs once the runner is switched on after the guides were already ready", async () => {
    mockRun.mockResolvedValue({ summary: "s", actions: [] });
    const { rerender } = renderHook(
      (p: { enabled: boolean; guidesReady: boolean }) => useScheduledJobRunner(baseArgs(p)),
      { initialProps: { enabled: false, guidesReady: false } },
    );
    await act(flush);
    rerender({ enabled: false, guidesReady: true });
    await act(flush);
    expect(mockRun).not.toHaveBeenCalled(); // still off: the guides-ready tick does nothing
    rerender({ enabled: true, guidesReady: true });
    await act(flush); // no timer advance
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  // The production case: the key and the switch-on arrive in ONE settings
  // commit (both come from the decrypted key). The edge run must send that key,
  // not the empty one from before — a 401 there burns the job's slot.
  it("the switch-on run carries the key and guide text that arrived with it", async () => {
    mockRun.mockResolvedValue({ summary: "s", actions: [] });
    const { rerender } = renderHook(
      (p: { enabled: boolean; apiKey: string; guideText: string }) =>
        useScheduledJobRunner(baseArgs({ enabled: p.enabled, ai: { apiKey: p.apiKey, model: "m", guideText: p.guideText } })),
      { initialProps: { enabled: false, apiKey: "", guideText: "" } },
    );
    await act(flush);
    rerender({ enabled: true, apiKey: "sk-ant-decrypted", guideText: "GUIDE-ARRIVED" });
    await act(flush);
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockRun.mock.calls[0][1].apiKey).toBe("sk-ant-decrypted");
    expect(mockRun.mock.calls[0][1].guideText).toBe("GUIDE-ARRIVED");
  });

  it("the run on the guides-ready edge carries the guide text that arrived with it", async () => {
    mockRun.mockResolvedValue({ summary: "s", actions: [] });
    const { rerender } = renderHook(
      (p: { guidesReady: boolean; guideText: string }) =>
        useScheduledJobRunner(baseArgs({ guidesReady: p.guidesReady, ai: { apiKey: "k", model: "m", guideText: p.guideText } })),
      { initialProps: { guidesReady: false, guideText: "" } },
    );
    await act(flush);
    rerender({ guidesReady: true, guideText: "GUIDE-LOADED" });
    await act(flush);
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockRun.mock.calls[0][1].guideText).toBe("GUIDE-LOADED");
  });
});

describe("useScheduledJobRunner: the period guard judges by the run's slot, not its end (§772 cr4 re-review)", () => {
  const settle = async () => act(async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); });
  beforeEach(() => {
    mockRun.mockReset().mockResolvedValue({ summary: "s", actions: [] });
    resetStore();
  });
  const record = (over: Partial<ScheduledJobRun> & { ranAt: string }): ScheduledJobRun => ({ summary: "s", actionCount: 0, ok: true, ...over });
  const runAt = (jobs: ScheduledJob[], now: string) => {
    renderHook(() => useScheduledJobRunner(baseArgs({ jobs, now: () => new Date(now) })));
    return settle();
  };

  // KILLED BY: judging the END time (lastRunAt) against the period start (a run that ends after local midnight skips the next day).
  it("a daily 23:58 job whose run ended at 00:03 still runs the next day", async () => {
    const rec = record({ ranAt: "2026-10-24T00:03:00.000Z", slot: "2026-10-23T23:58:00.000Z" });
    await runAt([dailyJob({ cadence: { kind: "daily", timeOfDay: "23:58" }, lastRunAt: rec.ranAt, history: [rec] })], "2026-10-24T23:59:00.000Z");
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it("a weekly Sunday 23:58 job whose run ended on Monday at 00:03 still runs the next week", async () => {
    const rec = record({ ranAt: "2026-10-26T00:03:00.000Z", slot: "2026-10-25T23:58:00.000Z" });
    await runAt([dailyJob({ cadence: { kind: "weekly", dayOfWeek: 0, timeOfDay: "23:58" }, lastRunAt: rec.ranAt, history: [rec] })], "2026-11-01T23:59:00.000Z");
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it("a FAILED run that ended after midnight does not skip the next day either", async () => {
    const rec = record({ ok: false, error: "turso", ranAt: "2026-10-24T00:03:00.000Z", slot: "2026-10-23T23:58:00.000Z" });
    await runAt([dailyJob({ cadence: { kind: "daily", timeOfDay: "23:58" }, lastRunAt: rec.ranAt, history: [rec] })], "2026-10-24T23:59:00.000Z");
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it("a run for a slot in the same period still skips it", async () => {
    const rec = record({ ranAt: "2026-10-24T23:50:00.000Z", slot: "2026-10-24T23:40:00.000Z" });
    await runAt([dailyJob({ cadence: { kind: "daily", timeOfDay: "23:58" }, lastRunAt: rec.ranAt, history: [rec] })], "2026-10-24T23:59:00.000Z");
    expect(mockRun).not.toHaveBeenCalled();
  });

  // KILLED BY: dropping the legacy comparison for a record without a slot.
  it("a legacy record without a slot keeps the old comparison: its lastRunAt against the current slot", async () => {
    const legacy = (ranAt: string) => dailyJob({ lastRunAt: ranAt, history: [record({ ranAt })] });
    await runAt([legacy("2026-10-23T09:30:00.000Z")], "2026-10-23T14:00:00.000Z"); // at or after the 09:00 slot: skipped
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("a legacy record from before the slot runs", async () => {
    const ranAt = "2026-10-23T08:59:00.000Z";
    await runAt([dailyJob({ lastRunAt: ranAt, history: [record({ ranAt })] })], "2026-10-23T14:00:00.000Z");
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  // KILLED BY: a period start that assumes local midnight exists (it does not on this day in Santiago).
  it.each([
    ["a record for a slot before the local day began (03:30Z, Santiago's day starts 04:00Z)", "2026-09-06T03:30:00.000Z", 1],
    ["a record for a slot after it began (04:30Z)", "2026-09-06T04:30:00.000Z", 0],
  ])("in America/Santiago on the day its midnight does not exist: %s", async (_n, slot, runs) => {
    const rec = record({ ranAt: slot, slot });
    await runAt([dailyJob({ timeZone: "America/Santiago", lastRunAt: slot, history: [rec] })], "2026-09-06T15:00:00.000Z");
    expect(mockRun).toHaveBeenCalledTimes(runs);
  });
});

describe("useScheduledJobRunner: the weekly hard cap is asked before the claim (AI-03)", () => {
  // KILLED BY: dropping the hook's confirmBackgroundGate wiring (a capped tab would claim the slot, then fail it).
  it("a capped tab neither claims nor analyses", async () => {
    mockRun.mockReset().mockResolvedValue({ summary: "s", actions: [] });
    resetStore();
    publishBackgroundCapState(true);
    renderHook(() => useScheduledJobRunner(baseArgs()));
    await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); });
    expect(mClaim).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
  });
});

describe("useScheduledJobRunner: the deployment is confirmed before the claim", () => {
  // KILLED BY: dropping the hook's confirmDeployment wiring (a tab whose AI is off would claim and fail the slot).
  it("a tab that cannot confirm the AI deployment neither claims nor analyses", async () => {
    mockRun.mockReset().mockResolvedValue({ summary: "s", actions: [] });
    resetStore();
    vi.mocked(confirmAiDeployment).mockRejectedValue(new AiDeploymentError("route-changed"));
    renderHook(() => useScheduledJobRunner(baseArgs()));
    await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); });
    expect(vi.mocked(confirmAiDeployment)).toHaveBeenCalled();
    expect(mClaim).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
  });
});
