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

describe("effectiveDark", () => {
  it("dark only when theme dark AND scheme dark-capable", () => {
    expect(effectiveDark(true, true)).toBe(true);
    expect(effectiveDark(true, false)).toBe(false); // mockup / light-only
    expect(effectiveDark(false, true)).toBe(false);
    expect(effectiveDark(false, false)).toBe(false);
  });
});

describe("style-ci custom", () => {
  it("accepts 'custom' as a valid stored style", () => {
    expect(readStoredStyle("custom")).toBe("custom");
    expect(readStoredStyle("AIPM")).toBe("AIPM");
    expect(readStoredStyle("mockup")).toBe("mockup");
    expect(readStoredStyle("bogus")).toBe("AIPM");
  });
});
