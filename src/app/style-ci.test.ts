import { describe, it, expect } from "vitest";
import { effectiveDark } from "./style-ci";

describe("effectiveDark", () => {
  it("dark only when theme dark AND scheme dark-capable", () => {
    expect(effectiveDark(true, true)).toBe(true);
    expect(effectiveDark(true, false)).toBe(false); // mockup / light-only
    expect(effectiveDark(false, true)).toBe(false);
    expect(effectiveDark(false, false)).toBe(false);
  });
});
