import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loadPortfolioMode,
  savePortfolioMode,
  loadCurrentTursoProjectId,
  saveCurrentTursoProjectId,
  MODE_KEY,
  CURRENT_TURSO_PROJECT_KEY,
} from "./portfolio-mode";
import { __resetSafeModeCache } from "./safe-mode";

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
    window.localStorage.setItem("lop-app:portfolio-mode", "nonsense");
    expect(loadPortfolioMode()).toBe("file");
  });

  it("current turso project id defaults to null and round-trips", () => {
    expect(loadCurrentTursoProjectId()).toBeNull();
    saveCurrentTursoProjectId("p1");
    expect(loadCurrentTursoProjectId()).toBe("p1");
    saveCurrentTursoProjectId(null);
    expect(loadCurrentTursoProjectId()).toBeNull();
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
