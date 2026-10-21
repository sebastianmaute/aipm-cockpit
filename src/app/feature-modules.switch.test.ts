// §762 — a module whose integration the deployment switched off counts as off,
// while the project's stored module list keeps it.
import { afterEach, describe, expect, it } from "vitest";
import {
  ALL_MODULE_IDS,
  disabledViewRedirect,
  enabledNavViews,
  isModuleEnabled,
  isModuleSwitchedOff,
  isViewEnabled,
} from "./feature-modules";
import { setDisabledIntegrations } from "./integration-switches";

afterEach(() => setDisabledIntegrations([]));

describe("TimeLog switched off by the deployment", () => {
  it("is on as before when nothing is switched off", () => {
    expect(isModuleSwitchedOff("timelog")).toBe(false);
    expect(isModuleEnabled("timelog", ALL_MODULE_IDS)).toBe(true);
    expect(isViewEnabled("timelog", ALL_MODULE_IDS)).toBe(true);
    expect(enabledNavViews(ALL_MODULE_IDS)).toContain("timelog");
  });

  it("is off for the module, its view and the navigation, though the project still lists it", () => {
    setDisabledIntegrations(["timelog"]);
    expect(ALL_MODULE_IDS).toContain("timelog");
    expect(isModuleSwitchedOff("timelog")).toBe(true);
    expect(isModuleEnabled("timelog", ALL_MODULE_IDS)).toBe(false);
    expect(isViewEnabled("timelog", ALL_MODULE_IDS)).toBe(false);
    expect(enabledNavViews(ALL_MODULE_IDS)).not.toContain("timelog");
    expect(disabledViewRedirect("timelog", ALL_MODULE_IDS, "modern", false)).toBe("dashboard");
  });

  it("leaves every other module alone, and other integrations do not touch TimeLog", () => {
    setDisabledIntegrations(["jira", "confluence", "ecb", "stt"]);
    for (const id of ALL_MODULE_IDS) expect(isModuleEnabled(id, ALL_MODULE_IDS)).toBe(true);
    setDisabledIntegrations(["timelog"]);
    for (const id of ALL_MODULE_IDS.filter((m) => m !== "timelog")) expect(isModuleEnabled(id, ALL_MODULE_IDS)).toBe(true);
  });
});
