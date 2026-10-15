import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadPortfolioMode,
  savePortfolioMode,
  loadCurrentTursoProjectId,
  saveCurrentTursoProjectId,
  commitTursoPortfolioSwitch,
  MODE_KEY,
  CURRENT_TURSO_PROJECT_KEY,
} from "./portfolio-mode";
import { __resetSafeModeCache } from "./safe-mode";
import { defaultSettings } from "./settings-types";
import { SETTINGS_KEY, writeSettings, __resetSettingsReloadSeal } from "./use-settings";

describe("portfolio-mode", () => {
  const originalLocation = window.location;

  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    __resetSettingsReloadSeal();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("defaults to 'file' when nothing is stored", () => {
    expect(loadPortfolioMode()).toBe("file");
  });

  it("round-trips a saved mode", () => {
    savePortfolioMode("turso");
    expect(loadPortfolioMode()).toBe("turso");
  });

  it("coerces an unknown stored value to 'file'", () => {
    window.localStorage.setItem("aipm-cockpit:portfolio-mode", "nonsense");
    expect(loadPortfolioMode()).toBe("file");
  });

  it("current turso project id defaults to null and round-trips", () => {
    expect(loadCurrentTursoProjectId()).toBeNull();
    saveCurrentTursoProjectId("p1");
    expect(loadCurrentTursoProjectId()).toBe("p1");
    saveCurrentTursoProjectId(null);
    expect(loadCurrentTursoProjectId()).toBeNull();
  });

  it("commitTursoPortfolioSwitch persists mode, project id, and storageConfig, then reloads", () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });
    commitTursoPortfolioSwitch(defaultSettings, "p1");
    expect(loadPortfolioMode()).toBe("turso");
    expect(loadCurrentTursoProjectId()).toBe("p1");
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(window.localStorage.getItem(SETTINGS_KEY)!);
    expect(persisted.storageConfig).toEqual({ kind: "turso" });
  });

  // §740 — the reload is asynchronous, and useSettings' persist effect writes the IN-MEMORY
  // settings (still "browser") on any settings change in between. Measured live: 60 ms after the
  // switch wrote "turso", that effect wrote "browser" back, and the reload built a BrowserBackend.
  it("commitTursoPortfolioSwitch: a stale settings write before the reload cannot undo the switch (§740)", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: vi.fn() },
    });
    commitTursoPortfolioSwitch(defaultSettings, "p1");
    expect(writeSettings({ ...defaultSettings, storageConfig: { kind: "browser" } })).toBe(true); // not a failure: no toast
    const persisted = JSON.parse(window.localStorage.getItem(SETTINGS_KEY)!);
    expect(persisted.storageConfig).toEqual({ kind: "turso" });
  });
});

describe("portfolio-mode — safe mode", () => {
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

  it("loadPortfolioMode returns 'file' in safe mode even when 'turso' is stored", () => {
    window.localStorage.setItem(MODE_KEY, "turso");
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/?safe=1");
    expect(loadPortfolioMode()).toBe("file");
    expect(window.localStorage.getItem(MODE_KEY)).toBe("turso");
  });

  it("loadCurrentTursoProjectId returns null in safe mode even when an id is stored", () => {
    window.localStorage.setItem(CURRENT_TURSO_PROJECT_KEY, "p1");
    __resetSafeModeCache();
    window.history.replaceState({}, "", "/?safe=1");
    expect(loadCurrentTursoProjectId()).toBeNull();
    expect(window.localStorage.getItem(CURRENT_TURSO_PROJECT_KEY)).toBe("p1");
  });
});
