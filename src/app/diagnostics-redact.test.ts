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
    const out = redactFields({ msg: "x".repeat(800) })!;
    expect((out.msg as string).length).toBeLessThanOrEqual(500);
    expect((out.msg as string).length).toBeGreaterThan(200);
  });

  it("returns undefined when a non-empty input has all values filtered out", () => {
    expect(redactFields({ d: { x: 1 }, e: [1, 2] })).toBeUndefined();
  });

  it("redacts a secret-shaped key even with a non-string value", () => {
    const out = redactFields({ apiKeyLength: 32, auth_token: true })!;
    expect(out.apiKeyLength).toBe("[redacted]");
    expect(out.auth_token).toBe("[redacted]");
  });

  it("scrubs secret patterns embedded in string VALUES under benign keys", () => {
    const out = redactFields({
      message: "auth failed for sk-ant-api03-ABC123xyz calling api",
      header: "Authorization: Bearer abc.def.ghijklmnop",
    })!;
    expect(out.message).not.toContain("sk-ant-api03-ABC123xyz");
    expect(out.message).toContain("[redacted]");
    expect(out.header as string).not.toContain("abc.def.ghijklmnop");
  });

  it("scrubs Atlassian tokens and bare token=/secret= in values", () => {
    const out = redactFields({
      a: "jira ATATT3xFfGF0abcDEF_123 failed",
      b: "url https://x?token=abc123&ok=1",
      c: "secret=topsecretvalue",
    })!;
    expect(out.a as string).not.toContain("ATATT3xFfGF0abcDEF_123");
    expect(out.b as string).not.toContain("abc123");
    expect(out.b as string).toContain("ok=1"); // benign query kept
    expect(out.c as string).not.toContain("topsecretvalue");
  });

  it("scrubs a Basic auth base64 blob from values", () => {
    const out = redactFields({ h: "Authorization: Basic dXNlckBleC5jb206c2VjcmV0VG9rZW4xMjM0" })!;
    expect(out.h as string).not.toContain("dXNlckBleC5jb206c2VjcmV0VG9rZW4xMjM0");
    expect(out.h as string).toContain("[redacted]");
  });
});
