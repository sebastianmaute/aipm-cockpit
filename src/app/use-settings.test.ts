import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultSettings } from "./settings-menu";
import { useSettings } from "./use-settings";

const SETTINGS_KEY = "lop-app:settings";

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
