import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetSafeModeCache } from "./safe-mode";
import { ALL_MODULE_IDS } from "./feature-modules";
import { defaultSettings } from "./settings-types";
import { defaultNotificationsConfig } from "./settings-types";
import { coerceLayout, migrateNextActionsLearning, migrateNotifications, SETTINGS_KEY, useSettings, writeSettings } from "./use-settings";

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

    it("hideFinishedTasks defaults to false when absent from persisted blob", async () => {
      const legacy: Record<string, unknown> = { ...defaultSettings };
      delete legacy.hideFinishedTasks;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(legacy));
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      expect(result.current.settings.hideFinishedTasks).toBe(false);
    });

    it("hideFinishedTasks coerces non-true values to false", async () => {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ ...defaultSettings, hideFinishedTasks: "yes" }),
      );
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      expect(result.current.settings.hideFinishedTasks).toBe(false);
    });

    it("hideFinishedTasks is true only when persisted strictly true", async () => {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ ...defaultSettings, hideFinishedTasks: true }),
      );
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      expect(result.current.settings.hideFinishedTasks).toBe(true);
    });

    it("defaults tasksViewMode to 'table' when absent from persisted blob", async () => {
      const legacy: Record<string, unknown> = { ...defaultSettings };
      delete legacy.tasksViewMode;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(legacy));
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      expect(result.current.settings.tasksViewMode).toBe("table");
    });

    it("tasksViewMode coerces invalid values to 'table'", async () => {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ ...defaultSettings, tasksViewMode: "garbage" }),
      );
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      expect(result.current.settings.tasksViewMode).toBe("table");
    });

    it("tasksViewMode is 'board' only when persisted strictly 'board'", async () => {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ ...defaultSettings, tasksViewMode: "board" }),
      );
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      expect(result.current.settings.tasksViewMode).toBe("board");
    });

    it("defaults dictation.engine to 'web-speech' when absent from persisted blob", async () => {
      const legacy: Record<string, unknown> = { ...defaultSettings };
      delete legacy.dictation;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(legacy));
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      expect(result.current.settings.dictation).toEqual({ engine: "web-speech", sttApiKey: "" });
    });

    it("dictation.engine coerces an invalid value to 'web-speech'", async () => {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ ...defaultSettings, dictation: { engine: "garbage" } }),
      );
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      expect(result.current.settings.dictation).toEqual({ engine: "web-speech", sttApiKey: "" });
    });

    it("dictation.engine is 'stt' only when persisted strictly 'stt'", async () => {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ ...defaultSettings, dictation: { engine: "stt" } }),
      );
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      expect(result.current.settings.dictation).toEqual({ engine: "stt", sttApiKey: "" });
    });

    it("tourSeen defaults to undefined (auto-launch eligible)", () => {
      expect(defaultSettings.tourSeen).toBeUndefined();
    });

    it("tourSeen round-trips through writeSettings -> load (not stripped by persist)", async () => {
      writeSettings({ ...defaultSettings, tourSeen: true });
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      expect(result.current.settings.tourSeen).toBe(true);
    });

    it("completedTours round-trips and drops non-strings on load", async () => {
      writeSettings({ ...defaultSettings, completedTours: ["raid", "reporting"] });
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      expect(result.current.settings.completedTours).toEqual(["raid", "reporting"]);
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

  describe("same-page sync", () => {
    it("setSettings on one instance propagates to another live instance", async () => {
      const a = renderHook(() => useSettings());
      const b = renderHook(() => useSettings());
      await act(async () => {});
      expect(b.result.current.settings.expertMode).not.toBe(true);
      act(() => {
        a.result.current.setSettings((s) => ({ ...s, expertMode: true }));
      });
      // The change made through instance A reaches instance B without a reload.
      expect(b.result.current.settings.expertMode).toBe(true);
      a.unmount();
      b.unmount();
    });

    it("an unmounted instance no longer receives broadcasts", async () => {
      const a = renderHook(() => useSettings());
      const b = renderHook(() => useSettings());
      await act(async () => {});
      b.unmount();
      // Must not throw / warn about updating an unmounted instance.
      act(() => {
        a.result.current.setSettings((s) => ({ ...s, expertMode: true }));
      });
      expect(a.result.current.settings.expertMode).toBe(true);
      a.unmount();
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
          birthday: { enabled: true, leadDays: 21 },
        },
      }),
    );
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.settings.notifications.birthday.leadDays).toBe(21);
  });

  it("invalid leadDays:'x' is omitted (undefined)", async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        ...defaultSettings,
        notifications: {
          ...defaultNotificationsConfig,
          birthday: { enabled: true, leadDays: "x" },
        },
      }),
    );
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.settings.notifications.birthday.leadDays).toBeUndefined();
  });

  it("negative leadDays is omitted (undefined)", async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        ...defaultSettings,
        notifications: {
          ...defaultNotificationsConfig,
          birthday: { enabled: true, leadDays: -3 },
        },
      }),
    );
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.settings.notifications.birthday.leadDays).toBeUndefined();
  });

  it("leadDays:0 is preserved (zero is a valid value)", async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        ...defaultSettings,
        notifications: {
          ...defaultNotificationsConfig,
          birthday: { enabled: true, leadDays: 0 },
        },
      }),
    );
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.settings.notifications.birthday.leadDays).toBe(0);
  });

  it("leadDays above 365 is clamped to 365", async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        ...defaultSettings,
        notifications: {
          ...defaultNotificationsConfig,
          birthday: { enabled: true, leadDays: 999 },
        },
      }),
    );
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.settings.notifications.birthday.leadDays).toBe(365);
  });
});

describe("notifications migration — useGlobalLeadDays + jiraTokenError", () => {
  it("legacy blob missing useGlobalLeadDays + jiraTokenError fills both to defaults", async () => {
    const legacy: Record<string, unknown> = {
      ...defaultSettings,
      notifications: {
        reminderLeadDays: 7,
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
});

describe("notifications migration — dueSoonWorkdays", () => {
  it("valid persisted dueSoonWorkdays:5 round-trips to 5", async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        ...defaultSettings,
        notifications: { ...defaultNotificationsConfig, dueSoonWorkdays: 5 },
      }),
    );
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.settings.notifications.dueSoonWorkdays).toBe(5);
  });

  it("missing dueSoonWorkdays defaults to 3", async () => {
    const legacy: Record<string, unknown> = {
      ...defaultSettings,
      notifications: { ...defaultNotificationsConfig },
    };
    delete (legacy.notifications as Record<string, unknown>).dueSoonWorkdays;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(legacy));
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.settings.notifications.dueSoonWorkdays).toBe(3);
  });

  it("invalid dueSoonWorkdays (-1) defaults to 3", async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        ...defaultSettings,
        notifications: { ...defaultNotificationsConfig, dueSoonWorkdays: -1 },
      }),
    );
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.settings.notifications.dueSoonWorkdays).toBe(3);
  });

  it("non-numeric dueSoonWorkdays (\"x\") defaults to 3", async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        ...defaultSettings,
        notifications: { ...defaultNotificationsConfig, dueSoonWorkdays: "x" },
      }),
    );
    const { result } = renderHook(() => useSettings());
    await act(async () => {});
    expect(result.current.settings.notifications.dueSoonWorkdays).toBe(3);
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

describe("writeSettings — localStorage quota guard", () => {
  it("does NOT throw when setItem raises QuotaExceededError", () => {
    // Arrange: stub setItem to simulate a full / disabled localStorage.
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });

    try {
      // Act + Assert: a failed persist must degrade gracefully, never throw.
      expect(() => writeSettings(defaultSettings)).not.toThrow();
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("useSettings — safe mode", () => {
  beforeEach(() => {
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/");
    window.localStorage.clear();
  });
  afterEach(() => {
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/");
    window.localStorage.clear();
  });

  it("boots defaults and does NOT read or write SETTINGS_KEY in safe mode", async () => {
    const stored = JSON.stringify({ ...defaultSettings, language: "de" });
    window.localStorage.setItem(SETTINGS_KEY, stored);
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/?safe=1");

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    expect(result.current.settings.language).toBe(defaultSettings.language);
    expect(window.localStorage.getItem(SETTINGS_KEY)).toBe(stored);
  });
});

describe("migrateNotifications desktopUrgent", () => {
  it("defaults desktopUrgent.enabled to false when absent", () => {
    expect(migrateNotifications({}).desktopUrgent).toEqual({ enabled: false });
  });
  it("preserves desktopUrgent.enabled=true when set", () => {
    expect(migrateNotifications({ desktopUrgent: { enabled: true } }).desktopUrgent).toEqual({
      enabled: true,
    });
  });
  it("treats a non-true value as disabled", () => {
    expect(migrateNotifications({ desktopUrgent: { enabled: "yes" } }).desktopUrgent).toEqual({
      enabled: false,
    });
  });
});

describe("migrateNextActionsLearning", () => {
  it("defaults to disabled + local when absent", () => {
    expect(migrateNextActionsLearning(undefined)).toEqual({ enabled: false, store: "local" });
  });
  it("coerces store to the union, else local", () => {
    expect(migrateNextActionsLearning({ enabled: true, store: "turso" })).toEqual({ enabled: true, store: "turso" });
    expect(migrateNextActionsLearning({ enabled: "yes", store: "cloud" })).toEqual({ enabled: false, store: "local" });
  });
});
