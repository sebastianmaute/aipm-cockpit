import { describe, expect, test } from "vitest";
import { resolveEffectiveSettings } from "./settings-effective";
import { defaultSettings } from "./settings-types";
import type { SettingsOverrides } from "./settings-types";
import type { ProjectAppearancePref } from "./project-appearance-prefs";

describe("resolveEffectiveSettings", () => {
  test("device-only (no override sources) is an identity copy", () => {
    const out = resolveEffectiveSettings(defaultSettings, undefined, undefined);
    expect(out).toEqual(defaultSettings);
  });

  test("does not mutate the device object", () => {
    const before = structuredClone(defaultSettings);
    const policy: SettingsOverrides = {
      nextActions: { scopePendingRed: 99 },
      timezone: { timezone: "Europe/Berlin" },
    };
    const appearance: ProjectAppearancePref = { dashboardDensity: "compact" };
    resolveEffectiveSettings(defaultSettings, policy, appearance);
    expect(defaultSettings).toEqual(before);
  });

  test("nextActions partial merges — overridden field changes, others keep device", () => {
    const policy: SettingsOverrides = { nextActions: { scopePendingRed: 42 } };
    const out = resolveEffectiveSettings(defaultSettings, policy, undefined);
    expect(out.nextActions?.scopePendingRed).toBe(42);
    // an un-overridden field keeps the device value
    expect(out.nextActions?.workloadOverdueThreshold).toBe(
      defaultSettings.nextActions?.workloadOverdueThreshold,
    );
  });

  test("nextActions merge fills a FULL config even when device has none", () => {
    const device = { ...defaultSettings, nextActions: undefined };
    const out = resolveEffectiveSettings(device, { nextActions: { scopePendingRed: 7 } }, undefined);
    expect(out.nextActions?.scopePendingRed).toBe(7);
    // every other field is defaulted (never undefined) — direct field reads stay safe
    expect(out.nextActions?.workloadOverdueThreshold).toBe(
      defaultSettings.nextActions?.workloadOverdueThreshold,
    );
  });

  test("nested notifications channel override merges without dropping sibling channels", () => {
    const policy: SettingsOverrides = { notifications: { birthday: { enabled: false } } };
    const out = resolveEffectiveSettings(defaultSettings, policy, undefined);
    expect(out.notifications.birthday.enabled).toBe(false);
    // an un-overridden channel keeps the device value
    expect(out.notifications.raidReview).toEqual(defaultSettings.notifications.raidReview);
  });

  test("notifications partial merges", () => {
    const policy: SettingsOverrides = { notifications: { reminderLeadDays: 21 } };
    const out = resolveEffectiveSettings(defaultSettings, policy, undefined);
    expect(out.notifications.reminderLeadDays).toBe(21);
    // un-overridden notification field keeps device value
    expect(out.notifications.raidReviewIntervalDays).toBe(
      defaultSettings.notifications.raidReviewIntervalDays,
    );
  });

  test("timezone whole-replaces both fields when the policy provides them", () => {
    const device = {
      ...defaultSettings,
      timezone: "America/New_York",
      additionalTimezones: ["UTC"],
    };
    const policy: SettingsOverrides = {
      timezone: { timezone: "Europe/Berlin", additionalTimezones: ["Asia/Tokyo"] },
    };
    const out = resolveEffectiveSettings(device, policy, undefined);
    expect(out.timezone).toBe("Europe/Berlin");
    expect(out.additionalTimezones).toEqual(["Asia/Tokyo"]);
  });

  test("timezone leaves device fields when the policy omits them", () => {
    const device = { ...defaultSettings, timezone: "America/New_York" };
    const out = resolveEffectiveSettings(device, {}, undefined);
    expect(out.timezone).toBe("America/New_York");
  });

  test("appearance fields whole-replace when set", () => {
    const appearance: ProjectAppearancePref = {
      dashboardDensity: "compact",
      showViewHints: false,
      tasksViewMode: "board",
    };
    const out = resolveEffectiveSettings(defaultSettings, undefined, appearance);
    expect(out.dashboardDensity).toBe("compact");
    expect(out.showViewHints).toBe(false);
    expect(out.tasksViewMode).toBe("board");
  });

  test("appearance does not touch theme/activeSchemeId (not settings-blob fields)", () => {
    const appearance: ProjectAppearancePref = { theme: "dark", activeSchemeId: "u-3" };
    const out = resolveEffectiveSettings(defaultSettings, undefined, appearance);
    // These fields do not exist on Settings; nothing leaks in.
    expect((out as Record<string, unknown>).theme).toBeUndefined();
    expect((out as Record<string, unknown>).activeSchemeId).toBeUndefined();
  });

  test("both sources apply together", () => {
    const policy: SettingsOverrides = {
      nextActions: { scopePendingRed: 3 },
      timezone: { timezone: "Europe/Berlin" },
    };
    const appearance: ProjectAppearancePref = { tasksViewMode: "board" };
    const out = resolveEffectiveSettings(defaultSettings, policy, appearance);
    expect(out.nextActions?.scopePendingRed).toBe(3);
    expect(out.timezone).toBe("Europe/Berlin");
    expect(out.tasksViewMode).toBe("board");
  });
});
