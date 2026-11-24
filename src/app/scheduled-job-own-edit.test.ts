import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptJob, declineJob, jobFingerprint } from "./scheduled-job-acceptance";
import { endOwnEdit, forgetOwnEdit, noteOwnEdit, ownEditTarget } from "./scheduled-job-own-edit";
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
    noteOwnEdit("own-k1", jobFingerprint(edited));
    acceptJob(edited);
    expect(ownEditTarget(job())).toBe(jobFingerprint(edited));
    declineJob(edited);
    expect(ownEditTarget(job())).toBe(jobFingerprint(edited));
  });

  it("falls back to the job's own once the entry records another answer", () => {
    noteOwnEdit("own-k1", jobFingerprint(edited));
    declineJob(job()); // the user stopped what the row showed
    expect(ownEditTarget(job())).toBe(jobFingerprint(job()));
  });

  it("a job without a key has only its own fingerprint", () => {
    expect(ownEditTarget(job({ key: null }))).toBe(jobFingerprint(job({ key: null })));
  });

  it("endOwnEdit clears only the edit it names; forgetOwnEdit clears any", () => {
    acceptJob(edited);
    noteOwnEdit("own-k1", jobFingerprint(edited));
    endOwnEdit("own-k1", jobFingerprint(job({ instruction: "older" })));
    expect(ownEditTarget(job())).toBe(jobFingerprint(edited));
    endOwnEdit("own-k1", jobFingerprint(edited));
    expect(ownEditTarget(job())).toBe(jobFingerprint(job()));
    noteOwnEdit("own-k1", jobFingerprint(edited));
    forgetOwnEdit("own-k1");
    expect(ownEditTarget(job())).toBe(jobFingerprint(job()));
  });
});
