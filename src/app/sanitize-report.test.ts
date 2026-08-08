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

  // ★★★ THIS TEST EXISTS BECAUSE THE OTHER FOUR CANNOT DETECT THE CAP AT ALL.
  // Every other literal here and in sanitize-branches.test.ts is <= 9 characters
  // against a 50-unit cap, so the truncation branch never executes and the
  // function's body could be reverted to a raw `.trim().slice(0, LABEL_MAX)`
  // with the whole suite still green. A cold review measured exactly that, on a
  // branch whose own comment claimed this path was "covered by its own test".
  //
  // `describeLabelStrip` MIRRORS `sanitizeLabel` by contract (its docstring says
  // so), so it must inherit clipText's surrogate back-off: a raw slice at the
  // boundary keeps a LONE HIGH SURROGATE, which UTF-8-encodes to U+FFFD on the
  // CSV and Markdown backends while surviving on JSON and IndexedDB.
  it("caps without splitting an astral character at the boundary", () => {
    // 3 BMP chars shift the astral run by one code unit, so the cut at 50 lands
    // INSIDE a surrogate pair. A pure-astral string would cut cleanly and prove
    // nothing.
    const raw = "abc" + "\u{10000}".repeat(40);
    const { value } = describeLabelStrip(raw);
    expect(value.length).toBeLessThanOrEqual(50);
    // The last unit must not be an unpaired high surrogate.
    const last = value.charCodeAt(value.length - 1);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    // …and the character must be dropped WHOLE, not merely trimmed to an even
    // length by luck: 3 + 2n is odd at the cap, so a correct back-off lands on 49.
    expect(value.length).toBe(49);
  });
});
