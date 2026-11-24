import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCEPTANCE_KEY,
  acceptJob,
  acceptanceState,
  forgetJob,
  isAcceptedHere,
  jobFingerprint,
  useAcceptanceSnapshot,
} from "./scheduled-job-acceptance";
import type { ScheduledJob } from "./scheduled-jobs/types";

function job(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 1,
    name: "Weekly",
    type: "portfolioAnalysis",
    cadence: { kind: "daily", timeOfDay: "08:00" },
    enabled: true,
    projectId: "p1",
    timeZone: "Europe/Berlin",
    key: "k1",
    lastRunAt: null,
    history: [],
    ...overrides,
  };
}

describe("scheduled job acceptance", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("a job with no entry is not accepted", () => {
    expect(acceptanceState(job())).toBe("none");
    expect(isAcceptedHere(job())).toBe(false);
  });

  it("accepting records the project and instruction", () => {
    expect(acceptJob(job({ instruction: "a" }))).toBe(true);
    expect(acceptanceState(job({ instruction: "a" }))).toBe("accepted");
  });

  it("a changed project lapses the acceptance", () => {
    acceptJob(job({ projectId: "p1" }));
    expect(acceptanceState(job({ projectId: "p2" }))).toBe("changed");
  });

  it("a changed instruction lapses the acceptance", () => {
    acceptJob(job({ instruction: "a" }));
    expect(acceptanceState(job({ instruction: "b" }))).toBe("changed");
    acceptJob(job());
    expect(acceptanceState(job({ instruction: "a" }))).toBe("changed");
  });

  it("a time change does not lapse it", () => {
    acceptJob(job());
    const moved = job({ cadence: { kind: "daily", timeOfDay: "17:00" }, timeZone: "Asia/Tokyo" });
    expect(acceptanceState(moved)).toBe("accepted");
  });

  it("a legacy or foreign job cannot run and cannot be accepted", () => {
    const legacy = job({ key: null });
    const foreign = job({ foreign: { raw: {} } });
    expect(acceptanceState(legacy)).toBe("cannot-run");
    expect(acceptanceState(foreign)).toBe("cannot-run");
    expect(acceptJob(legacy)).toBe(false);
    expect(acceptJob(foreign)).toBe(false);
    expect(localStorage.getItem(ACCEPTANCE_KEY)).toBeNull();
  });

  it("forgetJob removes the entry", () => {
    acceptJob(job());
    forgetJob("k1");
    expect(acceptanceState(job())).toBe("none");
  });

  it("a write that throws fails closed", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(acceptJob(job())).toBe(false);
    expect(acceptanceState(job())).toBe("none");
  });

  it("another tab's write is seen without a reload", () => {
    localStorage.setItem(ACCEPTANCE_KEY, JSON.stringify({ k1: jobFingerprint(job()) }));
    expect(isAcceptedHere(job())).toBe(true);
  });

  it("corrupt storage reads as nothing accepted", () => {
    for (const raw of ["{not json", "[1]", JSON.stringify({ k1: 5 })]) {
      localStorage.setItem(ACCEPTANCE_KEY, raw);
      expect(acceptanceState(job())).toBe("none");
    }
  });

  it("the snapshot hook re-renders on accept and on a storage event", () => {
    const { result } = renderHook(() => useAcceptanceSnapshot());
    const first = result.current;
    act(() => {
      acceptJob(job());
    });
    const second = result.current;
    expect(second).not.toBe(first);
    act(() => {
      localStorage.setItem(ACCEPTANCE_KEY, "{}");
      window.dispatchEvent(new StorageEvent("storage", { key: ACCEPTANCE_KEY }));
    });
    expect(result.current).not.toBe(second);
  });
});
