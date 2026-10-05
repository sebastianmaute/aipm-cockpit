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

// §635: forces the documents rich-field pass to throw — a sanitizer that throws
// for any reason OTHER than a missing DOM (since §97 a real missing DOM throws
// `DomUnavailableError` and fails the load) — delegating to the real pass unless the flag is set. Reset after
// every test that sets it, so no other test in this file sees it on.
const richThrow = vi.hoisted(() => ({ on: false }));
vi.mock("./document-rich-fields", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./document-rich-fields")>();
  return {
    ...actual,
    sanitizeDocumentRichFields: (doc: Parameters<typeof actual.sanitizeDocumentRichFields>[0]) => {
      if (richThrow.on) throw new TypeError("DOMPurify.sanitize is not a function");
      return actual.sanitizeDocumentRichFields(doc);
    },
  };
});

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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FsHandle } from "./fs-access";
import { LocalFileBackend } from "./local-file-backend";
import { StorageNotReadyError, jsonToWorkspace } from "./workspace";
import { fingerprintWorkspace } from "./unload-journal";

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

// §620 — a stored meta slice that PARSES but SANITIZES TO NOTHING (junk
// `steeringCommittee`, per Task 4's `sanitizedToNothing`) used to be dropped
// silently on a JSON load; the next save then wrote the file without it.
// `jsonToWorkspace` records the JSON key into `diag.decodeFailedSlices`
// (workspace.test.ts pins the decoder itself); this backend's job is only to
// PUBLISH what `loadFrom`'s `diag` collected, exactly like `lastLoadTruncation`.
describe("LocalFileBackend load() §620 decode failures (JSON)", () => {
  beforeEach(() => {
    kv.clear();
    idbGetError.current = null;
  });

  // §635: a strict JSON load WITH a diag records a rich-field throw instead
  // of failing the whole load, so the load paths that call `reportFor` pause saving.
  it("records a documents rich-field throw instead of failing the load (§635)", async () => {
    const be = new LocalFileBackend("local-json");
    await be.setHandle(
      fakeHandle({ text: JSON.stringify({ tasks: [{ id: 7, title: "Kept" }], raid: [], documents: [{ id: 1, title: "Status report", blocks: [{ type: "paragraph", html: "<p>reaches DOMPurify</p>" }], createdAt: "2026-08-06T00:00:00.000Z", updatedAt: "2026-08-06T00:00:00.000Z" }] }) }),
    );
    richThrow.on = true;
    try {
      const ws = await be.load();
      expect(be.lastDecodeFailures).toEqual(["documents"]);
      expect(ws.tasks.map((t) => t.id)).toEqual([7]);
      expect(ws.documents).toBeUndefined();
    } finally {
      richThrow.on = false;
    }
  });

  it("publishes the slice a JSON load could not decode", async () => {
    const be = new LocalFileBackend("local-json");
    await be.setHandle(
      fakeHandle({ text: JSON.stringify({ tasks: [], raid: [], steeringCommittee: "not-an-object" }) }),
    );
    await be.load();
    expect(be.lastDecodeFailures).toEqual(["steeringCommittee"]);
  });

  it("clears the flag on the next clean load — proves the reset, not just the set", async () => {
    const be = new LocalFileBackend("local-json");
    await be.setHandle(
      fakeHandle({ text: JSON.stringify({ tasks: [], raid: [], steeringCommittee: "not-an-object" }) }),
    );
    await be.load();
    expect(be.lastDecodeFailures).toEqual(["steeringCommittee"]); // the state this test needs to exist

    await be.setHandle(fakeHandle({ text: JSON.stringify({ tasks: [], raid: [] }) }));
    await be.load();
    expect(be.lastDecodeFailures).toEqual([]);
  });
});

// §630 — the CSV and Markdown halves of the §620 block above. The codecs now
// record an unreadable meta slice into the same `diag.decodeFailedSlices`
// (csv-/markdown-codecs.meta-slices.test.ts pin the decoders); this pins that
// `loadFrom` publishes it for those two formats too.
describe("LocalFileBackend load() §630 decode failures (CSV and Markdown)", () => {
  beforeEach(() => {
    kv.clear();
    idbGetError.current = null;
  });

  it("publishes the slice a CSV load could not decode", async () => {
    const be = new LocalFileBackend("local-csv");
    await be.setHandle(
      fakeHandle({ text: "# TASKS\r\nid,taskName\r\n7,T7\r\n\r\n# INSIGHTS\r\nconfig,{not json\r\n" }),
    );
    await be.load();
    expect(be.lastDecodeFailures).toEqual(["insights"]);
  });

  it("publishes the slice a Markdown load could not decode", async () => {
    const be = new LocalFileBackend("local-md");
    await be.setHandle(fakeHandle({ text: "## Insights\n\n```json\n{not json\n```\n" }));
    await be.load();
    expect(be.lastDecodeFailures).toEqual(["insights"]);
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

  it("clears decode failures too (§620) — its own mechanism, same placement as the import flags", async () => {
    // ★★ Its own it(), like `lastLoadTruncation` above: `lastDecodeFailures` is
    // published by `loadFrom`'s `finally` on a normal exit, but reset directly
    // in `load()`'s catch when the handle lookup itself rejects (before
    // `loadFrom` is ever entered) — a THIRD site, not covered by proving the
    // other two reset.
    const be = new LocalFileBackend("local-json");
    await be.setHandle(
      fakeHandle({ text: JSON.stringify({ tasks: [], raid: [], steeringCommittee: "not-an-object" }) }),
    );
    await be.load();
    expect(be.lastDecodeFailures).toEqual(["steeringCommittee"]); // the state this test needs to exist

    idbGetError.current = new Error("indexedDB unavailable");
    await expect(be.load()).rejects.toThrow("indexedDB unavailable");

    expect(be.lastDecodeFailures).toEqual([]);
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

// §629 unload-journal Step 3 — the local-json round-trip proof lives HERE
// rather than in unload-journal.test.ts: it needs a WRITABLE fake handle
// (write() actually updates what the next getFile() returns), and this file
// already mocks `./idb` as the in-memory handle store that setHandle/getHandle
// need. Mocking `./idb` in unload-journal.test.ts too would break the real
// fake-indexeddb calls its OWN (browser-kind) round-trip proof depends on.
function writableFakeHandle(): FsHandle {
  let text = "";
  return {
    name: "project.json",
    queryPermission: async () => "granted",
    requestPermission: async () => "granted",
    getFile: async () => ({ text: async () => text }) as File,
    createWritable: async () => ({
      write: async (data: string | Blob) => {
        text = typeof data === "string" ? data : text;
      },
      close: async () => {},
    }),
  };
}

const repoRoot = join(import.meta.dirname, "..", "..");
const smallWs = jsonToWorkspace(readFileSync(join(repoRoot, "sample-workspace-small.json"), "utf8"));
const bigWs = jsonToWorkspace(readFileSync(join(repoRoot, "sample-workspace-big.json"), "utf8"));

describe("fingerprint round-trip: local-json (§629 unload journal Step 3)", () => {
  beforeEach(() => {
    kv.clear();
    idbGetError.current = null;
  });

  it("small sample workspace", async () => {
    const before = fingerprintWorkspace(smallWs);
    const be = new LocalFileBackend("local-json");
    await be.setHandle(writableFakeHandle());
    // Fix round 1 — this instance never loaded the freshly-bound handle, so
    // under the new fail-closed rule save() would refuse. This test is about
    // the save→load round trip, not blind-write semantics, so force this
    // first write exactly like a real create/Save-As flow would.
    be.forceNextSave();
    await be.save(smallWs);
    const loaded = await be.load();
    expect(fingerprintWorkspace(loaded)).toBe(before);
  });

  it("bigger sample workspace (documents included)", async () => {
    const before = fingerprintWorkspace(bigWs);
    const be = new LocalFileBackend("local-json");
    await be.setHandle(writableFakeHandle());
    // Fix round 1 — see the sibling test above.
    be.forceNextSave();
    await be.save(bigWs);
    const loaded = await be.load();
    expect(fingerprintWorkspace(loaded)).toBe(before);
  });
});

// §28 — the CSV/Markdown codecs are DOM-free, so a dangerous rich cell used to
// reach the app un-sanitized from these two backends. The load runs the same
// post-decode pass `jsonToWorkspace` applies.
describe("LocalFileBackend load() sanitizes rich fields (§28)", () => {
  beforeEach(() => {
    kv.clear();
    idbGetError.current = null;
  });

  it("strips script-bearing markup from a CSV task description and keeps the text", async () => {
    const be = new LocalFileBackend("local-csv");
    await be.setHandle(
      fakeHandle({ text: '# TASKS\r\nid,taskName,description\r\n1,T,"<p>ok</p><img src=x onerror=""alert(1)"">"\r\n' }),
    );
    const ws = await be.load();
    expect(ws.tasks[0]!.description).toContain("<p>ok</p>");
    expect(ws.tasks[0]!.description).not.toContain("onerror");
  });
});
