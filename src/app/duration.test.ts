import { describe, expect, test } from "vitest";
import { parseDuration, formatDuration } from "./duration";

describe("parseDuration (1w=5d, 1d=8h, 1h=60m)", () => {
  test("parses a single unit", () => {
    expect(parseDuration("3h")).toBe(180);
    expect(parseDuration("2d")).toBe(2 * 8 * 60);
    expect(parseDuration("1w")).toBe(5 * 8 * 60);
    expect(parseDuration("45m")).toBe(45);
  });
  test("parses combinations and is case/space tolerant", () => {
    expect(parseDuration("2w 3d 4h")).toBe((2 * 5 + 3) * 8 * 60 + 4 * 60);
    expect(parseDuration("1W2D")).toBe((5 + 2) * 8 * 60);
  });
  test("empty → null (unset)", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("   ")).toBeNull();
  });
  test("invalid → null", () => {
    expect(parseDuration("banana")).toBeNull();
    expect(parseDuration("3x")).toBeNull();
    expect(parseDuration("1.5h")).toBeNull();
  });
});

describe("formatDuration", () => {
  test("formats minutes back into w/d/h/m, omitting zero units", () => {
    expect(formatDuration((2 * 5 + 3) * 8 * 60 + 4 * 60)).toBe("2w 3d 4h");
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(0)).toBe("");
  });
  test("round-trips parse∘format", () => {
    const m = parseDuration("1w 2d 3h 30m")!;
    expect(parseDuration(formatDuration(m))).toBe(m);
  });
});
