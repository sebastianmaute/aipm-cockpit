// src/app/local-file-backend.test.ts
//
// Behavioural cover for LocalFileBackend.load()'s import diagnostics.
//
// ★★ `backend-truncation-registry.test.ts` says "Only LocalFileBackend
// genuinely resists (a File System Access handle)" and names a behavioural
// test per backend as the upgrade path. It does not resist: the handle is
// reached through ONE seam (`idbGet`), and everything downstream of it is an
// interface this file can implement. Only `./idb` is mocked — `fs-access`,
// the CSV codec and the sanitizers all run for real.
//
// ★ The handle CANNOT go through the real (fake-indexeddb) store: IDB
// structure-clones its values and an FsHandle is an object of METHODS, so a
// real round-trip throws DataCloneError. The mock is an in-memory Map for
// exactly that reason, not to avoid IDB.

import { beforeEach, describe, expect, it, vi } from "vitest";

const kv = vi.hoisted(() => new Map<string, unknown>());

// ★★ `idbGet` REALLY DOES REJECT in the browser — `openIdb` rejects when there is
// no `indexedDB` at all, and on a store error. Nothing else in this file can reach
// that path, so it gets an explicit lever rather than a contrived handle.
const idbGetError = vi.hoisted(() => ({ current: null as Error | null }));

vi.mock("./idb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./idb")>();
  return {
    ...actual,
    idbGet: async (key: string) => {
      if (idbGetError.current) throw idbGetError.current;
      return kv.get(key);
    },
    idbSet: async (key: string, value: unknown) => {
      kv.set(key, value);
    },
    idbDelete: async (key: string) => {
      kv.delete(key);
    },
  };
});

// ★★★ ONLY THE PICKER IS REPLACED. `tryGrantPermission` must keep running for real,
// because it is the half of `openFile()` that §287 deliberately LEFT in place — a mock
// covering the whole module would make the test green whether that call survived or not.
const pickedByUser = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("./fs-access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fs-access")>();
  return { ...actual, pickOpenFile: async () => pickedByUser.current };
});

import type { FsHandle } from "./fs-access";
import { LocalFileBackend } from "./local-file-backend";
import { StorageNotReadyError } from "./workspace";

/** A file whose TASKS section both drops a row (no id) AND ends inside a
 *  quoted cell — so ONE load raises BOTH import flags off their defaults,
 *  which is what makes the "cleared" assertions below non-vacuous. */
const DIRTY_CSV = '# TASKS\r\nid,taskName,blockers\r\n,No id at all,\r\n7,T7,"never closed';

function fakeHandle(opts: {
  text?: string;
  permission?: PermissionState;
  getFileError?: Error;
}): FsHandle {
  return {
    name: "project.csv",
    queryPermission: async () => opts.permission ?? "granted",
    requestPermission: async () => opts.permission ?? "granted",
    getFile: async () => {
      if (opts.getFileError) throw opts.getFileError;
      return { text: async () => opts.text ?? "" } as File;
    },
    createWritable: async () => ({
      write: async () => {},
      close: async () => {},
    }),
  };
}

/** Loads DIRTY_CSV and asserts BOTH flags left their defaults. Every test
 *  below calls this FIRST: without a positive observable, a backend that
 *  never sets the flags at all would pass the "cleared" assertions. */
async function loadDirty(be: LocalFileBackend): Promise<void> {
  await be.setHandle(fakeHandle({ text: DIRTY_CSV }));
  await be.load();
  expect(be.lastImportUnterminatedQuote).toBe(true);
  expect(be.lastImportDroppedRows).toBeGreaterThan(0);
}

describe("LocalFileBackend load() import diagnostics", () => {
  beforeEach(() => {
    kv.clear();
    idbGetError.current = null;
  });

  // ★★ THE THREE THROWING EXITS USED TO SKIP THE IMPORT-FLAG RESET, which sat
  // below both StorageNotReadyError throws AND below readHandle, while the
  // `finally` publishes `lastLoadTruncation` only. So a dirty CSV load
  // followed by a failing one left the PREVIOUS file's diagnostics standing.
  it("clears the flags when the handle is gone (local-file-not-picked)", async () => {
    const be = new LocalFileBackend("local-csv");
    await loadDirty(be);

    await be.clearFile();
    await expect(be.load()).rejects.toThrow(StorageNotReadyError);
    expect(be.lastImportUnterminatedQuote).toBe(false);
    expect(be.lastImportDroppedRows).toBe(0);
  });

  it("clears the flags when read permission was revoked", async () => {
    const be = new LocalFileBackend("local-csv");
    await loadDirty(be);

    await be.setHandle(fakeHandle({ text: DIRTY_CSV, permission: "prompt" }));
    await expect(be.load()).rejects.toThrow(StorageNotReadyError);
    expect(be.lastImportUnterminatedQuote).toBe(false);
    expect(be.lastImportDroppedRows).toBe(0);
  });

  // ★ The local analogue of SharePoint's 404: the file the handle points at is
  // gone, so getFile() rejects. This is the exit the sibling's fix did not have
  // to think about, and the one the old comment's "five exits" never counted.
  it("clears the flags when the file behind the handle was deleted", async () => {
    const be = new LocalFileBackend("local-csv");
    await loadDirty(be);

    const gone = new Error("A requested file or directory could not be found");
    gone.name = "NotFoundError";
    await be.setHandle(fakeHandle({ getFileError: gone }));
    await expect(be.load()).rejects.toThrow(/could not be found/);
    expect(be.lastImportUnterminatedQuote).toBe(false);
    expect(be.lastImportDroppedRows).toBe(0);
  });

  // The non-throwing early exit. It always sat below the resets, so this one
  // does NOT kill the mutant — it is here so the empty-file path is not the
  // only exit with no cover at all.
  it("clears the flags when the file is now empty", async () => {
    const be = new LocalFileBackend("local-csv");
    await loadDirty(be);

    await be.setHandle(fakeHandle({ text: "   \r\n" }));
    const ws = await be.load();
    expect(ws.tasks).toEqual([]);
    expect(be.lastImportUnterminatedQuote).toBe(false);
    expect(be.lastImportDroppedRows).toBe(0);
  });

  // ★★ THE TWO QUOTE SIGNALS ARE INDEPENDENT, and DIRTY_CSV is the proof:
  // its quote OPENS at a field start (legal) and is never closed, so the
  // document is unterminated while carrying zero RFC 4180 violations. A reader
  // who assumes one implies the other will mis-read both.
  it("reports no malformed quotes for a file that is merely unterminated", async () => {
    const be = new LocalFileBackend("local-csv");
    await loadDirty(be);
    expect(be.lastImportMalformedQuotes).toBe(0);
  });

  it("publishes a malformed-quote count for a quote opening mid-field", async () => {
    const be = new LocalFileBackend("local-csv");
    await be.setHandle(
      fakeHandle({ text: '# TASKS\r\nid,taskName,blockers\r\n7,a"b",\r\n' }),
    );
    await be.load();
    expect(be.lastImportMalformedQuotes).toBeGreaterThan(0);
    // ★ And the file is otherwise fine — so this is the signal firing on its
    // own, not a by-product of the other two diagnostics.
    expect(be.lastImportUnterminatedQuote).toBe(false);
  });

  // ★★★ THE PRODUCER SIDE, which nothing covered. Every other assertion about
  // `lastImportDroppedBySection` in the repo is against a hand-built object
  // literal or a stub the test itself assigns — those prove the CONSUMER and
  // say nothing about whether a backend ever publishes the field. Deleting the
  // assignment in `load()` killed the whole per-section feature on the primary
  // backend (the toast falls back to a bare "N rows dropped" with no sections
  // named) while the entire suite stayed green.
  it("publishes the per-section breakdown, not just the total", async () => {
    const be = new LocalFileBackend("local-csv");
    await loadDirty(be);
    // DIRTY_CSV's dropped row is a task with no id, so the breakdown must name
    // that section and only that one.
    expect(be.lastImportDroppedBySection).toEqual({ tasks: 1 });
    // ★ The total ALONGSIDE the map, per the single-writer invariant: a second
    // increment path that updated only one of them is otherwise invisible here
    // exactly as it would be in the codec tests.
    expect(be.lastImportDroppedRows).toBe(1);
  });

  // ★★★ THE SECOND LOAD MUST TAKE AN EARLY-RETURN PATH, and a clean CSV is NOT
  // one. Measured, not reasoned: with a clean CSV as the second load, deleting
  // the `= undefined` reset SURVIVED (9/9 passed). On that path the publish at
  // the end of the `try` assigns `diag.droppedBySection`, which is itself
  // `undefined` for a clean file — so the publish clears the field and the reset
  // is redundant. The reset is load-bearing ONLY where the publish never runs:
  // `if (!text.trim()) return emptyWorkspace()` returns before it, as do the
  // not-picked and permission-denied throws. An empty file is therefore the
  // shape that pins it — the same "mutate the FIXTURE, not just the code" rule
  // the sibling SharePoint test states in its own comment.
  it("clears the per-section breakdown when the file is now empty", async () => {
    const be = new LocalFileBackend("local-csv");
    await loadDirty(be);
    expect(be.lastImportDroppedBySection).toEqual({ tasks: 1 });

    await be.setHandle(fakeHandle({ text: "   \r\n" }));
    await be.load();
    // ★ ABSENT, not an empty object and not zeros — a load that decoded nothing
    // inspected nothing, and `{tasks: 0}` would assert an inspection that never
    // happened. Without the reset this reports the FIRST load's breakdown: the
    // stale-flag defect the comment on the reset in `load()` records as having
    // already shipped once on the sibling field.
    expect(be.lastImportDroppedBySection).toBeUndefined();
    expect(be.lastImportDroppedRows).toBe(0);
  });

  it("clears the malformed-quote count on the next clean load", async () => {
    const be = new LocalFileBackend("local-csv");
    await be.setHandle(
      fakeHandle({ text: '# TASKS\r\nid,taskName,blockers\r\n7,a"b",\r\n' }),
    );
    await be.load();
    expect(be.lastImportMalformedQuotes).toBeGreaterThan(0);

    await be.setHandle(fakeHandle({ text: "# TASKS\r\nid,taskName,blockers\r\n7,T7,\r\n" }));
    await be.load();
    expect(be.lastImportMalformedQuotes).toBe(0);
  });
});

// ★★★ THE ONLY THING STANDING BETWEEN §287 AND A SILENT REGRESSION. The fix moved
// the handle commit OUT of `openFile()` and into the caller's accept branch, but the
// hook-level tests covering that branch mock `./storage` wholesale — so they assert that
// `setBackendFileHandle` was or was not called, which is a claim about the CALLER. Those
// tests pass unchanged against the PRE-FIX backend, because pre-fix NOTHING called that
// helper on any path: the bind lived down here. Re-adding `await idbSet(this.idbKey,
// handle)` to `openFile()` tomorrow would restore the data-loss bug with the whole hook
// suite still green. This file is where it is detectable, because only here does the
// real backend run.
describe("LocalFileBackend.openFile does not commit the handle (§287)", () => {
  // ★★★ THIS HOOK IS NOT DECORATION — WITHOUT IT THIS BLOCK FAILS ON A SHUFFLED RUN.
  // `idbGetError` is MODULE-scoped, and the sibling describe below leaves it SET on its
  // last test (the rethrow case) with no afterEach to clear it. Every test here reaches
  // `readHandle()` -> `getHandle()` -> `idbGet`, so if that sibling runs first the mock
  // throws and all three of these error out. vitest shuffles top-level describes against
  // each other, so the order is a function of the seed: MEASURED, not reasoned — seed 1
  // (which is what CI's blocking `unit-tests-shuffled` job pins) happens to keep source
  // order and passes, while `--sequence.seed=3` reorders and fails two of these three.
  // The weekly random-seed job would have found it eventually; open-followups §75 is the
  // record of this class. A describe that mutates module state owes an afterEach or every
  // sibling owes a beforeEach; this file chose the latter, so a NEW describe here needs one.
  beforeEach(() => {
    kv.clear();
    idbGetError.current = null;
  });
  it("leaves the active handle untouched", async () => {
    const be = new LocalFileBackend("local-csv");
    const current = fakeHandle({ text: "" });
    await be.setHandle(current);
    pickedByUser.current = fakeHandle({ text: "" });

    await be.openFile();

    expect(await be.readHandle()).toBe(current);
  });

  it("returns the picked handle to the caller", async () => {
    // ★★ Separate it(), and the positive control for the one above: an `openFile()`
    // that threw, or returned nothing, would satisfy "the active handle is untouched"
    // perfectly while being useless. This pins that the pick still happens and that its
    // result reaches the caller, which is the value the caller then commits.
    const be = new LocalFileBackend("local-csv");
    await be.setHandle(fakeHandle({ text: "" }));
    const picked = fakeHandle({ text: "" });
    pickedByUser.current = picked;

    expect(await be.openFile()).toBe(picked);
  });

  it("commits only when the caller asks, via setHandle", async () => {
    // ★★ The second positive control. Without it, a backend whose `setHandle` was
    // itself broken would make the first test pass for the WRONG reason — the active
    // handle unchanged because nothing can change it, rather than because `openFile`
    // declines to.
    const be = new LocalFileBackend("local-csv");
    await be.setHandle(fakeHandle({ text: "" }));
    const picked = fakeHandle({ text: "" });
    pickedByUser.current = picked;

    await be.setHandle(await be.openFile());

    expect(await be.readHandle()).toBe(picked);
  });
});

// ★★★ THE ONE EXIT ABOVE `loadFrom`'S RESETS. §287 split `load()` into a wrapper
// that awaits `getHandle()` and a `loadFrom(handle)` that does the work, and the resets
// live in `loadFrom`. So a REJECTING handle store became the first exit that could
// happen before any reset ran, leaving the previous load's diagnostics standing — which
// is worse than zeroes, because `truncationOps.reportFor` would then warn about lost
// rows in a file that is perfectly fine.
describe("LocalFileBackend.load resets diagnostics when the handle store rejects", () => {
  beforeEach(() => {
    kv.clear();
    idbGetError.current = null;
  });

  it("clears the import flags a previous load left raised", async () => {
    const be = new LocalFileBackend("local-csv");
    await loadDirty(be);
    expect(be.lastImportUnterminatedQuote).toBe(true); // the state this test needs to exist

    idbGetError.current = new Error("indexedDB unavailable");
    await expect(be.load()).rejects.toThrow("indexedDB unavailable");

    expect(be.lastImportUnterminatedQuote).toBe(false);
    expect(be.lastImportDroppedRows).toBe(0);
  });

  it("clears the truncation field too", async () => {
    // ★★ Its own it(): `lastLoadTruncation` is published by a DIFFERENT mechanism
    // (`loadFrom`'s `finally`) than the import flags above, so a fix that reset only
    // one of the two would leave this unproved if it shared their block.
    const be = new LocalFileBackend("local-csv");
    await loadDirty(be);
    // ★★★ SEEDED BY HAND, and the test was VACUOUS without it. `loadDirty`'s CSV
    // truncates nothing, so this field was already `{0,0}` and the assertion below
    // passed whether or not the reset ran — measured: under the pre-fix wrapper this
    // test stayed GREEN while its sibling went red. A non-zero value is the only thing
    // that makes it discriminate.
    be.lastLoadTruncation = { entries: 3, blocks: 1 };

    idbGetError.current = new Error("indexedDB unavailable");
    await expect(be.load()).rejects.toThrow("indexedDB unavailable");

    expect(be.lastLoadTruncation).toEqual({ entries: 0, blocks: 0 });
  });

  it("rethrows the original error rather than masking it", async () => {
    // ★★★ THE POSITIVE CONTROL, and the one that stops the fix becoming a
    // swallow. A `load()` that caught the rejection and resolved — or that converted it
    // into a generic StorageNotReadyError — would satisfy both assertions above while
    // hiding a real handle-store failure from the caller's own handler.
    const be = new LocalFileBackend("local-csv");
    const cause = new Error("store is closed");
    idbGetError.current = cause;

    await expect(be.load()).rejects.toBe(cause);
  });
});
