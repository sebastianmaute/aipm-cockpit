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
