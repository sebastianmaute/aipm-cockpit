import { describe, expect, test } from "vitest";
import { parseDuration, formatDuration, effortProgress } from "./duration";

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

describe("effortProgress", () => {
  test("no estimate (undefined or 0) → hasEstimate false, pct 0, not over", () => {
    expect(effortProgress(undefined, 120)).toEqual({ hasEstimate: false, pct: 0, over: false });
    expect(effortProgress(0, 120)).toEqual({ hasEstimate: false, pct: 0, over: false });
  });
  test("partial: spent below estimate", () => {
    expect(effortProgress(480, 120)).toEqual({ hasEstimate: true, pct: 0.25, over: false });
  });
  test("spent unset with estimate set → pct 0", () => {
    expect(effortProgress(480, undefined)).toEqual({ hasEstimate: true, pct: 0, over: false });
  });
  test("exactly equal → pct 1, not over", () => {
    expect(effortProgress(480, 480)).toEqual({ hasEstimate: true, pct: 1, over: false });
  });
  test("overrun → pct > 1, over true", () => {
    const r = effortProgress(480, 600);
    expect(r.hasEstimate).toBe(true);
    expect(r.over).toBe(true);
    expect(r.pct).toBeCloseTo(1.25, 5);
  });
});
