import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptanceStateAt, acceptJob, declineJob, jobFingerprint, storedAcceptanceEntry } from "./scheduled-job-acceptance";
import { endOwnEdit, forgetOwnEdit, noteOwnEdit, ownEditTarget, pendingOwnEditVersion } from "./scheduled-job-own-edit";
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
    noteOwnEdit("own-k1", edited, null);
    acceptJob(edited);
    expect(ownEditTarget(job())).toBe(jobFingerprint(edited));
    declineJob(edited);
    expect(ownEditTarget(job())).toBe(jobFingerprint(edited));
  });

  it("is the edited version while the entry is still what an unanswering edit left", () => {
    acceptJob(job({ instruction: "a" })); // the row reads changed: the edit records nothing
    noteOwnEdit("own-k1", edited, storedAcceptanceEntry("own-k1"));
    expect(ownEditTarget(job())).toBe(jobFingerprint(edited));
    expect(acceptanceStateAt(job(), ownEditTarget(job()))).toBe("changed");
  });

  it("falls back to the job's own once the entry records another answer", () => {
    noteOwnEdit("own-k1", edited, null);
    declineJob(job()); // the user stopped what the row showed
    expect(ownEditTarget(job())).toBe(jobFingerprint(job()));
  });

  it("a job without a key has only its own fingerprint", () => {
    expect(ownEditTarget(job({ key: null }))).toBe(jobFingerprint(job({ key: null })));
  });

  it("pendingOwnEditVersion is the job as the edit still saving will write it", () => {
    expect(pendingOwnEditVersion(job())).toEqual(job());
    noteOwnEdit("own-k1", edited, null);
    expect(pendingOwnEditVersion(job())).toMatchObject({ projectId: "p1", instruction: "c" });
  });

  it("endOwnEdit clears only the edit it names; forgetOwnEdit clears any", () => {
    acceptJob(edited);
    const older = noteOwnEdit("own-k1", job({ instruction: "older" }), null);
    noteOwnEdit("own-k1", edited, null);
    endOwnEdit("own-k1", older);
    expect(ownEditTarget(job())).toBe(jobFingerprint(edited));
    const same = noteOwnEdit("own-k1", edited, null);
    endOwnEdit("own-k1", same);
    expect(ownEditTarget(job())).toBe(jobFingerprint(job()));
    noteOwnEdit("own-k1", edited, null);
    forgetOwnEdit("own-k1");
    expect(ownEditTarget(job())).toBe(jobFingerprint(job()));
  });
});
