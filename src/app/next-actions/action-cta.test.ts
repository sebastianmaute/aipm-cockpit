import { describe, expect, it } from "vitest";
import { pickPrimaryCta, overflowCtas, type ActionCaps } from "./action-cta";
import type { SuggestedAction } from "./types";

const ALL: ActionCaps = {
  assign: true, draft: true, escalate: true, rebaseline: true, snapshotActive: true,
  reschedule: true, markDone: true, clearBlocker: true, snooze: true, createTask: true,
};
const NONE: ActionCaps = {
  assign: false, draft: false, escalate: false, rebaseline: false, snapshotActive: false,
  reschedule: false, markDone: false, clearBlocker: false, snooze: false, createTask: false,
};
function a(source: string, whyKey: string, view = "open-points"): SuggestedAction {
  return {
    id: `${source}:1:x`, source,
    title: { key: "actionRaidTitle", params: [1, "X"] },
    why: { key: whyKey },
    score: 10, tier: "now", cta: { kind: "open", view, id: 1 },
  } as never;
}

describe("pickPrimaryCta", () => {
  it("assign wins for a no-owner raid", () => {
    expect(pickPrimaryCta(a("raid", "actionRaidWhyNoOwner", "raid"), ALL)).toBe("assign");
  });
  it("assign wins for an unassigned task-attention", () => {
    expect(pickPrimaryCta(a("task-attention", "actionTaskWhyUnassigned"), ALL)).toBe("assign");
  });
  it("clearBlocker for a blocked task-attention", () => {
    expect(pickPrimaryCta(a("task-attention", "actionTaskWhyBlocked"), ALL)).toBe("clearBlocker");
  });
  it("reschedule for an overdue task-due (beats markDone)", () => {
    expect(pickPrimaryCta(a("task-due", "actionTaskWhyOverdue"), ALL)).toBe("reschedule");
  });
  it("rebaseline for an at-risk milestone", () => {
    expect(pickPrimaryCta(a("milestone", "actionMilestoneWhyAtRisk", "milestones"), ALL)).toBe("rebaseline");
  });
  it("rebaseline for a slipping schedule only when snapshotActive", () => {
    expect(pickPrimaryCta(a("schedule", "actionScheduleWhySlipping", "trends"), ALL)).toBe("rebaseline");
    expect(pickPrimaryCta(a("schedule", "actionScheduleWhySlipping", "trends"), { ...ALL, snapshotActive: false })).toBe("open");
  });
  it("escalate for a severity raid", () => {
    expect(pickPrimaryCta(a("raid", "actionRaidWhySeverity", "raid"), ALL)).toBe("escalate");
  });
  it("draft for a task-due when no reschedule bundle (beats markDone)", () => {
    expect(pickPrimaryCta(a("task-due", "actionTaskWhyOverdue"), { ...ALL, reschedule: false })).toBe("draft");
  });
  it("markDone when only markDone applies", () => {
    expect(pickPrimaryCta(a("change-pending", "actionChangeWhyPending"), { ...NONE, markDone: true })).toBe("markDone");
  });
  it("falls back to open with no caps", () => {
    expect(pickPrimaryCta(a("raid", "actionRaidWhySeverity", "raid"), NONE)).toBe("open");
  });
});

describe("overflowCtas", () => {
  it("excludes the promoted primary and lists menu order", () => {
    // task-due overdue, all caps: primary=reschedule; markDone+createTask gated, snooze present.
    // createTask is hidden for task-due; draft is applicable but task-due+draft → draft NOT primary (reschedule is) so it appears.
    const o = overflowCtas(a("task-due", "actionTaskWhyOverdue"), ALL);
    expect(o).toEqual(["markDone", "draft", "snooze"]);
  });
  it("snooze only when wired", () => {
    expect(overflowCtas(a("raid", "actionRaidWhySeverity", "raid"), { ...NONE, snooze: true })).toEqual(["snooze"]);
    expect(overflowCtas(a("raid", "actionRaidWhySeverity", "raid"), NONE)).toEqual([]);
  });
  it("createTask hidden for task-due, shown otherwise", () => {
    expect(overflowCtas(a("raid", "actionRaidWhySeverity", "raid"), { ...NONE, createTask: true })).toEqual(["createTask"]);
    expect(overflowCtas(a("task-due", "actionTaskWhyOverdue"), { ...NONE, createTask: true })).toEqual([]);
  });
});
