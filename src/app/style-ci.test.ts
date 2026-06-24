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
