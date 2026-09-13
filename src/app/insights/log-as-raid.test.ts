import { describe, expect, it } from "vitest";
import { applyInsightLoggedAsRaid, markInsightLoggedAsRaid } from "./log-as-raid";
import { metricAtActionPatch } from "./outcome";
import type { Insight } from "./insight";

const base: Insight = {
  id: 7, key: "milestoneSlip:42", type: "milestoneSlip", severity: "high",
  entityRef: { view: "milestones", id: 42 }, data: { name: "Kickoff", date: "2026-06-01", daysOverdue: 5 },
  status: "active", firstSeenAt: "2026-06-01", lastSeenAt: "2026-06-10", occurrences: 1,
};

describe("markInsightLoggedAsRaid", () => {
  it("marks acted, stamps actedAt, links the RAID id and captures the baseline like Act", () => {
    const out = markInsightLoggedAsRaid(base, 12, "2026-06-20");
    expect(out).toMatchObject({ status: "acted", actedAt: "2026-06-20", loggedRaidId: 12 });
    expect(out.metricAtAction).toBeDefined();
    expect(out.metricAtAction).toEqual(metricAtActionPatch(base).metricAtAction);
    expect(base.status).toBe("active"); // input not mutated
  });
  it("keeps an existing baseline — the first act wins", () => {
    const acted: Insight = { ...base, status: "acknowledged", metricAtAction: { daysOverdue: 2 } };
    expect(markInsightLoggedAsRaid(acted, 12, "2026-06-20").metricAtAction).toEqual({ daysOverdue: 2 });
  });
});

describe("applyInsightLoggedAsRaid", () => {
  it("marks only the matching insight and leaves the others untouched", () => {
    const other: Insight = { ...base, id: 8, key: "milestoneSlip:43" };
    const out = applyInsightLoggedAsRaid([base, other], 7, 12, "2026-06-20");
    expect(out[0]).toMatchObject({ id: 7, status: "acted", loggedRaidId: 12 });
    expect(out[1]).toBe(other); // positive control above; the non-target is the same reference
  });
  it("treats an unloaded list as empty and ignores an unknown id", () => {
    expect(applyInsightLoggedAsRaid(undefined, 7, 12, "2026-06-20")).toEqual([]);
    const out = applyInsightLoggedAsRaid([base], 99, 12, "2026-06-20");
    expect(out).toEqual([base]);
  });
});
