import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useStakeholderComms } from "./use-stakeholder-comms";
import { defaultSettings } from "./settings-menu";
import type { Settings } from "./settings-menu";
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
  toastEnabled?: boolean;
} = {}): Settings {
  return {
    ...defaultSettings,
    notifications: {
      ...defaultSettings.notifications,
      toast: { enabled: overrides.toastEnabled ?? true },
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
  it("fires a toast once when comms reminders exist and channel + toast are enabled", async () => {
    const showToast = vi.fn();
    renderHook(() =>
      useStakeholderComms({
        hydrated: true,
        today: TODAY,
        showToast,
        stakeholders: [STAKEHOLDER],
        milestones: [DUE_MILESTONE],
        raid: [],
        changes: [],
        settings: makeSettings({ toastEnabled: true, stakeholderCommsEnabled: true }),
        flags: FLAGS,
      })
    );
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("info", expect.any(String))
    );
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire when the stakeholderComms channel is disabled", async () => {
    const showToast = vi.fn();
    renderHook(() =>
      useStakeholderComms({
        hydrated: true,
        today: TODAY,
        showToast,
        stakeholders: [STAKEHOLDER],
        milestones: [DUE_MILESTONE],
        raid: [],
        changes: [],
        settings: makeSettings({ toastEnabled: true, stakeholderCommsEnabled: false }),
        flags: FLAGS,
      })
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(showToast).not.toHaveBeenCalled();
  });
});
