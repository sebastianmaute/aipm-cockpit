import { describe, it, expect } from "vitest";
import { isAbortError } from "./abort-error";

describe("isAbortError", () => {
  it("recognises a real DOMException abort", () => {
    expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
  });

  // ★ THE CASE THE HELPER EXISTS FOR. A DOMException is not reliably
  // `instanceof Error`/`instanceof DOMException` across the jsdom/Node
  // boundary, so the value can arrive as a plain object carrying only
  // `.name`. An `instanceof`-gated check returns false here — which is
  // exactly the defect (a user cancel reported as an error).
  it("recognises a plain object that merely carries name AbortError", () => {
    expect(isAbortError({ name: "AbortError" })).toBe(true);
  });

  it("recognises an Error subclass renamed to AbortError", () => {
    expect(isAbortError(Object.assign(new Error("stop"), { name: "AbortError" }))).toBe(true);
  });

  it("rejects an ordinary Error", () => {
    expect(isAbortError(new Error("boom"))).toBe(false);
  });

  it("rejects a different DOMException", () => {
    expect(isAbortError(new DOMException("quota", "QuotaExceededError"))).toBe(false);
  });

  it("rejects null, undefined, a string and a number without throwing", () => {
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
    expect(isAbortError(42)).toBe(false);
  });
});
