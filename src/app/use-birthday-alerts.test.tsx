import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBirthdayAlerts } from "./use-birthday-alerts";
import { defaultSettings } from "./settings-types";
import type { Resource } from "./types";
import type { Settings } from "./settings-types";

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

function makeSettingsWithChannelLeadDays(opts: {
  enabled: boolean;
  useGlobalLeadDays: boolean;
  reminderLeadDays: number;
  birthdayLeadDays?: number;
}): Settings {
  return {
    ...defaultSettings,
    notifications: {
      ...defaultSettings.notifications,
      reminderLeadDays: opts.reminderLeadDays,
      useGlobalLeadDays: opts.useGlobalLeadDays,
      birthday: { enabled: opts.enabled, leadDays: opts.birthdayLeadDays },
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

  it("uses channel-specific leadDays for birthday when useGlobalLeadDays=false", async () => {
    // birthday 10 days away; global=0 would miss it, channel=14 should catch it
    const today = "2026-05-25";
    const resources: Resource[] = [makeResource(1, "06-04")]; // 10 days away
    const showToast = vi.fn();
    const settings = makeSettingsWithChannelLeadDays({
      enabled: true,
      useGlobalLeadDays: false,
      reminderLeadDays: 0,
      birthdayLeadDays: 14,
    });

    renderHook(() =>
      useBirthdayAlerts({ hydrated: true, resources, today, settings, holidaySet: new Set(), absences: [], showToast }),
    );

    await act(async () => { await Promise.resolve(); });

    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("ignores channel leadDays and uses global when useGlobalLeadDays=true", async () => {
    // birthday 10 days away; global=7 misses it even though channel=30
    const today = "2026-05-25";
    const resources: Resource[] = [makeResource(1, "06-04")]; // 10 days away
    const showToast = vi.fn();
    const settings = makeSettingsWithChannelLeadDays({
      enabled: true,
      useGlobalLeadDays: true,
      reminderLeadDays: 7,
      birthdayLeadDays: 30,
    });

    renderHook(() =>
      useBirthdayAlerts({ hydrated: true, resources, today, settings, holidaySet: new Set(), absences: [], showToast }),
    );

    await act(async () => { await Promise.resolve(); });

    expect(showToast).not.toHaveBeenCalled();
  });
});
