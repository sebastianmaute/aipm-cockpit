import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBirthdayAlerts } from "./use-birthday-alerts";
import { defaultSettings } from "./settings-menu";
import type { Resource } from "./types";
import type { Settings } from "./settings-menu";

function makeResource(id: number, birthday: string): Resource {
  return {
    id,
    firstName: "Test",
    lastName: `User${id}`,
    roleId: null,
    utilizationMode: "percent",
    utilization: {},
    birthday,
  };
}

function makeSettings(enabled: boolean, leadDays: number): Settings {
  return {
    ...defaultSettings,
    notifications: {
      ...defaultSettings.notifications,
      reminderLeadDays: leadDays,
      birthday: { enabled },
    },
  };
}

describe("useBirthdayAlerts", () => {
  it("fires toast once when enabled and an upcoming birthday exists", async () => {
    const today = "2026-05-25";
    // birthday today
    const resources: Resource[] = [makeResource(1, "05-25")];
    const showToast = vi.fn();
    const settings = makeSettings(true, 7);

    const { result } = renderHook(() =>
      useBirthdayAlerts({ hydrated: true, resources, today, settings, holidaySet: new Set(), absences: [], showToast }),
    );

    // flush Promise.resolve microtask
    await act(async () => {
      await Promise.resolve();
    });

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("info", expect.stringContaining("1"));
    expect(result.current.birthdayDismissed).toBe(false);
  });

  it("does NOT fire toast when birthday notifications are disabled", async () => {
    const today = "2026-05-25";
    const resources: Resource[] = [makeResource(1, "05-25")];
    const showToast = vi.fn();
    const settings = makeSettings(false, 7);

    renderHook(() =>
      useBirthdayAlerts({ hydrated: true, resources, today, settings, holidaySet: new Set(), absences: [], showToast }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(showToast).not.toHaveBeenCalled();
  });

  it("does NOT fire toast when no birthdays fall within the lead window", async () => {
    const today = "2026-05-25";
    // birthday 30 days away, but leadDays is only 7
    const resources: Resource[] = [makeResource(1, "06-24")];
    const showToast = vi.fn();
    const settings = makeSettings(true, 7);

    renderHook(() =>
      useBirthdayAlerts({ hydrated: true, resources, today, settings, holidaySet: new Set(), absences: [], showToast }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(showToast).not.toHaveBeenCalled();
  });

  it("does NOT fire toast when hydrated is false", async () => {
    const today = "2026-05-25";
    const resources: Resource[] = [makeResource(1, "05-25")];
    const showToast = vi.fn();
    const settings = makeSettings(true, 7);

    renderHook(() =>
      useBirthdayAlerts({ hydrated: false, resources, today, settings, holidaySet: new Set(), absences: [], showToast }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(showToast).not.toHaveBeenCalled();
  });

  it("exposes setBirthdayDismissed to update dismiss state", async () => {
    const today = "2026-05-25";
    const resources: Resource[] = [makeResource(1, "05-25")];
    const showToast = vi.fn();
    const settings = makeSettings(true, 7);

    const { result } = renderHook(() =>
      useBirthdayAlerts({ hydrated: true, resources, today, settings, holidaySet: new Set(), absences: [], showToast }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.birthdayDismissed).toBe(false);

    act(() => {
      result.current.setBirthdayDismissed(true);
    });

    expect(result.current.birthdayDismissed).toBe(true);
  });
});
