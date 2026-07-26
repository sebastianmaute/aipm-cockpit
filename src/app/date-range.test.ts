import { describe, expect, it } from "vitest";
import { clampRangeEnd } from "./date-range";

describe("clampRangeEnd", () => {
  it("returns the end unchanged when it is not before the start", () => {
    expect(clampRangeEnd("2026-07-01", "2026-07-05")).toBe("2026-07-05");
    expect(clampRangeEnd("2026-07-01", "2026-07-01")).toBe("2026-07-01");
  });

  it("collapses an end that precedes the start", () => {
    expect(clampRangeEnd("2026-07-10", "2026-07-05")).toBe("2026-07-10");
  });

  it("leaves a blank or malformed end alone rather than inventing a date", () => {
    expect(clampRangeEnd("2026-07-10", "")).toBe("");
    expect(clampRangeEnd("", "2026-07-05")).toBe("2026-07-05");
  });

  it("leaves a half-typed end alone rather than rewriting it under the cursor", () => {
    expect(clampRangeEnd("2026-07-10", "2026-07")).toBe("2026-07");
    expect(clampRangeEnd("2026-07-10", "2026-07-1")).toBe("2026-07-1");
  });
});
