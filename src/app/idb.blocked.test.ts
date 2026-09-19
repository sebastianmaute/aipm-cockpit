// §548 — a blocked IndexedDB upgrade must not hold the app forever.
//
// `idb.ts` `openIdb` opens the shared "aipm-cockpit" database at IDB_VERSION.
// If an older tab (a build that predates the `onversionchange` handler below)
// still holds a connection open, the browser fires `blocked` on our request
// and then never fires another event until that tab closes on its own — with
// no handler, the workspace load this backs would wait forever. These tests
// pin the fix's two-sided contract: a newer tab always gets to proceed
// (onversionchange closes OUR connection), and if we are the one that gets
// blocked, we fail the load with a plain Error instead of hanging.
//
// Uses fake-indexeddb for a real IDB implementation under jsdom, same setup
// as storage-browser-kv.test.ts / browser-backend.test.ts.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { idbGet } from "./idb";

const IDB_NAME = "aipm-cockpit";
const BLOCKED_MESSAGE =
  "IndexedDB upgrade is blocked by another open tab of this app. Close the other tabs and reload.";

/** Reads the version the database is CURRENTLY at, by opening it with no
 *  version argument (which never upgrades). ★ DERIVED, never hard-coded: a
 *  literal copy of idb.ts's `IDB_VERSION` goes stale on the next bump, and a
 *  "newer" open at a version that is no longer newer fires no versionchange —
 *  so the test below would pass whether or not the handler exists. */
function openedVersion(): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME);
    req.onsuccess = () => {
      const { version } = req.result;
      req.result.close();
      resolve(version);
    };
    req.onerror = () => reject(req.error as Error);
  });
}

/** Races `promise` against a short timer so a mutant that removes a handler
 *  and leaves the request hanging fails fast instead of stalling the suite
 *  out to vitest's 20s test timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for: ${label}`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e as Error);
      },
    );
  });
}

function deleteIdb(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(IDB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

/** Simulates an old-build tab: opens the DB at version 1 with NO
 *  `onversionchange` handler, so it never yields to a newer tab's upgrade —
 *  exactly the connection shape that predates this fix. */
function openBlockerConnection(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error as Error);
  });
}

/** Raw-opens the DB at a given version and reports whether the request was
 *  blocked, succeeded, or errored — used to observe the state a connection
 *  our code holds leaves behind. */
function rawOpenOutcome(version: number): Promise<"blocked" | "success" | "error"> {
  return new Promise((resolve) => {
    const req = indexedDB.open(IDB_NAME, version);
    req.onblocked = () => resolve("blocked");
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    req.onsuccess = () => {
      resolve("success");
      req.result.close();
    };
    req.onerror = () => resolve("error");
  });
}

describe("openIdb — blocked upgrade", () => {
  beforeEach(() => {
    // Fresh in-memory IDB per test so connections/blocks don't leak across
    // cases (same reset pattern as storage-browser-kv.test.ts).
    globalThis.indexedDB = new IDBFactory();
  });
  afterEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it("rejects with the exact message when another tab's connection blocks the upgrade", async () => {
    await deleteIdb();
    const blockerDb = await openBlockerConnection();
    try {
      await expect(
        withTimeout(idbGet("any-key"), 2000, "idbGet to reject as blocked"),
      ).rejects.toThrow(BLOCKED_MESSAGE);
    } finally {
      blockerDb.close();
    }
  });

  it("closes on versionchange so a newer tab's open succeeds instead of blocking", async () => {
    // idb.ts's callers don't close their connection after an op (verified by
    // reading idb.ts: idbGet/idbSet/idbDelete/idbGetAll/idbBulkUpdate all
    // `await openIdb()` and never call `db.close()`), so the connection this
    // completed call opened is still live — the narrowest honest route to
    // proving `onversionchange` without exporting `openIdb` for the test.
    await idbGet("any-key");
    const current = await openedVersion();
    expect(current).toBeGreaterThan(1); // control: idb.ts really upgraded past a bare open

    const outcome = await withTimeout(
      rawOpenOutcome(current + 1),
      2000,
      "newer-version open to succeed",
    );

    expect(outcome).toBe("success");
  });

  it("closes a late connection that succeeds after the blocked promise already rejected", async () => {
    // A later raw open one version higher is NOT a valid proof by itself: a
    // late connection that merely gains an `onversionchange` handler (but is
    // never closed up front) also yields once THAT open fires versionchange
    // on it — so a "does a later open still succeed" check cannot tell
    // "closed immediately" (Req 3) apart from "leaked, but happens to yield
    // when something else later asks". Spy on the close the fix must make
    // and assert it fires with no further open involved.
    const closeSpy = vi.spyOn(IDBDatabase.prototype, "close");
    try {
      await deleteIdb();
      const blockerDb = await openBlockerConnection();

      await expect(
        withTimeout(idbGet("any-key"), 2000, "idbGet to reject as blocked"),
      ).rejects.toThrow(BLOCKED_MESSAGE);

      // Closing the blocker lets the earlier (already-rejected) open finish
      // its upgrade and fire the late onsuccess this fix must not leak. This
      // call is the blocker's OWN manual close, not the fix under test — it
      // sets the baseline the fix's own close call must exceed.
      blockerDb.close();
      const callsAfterBlockerCloses = closeSpy.mock.calls.length;

      await vi.waitFor(
        () => {
          expect(closeSpy.mock.calls.length).toBeGreaterThan(callsAfterBlockerCloses);
        },
        { timeout: 2000, interval: 20 },
      );
    } finally {
      closeSpy.mockRestore();
    }
  });
});
