import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptanceScope,
  ACCEPTANCE_KEY,
  EDITED_HERE_KEY,
  acceptJob,
  acceptanceState,
  declineJob,
  forgetJob,
  isAcceptedHere,
  isEditedHere,
  markEditedHere,
  storedAcceptanceEntry,
  jobFingerprint,
  useAcceptanceSnapshot,
} from "./scheduled-job-acceptance";
import type { ScheduledJob } from "./scheduled-jobs/types";

/** The portfolio this file's answers are kept for (`acceptanceScope`). */
const SCOPE = "https://a.example";

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
    expect(acceptanceState(job(), SCOPE)).toBe("none");
    expect(isAcceptedHere(job(), SCOPE)).toBe(false);
  });

  it("accepting records the project and instruction", () => {
    expect(acceptJob(job({ instruction: "a" }), SCOPE)).toBe(true);
    expect(acceptanceState(job({ instruction: "a" }), SCOPE)).toBe("accepted");
  });

  it("a changed project lapses the acceptance", () => {
    acceptJob(job({ projectId: "p1" }), SCOPE);
    expect(acceptanceState(job({ projectId: "p2" }), SCOPE)).toBe("changed");
  });

  it("a changed instruction lapses the acceptance", () => {
    acceptJob(job({ instruction: "a" }), SCOPE);
    expect(acceptanceState(job({ instruction: "b" }), SCOPE)).toBe("changed");
    acceptJob(job(), SCOPE);
    expect(acceptanceState(job({ instruction: "a" }), SCOPE)).toBe("changed");
  });

  it("a time change does not lapse it", () => {
    acceptJob(job(), SCOPE);
    const moved = job({ cadence: { kind: "daily", timeOfDay: "17:00" }, timeZone: "Asia/Tokyo" });
    expect(acceptanceState(moved, SCOPE)).toBe("accepted");
  });

  it("an answer counts only in its own portfolio: a clone with the same key reads none, and runs nothing", () => {
    const OTHER = "https://clone.example";
    expect(acceptJob(job(), SCOPE)).toBe(true);
    expect(acceptanceState(job(), SCOPE)).toBe("accepted");
    expect(acceptanceState(job(), OTHER)).toBe("none");
    expect(isAcceptedHere(job(), OTHER)).toBe(false);
    expect(declineJob(job(), OTHER)).toBe(true);
    expect(acceptanceState(job(), OTHER)).toBe("declined");
    expect(acceptanceState(job(), SCOPE)).toBe("accepted"); // the clone's answer leaves this one alone
    markEditedHere(job().key as string, jobFingerprint(job()), OTHER);
    expect(isEditedHere(job(), SCOPE)).toBe(false);
    forgetJob(job().key as string, OTHER);
    expect(acceptanceState(job(), SCOPE)).toBe("accepted");
  });

  it("an older entry keyed by the job key alone reads as no answer (fails closed)", () => {
    localStorage.setItem(ACCEPTANCE_KEY, JSON.stringify({ [job().key as string]: jobFingerprint(job()) }));
    expect(acceptanceState(job(), SCOPE)).toBe("none");
    expect(isAcceptedHere(job(), SCOPE)).toBe(false);
  });

  it("the local list has a fixed scope of its own", () => {
    expect(acceptanceScope(null)).toBe("local");
    expect(acceptanceScope("https://a.example")).toBe("https://a.example");
  });

  it("a legacy or foreign job cannot run and cannot be accepted", () => {
    const legacy = job({ key: null });
    const foreign = job({ foreign: { raw: {} } });
    expect(acceptanceState(legacy, SCOPE)).toBe("cannot-run");
    expect(acceptanceState(foreign, SCOPE)).toBe("cannot-run");
    expect(acceptJob(legacy, SCOPE)).toBe(false);
    expect(acceptJob(foreign, SCOPE)).toBe(false);
    expect(localStorage.getItem(ACCEPTANCE_KEY)).toBeNull();
  });

  it("a foreign job that keeps its key cannot be answered, even when its earlier version was accepted and edited here", () => {
    acceptJob(job(), SCOPE);
    const before = localStorage.getItem(ACCEPTANCE_KEY);
    const foreign = job({ foreign: { raw: { id: 1, type: "future", key: job().key } } });
    expect(foreign.key).not.toBeNull();
    expect(acceptanceState(foreign, SCOPE)).toBe("cannot-run");
    expect(isAcceptedHere(foreign, SCOPE)).toBe(false);
    expect(acceptJob(foreign, SCOPE)).toBe(false);
    expect(declineJob(foreign, SCOPE)).toBe(false);
    expect(localStorage.getItem(ACCEPTANCE_KEY)).toBe(before);
    markEditedHere(job().key as string, jobFingerprint(foreign), SCOPE);
    expect(isEditedHere(foreign, SCOPE)).toBe(false); // display only, but never about a job this version cannot edit
  });

  it("declining records it: the same job reads declined, never accepted", () => {
    expect(declineJob(job({ instruction: "a" }), SCOPE)).toBe(true);
    expect(acceptanceState(job({ instruction: "a" }), SCOPE)).toBe("declined");
    expect(isAcceptedHere(job({ instruction: "a" }), SCOPE)).toBe(false);
  });

  it("declining a job that cannot run does nothing", () => {
    expect(declineJob(job({ key: null }), SCOPE)).toBe(false);
    expect(declineJob(job({ foreign: { raw: {} } }), SCOPE)).toBe(false);
    expect(localStorage.getItem(ACCEPTANCE_KEY)).toBeNull();
  });

  it("a decline write that throws returns false and leaves the state", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(declineJob(job(), SCOPE)).toBe(false);
    expect(acceptanceState(job(), SCOPE)).toBe("none");
  });

  it("a declined job whose instruction changed reads declined-changed, not changed", () => {
    declineJob(job({ instruction: "a" }), SCOPE);
    expect(acceptanceState(job({ instruction: "b" }), SCOPE)).toBe("declined-changed");
    expect(isAcceptedHere(job({ instruction: "b" }), SCOPE)).toBe(false);
  });

  it("accepting after a decline accepts", () => {
    declineJob(job(), SCOPE);
    acceptJob(job(), SCOPE);
    expect(acceptanceState(job(), SCOPE)).toBe("accepted");
  });

  it("storedAcceptanceEntry returns the raw stored value, null when absent, null when storage throws", () => {
    expect(storedAcceptanceEntry("k1", SCOPE)).toBeNull();
    acceptJob(job(), SCOPE);
    expect(storedAcceptanceEntry("k1", SCOPE)).toBe(jobFingerprint(job()));
    declineJob(job(), SCOPE);
    expect(storedAcceptanceEntry("k1", SCOPE)).toBe("declined:" + jobFingerprint(job()));
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(storedAcceptanceEntry("k1", SCOPE)).toBeNull();
  });

  it("forgetJob removes the entry", () => {
    acceptJob(job(), SCOPE);
    forgetJob("k1", SCOPE);
    expect(acceptanceState(job(), SCOPE)).toBe("none");
  });

  it("a write that throws fails closed", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(acceptJob(job(), SCOPE)).toBe(false);
    expect(acceptanceState(job(), SCOPE)).toBe("none");
  });

  it("another tab's write is seen without a reload", () => {
    localStorage.setItem(ACCEPTANCE_KEY, JSON.stringify({ [`${SCOPE}|k1`]: jobFingerprint(job()) }));
    expect(isAcceptedHere(job(), SCOPE)).toBe(true);
  });

  it("corrupt storage reads as nothing accepted", () => {
    for (const raw of ["{not json", "[1]", JSON.stringify({ k1: 5 })]) {
      localStorage.setItem(ACCEPTANCE_KEY, raw);
      expect(acceptanceState(job(), SCOPE)).toBe("none");
    }
  });

  it("the snapshot hook re-renders on accept and on a storage event", () => {
    const { result } = renderHook(() => useAcceptanceSnapshot());
    const first = result.current;
    act(() => {
      acceptJob(job(), SCOPE);
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

describe("the 'you changed this job' marker", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("lives in localStorage, so a reload (fresh module state) still reads it", async () => {
    markEditedHere("k1", jobFingerprint(job()), SCOPE);
    expect(JSON.parse(localStorage.getItem(EDITED_HERE_KEY) ?? "{}")).toEqual({ [`${SCOPE}|k1`]: jobFingerprint(job()) });
    vi.resetModules();
    const fresh = await import("./scheduled-job-acceptance");
    expect(fresh.isEditedHere(job(), SCOPE)).toBe(true);
    expect(fresh.isEditedHere(job({ instruction: "other" }), SCOPE)).toBe(false);
  });

  it("an answer or a forget clears it", () => {
    markEditedHere("k1", jobFingerprint(job()), SCOPE);
    acceptJob(job(), SCOPE);
    expect(isEditedHere(job(), SCOPE)).toBe(false);
    markEditedHere("k1", jobFingerprint(job()), SCOPE);
    forgetJob("k1", SCOPE);
    expect(isEditedHere(job(), SCOPE)).toBe(false);
  });

  it("storage that throws reads as not edited here, and writing never throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => markEditedHere("k1", jobFingerprint(job()), SCOPE)).not.toThrow();
    expect(isEditedHere(job(), SCOPE)).toBe(false);
  });

  it("corrupt storage reads as not edited here", () => {
    localStorage.setItem(EDITED_HERE_KEY, "{not json");
    expect(isEditedHere(job(), SCOPE)).toBe(false);
  });

  it("the snapshot hook re-renders when another tab writes the marker", () => {
    const { result } = renderHook(() => useAcceptanceSnapshot());
    const first = result.current;
    act(() => {
      localStorage.setItem(EDITED_HERE_KEY, JSON.stringify({ k1: jobFingerprint(job()) }));
      window.dispatchEvent(new StorageEvent("storage", { key: EDITED_HERE_KEY }));
    });
    expect(result.current).not.toBe(first);
  });
});
