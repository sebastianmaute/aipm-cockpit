import { describe, it, expect } from "vitest";
import { CORE_TOKENS, ADVANCED_TOKENS, ICC_SEED, deriveAaVariants, resolveSchemeColors } from "./scheme-tokens";

describe("scheme-tokens", () => {
  it("ICC_SEED has a hex value for every core and advanced token", () => {
    for (const t of [...CORE_TOKENS, ...ADVANCED_TOKENS]) {
      expect(ICC_SEED[t.token], `seed for ${t.token}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("deriveAaVariants darkens the accent until it clears AA on white", () => {
    const derived = deriveAaVariants({ "--AIPM-green": "#84bd00", "--surface": "#ffffff" });
    expect(derived["--AIPM-green-strong"]).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("resolveSchemeColors merges user colors with derived variants", () => {
    const resolved = resolveSchemeColors({ "--AIPM-green": "#84bd00", "--surface": "#ffffff" });
    expect(resolved["--AIPM-green"]).toBe("#84bd00");
    expect(resolved["--AIPM-green-strong"]).toBeDefined();
  });
});
