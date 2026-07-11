import { describe, expect, it } from "vitest";
import { AiHttpError, classifyAiError, safeAiErrorType } from "./ai-errors";

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

describe("AiHttpError", () => {
  it("carries status + errorType and a status-only message", () => {
    const e = new AiHttpError(429, "rate_limit_error");
    expect(e.status).toBe(429);
    expect(e.errorType).toBe("rate_limit_error");
    expect(e.message).toBe("429");
    expect(e).toBeInstanceOf(Error);
  });
});
