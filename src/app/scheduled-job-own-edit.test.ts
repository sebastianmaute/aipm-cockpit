import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptanceStateAt, acceptJob, declineJob, jobFingerprint, storedAcceptanceEntry } from "./scheduled-job-acceptance";
import {
  declineShownJob, endOwnEdit, forgetOwnEdit, noteOwnEdit, ownEditAnswered, ownEditTarget, pendingOwnEditVersion, shownAcceptanceState,
} from "./scheduled-job-own-edit";
import type { ScheduledJob } from "./scheduled-jobs/types";

function job(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 1,
    name: "Weekly",
    type: "portfolioAnalysis",
    cadence: { kind: "daily", timeOfDay: "08:00" },
    enabled: true,
    projectId: "p1",
    timeZone: "UTC",
    key: "own-k1",
    instruction: "b",
    lastRunAt: null,
    history: [],
    ...overrides,
  };
}

const edited = job({ instruction: "c" });

describe("ownEditTarget", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => forgetOwnEdit("own-k1"));

  it("is the job's own fingerprint while no own edit is noted", () => {
    acceptJob(edited);
    expect(ownEditTarget(job())).toBe(jobFingerprint(job()));
  });

  it("is the edited version while the entry records it, accepted or stopped", () => {
    noteOwnEdit("own-k1", edited, null, "none");
    acceptJob(edited);
    expect(ownEditTarget(job())).toBe(jobFingerprint(edited));
    declineJob(edited);
    expect(ownEditTarget(job())).toBe(jobFingerprint(edited));
  });

  it("is the edited version while the entry is still what an unanswering edit left", () => {
    acceptJob(job({ instruction: "a" })); // the row reads changed: the edit records nothing
    noteOwnEdit("own-k1", edited, storedAcceptanceEntry("own-k1"), "changed");
    expect(ownEditTarget(job())).toBe(jobFingerprint(edited));
    expect(acceptanceStateAt(job(), ownEditTarget(job()))).toBe("changed");
  });

  it("falls back to the job's own once the entry records another answer", () => {
    noteOwnEdit("own-k1", edited, null, "none");
    declineJob(job()); // the user stopped what the row showed
    expect(ownEditTarget(job())).toBe(jobFingerprint(job()));
  });

  it("a job without a key has only its own fingerprint", () => {
    expect(ownEditTarget(job({ key: null }))).toBe(jobFingerprint(job({ key: null })));
  });

  it("pendingOwnEditVersion is the job as the edit still saving will write it", () => {
    expect(pendingOwnEditVersion(job())).toEqual(job());
    noteOwnEdit("own-k1", edited, null, "none");
    expect(pendingOwnEditVersion(job())).toMatchObject({ projectId: "p1", instruction: "c" });
  });

  it("endOwnEdit clears only the edit it names; forgetOwnEdit clears any", () => {
    acceptJob(edited);
    const older = noteOwnEdit("own-k1", job({ instruction: "older" }), null, "none");
    noteOwnEdit("own-k1", edited, null, "none");
    endOwnEdit("own-k1", older);
    expect(ownEditTarget(job())).toBe(jobFingerprint(edited));
    const same = noteOwnEdit("own-k1", edited, null, "none");
    endOwnEdit("own-k1", same);
    expect(ownEditTarget(job())).toBe(jobFingerprint(job()));
    noteOwnEdit("own-k1", edited, null, "none");
    forgetOwnEdit("own-k1");
    expect(ownEditTarget(job())).toBe(jobFingerprint(job()));
  });
});
describe("shownAcceptanceState and declineShownJob", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => forgetOwnEdit("own-k1"));

  it("shows the state noted at the edit while the entry is what the edit left", () => {
    acceptJob(job({ instruction: "a" }));
    noteOwnEdit("own-k1", job({ instruction: "a" }), storedAcceptanceEntry("own-k1"), "changed");
    expect(acceptanceStateAt(job(), ownEditTarget(job()))).toBe("accepted"); // what the row would flip to
    expect(shownAcceptanceState(job())).toBe("changed");
  });

  it("shows the live state once the entry changes, and without a note", () => {
    expect(shownAcceptanceState(job())).toBe("none");
    noteOwnEdit("own-k1", edited, null, "none");
    acceptJob(edited);
    expect(shownAcceptanceState(job())).toBe("accepted");
  });

  it("declineShownJob stops the version being saved and ends the frozen view even when the entry is unchanged", () => {
    declineJob(edited); // the edit kept a stopped job stopped: the entry already declines the edited version
    const note = noteOwnEdit("own-k1", edited, storedAcceptanceEntry("own-k1"), "declined-changed");
    expect(shownAcceptanceState(job())).toBe("declined-changed");
    expect(declineShownJob(job())).toBe(true);
    expect(ownEditAnswered(note)).toBe(true);
    expect(shownAcceptanceState(job())).toBe("declined");
  });

  it("a decline that cannot be stored leaves the note unanswered", () => {
    const note = noteOwnEdit("own-k1", edited, null, "none");
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(declineShownJob(job())).toBe(false);
    spy.mockRestore();
    expect(ownEditAnswered(note)).toBe(false);
  });
});
