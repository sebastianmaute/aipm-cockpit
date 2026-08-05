import { describe, it, expect } from "vitest";
import { computeSettingsPatch } from "./chat-settings-patch";
import type { Settings } from "./settings-types";

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
