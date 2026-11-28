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
  storedFingerprint,
  answerKeysOf,
  pruneAnswers,
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

  it("storedAcceptanceEntry returns the stored hash, null when absent, null when storage throws", () => {
    expect(storedAcceptanceEntry("k1", SCOPE)).toBeNull();
    acceptJob(job(), SCOPE);
    expect(storedAcceptanceEntry("k1", SCOPE)).toBe(storedFingerprint(jobFingerprint(job())));
    declineJob(job(), SCOPE);
    expect(storedAcceptanceEntry("k1", SCOPE)).toBe("declined:" + storedFingerprint(jobFingerprint(job())));
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
    expect(JSON.parse(localStorage.getItem(EDITED_HERE_KEY) ?? "{}")).toEqual({ [`${SCOPE}|k1`]: storedFingerprint(jobFingerprint(job())) });
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

describe("§818: the stores keep a hash, never the instruction, and forget jobs that are gone", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  const SECRET = "Email the board the Q3 numbers";
  const both = (): string => (localStorage.getItem(ACCEPTANCE_KEY) ?? "") + (localStorage.getItem(EDITED_HERE_KEY) ?? "");
  const answers = (): Record<string, string> => JSON.parse(localStorage.getItem(ACCEPTANCE_KEY) ?? "{}");
  const marks = (): Record<string, string> => JSON.parse(localStorage.getItem(EDITED_HERE_KEY) ?? "{}");

  it("storedFingerprint is the SHA-256 of the fingerprint text, hex, with a prefix", () => {
    // NIST FIPS 180-2 test vector for "abc".
    expect(storedFingerprint("abc")).toBe("sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(storedFingerprint("é")).not.toBe(storedFingerprint("e"));
  });

  it("accepting, declining and marking store no instruction text", () => {
    const j = job({ instruction: SECRET });
    acceptJob(j, SCOPE);
    expect(both()).not.toContain("Q3");
    declineJob(j, SCOPE);
    markEditedHere("k1", jobFingerprint(j), SCOPE);
    expect(both()).not.toContain("Q3");
    expect(acceptanceState(j, SCOPE)).toBe("declined");
    expect(isEditedHere(j, SCOPE)).toBe(true);
  });

  it("an answer and a mark written before §818 (the text itself) still count", () => {
    const j = job({ instruction: SECRET });
    localStorage.setItem(ACCEPTANCE_KEY, JSON.stringify({ [`${SCOPE}|k1`]: jobFingerprint(j) }));
    localStorage.setItem(EDITED_HERE_KEY, JSON.stringify({ [`${SCOPE}|k1`]: jobFingerprint(j) }));
    expect(acceptanceState(j, SCOPE)).toBe("accepted");
    expect(isEditedHere(j, SCOPE)).toBe(true);
    expect(acceptanceState(job({ instruction: "other" }), SCOPE)).toBe("changed");
    localStorage.setItem(ACCEPTANCE_KEY, JSON.stringify({ [`${SCOPE}|k1`]: "declined:" + jobFingerprint(j) }));
    expect(acceptanceState(j, SCOPE)).toBe("declined");
  });

  it("pruning forgets this portfolio's answers and marks for jobs the list no longer holds", () => {
    acceptJob(job({ key: "k1" }), SCOPE);
    acceptJob(job({ key: "k2" }), SCOPE);
    markEditedHere("k2", jobFingerprint(job({ key: "k2" })), SCOPE);
    pruneAnswers(SCOPE, new Set(["k1"]), answerKeysOf(SCOPE));
    expect(Object.keys(answers())).toEqual([`${SCOPE}|k1`]);
    expect(marks()).toEqual({});
    expect(acceptanceState(job({ key: "k1" }), SCOPE)).toBe("accepted");
    expect(acceptanceState(job({ key: "k2" }), SCOPE)).toBe("none");
  });

  it("pruning keeps another portfolio's entries, even one whose scope starts with this one's", () => {
    const OTHER = "https://b.example";
    const NESTED = `${SCOPE}|x`;
    acceptJob(job({ key: "k9" }), OTHER);
    acceptJob(job({ key: "k9" }), NESTED);
    pruneAnswers(SCOPE, new Set(["k1"]), answerKeysOf(SCOPE));
    expect(acceptanceState(job({ key: "k9" }), OTHER)).toBe("accepted");
    expect(acceptanceState(job({ key: "k9" }), NESTED)).toBe("accepted");
  });

  it("an answer written while the read was under way is kept, though its job is not in the list", () => {
    const seen = answerKeysOf(SCOPE);
    acceptJob(job({ key: "new" }), SCOPE); // another tab created and accepted it after the read began
    pruneAnswers(SCOPE, new Set(["k1"]), seen);
    expect(acceptanceState(job({ key: "new" }), SCOPE)).toBe("accepted");
  });

  it("pruning rewrites text left by an earlier version as its hash, in every portfolio, and drops unscoped entries", () => {
    const j = job({ instruction: SECRET });
    localStorage.setItem(ACCEPTANCE_KEY, JSON.stringify({
      [`${SCOPE}|k1`]: jobFingerprint(j),
      ["https://b.example|k1"]: "declined:" + jobFingerprint(j),
      k1: jobFingerprint(j),
    }));
    localStorage.setItem(EDITED_HERE_KEY, JSON.stringify({ ["https://b.example|k1"]: jobFingerprint(j) }));
    pruneAnswers(SCOPE, new Set(["k1"]), answerKeysOf(SCOPE));
    expect(both()).not.toContain("Q3");
    expect(answers()).toEqual({
      [`${SCOPE}|k1`]: storedFingerprint(jobFingerprint(j)),
      ["https://b.example|k1"]: "declined:" + storedFingerprint(jobFingerprint(j)),
    });
    expect(acceptanceState(j, SCOPE)).toBe("accepted");
    expect(acceptanceState(j, "https://b.example")).toBe("declined");
    expect(isEditedHere(j, "https://b.example")).toBe(true);
  });

  it("pruning with nothing to change writes nothing", () => {
    const writes = vi.spyOn(Storage.prototype, "setItem");
    pruneAnswers(SCOPE, new Set(["k1"]), answerKeysOf(SCOPE));
    acceptJob(job(), SCOPE);
    writes.mockClear();
    pruneAnswers(SCOPE, new Set(["k1"]), answerKeysOf(SCOPE));
    expect(writes).not.toHaveBeenCalled();
  });

  it("a prune whose write throws leaves the answers as they were", () => {
    acceptJob(job({ key: "k2" }), SCOPE);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(() => pruneAnswers(SCOPE, new Set(["k1"]), answerKeysOf(SCOPE))).not.toThrow();
    expect(acceptanceState(job({ key: "k2" }), SCOPE)).toBe("accepted");
  });
});
