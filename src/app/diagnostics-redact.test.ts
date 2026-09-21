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

// The §564 negatives, shared with the §606 block below so the two lists cannot drift apart.
const SHARED_OPAQUE_TOKEN_NEGATIVES: Array<[string, string]> = [
  ["a lowercase UUID (crypto.randomUUID ids)", "f47ac10b-58cc-4372-a567-0e02b2c3d479"],
  ["an uppercase GUID (MSAL client / tenant ids)", "F47AC10B-58CC-4372-A567-0E02B2C3D479"],
  ["a 40-char commit SHA", "0fa7cc72a4b1c8e9d2f3a6b5c4d3e2f1a0b9c8d7"],
  ["a long camelCase i18n key", "integrationsTursoTokenPlaceholder"],
  ["a German compound word", "Datenschutzgrundverordnungsbeauftragter"],
  ["a stack frame", "at jsonToWorkspace (webpack-internal:///./src/app/workspace.ts:787:14)"],
  ["a 31-char mixed-class run (one under the floor)", "aB3xQ9zK7mP2wR8tL4vN6yH1sJ5dF0g"],
];

describe("§564: an opaque token with no vendor prefix is redacted, legitimate ids survive", () => {
  const TOKEN = "aB3xQ9zK7mP2wR8tL4vN6yH1sJ5dF0gC"; // 32, lower + upper + digit
  it("redacts a bare mixed-class token inside free text", () => {
    const out = redactFields({ message: `upstream said ${TOKEN} was rejected` });
    expect(out?.message).toBe("upstream said [redacted] was rejected");
  });
  // ★ Every one of these is a real shape that flows through logDiag in this app. A redaction
  // test with only the positive half proves nothing about what it costs.
  it.each(SHARED_OPAQUE_TOKEN_NEGATIVES)("leaves %s untouched", (_label, value) => {
    expect(redactFields({ id: value })?.id).toBe(value);
  });
});

describe("§606: a base64-shaped secret split by `+` or ending in `=` padding is redacted", () => {
  it("redacts a 40-char mixed-class run containing a `+`", () => {
    const TOKEN = "aB3xQ9zK7mP2wR8t+4vN6yH1sJ5dF0gCXyZ1abcD"; // 40, lower+upper+digit, one '+'
    const out = redactFields({ message: `upstream said ${TOKEN} was rejected` });
    expect(out?.message).toBe("upstream said [redacted] was rejected");
  });

  it("redacts a 44-char mixed-class run ending in `==` padding, padding included", () => {
    const TOKEN = "aB3xQ9zK7mP2wR8tL4vN6yH1sJ5dF0gCXyZ1abcDEf=="; // 44, ends '=='
    const out = redactFields({ message: `upstream said ${TOKEN} was rejected` });
    expect(out?.message).toBe("upstream said [redacted] was rejected");
  });

  // ★ The case the `=` branch exists for. `/` splits this token into runs under 32 in §564's
  // alphabet, so before §606 it was logged in FULL; here it is one run ending in `==`, with no
  // `+` anywhere. The 44-char `==` positive above cannot stand in for it: §564 already redacts
  // that one's alphanumeric core and leaves only the padding.
  it("redacts a 47-char `/`-split run ending in `==` padding, with no `+` anywhere", () => {
    const TOKEN = "aB3xQ9zK7m/P2wR8tL4vN6/yH1sJ5dF0gC/XyZ1abcDEf=="; // 47, ends '=='
    const out = redactFields({ message: `upstream said ${TOKEN} was rejected` });
    expect(out?.message).toBe("upstream said [redacted] was rejected");
  });

  // ★ Why the rule must run BEFORE §564: §564's alphabet excludes `+`, so run first it redacts
  // the 34-char head alone and leaves `+4vN6yH1sJ5dF0g`, 15 characters of the secret, in the log.
  it("redacts a 34-char head, `+`, then a tail as ONE run (no padding)", () => {
    const TOKEN = "aB3xQ9zK7mP2wR8tL4vN6yH1sJ5dF0gCXy+4vN6yH1sJ5dF0g"; // 49, one '+'
    const out = redactFields({ message: `upstream said ${TOKEN} was rejected` });
    expect(out?.message).toBe("upstream said [redacted] was rejected");
  });

  // ★ A `=` that does not terminate the token is not padding, but it must not un-redact a run the
  // `+` already qualifies: every piece of this token is under 32, so rejecting the run would log
  // it in full. Only the `=on` stays visible.
  it("redacts a `+` run followed by `=` and more text, leaving the `=` text visible", () => {
    const TOKEN = "aB3xQ9zK7mP2wR8t+4vN6yH1sJ5dF0gCXyZ1abcD"; // 40, one '+'
    const out = redactFields({ message: `upstream said ${TOKEN}=on was rejected` });
    expect(out?.message).toBe("upstream said [redacted]=on was rejected");
  });

  // ★ Every one of these is a real shape that flows through logDiag in this app, plus the
  // shapes this rule's alphabet newly risks: paths and stack frames that use `/`, and a 32+ run
  // followed by a `=` that does not end the string.
  it.each([
    ...SHARED_OPAQUE_TOKEN_NEGATIVES,
    [
      "a long mixed-case path with digits",
      "webpack-internal:///./src/app/Chart2Panel/UseChartReadout3.tsx",
    ],
    ["a 31-char base64 run with `+` (one under the floor)", "aB3xQ9zK7mP2wR8t+4vN6yH1sJ5dF0g"],
    ["a `+`-containing string with no uppercase", "ab3xq9zk7mp2wr8t+4vn6yh1sj5df0gcxyz1abcd"],
    [
      "a key=value-shaped string with no `+` and no trailing `=`",
      "Chart2Panel=UseReadout3AndMoreLettersHereX",
    ],
    [
      "a 36-char path run followed by `=` and more text (padding must be trailing)",
      "/api/v1/Tenants/Chart2Panel/Settings=on",
    ],
  ] as Array<[string, string]>)("leaves %s untouched", (_label, value) => {
    expect(redactFields({ id: value })?.id).toBe(value);
  });
});
