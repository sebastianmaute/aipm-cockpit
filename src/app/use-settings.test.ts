import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ALL_MODULE_IDS } from "./feature-modules";
import { defaultSettings } from "./settings-types";
import { defaultNotificationsConfig } from "./settings-types";
import { coerceLayout, SETTINGS_KEY, useSettings, writeSettings } from "./use-settings";

beforeEach(() => {
  localStorage.clear();
});

describe("useSettings", () => {
  describe("initial state", () => {
    it("settings equals defaultSettings before effects fire", () => {
      const { result } = renderHook(() => useSettings());
      expect(result.current.settings).toEqual(defaultSettings);
    });

    it("defaults resources.workdayHours to 8", () => {
      const { result } = renderHook(() => useSettings());
      expect(result.current.settings.resources.workdayHours).toBe(8);
    });

    it("lang equals settings.language", async () => {
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      expect(result.current.lang).toBe(result.current.settings.language);
    });
  });

  describe("hydration", () => {
    it("hydrated is false initially, true after mount", async () => {
      const { result } = renderHook(() => useSettings());
      expect(result.current.hydrated).toBe(false);
      await act(async () => {});
      expect(result.current.hydrated).toBe(true);
    });

    it("i18nReady is true after mount (en-US resolves synchronously)", async () => {
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      expect(result.current.i18nReady).toBe(true);
    });

    it("loads and merges saved settings from localStorage on mount", async () => {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ ...defaultSettings, language: "en-GB" }),
      );
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      expect(result.current.settings.language).toBe("en-GB");
    });

    it("sanitizes persisted reports.extra (drops junk + dups) on load", async () => {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({
          ...defaultSettings,
          reports: { extra: ["budget-report", "nope", "budget-report"] },
        }),
      );
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      expect(result.current.settings.reports?.extra).toEqual(["budget-report"]);
    });

    it("preserves an explicitly emptied reports.extra (removal sticks)", async () => {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ ...defaultSettings, reports: { extra: [] } }),
      );
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      expect(result.current.settings.reports?.extra).toEqual([]);
    });

    it("legacy settings without a reports key fall back to the default reports", async () => {
      // Persisted blob from before the `reports` key existed.
      const legacy: Record<string, unknown> = { ...defaultSettings };
      delete legacy.reports;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(legacy));
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      expect(result.current.settings.reports?.extra).toEqual([
        "raid-report",
        "budget-report",
      ]);
    });

    it("legacy settings without a features key hydrate to all modules enabled", async () => {
      // Persisted blob from before the `features` key existed (e.g. language-only blob).
      const legacy: Record<string, unknown> = { language: "en-US" };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(legacy));
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      expect(result.current.settings.features).toEqual([...ALL_MODULE_IDS]);
    });
  });

  describe("default reports (real default path)", () => {
    it("defaultSettings.reports.extra is RAID + Budget", () => {
      expect(defaultSettings.reports?.extra).toEqual(["raid-report", "budget-report"]);
    });

    it("a fresh install (empty storage) yields the default RAID + Budget reports", async () => {
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      expect(result.current.settings.reports?.extra).toEqual([
        "raid-report",
        "budget-report",
      ]);
    });
  });

  describe("persistence", () => {
    it("persists settings to localStorage when setSettings is called", async () => {
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      act(() => {
        result.current.setSettings((s) => ({ ...s, language: "en-GB" as const }));
      });
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as {
        language?: string;
      };
      expect(stored.language).toBe("en-GB");
    });
  });
});

describe("notifications defaults", () => {
  it("notifications defaults include RAID review enabled with a 14-day interval", () => {
    expect(defaultNotificationsConfig.raidReview).toEqual({ enabled: true });
    expect(defaultNotificationsConfig.raidReviewIntervalDays).toBe(14);
  });

  it("legacy notifications (no RAID review keys) backfill to enabled + 14 days", async () => {
    const legacy: Record<string, unknown> = {
      ...defaultSettings,
      notifications: {
        reminderLeadDays: 7,
        banner: { enabled: true },
        toast: { enabled: true },
        popup: { enabled: true },
        birthday: { enabled: true },
      },
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(legacy));
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.settings.notifications.raidReview).toEqual({
      enabled: true,
    });
    expect(result.current.settings.notifications.raidReviewIntervalDays).toBe(14);
  });

  it("preserves a disabled RAID review channel + custom interval on load", async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        ...defaultSettings,
        notifications: {
          ...defaultNotificationsConfig,
          raidReview: { enabled: false },
          raidReviewIntervalDays: 30,
        },
      }),
    );
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.settings.notifications.raidReview).toEqual({
      enabled: false,
    });
    expect(result.current.settings.notifications.raidReviewIntervalDays).toBe(30);
  });
});

describe("notifications migration — stakeholderCommsLeadDays", () => {
  it("missing stakeholderCommsLeadDays fills all four quadrants with defaults (14/7/7/3)", async () => {
    const legacy: Record<string, unknown> = {
      ...defaultSettings,
      notifications: {
        ...defaultNotificationsConfig,
        // stakeholderCommsLeadDays deliberately absent
      },
    };
    delete (legacy.notifications as Record<string, unknown>).stakeholderCommsLeadDays;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(legacy));
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.settings.notifications.stakeholderCommsLeadDays).toEqual({
      "manage-closely": 14,
      "keep-satisfied": 7,
      "keep-informed": 7,
      monitor: 3,
    });
  });

  it("valid persisted values are preserved", async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        ...defaultSettings,
        notifications: {
          ...defaultNotificationsConfig,
          stakeholderCommsLeadDays: {
            "manage-closely": 21,
            "keep-satisfied": 10,
            "keep-informed": 5,
            monitor: 1,
          },
        },
      }),
    );
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.settings.notifications.stakeholderCommsLeadDays).toEqual({
      "manage-closely": 21,
      "keep-satisfied": 10,
      "keep-informed": 5,
      monitor: 1,
    });
  });

  it("invalid value for one quadrant falls back to that quadrant's default", async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        ...defaultSettings,
        notifications: {
          ...defaultNotificationsConfig,
          stakeholderCommsLeadDays: {
            "manage-closely": "bad",
            "keep-satisfied": 10,
            "keep-informed": 5,
            monitor: 1,
          },
        },
      }),
    );
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.settings.notifications.stakeholderCommsLeadDays["manage-closely"]).toBe(14);
    expect(result.current.settings.notifications.stakeholderCommsLeadDays["keep-satisfied"]).toBe(10);
  });

  it("value above 365 is clamped to 365", async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        ...defaultSettings,
        notifications: {
          ...defaultNotificationsConfig,
          stakeholderCommsLeadDays: {
            "manage-closely": 999,
            "keep-satisfied": 7,
            "keep-informed": 7,
            monitor: 3,
          },
        },
      }),
    );
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.settings.notifications.stakeholderCommsLeadDays["manage-closely"]).toBe(365);
  });

  it("zero is a valid value (preserved)", async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        ...defaultSettings,
        notifications: {
          ...defaultNotificationsConfig,
          stakeholderCommsLeadDays: {
            "manage-closely": 0,
            "keep-satisfied": 7,
            "keep-informed": 7,
            monitor: 3,
          },
        },
      }),
    );
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.settings.notifications.stakeholderCommsLeadDays["manage-closely"]).toBe(0);
  });
});

describe("layout setting", () => {
  it("defaults to modern", () => {
    expect(defaultSettings.layout).toBe("modern");
  });

  it("coerceLayout keeps valid values and falls back to modern", () => {
    expect(coerceLayout("classic")).toBe("classic");
    expect(coerceLayout("modern")).toBe("modern");
    expect(coerceLayout("bogus")).toBe("modern");
    expect(coerceLayout(undefined)).toBe("modern");
  });
});

describe("features persistence", () => {
  it("defaultSettings enables all modules (Advanced)", () => {
    expect(defaultSettings.features).toEqual([...ALL_MODULE_IDS]);
  });

  it("writeSettings round-trips the features array to localStorage", () => {
    writeSettings({ ...defaultSettings, features: ["raid", "budget"] });
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string).features).toEqual(["raid", "budget"]);
  });
});

describe("notifications migration — per-channel leadDays", () => {
  it("persisted channel leadDays:21 survives migrateNotifications", async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        ...defaultSettings,
        notifications: {
          ...defaultNotificationsConfig,
          toast: { enabled: true, leadDays: 21 },
        },
      }),
    );
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.settings.notifications.toast.leadDays).toBe(21);
  });

  it("invalid leadDays:'x' is omitted (undefined)", async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        ...defaultSettings,
        notifications: {
          ...defaultNotificationsConfig,
          toast: { enabled: true, leadDays: "x" },
        },
      }),
    );
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.settings.notifications.toast.leadDays).toBeUndefined();
  });

  it("negative leadDays is omitted (undefined)", async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        ...defaultSettings,
        notifications: {
          ...defaultNotificationsConfig,
          banner: { enabled: true, leadDays: -3 },
        },
      }),
    );
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.settings.notifications.banner.leadDays).toBeUndefined();
  });

  it("leadDays:0 is preserved (zero is a valid value)", async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        ...defaultSettings,
        notifications: {
          ...defaultNotificationsConfig,
          popup: { enabled: true, leadDays: 0 },
        },
      }),
    );
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.settings.notifications.popup.leadDays).toBe(0);
  });

  it("leadDays above 365 is clamped to 365", async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        ...defaultSettings,
        notifications: {
          ...defaultNotificationsConfig,
          toast: { enabled: true, leadDays: 999 },
        },
      }),
    );
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.settings.notifications.toast.leadDays).toBe(365);
  });
});

describe("notifications migration — useGlobalLeadDays + jiraTokenError", () => {
  it("legacy blob missing useGlobalLeadDays + jiraTokenError fills both to defaults", async () => {
    const legacy: Record<string, unknown> = {
      ...defaultSettings,
      notifications: {
        reminderLeadDays: 7,
        banner: { enabled: true },
        toast: { enabled: true },
        popup: { enabled: true },
        birthday: { enabled: true },
        raidReview: { enabled: true },
        raidReviewIntervalDays: 14,
        stakeholderComms: { enabled: true },
        // useGlobalLeadDays and jiraTokenError deliberately absent
      },
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(legacy));
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.settings.notifications.useGlobalLeadDays).toBe(true);
    expect(result.current.settings.notifications.jiraTokenError).toEqual({ enabled: true });
  });

  it("legacy banner:{enabled:true} WITHOUT toastFirstMigrated is FLIPPED to false by one-time migration", async () => {
    const legacy: Record<string, unknown> = {
      ...defaultSettings,
      notifications: {
        reminderLeadDays: 7,
        banner: { enabled: true },
        toast: { enabled: true },
        popup: { enabled: true },
        birthday: { enabled: true },
        raidReview: { enabled: true },
        raidReviewIntervalDays: 14,
        stakeholderComms: { enabled: true },
        // toastFirstMigrated deliberately absent — pre-0.57 persisted config
      },
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(legacy));
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.settings.notifications.banner.enabled).toBe(false);
  });

  it("legacy popup:{enabled:true} WITHOUT toastFirstMigrated is FLIPPED to false by one-time migration", async () => {
    const legacy: Record<string, unknown> = {
      ...defaultSettings,
      notifications: {
        reminderLeadDays: 7,
        banner: { enabled: false },
        toast: { enabled: true },
        popup: { enabled: true },
        birthday: { enabled: true },
        raidReview: { enabled: true },
        raidReviewIntervalDays: 14,
        stakeholderComms: { enabled: true },
        // toastFirstMigrated deliberately absent — pre-0.57 persisted config
      },
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(legacy));
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.settings.notifications.popup.enabled).toBe(false);
  });
});

describe("notifications migration — toast-first: per-channel leadDays preserved during flip", () => {
  it("banner.leadDays:5 is preserved even though banner.enabled is flipped to false", async () => {
    const legacy: Record<string, unknown> = {
      ...defaultSettings,
      notifications: {
        reminderLeadDays: 7,
        useGlobalLeadDays: true,
        banner: { enabled: true, leadDays: 5 },
        toast: { enabled: false },
        popup: { enabled: true },
        birthday: { enabled: true },
        raidReview: { enabled: true },
        raidReviewIntervalDays: 14,
        stakeholderComms: { enabled: true },
        stakeholderCommsLeadDays: { "manage-closely": 14, "keep-satisfied": 7, "keep-informed": 7, monitor: 3 },
        jiraTokenError: { enabled: true },
        // toastFirstMigrated absent — pre-0.57 persisted config
      },
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(legacy));
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.settings.notifications.banner.enabled).toBe(false);
    expect(result.current.settings.notifications.banner.leadDays).toBe(5);
  });

  it("popup.leadDays:3 is preserved even though popup.enabled is flipped to false", async () => {
    const legacy: Record<string, unknown> = {
      ...defaultSettings,
      notifications: {
        reminderLeadDays: 7,
        useGlobalLeadDays: true,
        banner: { enabled: true },
        toast: { enabled: false },
        popup: { enabled: true, leadDays: 3 },
        birthday: { enabled: true },
        raidReview: { enabled: true },
        raidReviewIntervalDays: 14,
        stakeholderComms: { enabled: true },
        stakeholderCommsLeadDays: { "manage-closely": 14, "keep-satisfied": 7, "keep-informed": 7, monitor: 3 },
        jiraTokenError: { enabled: true },
        // toastFirstMigrated absent
      },
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(legacy));
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.settings.notifications.popup.enabled).toBe(false);
    expect(result.current.settings.notifications.popup.leadDays).toBe(3);
  });
});

describe("notifications migration — no notifications key at all", () => {
  it("blob with no notifications key fires migration → banner=false, popup=false, toast=true, flag=true", async () => {
    // Simulate a very old persisted blob that predates the notifications key entirely.
    const legacy: Record<string, unknown> = { ...defaultSettings };
    delete (legacy as Record<string, unknown>).notifications;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(legacy));
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    const n = result.current.settings.notifications;
    expect(n.banner.enabled).toBe(false);
    expect(n.popup.enabled).toBe(false);
    expect(n.toast.enabled).toBe(true);
    expect(n.toastFirstMigrated).toBe(true);
  });
});

describe("useSettings — toastFirstJustMigrated signal", () => {
  it("is true when loading a legacy blob (no toastFirstMigrated)", async () => {
    const legacy: Record<string, unknown> = {
      ...defaultSettings,
      notifications: {
        ...defaultNotificationsConfig,
        toastFirstMigrated: undefined,
      },
    };
    // Delete the flag so it's truly absent
    delete (legacy.notifications as Record<string, unknown>).toastFirstMigrated;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(legacy));
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.toastFirstJustMigrated).toBe(true);
  });

  it("is false when loading an already-migrated blob (toastFirstMigrated=true)", async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        ...defaultSettings,
        notifications: { ...defaultNotificationsConfig, toastFirstMigrated: true },
      }),
    );
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.toastFirstJustMigrated).toBe(false);
  });

  it("is false for a fresh install (empty localStorage)", async () => {
    // localStorage is cleared in beforeEach — no stored blob at all.
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.toastFirstJustMigrated).toBe(false);
  });
});

describe("notifications migration — toast-first one-time migration", () => {
  it("defaultNotificationsConfig.toastFirstMigrated is true (fresh installs skip migration)", () => {
    expect(defaultNotificationsConfig.toastFirstMigrated).toBe(true);
  });

  it("legacy config without toastFirstMigrated flips banner=false, popup=false, toast=true and sets flag", async () => {
    const legacy: Record<string, unknown> = {
      ...defaultSettings,
      notifications: {
        reminderLeadDays: 7,
        useGlobalLeadDays: true,
        banner: { enabled: true },
        toast: { enabled: false },
        popup: { enabled: true },
        birthday: { enabled: true },
        raidReview: { enabled: true },
        raidReviewIntervalDays: 14,
        stakeholderComms: { enabled: true },
        stakeholderCommsLeadDays: { "manage-closely": 14, "keep-satisfied": 7, "keep-informed": 7, monitor: 3 },
        jiraTokenError: { enabled: true },
        // toastFirstMigrated absent — pre-0.57 persisted config
      },
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(legacy));
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    const n = result.current.settings.notifications;
    expect(n.banner.enabled).toBe(false);
    expect(n.popup.enabled).toBe(false);
    expect(n.toast.enabled).toBe(true);
    expect(n.toastFirstMigrated).toBe(true);
  });

  it("migration preserves other fields: birthday disabled, custom reminderLeadDays, stakeholderComms enabled", async () => {
    const legacy: Record<string, unknown> = {
      ...defaultSettings,
      notifications: {
        reminderLeadDays: 21,
        useGlobalLeadDays: false,
        banner: { enabled: true },
        toast: { enabled: false },
        popup: { enabled: true },
        birthday: { enabled: false },
        raidReview: { enabled: true },
        raidReviewIntervalDays: 30,
        stakeholderComms: { enabled: true },
        stakeholderCommsLeadDays: { "manage-closely": 14, "keep-satisfied": 7, "keep-informed": 7, monitor: 3 },
        jiraTokenError: { enabled: true },
        // toastFirstMigrated absent
      },
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(legacy));
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    const n = result.current.settings.notifications;
    // migration flipped these three
    expect(n.banner.enabled).toBe(false);
    expect(n.popup.enabled).toBe(false);
    expect(n.toast.enabled).toBe(true);
    // everything else preserved
    expect(n.reminderLeadDays).toBe(21);
    expect(n.useGlobalLeadDays).toBe(false);
    expect(n.birthday.enabled).toBe(false);
    expect(n.raidReviewIntervalDays).toBe(30);
    expect(n.stakeholderComms.enabled).toBe(true);
    expect(n.toastFirstMigrated).toBe(true);
  });

  it("already-migrated config (toastFirstMigrated=true) does NOT re-flip banner/popup/toast", async () => {
    const persisted: Record<string, unknown> = {
      ...defaultSettings,
      notifications: {
        reminderLeadDays: 7,
        useGlobalLeadDays: true,
        banner: { enabled: true },
        toast: { enabled: false },
        popup: { enabled: true },
        birthday: { enabled: true },
        raidReview: { enabled: true },
        raidReviewIntervalDays: 14,
        stakeholderComms: { enabled: true },
        stakeholderCommsLeadDays: { "manage-closely": 14, "keep-satisfied": 7, "keep-informed": 7, monitor: 3 },
        jiraTokenError: { enabled: true },
        toastFirstMigrated: true, // already migrated — user manually re-enabled banner/popup
      },
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(persisted));
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    const n = result.current.settings.notifications;
    expect(n.banner.enabled).toBe(true);
    expect(n.popup.enabled).toBe(true);
    expect(n.toast.enabled).toBe(false);
    expect(n.toastFirstMigrated).toBe(true);
  });
});

import { sanitizeTemplates } from "./templates";

describe("settings templates field", () => {
  it("sanitizes a templates array and defaults undefined to []", () => {
    const parsed = JSON.parse(JSON.stringify({ templates: [{ id: "t", name: "T", features: [], fieldVisibility: {} }] }));
    expect(sanitizeTemplates(parsed.templates)).toHaveLength(1);
    expect(sanitizeTemplates(undefined)).toEqual([]);
  });
});
