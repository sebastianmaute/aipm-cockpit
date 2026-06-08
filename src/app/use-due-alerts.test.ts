import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, test, vi } from "vitest";
import { useDueAlerts } from "./use-due-alerts";
import type { Settings } from "./settings-menu";
import type { RaidItem, Task } from "./types";
import { ALL_MODULE_IDS } from "./feature-modules";

const TODAY = "2030-01-15";

const OVERDUE_TASK: Task = {
  id: 1,
  taskName: "Overdue task",
  assignee: "Test User",
  assigneeEmail: "test@example.com",
  dueDate: "2030-01-10",
  priority: "Medium",
  blockers: "",
  notes: "",
  lastUpdateDate: "2030-01-01",
};

function makeSettings(overrides: {
  toastEnabled?: boolean;
  popupEnabled?: boolean;
} = {}): Settings {
  return {
    language: "en-US",
    holidayCountries: [],
    storageConfig: { kind: "browser" },
    ai: {
      apiKey: "",
      model: "claude-sonnet-4-6",
      consentAccepted: false,
    },
    notifications: {
      reminderLeadDays: 7,
      banner: { enabled: true },
      toast: { enabled: overrides.toastEnabled ?? false },
      popup: { enabled: overrides.popupEnabled ?? false },
      birthday: { enabled: false },
      raidReview: { enabled: true },
      raidReviewIntervalDays: 14,
    },
    jira: {
      enabled: false,
      siteUrl: "",
      email: "",
      apiToken: "",
      projectKey: "",
      projectName: "",
      issueTypes: [],
      assigneeMode: "currentUser",
      assigneeAccountId: "",
      assigneeDisplayName: "",
      tokenExpiresAt: "",
    },
    popout: { reuseWindow: false },
    resources: { workdayHours: 8 },
    layout: "modern",
    features: [...ALL_MODULE_IDS],
  };
}

describe("useDueAlerts", () => {
  it("bannerDismissed and dueModalOpen are false initially", () => {
    const showToast = vi.fn();
    const { result } = renderHook(() =>
      useDueAlerts({
        hydrated: false,
        tasks: [],
        holidaySet: new Set(),
        absences: [],
        raid: [],
        settings: makeSettings(),
        today: TODAY,
        showToast,
        raidEnabled: true,
      })
    );
    expect(result.current.bannerDismissed).toBe(false);
    expect(result.current.dueModalOpen).toBe(false);
  });

  it("does NOT fire when hydrated=false", () => {
    const showToast = vi.fn();
    const { result } = renderHook(() =>
      useDueAlerts({
        hydrated: false,
        tasks: [OVERDUE_TASK],
        holidaySet: new Set(),
        absences: [],
        raid: [],
        settings: makeSettings({ toastEnabled: true, popupEnabled: true }),
        today: TODAY,
        showToast,
        raidEnabled: true,
      })
    );
    expect(showToast).not.toHaveBeenCalled();
    expect(result.current.dueModalOpen).toBe(false);
  });

  it("calls showToast once when hydrated=true and toast.enabled=true", async () => {
    const showToast = vi.fn();
    renderHook(() =>
      useDueAlerts({
        hydrated: true,
        tasks: [OVERDUE_TASK],
        holidaySet: new Set(),
        absences: [],
        raid: [],
        settings: makeSettings({ toastEnabled: true }),
        today: TODAY,
        showToast,
        raidEnabled: true,
      })
    );
    // Flush microtasks so the deferred setState inside void Promise.resolve().then() executes
    await act(async () => {
      await Promise.resolve();
    });
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("info", expect.any(String));
  });

  it("sets dueModalOpen=true when hydrated=true and popup.enabled=true", async () => {
    const showToast = vi.fn();
    const { result } = renderHook(() =>
      useDueAlerts({
        hydrated: true,
        tasks: [OVERDUE_TASK],
        holidaySet: new Set(),
        absences: [],
        raid: [],
        settings: makeSettings({ popupEnabled: true }),
        today: TODAY,
        showToast,
        raidEnabled: true,
      })
    );
    // Flush microtasks so the deferred setState inside void Promise.resolve().then() executes
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.dueModalOpen).toBe(true);
  });

  test("fires a RAID-review toast once per session when items exist and toast channel on", async () => {
    const showToast = vi.fn();
    const raid: RaidItem[] = [
      {
        id: 1,
        category: "R",
        title: "Risk",
        status: "Open",
        linkedTaskIds: [],
        causedByRaidIds: [],
        stakeholderIds: [],
        raisedDate: "2026-01-01",
      },
    ];
    renderHook(() =>
      useDueAlerts({
        hydrated: true,
        tasks: [],
        holidaySet: new Set(),
        absences: [],
        raid,
        settings: makeSettings({ toastEnabled: true }),
        today: "2026-06-04",
        showToast,
        raidEnabled: true,
      })
    );
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        "info",
        expect.stringMatching(/RAID review due/i)
      )
    );
  });

  test("does not open the RAID-review modal when the raid module is disabled", async () => {
    const showToast = vi.fn();
    const raid: RaidItem[] = [
      {
        id: 1,
        category: "R",
        title: "Risk",
        status: "Open",
        linkedTaskIds: [],
        causedByRaidIds: [],
        stakeholderIds: [],
        raisedDate: "2026-01-01",
      },
    ];
    const { result } = renderHook(() =>
      useDueAlerts({
        hydrated: true,
        tasks: [],
        holidaySet: new Set(),
        absences: [],
        raid,
        settings: makeSettings({ toastEnabled: true, popupEnabled: true }),
        today: "2026-06-04",
        showToast,
        raidEnabled: false,
      })
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.raidReviewModalOpen).toBe(false);
    expect(showToast).not.toHaveBeenCalled();
  });
});
