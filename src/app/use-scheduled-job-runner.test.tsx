import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useScheduledJobRunner, type ScheduledJobRunnerArgs } from "./use-scheduled-job-runner";
import type { ScheduledJob } from "./scheduled-jobs/types";

// The runner builds the run deps itself: the AI call, the portfolio lists, the project load and the report
// store are mocked at their module edge, so the REAL runScheduledJob runs in every test below.
vi.mock("./scheduled-job-analysis", () => ({
  runJobAnalysis: vi.fn(),
}));
vi.mock("./turso-portfolio", () => ({
  listProjects: vi.fn(),
  listArchivedProjects: vi.fn(),
}));
vi.mock("./turso-backend", () => ({
  TursoBackend: vi.fn().mockImplementation(function () {
    return { load: async () => emptyWorkspace() };
  }),
}));
vi.mock("./scheduled-reports-store", () => ({
  hasReport: vi.fn(),
  claimReport: vi.fn(),
  releaseClaim: vi.fn(),
  finishReport: vi.fn(),
}));
import { runJobAnalysis } from "./scheduled-job-analysis";
import { listProjects, listArchivedProjects } from "./turso-portfolio";
import { hasReport, claimReport, finishReport } from "./scheduled-reports-store";
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
  return {
    enabled: true,
    guidesReady: true,
    jobs: [dailyJob()],
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
}

function resetStore(): void {
  vi.mocked(hasReport).mockReset().mockResolvedValue(false);
  mClaim.mockReset().mockResolvedValue(true);
  vi.mocked(finishReport).mockReset().mockResolvedValue(undefined);
  vi.mocked(listProjects).mockReset().mockResolvedValue([{ id: "p1", meta: { name: "Apollo" }, archived: false } as never]);
  vi.mocked(listArchivedProjects).mockReset().mockResolvedValue([]);
}

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

  it("two runner instances ticking at once on the same job analyse once", async () => {
    mClaim.mockReset().mockResolvedValueOnce(true).mockResolvedValue(false);
    mockRun.mockResolvedValue({ summary: "s", actions: [] });
    await act(async () => {
      renderHook(() => useScheduledJobRunner(baseArgs()));
      renderHook(() => useScheduledJobRunner(baseArgs()));
      for (let i = 0; i < 40; i++) await Promise.resolve();
    });
    expect(mClaim).toHaveBeenCalledTimes(2);
    expect(mockRun).toHaveBeenCalledTimes(1);
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
