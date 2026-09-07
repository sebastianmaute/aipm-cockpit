import { describe, it, expect } from "vitest";
import { str } from "./str";

describe("str", () => {
  it("renders nullish as the empty string", () => {
    expect(str(null)).toBe("");
    expect(str(undefined)).toBe("");
  });

  it("joins an array with a comma and a space", () => {
    expect(str([1, 2, 3])).toBe("1, 2, 3");
  });

  it("renders an empty array as the empty string, which the clear predicates rely on", () => {
    expect(str([])).toBe("");
  });

  it("stringifies everything else verbatim", () => {
    expect(str(42)).toBe("42");
    expect(str(true)).toBe("true");
    expect(str("x")).toBe("x");
  });
});
