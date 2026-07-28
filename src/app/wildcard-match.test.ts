import { describe, expect, it } from "vitest";
import { wildcardMatcher } from "./wildcard-match";

describe("wildcardMatcher", () => {
  it("matches everything on an empty or blank query", () => {
    expect(wildcardMatcher("")("anything")).toBe(true);
    expect(wildcardMatcher("   ")("anything")).toBe(true);
  });

  it("is an unanchored case-insensitive substring test when there is no *", () => {
    const m = wildcardMatcher("Ship");
    expect(m("Ship the release")).toBe(true);
    expect(m("RESHIPMENT")).toBe(true);
    expect(m("deploy")).toBe(false);
  });

  it("lets * span any run of characters", () => {
    const m = wildcardMatcher("api*docs");
    expect(m("API reference docs")).toBe(true);
    expect(m("api docs")).toBe(true);
    expect(m("docs before api")).toBe(false);
  });

  it("treats a bare * as match-all and honours leading/trailing *", () => {
    expect(wildcardMatcher("*")("anything")).toBe(true);
    expect(wildcardMatcher("*fix")("hotfix")).toBe(true);
    expect(wildcardMatcher("fix*")("fixture")).toBe(true);
  });

  // ★ The query is user text, not a pattern language. A regex metachar must be
  //   literal — otherwise "c++" throws "Nothing to repeat" and takes the panel
  //   down, and "a.b" would match "axb".
  it("treats regex metacharacters as literal", () => {
    expect(() => wildcardMatcher("c++")("c++ refactor")).not.toThrow();
    expect(wildcardMatcher("c++")("c++ refactor")).toBe(true);
    expect(wildcardMatcher("a.b")("axb")).toBe(false);
    expect(wildcardMatcher("a.b")("a.b")).toBe(true);
  });
});
