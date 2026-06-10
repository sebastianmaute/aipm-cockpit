import { describe, it, expect, beforeEach } from "vitest";
import {
  loadPortfolioMode,
  savePortfolioMode,
  loadCurrentTursoProjectId,
  saveCurrentTursoProjectId,
} from "./portfolio-mode";

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
