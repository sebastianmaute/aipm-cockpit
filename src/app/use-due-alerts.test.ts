import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDueAlerts } from "./use-due-alerts";
import type { Settings } from "./settings-menu";
import type { Task } from "./types";

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
    },
    popout: { reuseWindow: false },
    resources: { workdayHours: 8 },
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
        settings: makeSettings(),
        today: TODAY,
        showToast,
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
        settings: makeSettings({ toastEnabled: true, popupEnabled: true }),
        today: TODAY,
        showToast,
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
        settings: makeSettings({ toastEnabled: true }),
        today: TODAY,
        showToast,
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
        settings: makeSettings({ popupEnabled: true }),
        today: TODAY,
        showToast,
      })
    );
    // Flush microtasks so the deferred setState inside void Promise.resolve().then() executes
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.dueModalOpen).toBe(true);
  });
});
