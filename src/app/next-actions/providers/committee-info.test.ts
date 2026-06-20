// src/app/next-actions/providers/committee-info.test.ts
import { describe, expect, it } from "vitest";
import { committeeInfoProvider } from "./committee-info";
import type { ActionInput } from "../types";
import type { SteeringCommittee } from "../../types";
import { ACTION_WEIGHTS, scoreAction } from "../score";

const W = ACTION_WEIGHTS;
const TODAY = "2026-06-20";

function input(steeringCommittee?: SteeringCommittee): ActionInput {
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
    commsReminders: [],
    steeringCommittee,
  } as ActionInput;
}

/** A committee with a single future meeting whose info-pack is due `dueDate` away.
 *  leadDays is computed so the pack's working-day-back due date lands on `dueDate`. */
function committee(meetingDate: string, leadDays: number): SteeringCommittee {
  return {
    name: "SteerCo",
    memberResourceIds: [],
    meetings: [{ id: 7, date: meetingDate, title: "Q3 Review" }],
    infoSchedules: [{ id: 4, label: "Board pack", leadDays }],
  };
}

describe("committeeInfoProvider — absent / empty committee", () => {
  it("returns [] when steeringCommittee is undefined", () => {
    expect(committeeInfoProvider.provide(input(undefined))).toEqual([]);
  });

  it("returns [] when the committee has no meetings", () => {
    const c: SteeringCommittee = { name: "X", memberResourceIds: [], meetings: [], infoSchedules: [{ id: 1, label: "Pack", leadDays: 3 }] };
    expect(committeeInfoProvider.provide(input(c))).toEqual([]);
  });
});

describe("committeeInfoProvider — now-tier reminder", () => {
  // Meeting 2026-06-24 (Wed). leadDays 3 working days back -> 2026-06-19 -> daysLeft -1 -> now.
  const acts = committeeInfoProvider.provide(input(committee("2026-06-24", 3)));

  it("emits exactly one action", () => {
    expect(acts).toHaveLength(1);
  });

  it("sets source to 'committee'", () => {
    expect(acts[0].source).toBe("committee");
  });

  it("uses a deep-link cta to the steering-committee view with the meeting id", () => {
    expect(acts[0].cta).toEqual({ kind: "open", view: "steering-committee", id: 7 });
  });

  it("builds a stable id of committee:<meetingId>:<scheduleId>", () => {
    expect(acts[0].id).toBe("committee:7:4");
  });

  it("scores a now reminder with urgencyToday + riskHigh + clarityBonus", () => {
    expect(acts[0].score).toBe(scoreAction({ urgency: W.urgencyToday, risk: W.riskHigh, clarity: W.clarityBonus }));
  });

  it("carries title/why i18n keys (no raw strings)", () => {
    expect(acts[0].title.key).toBe("actionCommitteeInfoTitle");
    expect(acts[0].why.key).toBe("actionCommitteeInfoWhy");
  });
});

describe("committeeInfoProvider — soon vs upcoming", () => {
  it("emits an action for a soon-tier reminder", () => {
    // Meeting 2026-06-30 (Tue). leadDays 3 working days back -> 2026-06-25 (Thu) -> daysLeft 5 -> soon.
    const acts = committeeInfoProvider.provide(input(committee("2026-06-30", 3)));
    expect(acts).toHaveLength(1);
    expect(acts[0].score).toBe(scoreAction({ urgency: W.urgencySoon, risk: W.riskHigh, clarity: W.clarityBonus }));
  });

  it("skips an upcoming-tier reminder", () => {
    // Meeting far out -> due date many days away -> upcoming -> no action.
    const acts = committeeInfoProvider.provide(input(committee("2026-09-30", 3)));
    expect(acts).toEqual([]);
  });
});

describe("committeeInfoProvider — provider metadata", () => {
  it("is a core provider (no moduleId)", () => {
    expect(committeeInfoProvider.moduleId).toBeUndefined();
  });
});
