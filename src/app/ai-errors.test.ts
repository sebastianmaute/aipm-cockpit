import { describe, expect, it } from "vitest";
import { AiHttpError, classifyAiError, safeAiErrorType, safeAiErrorMessage } from "./ai-errors";

describe("classifyAiError", () => {
  it("classifies HTTP 429 as limit", () => {
    expect(classifyAiError(429)).toBe("limit");
  });

  it("classifies rate_limit_error errorType as limit (any status)", () => {
    expect(classifyAiError(400, "rate_limit_error")).toBe("limit");
    expect(classifyAiError(529, "rate_limit_error")).toBe("limit");
  });

  it("classifies overloaded_error errorType as limit", () => {
    expect(classifyAiError(529, "overloaded_error")).toBe("limit");
  });

  it("classifies 401 and 403 as auth", () => {
    expect(classifyAiError(401)).toBe("auth");
    expect(classifyAiError(403)).toBe("auth");
  });

  it("classifies 500 and other statuses as generic", () => {
    expect(classifyAiError(500)).toBe("generic");
    expect(classifyAiError(400)).toBe("generic");
    expect(classifyAiError(404, "not_found_error")).toBe("generic");
  });
});

describe("safeAiErrorType", () => {
  it("reads error.type when present as a string", () => {
    expect(safeAiErrorType({ error: { type: "rate_limit_error", message: "secret" } })).toBe(
      "rate_limit_error",
    );
  });

  it("returns undefined for malformed shapes and never throws", () => {
    expect(safeAiErrorType(null)).toBeUndefined();
    expect(safeAiErrorType(undefined)).toBeUndefined();
    expect(safeAiErrorType("string")).toBeUndefined();
    expect(safeAiErrorType({})).toBeUndefined();
    expect(safeAiErrorType({ error: null })).toBeUndefined();
    expect(safeAiErrorType({ error: {} })).toBeUndefined();
    expect(safeAiErrorType({ error: { type: 42 } })).toBeUndefined();
  });
});

describe("safeAiErrorMessage", () => {
  it("reads error.message, strips control chars, and returns the text", () => {
    expect(
      safeAiErrorMessage({
        error: { type: "invalid_request_error", message: "prompt is too long: 250000 tokens > 200000" },
      }),
    ).toBe("prompt is too long: 250000 tokens > 200000");
  });

  it("strips ASCII control chars (newlines/tabs/NUL) from the message", () => {
    // Build the string without typing literal control bytes into the source.
    const raw = ["line one", "line two"].join("\n") + "\ttail" + String.fromCharCode(0);
    const out = safeAiErrorMessage({ error: { message: raw } });
    expect(out).toBeDefined();
    expect(/[\x00-\x1f]/.test(out as string)).toBe(false);
    expect(out).toContain("line one");
    expect(out).toContain("line two");
  });

  it("truncates to at most 500 characters", () => {
    const long = "x".repeat(2000);
    const out = safeAiErrorMessage({ error: { message: long } });
    expect((out as string).length).toBeLessThanOrEqual(500);
  });

  it("returns undefined for malformed / empty shapes and never throws", () => {
    expect(safeAiErrorMessage(null)).toBeUndefined();
    expect(safeAiErrorMessage(undefined)).toBeUndefined();
    expect(safeAiErrorMessage("string")).toBeUndefined();
    expect(safeAiErrorMessage(42)).toBeUndefined();
    expect(safeAiErrorMessage({})).toBeUndefined();
    expect(safeAiErrorMessage({ error: null })).toBeUndefined();
    expect(safeAiErrorMessage({ error: {} })).toBeUndefined();
    expect(safeAiErrorMessage({ error: { message: 42 } })).toBeUndefined();
    expect(safeAiErrorMessage({ error: { message: "   " } })).toBeUndefined();
  });
});

describe("AiHttpError", () => {
  it("carries status + errorType and a status-only message", () => {
    const e = new AiHttpError(429, "rate_limit_error");
    expect(e.status).toBe(429);
    expect(e.errorType).toBe("rate_limit_error");
    expect(e.message).toBe("429");
    expect(e).toBeInstanceOf(Error);
  });

  it("carries an optional safeMessage while message stays status-only", () => {
    const e = new AiHttpError(400, "invalid_request_error", "prompt is too long: 1 > 0");
    expect(e.status).toBe(400);
    expect(e.errorType).toBe("invalid_request_error");
    expect(e.safeMessage).toBe("prompt is too long: 1 > 0");
    // The Error.message must NOT leak the body text — status only.
    expect(e.message).toBe("400");
  });

  it("leaves safeMessage undefined when not provided", () => {
    expect(new AiHttpError(500).safeMessage).toBeUndefined();
  });
});
