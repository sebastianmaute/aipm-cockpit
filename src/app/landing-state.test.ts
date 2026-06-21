import { afterEach, describe, expect, test } from "vitest";
import { loadLandingState, saveLandingState, clearLandingState, LANDING_STATE_MAX_PROJECTS } from "./landing-state";

afterEach(() => clearLandingState());

describe("landing-state", () => {
  test("round-trips a project's state", () => {
    saveLandingState("p1", { lastVisitAt: "2026-06-20T10:00:00.000Z", rag: { overall: "A" } });
    expect(loadLandingState("p1")).toEqual({ lastVisitAt: "2026-06-20T10:00:00.000Z", rag: { overall: "A" } });
  });

  test("absent project → empty object", () => {
    expect(loadLandingState("nope")).toEqual({});
  });

  test("projects are isolated", () => {
    saveLandingState("p1", { lastVisitAt: "2026-06-20T00:00:00.000Z" });
    saveLandingState("p2", { lastVisitAt: "2026-06-21T00:00:00.000Z" });
    expect(loadLandingState("p1").lastVisitAt).toBe("2026-06-20T00:00:00.000Z");
    expect(loadLandingState("p2").lastVisitAt).toBe("2026-06-21T00:00:00.000Z");
  });

  test("caps the map, dropping the oldest by lastVisitAt", () => {
    for (let i = 0; i < LANDING_STATE_MAX_PROJECTS + 5; i++) {
      const n = String(i).padStart(2, "0");
      saveLandingState(`p${n}`, { lastVisitAt: `2026-06-${n}T00:00:00.000Z` });
    }
    expect(loadLandingState("p00")).toEqual({});
    expect(loadLandingState(`p${String(LANDING_STATE_MAX_PROJECTS + 4).padStart(2, "0")}`).lastVisitAt).toBeDefined();
  });

  test("round-trips a metrics snapshot", () => {
    saveLandingState("p1", { lastVisitAt: "2026-06-20T00:00:00.000Z", metrics: { complete: 50, overdue: 2, openRaid: 1 } });
    expect(loadLandingState("p1").metrics).toEqual({ complete: 50, overdue: 2, openRaid: 1 });
  });

  test("rejects a state whose metrics is not an object", () => {
    window.localStorage.setItem("lop-app:landing-state", JSON.stringify({ p1: { lastVisitAt: "x", metrics: 5 } }));
    expect(loadLandingState("p1")).toEqual({});
  });

  test("corrupt JSON → empty object, no throw", () => {
    window.localStorage.setItem("lop-app:landing-state", "{not json");
    expect(loadLandingState("p1")).toEqual({});
  });

  test("non-object stored value → empty object", () => {
    window.localStorage.setItem("lop-app:landing-state", JSON.stringify([1, 2, 3]));
    expect(loadLandingState("p1")).toEqual({});
  });
});
