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
  bannerEnabled?: boolean;
  useGlobalLeadDays?: boolean;
  reminderLeadDays?: number;
  toastLeadDays?: number;
  popupLeadDays?: number;
  bannerLeadDays?: number;
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
      reminderLeadDays: overrides.reminderLeadDays ?? 7,
      useGlobalLeadDays: overrides.useGlobalLeadDays ?? true,
      banner: { enabled: overrides.bannerEnabled ?? true, leadDays: overrides.bannerLeadDays },
      toast: { enabled: overrides.toastEnabled ?? false, leadDays: overrides.toastLeadDays },
      popup: { enabled: overrides.popupEnabled ?? false, leadDays: overrides.popupLeadDays },
      birthday: { enabled: false },
      raidReview: { enabled: true },
      raidReviewIntervalDays: 14,
      stakeholderComms: { enabled: true },
      stakeholderCommsLeadDays: { "manage-closely": 14, "keep-satisfied": 7, "keep-informed": 7, monitor: 3 },
      jiraTokenError: { enabled: true },
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

  test("per-channel lead days: toast uses its own leadDays when useGlobalLeadDays=false", async () => {
    // OVERDUE_TASK.dueDate = 2030-01-10, TODAY = 2030-01-15 → 5 days overdue
    // toast leadDays=3 → task is within window (overdue tasks always alert)
    const showToast = vi.fn();
    renderHook(() =>
      useDueAlerts({
        hydrated: true,
        tasks: [OVERDUE_TASK],
        holidaySet: new Set(),
        absences: [],
        raid: [],
        settings: makeSettings({
          toastEnabled: true,
          useGlobalLeadDays: false,
          reminderLeadDays: 0, // global = 0 → would suppress if used
          toastLeadDays: 10,   // channel override → includes overdue task
        }),
        today: TODAY,
        showToast,
        raidEnabled: false,
      })
    );
    await act(async () => { await Promise.resolve(); });
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  test("per-channel lead days: popup uses its own leadDays when useGlobalLeadDays=false", async () => {
    const showToast = vi.fn();
    const { result } = renderHook(() =>
      useDueAlerts({
        hydrated: true,
        tasks: [OVERDUE_TASK],
        holidaySet: new Set(),
        absences: [],
        raid: [],
        settings: makeSettings({
          popupEnabled: true,
          useGlobalLeadDays: false,
          reminderLeadDays: 0,
          popupLeadDays: 10,
        }),
        today: TODAY,
        showToast,
        raidEnabled: false,
      })
    );
    await act(async () => { await Promise.resolve(); });
    expect(result.current.dueModalOpen).toBe(true);
  });

  test("useGlobalLeadDays=true ignores channel leadDays and uses global value", async () => {
    // OVERDUE_TASK due 2030-01-10, TODAY 2030-01-15 (5 days overdue)
    // global=7 covers it; channel=0 would not — but global wins
    const showToast = vi.fn();
    renderHook(() =>
      useDueAlerts({
        hydrated: true,
        tasks: [OVERDUE_TASK],
        holidaySet: new Set(),
        absences: [],
        raid: [],
        settings: makeSettings({
          toastEnabled: true,
          useGlobalLeadDays: true,
          reminderLeadDays: 7,
          toastLeadDays: 0,
        }),
        today: TODAY,
        showToast,
        raidEnabled: false,
      })
    );
    await act(async () => { await Promise.resolve(); });
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  test("toast-first defaults: toast.enabled=true fires even when banner and popup are off", async () => {
    const showToast = vi.fn();
    renderHook(() =>
      useDueAlerts({
        hydrated: true,
        tasks: [OVERDUE_TASK],
        holidaySet: new Set(),
        absences: [],
        raid: [],
        settings: makeSettings({
          toastEnabled: true,
          bannerEnabled: false,
          popupEnabled: false,
        }),
        today: TODAY,
        showToast,
        raidEnabled: false,
      })
    );
    await act(async () => { await Promise.resolve(); });
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("info", expect.any(String));
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
