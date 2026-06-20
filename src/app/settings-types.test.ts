import { describe, it, expect } from "vitest";
import { sanitizeAiConfig, defaultAiConfig } from "./settings-types";

describe("sanitizeAiConfig groundInGuides", () => {
  it("defaults groundInGuides to true", () => {
    expect(defaultAiConfig.groundInGuides).toBe(true);
    expect(sanitizeAiConfig({}).groundInGuides).toBe(true);
  });
  it("respects an explicit false", () => {
    expect(sanitizeAiConfig({ groundInGuides: false }).groundInGuides).toBe(false);
  });
});

describe("sanitizeAiConfig suggestAllNextActionThresholds", () => {
  it("defaults to false (opt-in)", () => {
    expect(defaultAiConfig.suggestAllNextActionThresholds).toBeUndefined();
    expect(sanitizeAiConfig({}).suggestAllNextActionThresholds).toBe(false);
  });
  it("coerces to true only for a literal true", () => {
    expect(sanitizeAiConfig({ suggestAllNextActionThresholds: true }).suggestAllNextActionThresholds).toBe(true);
  });
  it("treats non-true truthy values as false", () => {
    expect(sanitizeAiConfig({ suggestAllNextActionThresholds: "x" }).suggestAllNextActionThresholds).toBe(false);
    expect(sanitizeAiConfig({ suggestAllNextActionThresholds: 1 }).suggestAllNextActionThresholds).toBe(false);
  });
});
