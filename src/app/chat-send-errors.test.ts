import { describe, test, expect } from "vitest";
import { chatSendErrorOutcome } from "./chat-send-errors";
import { AiConsentRevokedError, AiDeploymentError, AiHttpError, AiKeyRefusedError } from "./ai-errors";
import { AiPeopleProtectedContentError } from "./ai-privacy";

/** An error whose name is AbortError, as fetch raises it when the controller fires. */
function named<E extends Error>(err: E, name: string): E {
  Object.defineProperty(err, "name", { value: name });
  return err;
}

describe("chatSendErrorOutcome — one per branch", () => {
  test("an AbortError (a DOMException-like object too) is a stop", () => {
    expect(chatSendErrorOutcome(named(new Error("aborted"), "AbortError"))).toEqual({ kind: "stopped" });
    expect(chatSendErrorOutcome({ name: "AbortError" })).toEqual({ kind: "stopped" });
  });

  test("Anthropic's usage limit (429, or a limit error type) is an appended notice", () => {
    expect(chatSendErrorOutcome(new AiHttpError(429))).toEqual({ kind: "notice", key: "aiUsageLimitReached" });
    expect(chatSendErrorOutcome(new AiHttpError(529, "overloaded_error"))).toEqual({ kind: "notice", key: "aiUsageLimitReached" });
  });

  test("people protection refusing the content", () => {
    expect(chatSendErrorOutcome(new AiPeopleProtectedContentError())).toEqual({ kind: "error", key: "chatPeopleProtectedContent" });
  });

  test("consent revoked during the send", () => {
    expect(chatSendErrorOutcome(new AiConsentRevokedError())).toEqual({ kind: "error", key: "aiConsentRevokedDuringSend" });
  });

  test("a transport failure is named as the transport", () => {
    expect(chatSendErrorOutcome(new AiDeploymentError("off"))).toEqual({ kind: "error", key: "aiDeploymentOff" });
  });

  test("a refused key is named as the key", () => {
    expect(chatSendErrorOutcome(new AiHttpError(401))).toEqual({ kind: "error", key: "aiKeyRejected" });
    expect(chatSendErrorOutcome(new AiKeyRefusedError("organization"))).toEqual({ kind: "error", key: "aiKeyWrongOrganization" });
  });

  test("an unknown model is named as the model", () => {
    expect(chatSendErrorOutcome(new AiHttpError(404, "not_found_error"))).toEqual({ kind: "error", key: "aiModelUnavailable" });
  });

  test("anything else is the raw message, with an AiHttpError's safe message", () => {
    expect(chatSendErrorOutcome(new AiHttpError(400, "invalid_request_error", "prompt is too long"))).toEqual({
      kind: "raw", message: "400", safeMessage: "prompt is too long",
    });
    expect(chatSendErrorOutcome(new Error("network down"))).toEqual({ kind: "raw", message: "network down", safeMessage: undefined });
  });
});

describe("chatSendErrorOutcome — a rejection that is not an object", () => {
  test.each([
    ["null", null, "null"],
    ["undefined", undefined, "undefined"],
    // The string and number rows pin the OUTCOME only: they pass without the non-object guard, since those inputs never threw. Only null and undefined depend on the guard.
    ["a string", "plain", "plain"],
    ["a number", 42, "42"],
  ] as const)("%s is the generic error, never a throw", (_label, err, message) => {
    expect(chatSendErrorOutcome(err)).toEqual({ kind: "raw", message, safeMessage: undefined });
  });
});

// Only "AbortError first" is an order a test can see; the later branches do not overlap on today's
// error classes (see `chatSendErrorOutcome`'s docstring), so their order is not pinned here.
describe("chatSendErrorOutcome — AbortError comes first", () => {
  test("AbortError wins over a usage limit", () => {
    expect(chatSendErrorOutcome(named(new AiHttpError(429), "AbortError"))).toEqual({ kind: "stopped" });
  });

  test("AbortError wins over people protection and over a refused key", () => {
    expect(chatSendErrorOutcome(named(new AiPeopleProtectedContentError(), "AbortError"))).toEqual({ kind: "stopped" });
    expect(chatSendErrorOutcome(named(new AiHttpError(401), "AbortError"))).toEqual({ kind: "stopped" });
  });
});

// Classification at the boundaries between classes, decided by `classifyAiError`, not by branch order.
describe("chatSendErrorOutcome — class boundaries", () => {
  test("a limit error type on a 403 is the limit, not the key", () => {
    expect(chatSendErrorOutcome(new AiHttpError(403, "rate_limit_error"))).toEqual({ kind: "notice", key: "aiUsageLimitReached" });
  });

  test("a 404 without the model error type is generic, not the model", () => {
    expect(chatSendErrorOutcome(new AiHttpError(404))).toEqual({ kind: "raw", message: "404", safeMessage: undefined });
  });
});
