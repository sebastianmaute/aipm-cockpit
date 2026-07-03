import { describe, it, expect } from "vitest";
import { relationalReadIsEmpty } from "./turso-backend";

// A well-formed SELECT result with n rows.
const ok = (n: number) => ({ response: { result: { rows: new Array(n).fill([]) } } });
// Malformed: a result whose rows array is absent (a partial/failed read).
const malformed = { response: { result: {} } };
const noResponse = {};

describe("relationalReadIsEmpty", () => {
  it("is true when every result is a well-formed 0-row read (genuinely empty project)", () => {
    expect(relationalReadIsEmpty([ok(0), ok(0), ok(0)] as never)).toBe(true);
  });

  it("is false when any result has rows", () => {
    expect(relationalReadIsEmpty([ok(0), ok(2), ok(0)] as never)).toBe(false);
  });

  it("THROWS on a malformed result — a partial/failed read must NOT be treated as 'empty'", () => {
    expect(() => relationalReadIsEmpty([ok(0), malformed, ok(0)] as never)).toThrow(/malformed/i);
    expect(() => relationalReadIsEmpty([ok(1), noResponse] as never)).toThrow(/malformed/i);
  });

  it("THROWS on a TRUNCATED read (fewer results than expected) — not masked as empty", () => {
    expect(() => relationalReadIsEmpty([ok(0), ok(0)] as never, 3)).toThrow(/truncated|expected/i);
    expect(relationalReadIsEmpty([ok(0), ok(0), ok(0)] as never, 3)).toBe(true); // full + empty → ok
  });
});
