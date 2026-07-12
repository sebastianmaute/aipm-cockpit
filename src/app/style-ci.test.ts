import { describe, it, expect } from "vitest";
import { readStoredStyle, effectiveDark } from "./style-ci";

describe("readStoredStyle", () => {
  it("defaults unknown/null to AIPM", () => {
    expect(readStoredStyle(null)).toBe("AIPM");
    expect(readStoredStyle("bogus")).toBe("AIPM");
  });
  it("passes through valid values", () => {
    expect(readStoredStyle("mockup")).toBe("mockup");
    expect(readStoredStyle("AIPM")).toBe("AIPM");
  });
});

describe("effectiveDark — mockup pins light", () => {
  it("mockup is never dark even when the theme resolved dark", () => {
    expect(effectiveDark(true, "mockup")).toBe(false);
  });
  it("AIPM honours the resolved theme", () => {
    expect(effectiveDark(true, "AIPM")).toBe(true);
    expect(effectiveDark(false, "AIPM")).toBe(false);
  });
});

describe("style-ci custom", () => {
  it("accepts 'custom' as a valid stored style", () => {
    expect(readStoredStyle("custom")).toBe("custom");
    expect(readStoredStyle("AIPM")).toBe("AIPM");
    expect(readStoredStyle("mockup")).toBe("mockup");
    expect(readStoredStyle("bogus")).toBe("AIPM");
  });

  it("pins light for a light-only custom scheme (like mockup)", () => {
    expect(effectiveDark(true, "custom")).toBe(false); // supportsDark defaults false
    expect(effectiveDark(true, "custom", false)).toBe(false);
    expect(effectiveDark(true, "mockup")).toBe(false);
    expect(effectiveDark(true, "AIPM")).toBe(true);
    expect(effectiveDark(false, "AIPM")).toBe(false);
  });

  it("a dark-capable custom scheme honours the resolved theme", () => {
    expect(effectiveDark(true, "custom", true)).toBe(true);
    expect(effectiveDark(false, "custom", true)).toBe(false);
    // supportsDark is irrelevant for mockup (always light) and AIPM (always honours theme)
    expect(effectiveDark(true, "mockup", true)).toBe(false);
    expect(effectiveDark(true, "AIPM", false)).toBe(true);
  });
});
