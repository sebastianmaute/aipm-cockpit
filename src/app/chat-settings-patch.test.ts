import { describe, it, expect } from "vitest";
import { computeSettingsPatch } from "./chat-settings-patch";
import type { Settings } from "./settings-types";
import { TOOL_DEFS } from "./chat-tool-defs";

function baseSettings(): Settings {
  // Minimal shape the function reads. Cast is safe: computeSettingsPatch only
  // touches dashboardDensity, showViewHints, tasksViewMode, hideExternalTasks,
  // features and nextActions.
  return {
    dashboardDensity: "comfortable",
    showViewHints: true,
    tasksViewMode: "table",
    hideExternalTasks: false,
    features: [],
    nextActions: undefined,
  } as unknown as Settings;
}

describe("computeSettingsPatch", () => {
  it("returns empty changes for an empty patch", () => {
    const { changes, applied } = computeSettingsPatch({}, baseSettings());
    expect(changes).toEqual({});
    expect(applied).toEqual({});
  });

  it("accepts a valid dashboardDensity and reports it as applied", () => {
    const { changes, applied } = computeSettingsPatch(
      { dashboardDensity: "compact" },
      baseSettings(),
    );
    expect(changes.dashboardDensity).toBe("compact");
    expect(applied.dashboardDensity).toBe("compact");
  });

  it("ignores an invalid dashboardDensity rather than storing it", () => {
    const { changes, applied } = computeSettingsPatch(
      { dashboardDensity: "cosy" } as never,
      baseSettings(),
    );
    expect(changes).toEqual({});
    expect(applied).toEqual({});
  });

  it("accepts all three tasksViewMode values", () => {
    for (const mode of ["table", "board", "swimlane"] as const) {
      const { applied } = computeSettingsPatch({ tasksViewMode: mode }, baseSettings());
      expect(applied.tasksViewMode).toBe(mode);
    }
  });

  it("drops unknown module ids via sanitizeFeatures", () => {
    const { applied } = computeSettingsPatch(
      { enabledModules: ["budget", "not-a-module"] } as never,
      baseSettings(),
    );
    expect(applied.enabledModules).not.toContain("not-a-module");
  });

  // §779 — a typo in a mixed list silently switched that function off; the model is now told which
  // ids were ignored. Mutation: dropping the `droppedModules` echo turns the first red.
  it("reports the ids a mixed list dropped as droppedModules", () => {
    const { changes, applied } = computeSettingsPatch(
      { enabledModules: ["budget", "raidd", 7] } as never,
      baseSettings(),
    );
    expect(changes.features).toEqual(["budget"]);
    expect(applied.enabledModules).toEqual(["budget"]);
    expect(applied.droppedModules).toEqual(["raidd", "7"]);
  });

  it("adds no droppedModules when every id is known, the legacy documents id included", () => {
    const { applied } = computeSettingsPatch({ enabledModules: ["budget", "documents"] } as never, baseSettings());
    expect(applied).toEqual({ enabledModules: ["budget", "knowledge"] });
  });

  // §779 — the list now persists with the project, so a value that would read as "switch everything off"
  // by accident is refused instead of sanitised to [].
  // Mutation: removing the non-array refusal turns the first red; removing the all-unknown refusal, the second.
  it("refuses a non-array enabledModules", () => {
    for (const bad of ["budget", { budget: true }, null, 3]) {
      expect(() => computeSettingsPatch({ enabledModules: bad } as never, baseSettings())).toThrow(
        "enabledModules must be a list of module ids",
      );
    }
  });

  it("refuses a non-empty list that names no known module, naming what it got", () => {
    expect(() => computeSettingsPatch({ enabledModules: ["Budget", "wiki"] } as never, baseSettings())).toThrow(
      /enabledModules names no known module: Budget, wiki/,
    );
  });

  it("accepts [] as switching every function off (the Simple preset)", () => {
    const { changes, applied } = computeSettingsPatch({ enabledModules: [] } as never, baseSettings());
    expect(changes.features).toEqual([]);
    expect(applied.enabledModules).toEqual([]);
  });

  it("ignores unknown nextActionsWeights keys and applies nothing for them", () => {
    const { changes, applied } = computeSettingsPatch(
      { nextActionsWeights: { bogusKey: 5 } } as never,
      baseSettings(),
    );
    expect(changes.nextActions).toBeUndefined();
    expect(applied.nextActionsWeights).toBeUndefined();
  });

  it("accepts a real nextActionsWeights key and clamps it via its coercer", () => {
    // workloadOverdueThreshold uses intMin1 (settings-types.ts): n must be a
    // finite number >= 1, else it falls back to the current/default value.
    // -10 is out of range, so this asserts the CLAMPED result (3, the
    // default), not the raw input — proving the coercer actually ran rather
    // than the raw value being stored verbatim.
    const { changes, applied } = computeSettingsPatch(
      { nextActionsWeights: { workloadOverdueThreshold: -10 } } as never,
      baseSettings(),
    );
    expect(changes.nextActions?.workloadOverdueThreshold).toBe(3);
    expect(applied.nextActionsWeights).toEqual({ workloadOverdueThreshold: 3 });
  });

  it("accepts showViewHints:false and carries it through changes and applied", () => {
    // Base settings have showViewHints:true, so `false` proves the value is
    // actually carried rather than coincidentally matching the default.
    const { changes, applied } = computeSettingsPatch({ showViewHints: false }, baseSettings());
    expect(changes.showViewHints).toBe(false);
    expect(applied.showViewHints).toBe(false);
  });

  it("ignores a non-boolean showViewHints", () => {
    const { changes, applied } = computeSettingsPatch(
      { showViewHints: "yes" } as never,
      baseSettings(),
    );
    expect(changes).toEqual({});
    expect(applied).toEqual({});
  });

  it("accepts hideExternalTasks:true and carries it through changes and applied", () => {
    // Base settings have hideExternalTasks:false, so `true` proves the value
    // is actually carried rather than coincidentally matching the default.
    const { changes, applied } = computeSettingsPatch({ hideExternalTasks: true }, baseSettings());
    expect(changes.hideExternalTasks).toBe(true);
    expect(applied.hideExternalTasks).toBe(true);
  });

  it("ignores a non-boolean hideExternalTasks", () => {
    const { changes, applied } = computeSettingsPatch(
      { hideExternalTasks: "yes" } as never,
      baseSettings(),
    );
    expect(changes).toEqual({});
    expect(applied).toEqual({});
  });

  it("accepts dashboardDensity:comfortable", () => {
    const { changes, applied } = computeSettingsPatch(
      { dashboardDensity: "comfortable" },
      baseSettings(),
    );
    expect(changes.dashboardDensity).toBe("comfortable");
    expect(applied.dashboardDensity).toBe("comfortable");
  });

  it("ignores an invalid tasksViewMode", () => {
    const { changes, applied } = computeSettingsPatch(
      { tasksViewMode: "list" } as never,
      baseSettings(),
    );
    expect(changes).toEqual({});
    expect(applied).toEqual({});
  });
});

describe("computeSettingsPatch — AI people protection", () => {
  // The protection is a PROJECT override (`settingsOverrides.ai.peopleAllowed`), written only by the
  // Settings → AI control after a confirmation. `update_settings` patches device `Settings` and has no
  // field that reaches it; whatever the model smuggles in is ignored.
  it("cannot store peopleAllowed, however the model spells it", () => {
    const patch = {
      peopleAllowed: true,
      aiPeopleAllowed: true,
      ai: { peopleAllowed: true },
      settingsOverrides: { ai: { peopleAllowed: true } },
      overrides: { ai: { peopleAllowed: true } },
    } as never;
    const { changes, applied } = computeSettingsPatch(patch, baseSettings());
    expect(changes).toEqual({});
    expect(applied).toEqual({});
    expect(JSON.stringify(changes)).not.toContain("peopleAllowed");
  });

  it("the tool schema offers no field for it", () => {
    const def = TOOL_DEFS.find((d) => d.name === "update_settings");
    expect(def).toBeDefined();
    expect(JSON.stringify(def)).not.toMatch(/people|protect/i);
  });

  it("control: a real field in the same patch still applies", () => {
    const { changes } = computeSettingsPatch({ dashboardDensity: "compact", peopleAllowed: true } as never, baseSettings());
    expect(changes).toEqual({ dashboardDensity: "compact" });
  });
});
