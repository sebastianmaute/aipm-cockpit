import { describe, it, expect } from "vitest";
import { contrastRatio, checkSchemePairs } from "./scheme-contrast";

describe("scheme-contrast", () => {
  it("black/white is ~21 and equal colors are 1", () => {
    expect(Math.round(contrastRatio("#000000", "#ffffff"))).toBe(21);
    expect(contrastRatio("#123456", "#123456")).toBeCloseTo(1, 5);
  });

  it("flags a sub-AA text/background pair", () => {
    const pairs = checkSchemePairs({ "--foreground": "#bbbbbb", "--background": "#ffffff" });
    const textPair = pairs.find((p) => p.id === "text-bg");
    expect(textPair).toBeDefined();
    expect(textPair!.passesAa).toBe(false);
  });

  it("passes a high-contrast text/background pair", () => {
    const pairs = checkSchemePairs({ "--foreground": "#222222", "--background": "#ffffff" });
    const textPair = pairs.find((p) => p.id === "text-bg");
    expect(textPair!.passesAa).toBe(true);
  });
});
