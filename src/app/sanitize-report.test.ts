import { describe, expect, it } from "vitest";
import { describeTextCap, describeClamp, describeLabelStrip } from "./sanitize-report";

describe("describeTextCap", () => {
  it("returns the value unchanged with no adjustment when under the cap", () => {
    expect(describeTextCap("hello", 10)).toEqual({ value: "hello", adjustment: null });
  });

  it("truncates and reports the removed count when over the cap", () => {
    expect(describeTextCap("hello world", 5)).toEqual({
      value: "hello",
      adjustment: { kind: "truncated", max: 5, removed: 6 },
    });
  });
});

describe("describeClamp", () => {
  it("returns undefined and no adjustment for an empty string", () => {
    expect(describeClamp("", { min: 0, max: 24 })).toEqual({ value: undefined, adjustment: null });
  });

  it("passes an in-range value through, rounded", () => {
    expect(describeClamp("8.25", { min: 0, max: 24, round: 1 })).toEqual({ value: 8.3, adjustment: null });
  });

  it("clamps above max and reports the max bound", () => {
    expect(describeClamp("250", { min: 0, max: 24, round: 1 })).toEqual({
      value: 24,
      adjustment: { kind: "clamped", bound: "max", to: 24 },
    });
  });

  it("clamps below min and reports the min bound", () => {
    expect(describeClamp("-5", { min: 0, max: 24 })).toEqual({
      value: 0,
      adjustment: { kind: "clamped", bound: "min", to: 0 },
    });
  });

  it("treats a non-numeric entry as the min bound", () => {
    expect(describeClamp("abc", { min: 0, max: 24 })).toEqual({
      value: 0,
      adjustment: { kind: "clamped", bound: "min", to: 0 },
    });
  });
});

describe("describeLabelStrip", () => {
  it("returns the value unchanged when there are no separator chars", () => {
    expect(describeLabelStrip("frontend")).toEqual({ value: "frontend", adjustment: null });
  });

  it("replaces separators with a space and reports which chars were stripped", () => {
    expect(describeLabelStrip("api,docs")).toEqual({
      value: "api docs",
      adjustment: { kind: "stripped", chars: [","] },
    });
  });
});
