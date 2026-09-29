// src/app/pending-edits.test.ts
//
// §626 — the pending-edits outbox: track / settle / flush on pagehide / take.
// jsdom proves the flush happens inside `pagehide`, not that a real browser keeps the write across a
// close; `localStorage.setItem` being synchronous is the mechanism.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import * as diagnostics from "./diagnostics";
import {
  PENDING_EDITS_PREFIX, flushPendingEdits, pendingEditScope, resetPendingEditsForTests,
  settlePendingEdit, takePendingEdits, trackPendingEdit,
} from "./pending-edits";
import { UNLOAD_JOURNAL_MAX_AGE_MS, UNLOAD_JOURNAL_MAX_CHARS } from "./unload-journal";

// Real clock: the pagehide listener stamps savedAt with Date.now(), so `take` must read at about that time.
const NOW = Date.now();
const scope = pendingEditScope("https://db.example.com", "templates");
const storageKey = `${PENDING_EDITS_PREFIX}${scope}`;

function edit(over: Partial<{ id: string; base: string; value: string }> = {}) {
  return { kind: "template-name" as const, id: "t1", base: "A", value: "B", ...over };
}

function pagehide(): void {
  window.dispatchEvent(new Event("pagehide"));
}

describe("pending-edits outbox", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetPendingEditsForTests();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetPendingEditsForTests();
  });

  it("a tracked edit is written on pagehide and taken back", () => {
    trackPendingEdit(scope, edit());
    pagehide();
    const taken = takePendingEdits(scope, NOW);
    expect(taken).toHaveLength(1);
    expect(taken[0]).toMatchObject({ v: 1, kind: "template-name", id: "t1", base: "A", value: "B" });
    expect(takePendingEdits(scope, NOW)).toEqual([]);
  });

  it("nothing touches localStorage before pagehide", () => {
    trackPendingEdit(scope, edit());
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it("flushPendingEdits stamps savedAt with the given time", () => {
    trackPendingEdit(scope, edit());
    flushPendingEdits(NOW);
    expect(takePendingEdits(scope, NOW)[0].savedAt).toBe(NOW);
  });

  it("a settled edit is not written", () => {
    trackPendingEdit(scope, edit());
    settlePendingEdit(scope, "template-name", "t1");
    pagehide();
    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(takePendingEdits(scope, NOW)).toEqual([]);
  });

  it("re-tracking the same kind and id keeps only the latest value", () => {
    trackPendingEdit(scope, edit({ value: "B" }));
    trackPendingEdit(scope, edit({ value: "C" }));
    pagehide();
    const taken = takePendingEdits(scope, NOW);
    expect(taken).toHaveLength(1);
    expect(taken[0].value).toBe("C");
  });

  it("different kinds or ids are kept side by side", () => {
    trackPendingEdit(scope, edit());
    trackPendingEdit(scope, { ...edit(), kind: "template-body" });
    trackPendingEdit(scope, edit({ id: "t2" }));
    pagehide();
    expect(takePendingEdits(scope, NOW)).toHaveLength(3);
  });

  it("settling the last edit of a scope removes a key written earlier", () => {
    trackPendingEdit(scope, edit());
    pagehide();
    settlePendingEdit(scope, "template-name", "t1");
    pagehide();
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it("the storage key and record contain neither the URL nor a token", () => {
    const secret = pendingEditScope("https://db.example.com?authToken=secret-token", "templates");
    trackPendingEdit(secret, edit());
    pagehide();
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key !== null && key.startsWith(PENDING_EDITS_PREFIX)) keys.push(key);
    }
    expect(keys).toHaveLength(1);
    for (const key of keys) {
      const haystack = key + (window.localStorage.getItem(key) ?? "");
      expect(haystack).not.toContain("db.example.com");
      expect(haystack).not.toContain("secret-token");
    }
  });

  it("an edit older than 30 days is dropped", () => {
    const spy = vi.spyOn(diagnostics, "logDiag").mockImplementation(() => {});
    window.localStorage.setItem(storageKey, JSON.stringify([
      { v: 1, ...edit(), savedAt: NOW - UNLOAD_JOURNAL_MAX_AGE_MS - 1 },
    ]));
    expect(takePendingEdits(scope, NOW)).toEqual([]);
    expect(spy).toHaveBeenCalledWith("warn", "storage.pendingEditDropped", expect.objectContaining({ reason: "expired" }));
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it("a corrupt record is dropped and logged", () => {
    const spy = vi.spyOn(diagnostics, "logDiag").mockImplementation(() => {});
    window.localStorage.setItem(storageKey, "{not json");
    expect(takePendingEdits(scope, NOW)).toEqual([]);
    expect(spy).toHaveBeenCalledWith("warn", "storage.pendingEditDropped", expect.objectContaining({ reason: "corrupt" }));
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it("a malformed entry in a valid array is dropped, the good one kept", () => {
    const spy = vi.spyOn(diagnostics, "logDiag").mockImplementation(() => {});
    window.localStorage.setItem(storageKey, JSON.stringify([
      { v: 1, ...edit(), savedAt: NOW },
      { v: 1, kind: "nope", id: 7 },
    ]));
    const taken = takePendingEdits(scope, NOW);
    expect(taken).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith("warn", "storage.pendingEditDropped", expect.objectContaining({ reason: "corrupt" }));
  });

  it("setItem throwing during pagehide does not escape", () => {
    const spy = vi.spyOn(diagnostics, "logDiag").mockImplementation(() => {});
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    trackPendingEdit(scope, edit());
    expect(() => pagehide()).not.toThrow();
    expect(spy).toHaveBeenCalledWith("warn", "storage.pendingEditsWriteFailed", expect.anything());
  });

  it("getItem throwing during take does not escape", () => {
    vi.spyOn(diagnostics, "logDiag").mockImplementation(() => {});
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(takePendingEdits(scope, NOW)).toEqual([]);
  });

  it("a record over UNLOAD_JOURNAL_MAX_CHARS is not written", () => {
    const spy = vi.spyOn(diagnostics, "logDiag").mockImplementation(() => {});
    trackPendingEdit(scope, edit({ value: "x".repeat(UNLOAD_JOURNAL_MAX_CHARS + 1) }));
    pagehide();
    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(spy).toHaveBeenCalledWith("warn", "storage.pendingEditsWriteFailed", expect.objectContaining({ reason: "too-large" }));
  });
});
