// src/app/next-actions/providers/stakeholder-comms.test.ts
import { describe, expect, it } from "vitest";
import { stakeholderCommsProvider } from "./stakeholder-comms";
import type { ActionInput } from "../types";
import type { StakeholderCommsReminder } from "../../stakeholder-comms";
import { ACTION_WEIGHTS, scoreAction } from "../score";

const TODAY = "2026-06-13";

function input(commsReminders: StakeholderCommsReminder[]): ActionInput {
  return {
    tasks: [],
    raid: [],
    changes: [],
    milestones: [],
    stakeholders: [],
    dashboard: {} as ActionInput["dashboard"],
    features: [],
    today: TODAY,
    now: new Date(`${TODAY}T00:00:00Z`),
    reminderLeadDays: 0,
    dueSoonWorkdays: 3,
    raidReviewIntervalDays: 30,
    dismissed: new Set(),
    projectName: "",
    commsReminders,
  } as ActionInput;
}

function reminder(over: Partial<StakeholderCommsReminder> = {}): StakeholderCommsReminder {
  return {
    stakeholderId: 3,
    stakeholderName: "Acme",
    quadrant: "manage-closely",
    itemKind: "milestone",
    itemId: 9,
    itemTitle: "Phase 1",
    reasonKey: "commsOverdue",
    priority: 1,
    ...over,
  };
}

const EXPECTED_SCORE = scoreAction({ urgency: ACTION_WEIGHTS.urgencySoon, risk: ACTION_WEIGHTS.riskHigh });

describe("stakeholderCommsProvider — single reminder", () => {
  it("maps one reminder to one action with the correct id", () => {
    const acts = stakeholderCommsProvider.provide(input([reminder()]));
    expect(acts).toHaveLength(1);
    expect(acts[0].id).toBe("stakeholder-comms:3:milestone:9");
  });

  it("sets source to 'stakeholder-comms'", () => {
    const acts = stakeholderCommsProvider.provide(input([reminder()]));
    expect(acts[0].source).toBe("stakeholder-comms");
  });

  it("sets moduleId to 'stakeholders'", () => {
    const acts = stakeholderCommsProvider.provide(input([reminder()]));
    expect(acts[0].moduleId).toBe("stakeholders");
  });

  it("sets title with stakeholderName param", () => {
    const acts = stakeholderCommsProvider.provide(input([reminder()]));
    expect(acts[0].title).toEqual({ key: "actionCommsTitle", params: ["Acme"] });
  });

  it("sets why with itemKind param", () => {
    const acts = stakeholderCommsProvider.provide(input([reminder()]));
    expect(acts[0].why).toEqual({ key: "actionCommsWhy", params: ["milestone"] });
  });

  it("sets score to urgencySoon + riskHigh", () => {
    const acts = stakeholderCommsProvider.provide(input([reminder()]));
    expect(acts[0].score).toBe(EXPECTED_SCORE);
  });

  it("sets cta to open stakeholders view with stakeholderId", () => {
    const acts = stakeholderCommsProvider.provide(input([reminder()]));
    expect(acts[0].cta).toEqual({ kind: "open", view: "stakeholders", id: 3 });
  });
});

describe("stakeholderCommsProvider — edge cases", () => {
  it("returns empty array for empty commsReminders", () => {
    expect(stakeholderCommsProvider.provide(input([]))).toEqual([]);
  });

  it("returns two distinct-id actions for two reminders on the same stakeholder with different itemKind/itemId", () => {
    const r1 = reminder({ stakeholderId: 3, stakeholderName: "Acme", itemKind: "milestone", itemId: 9 });
    const r2 = reminder({ stakeholderId: 3, stakeholderName: "Acme", itemKind: "raid", itemId: 5 });
    const acts = stakeholderCommsProvider.provide(input([r1, r2]));
    expect(acts).toHaveLength(2);
    expect(acts[0].id).toBe("stakeholder-comms:3:milestone:9");
    expect(acts[1].id).toBe("stakeholder-comms:3:raid:5");
  });
});

describe("stakeholderCommsProvider — provider metadata", () => {
  it("has moduleId 'stakeholders'", () => {
    expect(stakeholderCommsProvider.moduleId).toBe("stakeholders");
  });
});
