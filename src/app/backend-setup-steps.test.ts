// src/app/backend-setup-steps.test.ts
import { describe, it, expect } from "vitest";
import {
  BACKEND_SETUP_STEPS,
  clampStep,
  summarizeBackendSetup,
} from "./backend-setup-steps";
import { defaultSettings } from "./settings-types";
import { defaultTimelogConfig } from "./timelog-types";

// ---------------------------------------------------------------------------
// clampStep
// ---------------------------------------------------------------------------

describe("clampStep", () => {
  it("clamps below zero to zero", () => {
    expect(clampStep(-1, 5)).toBe(0);
  });

  it("clamps above total-1 to total-1", () => {
    expect(clampStep(10, 5)).toBe(4);
  });

  it("returns an in-range index unchanged", () => {
    expect(clampStep(2, 5)).toBe(2);
  });

  it("returns 0 when total is zero", () => {
    expect(clampStep(3, 0)).toBe(0);
  });

  it("returns 0 when total is 1", () => {
    expect(clampStep(0, 1)).toBe(0);
    expect(clampStep(5, 1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// BACKEND_SETUP_STEPS shape
// ---------------------------------------------------------------------------

describe("BACKEND_SETUP_STEPS", () => {
  it("has exactly 5 steps", () => {
    expect(BACKEND_SETUP_STEPS).toHaveLength(5);
  });

  it("step keys are in the expected order", () => {
    expect(BACKEND_SETUP_STEPS.map((s) => s.key)).toEqual([
      "storage",
      "ai",
      "jira",
      "timelog",
      "review",
    ]);
  });

  it("storage step is not skippable", () => {
    expect(BACKEND_SETUP_STEPS[0].skippable).toBe(false);
  });

  it("ai step is skippable", () => {
    expect(BACKEND_SETUP_STEPS[1].skippable).toBe(true);
  });

  it("jira step is skippable", () => {
    expect(BACKEND_SETUP_STEPS[2].skippable).toBe(true);
  });

  it("timelog step is skippable", () => {
    expect(BACKEND_SETUP_STEPS[3].skippable).toBe(true);
  });

  it("review step is not skippable", () => {
    expect(BACKEND_SETUP_STEPS[4].skippable).toBe(false);
  });

  it("every step has a non-empty titleKey", () => {
    for (const step of BACKEND_SETUP_STEPS) {
      expect(step.titleKey).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// summarizeBackendSetup
// ---------------------------------------------------------------------------

describe("summarizeBackendSetup", () => {
  it("returns 4 items (storage, ai, jira, timelog — review is the container)", () => {
    expect(summarizeBackendSetup(defaultSettings)).toHaveLength(4);
  });

  it("storage is always configured (true) with a detailText", () => {
    const items = summarizeBackendSetup(defaultSettings);
    const storage = items.find((i) => i.key === "storage");
    expect(storage?.configured).toBe(true);
    expect(storage?.detailText).toBeTruthy();
  });

  it("storage detailText reflects storageConfig.kind", () => {
    const settings = { ...defaultSettings, storageConfig: { kind: "turso" as const } };
    const items = summarizeBackendSetup(settings);
    const storage = items.find((i) => i.key === "storage");
    expect(storage?.detailText).toBe("turso");
  });

  it("ai is unconfigured when apiKey is absent", () => {
    const items = summarizeBackendSetup(defaultSettings);
    const ai = items.find((i) => i.key === "ai");
    expect(ai?.configured).toBe(false);
  });

  it("ai is configured when apiKey is a non-empty trimmed string", () => {
    const settings = {
      ...defaultSettings,
      ai: { ...defaultSettings.ai, apiKey: "sk-ant-test" },
    };
    const items = summarizeBackendSetup(settings);
    const ai = items.find((i) => i.key === "ai");
    expect(ai?.configured).toBe(true);
  });

  it("ai is unconfigured when apiKey is whitespace only", () => {
    const settings = {
      ...defaultSettings,
      ai: { ...defaultSettings.ai, apiKey: "   " },
    };
    const items = summarizeBackendSetup(settings);
    const ai = items.find((i) => i.key === "ai");
    expect(ai?.configured).toBe(false);
  });

  it("jira is unconfigured by default", () => {
    const items = summarizeBackendSetup(defaultSettings);
    const jira = items.find((i) => i.key === "jira");
    expect(jira?.configured).toBe(false);
  });

  it("jira is configured when jira.enabled is true", () => {
    const settings = {
      ...defaultSettings,
      jira: { ...defaultSettings.jira, enabled: true },
    };
    const items = summarizeBackendSetup(settings);
    const jira = items.find((i) => i.key === "jira");
    expect(jira?.configured).toBe(true);
  });

  it("timelog is unconfigured when timelog is undefined", () => {
    const settings = { ...defaultSettings, timelog: undefined };
    const items = summarizeBackendSetup(settings);
    const timelog = items.find((i) => i.key === "timelog");
    expect(timelog?.configured).toBe(false);
  });

  it("timelog is configured when timelog.enabled is true", () => {
    const settings = {
      ...defaultSettings,
      timelog: { ...defaultTimelogConfig, enabled: true },
    };
    const items = summarizeBackendSetup(settings);
    const timelog = items.find((i) => i.key === "timelog");
    expect(timelog?.configured).toBe(true);
  });
});
