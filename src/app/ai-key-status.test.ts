import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetAiKeyStatusForTests,
  aiKeyMessageKey,
  aiKeyMessageKeyForError,
  aiKeyMessageKeyForStatusToken,
  aiFailureMessageKey,
  aiFailureMessageKeyForToken,
  aiFailureToken,
  getAiKeyStatus,
  isAiKeyStatusBad,
  isKeyBlocked,
  reportAiKeyRefused,
  reportAiKeyResponse,
  reportAiKeyUnreadable,
  subscribeAiKeyStatus,
  syncAiKey,
} from "./ai-key-status";
import { AiDeploymentError, AiGatewayError, AiHttpError, AiKeyCheckUnavailableError, AiKeyRefusedError } from "./ai-errors";

const KEY_A = "sk-ant-api03-AAAAAAAAAAAAAAAAAAAA";
const KEY_B = "sk-ant-api03-BBBBBBBBBBBBBBBBBBBB";

beforeEach(() => __resetAiKeyStatusForTests());
afterEach(() => vi.restoreAllMocks());

describe("ai-key-status store", () => {
  it("starts unknown", () => {
    expect(getAiKeyStatus()).toBe("unknown");
  });

  it("maps 2xx → ok, 401 → rejected, 403 → forbidden for the live key", () => {
    syncAiKey(KEY_A);
    reportAiKeyResponse(KEY_A, 401);
    expect(getAiKeyStatus()).toBe("rejected");
    reportAiKeyResponse(KEY_A, 403);
    expect(getAiKeyStatus()).toBe("forbidden");
    reportAiKeyResponse(KEY_A, 200);
    expect(getAiKeyStatus()).toBe("ok");
  });

  it("adopts the reported key when no key was synced yet", () => {
    reportAiKeyResponse(`  ${KEY_A}  `, 401);
    expect(getAiKeyStatus()).toBe("rejected");
    // The same key, differently padded, is the same key.
    reportAiKeyResponse(KEY_A, 200);
    expect(getAiKeyStatus()).toBe("ok");
  });

  it("ignores any other status (429, 500, 400) — only 2xx/401/403 speak about the key", () => {
    syncAiKey(KEY_A);
    reportAiKeyResponse(KEY_A, 401);
    for (const s of [429, 500, 529, 400, 404]) reportAiKeyResponse(KEY_A, s);
    expect(getAiKeyStatus()).toBe("rejected");
  });

  it("a 403 carrying a rate-limit error type is a limit, not a key problem", () => {
    syncAiKey(KEY_A);
    reportAiKeyResponse(KEY_A, 403, "rate_limit_error");
    expect(getAiKeyStatus()).toBe("unknown");
  });

  it("resets to unknown when the live key changes, and ignores reports for a stale key", () => {
    syncAiKey(KEY_A);
    reportAiKeyResponse(KEY_A, 401);
    syncAiKey(KEY_B);
    expect(getAiKeyStatus()).toBe("unknown");
    // A request still in flight with the OLD key lands after the change.
    reportAiKeyResponse(KEY_A, 401);
    expect(getAiKeyStatus()).toBe("unknown");
    reportAiKeyResponse(KEY_B, 200);
    expect(getAiKeyStatus()).toBe("ok");
  });

  it("re-syncing the SAME key keeps the status", () => {
    syncAiKey(KEY_A);
    reportAiKeyResponse(KEY_A, 401);
    syncAiKey(` ${KEY_A}`);
    expect(getAiKeyStatus()).toBe("rejected");
  });

  it("notifies subscribers on a change only, and unsubscribes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAiKeyStatus(listener);
    syncAiKey(KEY_A);
    expect(listener).not.toHaveBeenCalled(); // unknown → unknown is no change
    reportAiKeyResponse(KEY_A, 401);
    expect(listener).toHaveBeenCalledTimes(1);
    reportAiKeyResponse(KEY_A, 401);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    reportAiKeyResponse(KEY_A, 200);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("unreadable is recorded against the empty key and cleared once a key is entered", () => {
    syncAiKey("");
    reportAiKeyUnreadable();
    expect(getAiKeyStatus()).toBe("unreadable");
    syncAiKey("");
    expect(getAiKeyStatus()).toBe("unreadable");
    syncAiKey(KEY_A);
    expect(getAiKeyStatus()).toBe("unknown");
  });

  it("unreadable is ignored when a non-empty key is already live", () => {
    syncAiKey(KEY_A);
    reportAiKeyUnreadable();
    expect(getAiKeyStatus()).toBe("unknown");
  });

  it("writes nothing to localStorage, sessionStorage or IndexedDB", () => {
    localStorage.clear();
    sessionStorage.clear();
    const lsSet = vi.spyOn(Storage.prototype, "setItem");
    const idb = globalThis.indexedDB;
    const idbOpen = idb ? vi.spyOn(idb, "open") : null;
    syncAiKey(KEY_A);
    reportAiKeyResponse(KEY_A, 401);
    reportAiKeyResponse(KEY_A, 403);
    reportAiKeyResponse(KEY_A, 200);
    syncAiKey("");
    reportAiKeyUnreadable();
    expect(lsSet).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    if (idbOpen) expect(idbOpen).not.toHaveBeenCalled();
  });
});

describe("ai-key-status message helpers", () => {
  it("maps a status to its message key", () => {
    expect(aiKeyMessageKey("rejected")).toBe("aiKeyRejected");
    expect(aiKeyMessageKey("forbidden")).toBe("aiKeyForbidden");
    expect(aiKeyMessageKey("unreadable")).toBe("aiKeyUnreadable");
    expect(aiKeyMessageKey("ok")).toBeNull();
    expect(aiKeyMessageKey("unknown")).toBeNull();
    expect(isAiKeyStatusBad("rejected")).toBe(true);
    expect(isAiKeyStatusBad("ok")).toBe(false);
  });

  it("maps an AiHttpError to the key message only for the auth class", () => {
    expect(aiKeyMessageKeyForError(new AiHttpError(401))).toBe("aiKeyRejected");
    expect(aiKeyMessageKeyForError(new AiHttpError(403))).toBe("aiKeyForbidden");
    expect(aiKeyMessageKeyForError(new AiHttpError(403, "rate_limit_error"))).toBeNull();
    expect(aiKeyMessageKeyForError(new AiHttpError(500))).toBeNull();
    expect(aiKeyMessageKeyForError(new Error("401"))).toBeNull();
    expect(aiKeyMessageKeyForError("401")).toBeNull();
  });

  it("maps a controlled status token (the digit string hooks store) to the key message", () => {
    expect(aiKeyMessageKeyForStatusToken("401")).toBe("aiKeyRejected");
    expect(aiKeyMessageKeyForStatusToken("403")).toBe("aiKeyForbidden");
    expect(aiKeyMessageKeyForStatusToken("500")).toBeNull();
    expect(aiKeyMessageKeyForStatusToken("network")).toBeNull();
    expect(aiKeyMessageKeyForStatusToken(undefined)).toBeNull();
  });
});

// A transport failure (switched-off deployment, refused gateway) is named before the key, and never as the key.
describe("aiFailureMessageKey", () => {
  it("names a transport failure by its own message, a refused key by the key message, anything else null", () => {
    expect(aiFailureMessageKey(new AiDeploymentError("off"))).toBe("aiDeploymentOff");
    expect(aiFailureMessageKey(new AiDeploymentError("unconfirmed"))).toBe("aiDeploymentUnconfirmed");
    expect(aiFailureMessageKey(new AiGatewayError("ai-gateway-rejected"))).toBe("aiGatewayRejected");
    expect(aiFailureMessageKey(new AiGatewayError("ai-gateway-rate-limited"))).toBe("aiGatewayRateLimited");
    expect(aiFailureMessageKey(new AiHttpError(401))).toBe("aiKeyRejected");
    expect(aiFailureMessageKey(new AiHttpError(500))).toBeNull();
    expect(aiFailureMessageKey(new TypeError("Failed to fetch"))).toBeNull();
  });

  it("maps a stored token: a transport message key stays itself, 401/403 name the key, the rest null", () => {
    expect(aiFailureMessageKeyForToken("aiDeploymentInvalid")).toBe("aiDeploymentInvalid");
    expect(aiFailureMessageKeyForToken("aiGatewayFailed")).toBe("aiGatewayFailed");
    expect(aiFailureMessageKeyForToken("aiGatewayRateLimited")).toBe("aiGatewayRateLimited");
    expect(aiFailureMessageKeyForToken("401")).toBe("aiKeyRejected");
    expect(aiFailureMessageKeyForToken("network")).toBeNull();
    expect(aiFailureMessageKeyForToken("off")).toBeNull();
    expect(aiFailureMessageKeyForToken("toString")).toBeNull();
    expect(aiFailureMessageKeyForToken(null)).toBeNull();
  });
});

describe("aiFailureToken — the token a token-keeping hook stores for a refused or unchecked key", () => {
  it.each([
    [new AiKeyRefusedError("organization"), "aiKeyWrongOrganization"],
    [new AiKeyRefusedError("workspace"), "aiKeyWrongWorkspace"],
    [new AiKeyCheckUnavailableError(), "aiKeyCheckUnavailable"],
    [new AiGatewayError("ai-gateway-rejected"), "aiGatewayRejected"],
  ] as const)("%o stores %s, which reads back as its own message", (err, key) => {
    expect(aiFailureToken(err)).toBe(key);
    expect(aiFailureMessageKeyForToken(aiFailureToken(err))).toBe(key);
  });
  it("an Anthropic HTTP error or a plain error is not its business (the hook keeps its own token)", () => {
    expect(aiFailureToken(new AiHttpError(401))).toBeNull();
    expect(aiFailureToken(new Error("parse"))).toBeNull();
  });
});

describe("a key the organisation refuses (AI organisation key)", () => {
  it("reportAiKeyRefused sets the matching status for the live key", () => {
    syncAiKey(KEY_A);
    reportAiKeyRefused(KEY_A, "organization");
    expect(getAiKeyStatus()).toBe("refused-organization");
    reportAiKeyRefused(KEY_A, "workspace");
    expect(getAiKeyStatus()).toBe("refused-workspace");
  });

  it("a refusal measured with a key that is no longer live is dropped", () => {
    syncAiKey(KEY_B);
    reportAiKeyRefused(KEY_A, "organization");
    expect(getAiKeyStatus()).toBe("unknown");
  });

  it("syncAiKey with a different key resets a refusal to unknown; the same key keeps it", () => {
    syncAiKey(KEY_A);
    reportAiKeyRefused(KEY_A, "organization");
    syncAiKey(" " + KEY_A + " ");
    expect(getAiKeyStatus()).toBe("refused-organization");
    syncAiKey(KEY_B);
    expect(getAiKeyStatus()).toBe("unknown");
  });

  it("isKeyBlocked is true for rejected and both refusals, false for the rest", () => {
    expect(isKeyBlocked("rejected")).toBe(true);
    expect(isKeyBlocked("refused-organization")).toBe(true);
    expect(isKeyBlocked("refused-workspace")).toBe(true);
    for (const s of ["unknown", "ok", "forbidden", "unreadable"] as const) expect(isKeyBlocked(s)).toBe(false);
  });

  it("both refusals count as a bad status and name their message", () => {
    expect(isAiKeyStatusBad("refused-organization")).toBe(true);
    expect(isAiKeyStatusBad("refused-workspace")).toBe(true);
    expect(aiKeyMessageKey("refused-organization")).toBe("aiKeyWrongOrganization");
    expect(aiKeyMessageKey("refused-workspace")).toBe("aiKeyWrongWorkspace");
  });

  it("a thrown AiKeyRefusedError names its message", () => {
    expect(aiKeyMessageKeyForError(new AiKeyRefusedError("organization"))).toBe("aiKeyWrongOrganization");
    expect(aiKeyMessageKeyForError(new AiKeyRefusedError("workspace"))).toBe("aiKeyWrongWorkspace");
    expect(aiFailureMessageKey(new AiKeyRefusedError("workspace"))).toBe("aiKeyWrongWorkspace");
  });
});
