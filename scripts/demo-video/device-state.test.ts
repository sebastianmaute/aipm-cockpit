// @vitest-environment jsdom
// §715 A — the device state a take seeds right after Explore the demo: the Dashboard's "since you last
// looked" record for Friday 18 September, and the digest's prior run. Both are recomputed here through
// the app's own engines, so the fixture cannot drift from what the Dashboard would have saved on Friday.
//
// The strip Monday shows against this seed (asserted in the last test): task 25 "MVP demo to the
// customer" newly overdue (due Friday 18th, so not yet overdue on Friday itself), one RAID item created
// (the GDPR issue, logged at 15:10 on Friday, after the 15:00 visit), and no RAG flip.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeDelta } from "../../src/app/dashboard-delta";
import { loadLandingState } from "../../src/app/landing-state";
import { DIGEST_STATE_KEY, loadDigestState } from "../../src/app/digest/digest-state";
import { buildDemoWorkspace } from "../../src/app/demo-workspace";
import { demoDashboard } from "../../src/test/demo-next-actions";

const here = import.meta.dirname;
const master = JSON.parse(readFileSync(join(here, "..", "..", "sample-workspace-small.json"), "utf8"));
const seed = JSON.parse(readFileSync(join(here, "fixtures", "device-state.json"), "utf8"));
const { landing, digest } = seed;

const ragOf = (m: ReturnType<typeof demoDashboard>) => {
  const all = { overall: m.overall.effective, schedule: m.schedule.effective, budget: m.budget.effective, scope: m.scope.effective };
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v)) as Record<string, string>;
};

describe("the demo week's device state (§715)", () => {
  const friday = demoDashboard(master, "2026-09-18");

  it("the landing seed is Friday's dashboard", () => {
    expect(landing.lastVisitAt).toBe("2026-09-18T15:00:00.000Z");
    expect(landing.rag).toEqual(ragOf(friday));
    expect(landing.metrics).toEqual({ complete: friday.progress.percent, overdue: friday.overdue.length, openRaid: friday.openRaidCount });
  });

  it("the digest seed was run on Friday and is not due before the week ends", () => {
    expect(digest.lastRunAt).toBe("2026-09-18T15:00:00.000Z");
    expect(digest.priorRag).toBe(landing.rag.overall);
    expect(digest.priorMetrics).toEqual({ overdue: landing.metrics.overdue, openRaid: landing.metrics.openRaid });
    expect(Date.parse(digest.nextDueAt)).toBeGreaterThan(Date.parse("2026-09-25T23:59:59+02:00"));
  });

  it("the app accepts both seeds", () => {
    localStorage.setItem("aipm-cockpit:landing-state", JSON.stringify({ p1: landing }));
    expect(loadLandingState("p1")).toEqual(landing);
    localStorage.setItem(DIGEST_STATE_KEY, JSON.stringify({ p1: digest }));
    expect(loadDigestState("p1")).toEqual(digest);
  });

  it("Monday's strip has something to show", () => {
    const monday = demoDashboard(master, "2026-09-21");
    const delta = computeDelta({
      prior: landing,
      activity: buildDemoWorkspace(master, "2026-09-21").activityLog ?? [],
      currentRag: { overall: monday.overall.effective, schedule: monday.schedule.effective, budget: monday.budget.effective, scope: monday.scope.effective },
      overdue: monday.overdue,
      today: "2026-09-21",
    });
    expect(delta.isFirstVisit).toBe(false);
    expect(delta.newOverdue.map((t) => t.taskName)).toEqual(["MVP demo to the customer"]);
    expect(delta.counts.raid.created).toBe(1);
    expect(delta.ragFlips).toEqual([]);
  });
});
