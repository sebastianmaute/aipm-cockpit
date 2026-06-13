import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useStakeholderComms } from "./use-stakeholder-comms";
import { defaultSettings } from "./settings-types";
import type { Settings } from "./settings-types";
import type { Milestone, Stakeholder } from "./types";

const TODAY = "2030-01-15";

// High influence / High interest -> "manage-closely" quadrant, which nudges on
// milestones due within 14 days when the stakeholder is RACI-linked.
const STAKEHOLDER: Stakeholder = {
  id: 1,
  name: "Dana Sponsor",
  category: "Sponsor",
  influence: "High",
  interest: "High",
  raci: { "10": "A" },
};

const DUE_MILESTONE: Milestone = {
  id: 10,
  name: "Go-live",
  date: "2030-01-20", // 5 days out, inside the 14-day lead
  linkedTaskIds: [],
};

function makeSettings(overrides: {
  stakeholderCommsEnabled?: boolean;
} = {}): Settings {
  return {
    ...defaultSettings,
    notifications: {
      ...defaultSettings.notifications,
      stakeholderComms: { enabled: overrides.stakeholderCommsEnabled ?? true },
    },
  };
}

const FLAGS = {
  stakeholdersEnabled: true,
  milestonesEnabled: true,
  raidEnabled: true,
  changesEnabled: true,
};

describe("useStakeholderComms", () => {
  it("computes reminder items when the channel is enabled and a due milestone is RACI-linked", () => {
    const { result } = renderHook(() =>
      useStakeholderComms({
        today: TODAY,
        stakeholders: [STAKEHOLDER],
        milestones: [DUE_MILESTONE],
        raid: [],
        changes: [],
        settings: makeSettings({ stakeholderCommsEnabled: true }),
        flags: FLAGS,
      })
    );
    expect(result.current.items.length).toBeGreaterThan(0);
    expect(result.current.items[0].stakeholderId).toBe(1);
  });

  it("returns no items when the stakeholderComms channel is disabled", () => {
    const { result } = renderHook(() =>
      useStakeholderComms({
        today: TODAY,
        stakeholders: [STAKEHOLDER],
        milestones: [DUE_MILESTONE],
        raid: [],
        changes: [],
        settings: makeSettings({ stakeholderCommsEnabled: false }),
        flags: FLAGS,
      })
    );
    expect(result.current.items).toEqual([]);
  });

  it("returns no items when stakeholders are disabled via flags", () => {
    const { result } = renderHook(() =>
      useStakeholderComms({
        today: TODAY,
        stakeholders: [STAKEHOLDER],
        milestones: [DUE_MILESTONE],
        raid: [],
        changes: [],
        settings: makeSettings({ stakeholderCommsEnabled: true }),
        flags: { ...FLAGS, stakeholdersEnabled: false },
      })
    );
    expect(result.current.items).toEqual([]);
  });
});
