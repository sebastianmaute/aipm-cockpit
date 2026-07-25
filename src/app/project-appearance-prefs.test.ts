import { afterEach, describe, expect, test } from "vitest";
import {
  loadProjectAppearance,
  saveProjectAppearance,
  getAppearanceSnapshot,
  subscribeAppearance,
  PROJECT_APPEARANCE_MAX_PROJECTS,
  type ProjectAppearancePref,
} from "./project-appearance-prefs";

const KEY = "aipm-cockpit:project-appearance";
afterEach(() => window.localStorage.removeItem(KEY));

describe("project-appearance-prefs", () => {
  test("absent project → empty object", () => {
    expect(loadProjectAppearance("nope")).toEqual({});
  });

  test("getAppearanceSnapshot is referentially stable until a change", () => {
    const a = getAppearanceSnapshot("rp");
    expect(getAppearanceSnapshot("rp")).toBe(a); // unchanged → same ref
    saveProjectAppearance("rp", { dashboardDensity: "compact" });
    const b = getAppearanceSnapshot("rp");
    expect(b).not.toBe(a);
    expect(b.dashboardDensity).toBe("compact");
  });

  test("subscribeAppearance fires on save and stops after unsubscribe", () => {
    let hits = 0;
    const unsub = subscribeAppearance(() => {
      hits += 1;
    });
    saveProjectAppearance("rp2", { showViewHints: false });
    expect(hits).toBe(1);
    unsub();
    saveProjectAppearance("rp2", { showViewHints: true });
    expect(hits).toBe(1); // no longer notified
  });

  test("round-trips a project's prefs", () => {
    const pref: ProjectAppearancePref = {
      dashboardDensity: "compact",
      theme: "dark",
      activeSchemeId: "u-3",
      showViewHints: false,
      tasksViewMode: "board",
    };
    saveProjectAppearance("p1", pref);
    expect(loadProjectAppearance("p1")).toEqual(pref);
  });

  test("projects are isolated", () => {
    saveProjectAppearance("p1", { dashboardDensity: "compact" });
    saveProjectAppearance("p2", { dashboardDensity: "comfortable" });
    expect(loadProjectAppearance("p1").dashboardDensity).toBe("compact");
    expect(loadProjectAppearance("p2").dashboardDensity).toBe("comfortable");
  });

  test("saving replaces (does not merge) the entry", () => {
    saveProjectAppearance("p1", { dashboardDensity: "compact", theme: "dark" });
    saveProjectAppearance("p1", { theme: "light" });
    expect(loadProjectAppearance("p1")).toEqual({ theme: "light" });
  });

  test("corrupt JSON → empty object, no throw", () => {
    window.localStorage.setItem(KEY, "{not json");
    expect(loadProjectAppearance("p1")).toEqual({});
  });

  test("non-object stored value → empty object", () => {
    window.localStorage.setItem(KEY, JSON.stringify([1, 2, 3]));
    expect(loadProjectAppearance("p1")).toEqual({});
  });

  test("drops invalid enum values on load", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        p1: {
          dashboardDensity: "cozy",
          theme: "midnight",
          tasksViewMode: "grid",
          showViewHints: "yes",
          activeSchemeId: "keep",
        },
      }),
    );
    // Only the valid activeSchemeId survives; all invalid enums/types dropped.
    expect(loadProjectAppearance("p1")).toEqual({ activeSchemeId: "keep" });
  });

  test("drops blank activeSchemeId and trims it", () => {
    saveProjectAppearance("p1", { activeSchemeId: "   " });
    expect(loadProjectAppearance("p1")).toEqual({});
    saveProjectAppearance("p2", { activeSchemeId: "  u-7  " });
    expect(loadProjectAppearance("p2")).toEqual({ activeSchemeId: "u-7" });
  });

  test("swimlane is a valid persisted tasksViewMode", () => {
    saveProjectAppearance("p1", { tasksViewMode: "swimlane" });
    expect(getAppearanceSnapshot("p1").tasksViewMode).toBe("swimlane");
  });

  test("an unknown mode is still dropped", () => {
    saveProjectAppearance("p2", { tasksViewMode: "grid" as never });
    expect(getAppearanceSnapshot("p2").tasksViewMode).toBeUndefined();
  });

  test("caps the map, evicting the oldest inserted entry", () => {
    for (let i = 0; i < PROJECT_APPEARANCE_MAX_PROJECTS + 5; i++) {
      const n = String(i).padStart(2, "0");
      saveProjectAppearance(`p${n}`, { dashboardDensity: "compact" });
    }
    // The first five inserted were evicted.
    expect(loadProjectAppearance("p00")).toEqual({});
    expect(loadProjectAppearance("p04")).toEqual({});
    expect(loadProjectAppearance("p05").dashboardDensity).toBe("compact");
    expect(
      loadProjectAppearance(`p${String(PROJECT_APPEARANCE_MAX_PROJECTS + 4).padStart(2, "0")}`)
        .dashboardDensity,
    ).toBe("compact");
  });
});
