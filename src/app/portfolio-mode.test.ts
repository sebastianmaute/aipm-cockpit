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

describe("portfolio-mode", () => {
  beforeEach(() => window.localStorage.clear());

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
    const originalLocation = window.location;
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });
    commitTursoPortfolioSwitch(defaultSettings, "p1");
    expect(loadPortfolioMode()).toBe("turso");
    expect(loadCurrentTursoProjectId()).toBe("p1");
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
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
