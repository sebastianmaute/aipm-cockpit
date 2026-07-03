import { describe, it, expect } from "vitest";
import { redactFields } from "./diagnostics-redact";

describe("redactFields", () => {
  it("returns undefined for empty/absent input", () => {
    expect(redactFields(undefined)).toBeUndefined();
    expect(redactFields({})).toBeUndefined();
  });

  it("redacts secret-ish keys (case-insensitive substring)", () => {
    const out = redactFields({ apiKey: "sk-ant-xxx", authToken: "t", anthropicApiKey: "y", ok: "keep" })!;
    expect(out.apiKey).toBe("[redacted]");
    expect(out.authToken).toBe("[redacted]");
    expect(out.anthropicApiKey).toBe("[redacted]");
    expect(out.ok).toBe("keep");
  });

  it("drops non-primitive values (no object/array dumps)", () => {
    const out = redactFields({ a: 1, b: true, c: "x", d: { nested: 1 }, e: [1, 2], f: () => 1 })!;
    expect(out).toEqual({ a: 1, b: true, c: "x" });
  });

  it("caps long strings", () => {
    const out = redactFields({ msg: "x".repeat(500) })!;
    expect((out.msg as string).length).toBeLessThanOrEqual(200);
  });
});
