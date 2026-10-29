import { describe, expect, it } from "vitest";
import { DIFF_VALUE_MAX, formatDiffValue } from "./version-diff-format";

describe("formatDiffValue (§776)", () => {
  it("shows a blank value as a dash", () => {
    for (const v of [null, undefined, "", [], {}]) expect(formatDiffValue(v)).toBe("—");
  });

  it("keeps plain text, numbers and booleans as they are", () => {
    expect(formatDiffValue("Approved")).toBe("Approved");
    expect(formatDiffValue(42)).toBe("42");
    expect(formatDiffValue(false)).toBe("false");
  });

  it("reads rich text as its plain text, not its markup", () => {
    expect(formatDiffValue("<p>First</p><ul><li>one</li><li>two</li></ul><p>a &amp; b</p>")).toBe("First one two a & b");
  });

  it("keeps a plain value that merely contains a '<'", () => {
    expect(formatDiffValue("a < b")).toBe("a < b");
  });

  it("joins a list of plain values with commas", () => {
    expect(formatDiffValue(["design", "ux"])).toBe("design, ux");
  });

  it("reads an object as key: value pairs, leaving blank ones out", () => {
    expect(formatDiffValue({ "10": "A", "11": "R", "12": "" })).toBe("10: A, 11: R");
  });

  it("sets apart the objects of a list with semicolons", () => {
    expect(formatDiffValue([{ taskId: 4, type: "FS" }, { taskId: 7, type: "SS" }])).toBe("taskId: 4, type: FS; taskId: 7, type: SS");
  });

  it("falls back to JSON below two levels", () => {
    expect(formatDiffValue([{ a: { b: 1 } }])).toBe('a: {"b":1}');
  });

  it("caps a long value", () => {
    const out = formatDiffValue("x".repeat(DIFF_VALUE_MAX + 50));
    expect(out).toBe(`${"x".repeat(DIFF_VALUE_MAX)}…`);
  });
});
