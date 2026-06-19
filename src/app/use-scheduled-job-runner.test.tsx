import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useScheduledJobRunner, type ScheduledJobRunnerArgs } from "./use-scheduled-job-runner";
import type { ScheduledJob } from "./scheduled-jobs/types";

// The runner calls runJobAnalysis per due job; mock it so no real fetch happens.
vi.mock("./scheduled-job-analysis", () => ({
  runJobAnalysis: vi.fn(),
}));
import { runJobAnalysis } from "./scheduled-job-analysis";
const mockRun = vi.mocked(runJobAnalysis);

// A daily job whose slot is past noon, never run yet → due when `now` is afternoon.
function dailyJob(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 1,
    name: "Daily portfolio",
    type: "portfolioAnalysis",
    cadence: { kind: "daily", timeOfDay: "09:00" },
    enabled: true,
    lastRunAt: null,
    history: [],
    ...overrides,
  };
}

// Local-time afternoon (well past 09:00) so isDue → true for the daily job above.
const afternoon = () => {
  const d = new Date();
  d.setHours(14, 0, 0, 0);
  return d;
};
// Before the 09:00 slot → not due.
const earlyMorning = () => {
  const d = new Date();
  d.setHours(7, 0, 0, 0);
  return d;
};

function baseArgs(overrides: Partial<ScheduledJobRunnerArgs> = {}): ScheduledJobRunnerArgs {
  return {
    enabled: true,
    jobs: [dailyJob()],
    recordRun: vi.fn(),
    buildContext: () => "ctx",
    ai: { apiKey: "k", model: "m" },
    notify: vi.fn(),
    now: afternoon,
    ...overrides,
  };
}

describe("useScheduledJobRunner", () => {
  beforeEach(() => {
    mockRun.mockReset();
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
    expect(notify).toHaveBeenCalledWith("Daily portfolio", "all good");
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

  it("records ok:false with the error message on a failed analysis and does NOT notify", async () => {
    mockRun.mockRejectedValue(new Error("500"));
    const recordRun = vi.fn();
    const notify = vi.fn();
    await act(async () => {
      renderHook(() => useScheduledJobRunner(baseArgs({ recordRun, notify })));
    });
    expect(recordRun).toHaveBeenCalledTimes(1);
    const [, run] = recordRun.mock.calls[0];
    expect(run.ok).toBe(false);
    expect(run.error).toBe("500");
    expect(run.summary).toBe("");
    expect(run.actionCount).toBe(0);
    expect(notify).not.toHaveBeenCalled();
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
