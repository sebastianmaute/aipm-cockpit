import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetAiKeyStatusForTests,
  aiKeyMessageKey,
  aiKeyMessageKeyForError,
  aiKeyMessageKeyForStatusToken,
  getAiKeyStatus,
  isAiKeyStatusBad,
  reportAiKeyResponse,
  reportAiKeyUnreadable,
  subscribeAiKeyStatus,
  syncAiKey,
} from "./ai-key-status";
import { AiHttpError } from "./ai-errors";

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
