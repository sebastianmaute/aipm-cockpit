// src/app/local-file-backend.revision.test.ts
//
// §4 §645 — LocalFileBackend's revision guard: a save that would overwrite
// another writer's newer data throws SaveConflictError and writes nothing,
// AND a project switch in one window/tab must not redirect another window's
// save (the "handle per window" half of §645). Mirrors
// browser-backend.revision.test.ts's shape, but the "other writer" here is
// modelled as a foreign process mutating the same FsHandle's content +
// revision directly (createWritable/close bypassed), and the "other window"
// is a second LocalFileBackend instance sharing the same mocked IDB
// handle-slot.
//
// §4 fix round 1 (R10) additions: fail-closed on an unknown revision (change
// 1), the R6 one-shot pre-read (change 2), adoptFrom (change 3), the force
// flag surviving a failed write (change 4), the lock-wait timeout (change 6)
// and the lastModified:size revision encoding (change 7).
//
// ★ `./idb` is mocked with an in-memory Map, exactly like
// local-file-backend.test.ts: an FsHandle is an object of methods, and a real
// IDB store structure-clones its values, so a genuine round-trip through
// fake-indexeddb would throw DataCloneError.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const kvStore = vi.hoisted(() => new Map<string, unknown>());
/** Round 4 RI3 — runs after each slot read, so a test can play another tab writing between two reads. */
const readHook = vi.hoisted(() => ({ current: null as null | ((key: string) => void) }));
/** Round 5 — runs before each slot write; a test throws from it to play a rejecting `idbSet` (quota). */
const writeHook = vi.hoisted(() => ({ current: null as null | ((key: string) => void) }));
const { logDiagSpy } = vi.hoisted(() => ({ logDiagSpy: vi.fn() }));
vi.mock("./diagnostics", async (importOriginal) => ({ ...(await importOriginal<typeof import("./diagnostics")>()), logDiag: logDiagSpy }));
const PROJECT_HANDLES = vi.hoisted(() => new Map<string, unknown>());
vi.mock("./project-file-handles", () => ({
  getHandle: vi.fn(async (id: string) => PROJECT_HANDLES.get(id) ?? null),
  saveHandle: vi.fn(async () => undefined),
  deleteHandle: vi.fn(async () => undefined),
}));

vi.mock("./idb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./idb")>();
  return {
    ...actual,
    idbGet: async (key: string) => {
      const value = kvStore.get(key);
      readHook.current?.(key);
      return value;
    },
    idbSet: async (key: string, value: unknown) => {
      writeHook.current?.(key);
      kvStore.set(key, value);
    },
    idbDelete: async (key: string) => {
      kvStore.delete(key);
    },
  };
});

import type { FsHandle } from "./fs-access";
import { LocalFileBackend } from "./local-file-backend";
import { addProject, emptyRegistry, saveRegistry } from "./projects-registry";
import { emptyWorkspace, workspaceToJson } from "./workspace";
import { SaveConflictError, SaveLockTimeoutError } from "./storage-error";

/** The `lastModified:size` encoding (R10 change 7), spelled out once here so
 *  a test asserting an EXACT revision string does not hardcode the format. */
function rev(lastModified: number, text: string): string {
  return `${lastModified}:${text.length}`;
}

/**
 * Extends the `writableFakeHandle` pattern from local-file-backend.test.ts
 * with a revision that actually changes on every real write — `lastModified`
 * via a monotonic COUNTER, never `Date.now()`, so two writes inside the same
 * millisecond still produce distinct revisions (controller ruling), and
 * `size` as the live `text.length` (R10 change 7's second component).
 *
 * `externalWrite` simulates a FOREIGN process (another program, or — for the
 * §645 "handle per window" tests — nothing at all, since those tests instead
 * point a SECOND backend instance at a different handle) mutating the file
 * directly, bypassing `createWritable`/`close`, but through the SAME counter
 * so the bump is still observable and still monotonic. `armWriteFailure`
 * makes the very next `createWritable()` throw once (R10 change 4).
 */
function revisionFakeHandle(initial: { text?: string; lastModified?: number } = {}): FsHandle & {
  externalWrite(text: string): void;
  armWriteFailure(): void;
} {
  let text = initial.text ?? "";
  let counter = initial.lastModified ?? 1000;
  let failNextWrite = false;
  return {
    name: "project.json",
    queryPermission: async () => "granted",
    requestPermission: async () => "granted",
    getFile: async () =>
      ({ text: async () => text, lastModified: counter, size: text.length }) as unknown as File,
    createWritable: async () => {
      if (failNextWrite) {
        failNextWrite = false;
        throw new Error("simulated write failure");
      }
      return {
        write: async (data: string | Blob) => {
          text = typeof data === "string" ? data : text;
        },
        close: async () => {
          counter += 1;
        },
      };
    },
    externalWrite(newText: string) {
      text = newText;
      counter += 1;
    },
    armWriteFailure() {
      failNextWrite = true;
    },
  };
}

describe("LocalFileBackend §4 §645 revision guard", () => {
  beforeEach(() => {
    kvStore.clear();
  });

  afterEach(() => {
    // Restore navigator state even if a test below threw before its own cleanup.
    Reflect.deleteProperty(navigator, "locks");
  });

  it("revision() after load matches the file's revision; after save it's the new one", async () => {
    const be = new LocalFileBackend("local-json");
    const handle = revisionFakeHandle({ text: "", lastModified: 1000 });
    await be.setHandle(handle);

    await be.load();
    expect(be.revision()).toBe(rev(1000, ""));

    await be.save(emptyWorkspace());
    const file = await handle.getFile();
    expect(be.revision()).toBe(rev(file.lastModified, await file.text()));
    expect(be.revision()).not.toBe(rev(1000, ""));
  });

  it("a foreign write between load and save rejects with SaveConflictError and writes nothing", async () => {
    const be = new LocalFileBackend("local-json");
    // Empty text so load() takes the empty-workspace short-circuit rather than
    // parsing JSON — this test is about the revision compare, not content.
    const handle = revisionFakeHandle({ text: "", lastModified: 1000 });
    await be.setHandle(handle);
    await be.load();

    // Another program changed the file after our load.
    handle.externalWrite("mutated-by-someone-else");

    await expect(be.save(emptyWorkspace())).rejects.toBeInstanceOf(SaveConflictError);

    const file = await handle.getFile();
    expect(await file.text()).toBe("mutated-by-someone-else");
  });

  it("§645: instance A bound to file X; instance B's setHandle(Y) does not redirect A's next save", async () => {
    const a = new LocalFileBackend("local-json");
    const b = new LocalFileBackend("local-json");
    // X is empty so a.load() takes the empty-workspace short-circuit rather
    // than parsing JSON. Y is never loaded/parsed by anyone in this test, so
    // it can carry distinguishable non-JSON content to prove it stays untouched.
    const x = revisionFakeHandle({ text: "", lastModified: 1000 });
    const y = revisionFakeHandle({ text: "Y-original", lastModified: 2000 });

    await a.setHandle(x);
    await a.load();

    // B rewrites the SHARED idb slot to point at Y.
    await b.setHandle(y);

    // A's next save must still target X, not the slot's new value.
    await expect(a.save({ ...emptyWorkspace(), tasks: [] })).resolves.toBeUndefined();

    const xFile = await x.getFile();
    const yFile = await y.getFile();
    expect(await xFile.text()).toBe(workspaceToJson({ ...emptyWorkspace(), tasks: [] }));
    expect(await yFile.text()).toBe("Y-original");
  });

  it("a fresh instance with no bound handle still reads the slot (restores the last file on startup)", async () => {
    const seed = new LocalFileBackend("local-json");
    const handle = revisionFakeHandle({ text: "", lastModified: 1000 });
    await seed.setHandle(handle);

    const fresh = new LocalFileBackend("local-json");
    await fresh.load();
    expect(fresh.revision()).toBe(rev(1000, ""));
  });

  it("forceNextSave() writes despite a foreign change and adopts the new revision", async () => {
    const be = new LocalFileBackend("local-json");
    const handle = revisionFakeHandle({ text: "", lastModified: 1000 });
    await be.setHandle(handle);
    await be.load();

    handle.externalWrite("mutated-by-someone-else");

    be.forceNextSave();
    await expect(be.save(emptyWorkspace())).resolves.toBeUndefined();

    const file = await handle.getFile();
    expect(await file.text()).toBe(workspaceToJson(emptyWorkspace()));
    expect(be.revision()).toBe(rev(file.lastModified, await file.text()));
    expect(be.revision()).not.toBe(rev(1000, ""));
  });

  // §4 fix round 1 (R10 change 1) — fail closed.
  describe("fail-closed on an unknown revision (R10 change 1)", () => {
    it("a bound-but-never-loaded instance refuses to save, and writes nothing", async () => {
      const be = new LocalFileBackend("local-json");
      const handle = revisionFakeHandle({ text: "original", lastModified: 1000 });
      await be.setHandle(handle);
      // Never loaded, never forced, never adopted: currentRevision is UNKNOWN.

      await expect(be.save(emptyWorkspace())).rejects.toBeInstanceOf(SaveConflictError);

      const file = await handle.getFile();
      expect(await file.text()).toBe("original");
    });

    it("a fresh instance restored from the slot (never loaded by THIS instance) also refuses", async () => {
      // "restores the last file on startup" (above) binds via getHandle()'s
      // slot fallback, but binding alone is not a load: this instance's own
      // revision is still unknown until it actually reads the file.
      const seed = new LocalFileBackend("local-json");
      const handle = revisionFakeHandle({ text: "original", lastModified: 1000 });
      await seed.setHandle(handle);

      const fresh = new LocalFileBackend("local-json");
      // Deliberately no fresh.load() — only the slot fallback binds the handle.
      await expect(fresh.save(emptyWorkspace())).rejects.toBeInstanceOf(SaveConflictError);

      const file = await handle.getFile();
      expect(await file.text()).toBe("original");
    });

    it("forceNextSave lets a never-loaded instance write anyway (the intentional-blind-write escape hatch)", async () => {
      const be = new LocalFileBackend("local-json");
      const handle = revisionFakeHandle({ text: "original", lastModified: 1000 });
      await be.setHandle(handle);

      be.forceNextSave();
      await expect(be.save(emptyWorkspace())).resolves.toBeUndefined();

      const file = await handle.getFile();
      expect(await file.text()).toBe(workspaceToJson(emptyWorkspace()));
    });
  });

  // §4 fix round 1 (R10 change 2) — the R6 one-shot pre-read.
  describe("R6 one-shot pre-read (R10 change 2)", () => {
    it("setHandle adopts the revision from a prior loadFrom of the SAME handle (preview-then-commit)", async () => {
      const be = new LocalFileBackend("local-json");
      const handle = revisionFakeHandle({ text: "", lastModified: 1000 });

      // Preview: read the candidate file WITHOUT binding (§287/§590).
      await be.loadFrom(handle);
      expect(be.revision()).toBeNull(); // not yet bound — nothing adopted yet

      // Commit: bind it now.
      await be.setHandle(handle);

      // No load() of the BOUND handle happened, but the preview read already
      // established a real baseline — the very next save must not fail-closed.
      expect(be.revision()).toBe(rev(1000, ""));
      await expect(be.save(emptyWorkspace())).resolves.toBeUndefined();
    });

    it("is consumed (one-shot): a second bind of the SAME handle without a fresh loadFrom does not reuse it", async () => {
      const be = new LocalFileBackend("local-json");
      const handle = revisionFakeHandle({ text: "", lastModified: 1000 });

      await be.loadFrom(handle);
      await be.setHandle(handle); // consumes the pre-read
      expect(be.revision()).toBe(rev(1000, ""));

      await be.setHandle(handle); // re-bind the SAME handle, no fresh loadFrom
      expect(be.revision()).toBeNull();
    });

    it("does not transfer to a setHandle of a DIFFERENT handle", async () => {
      const be = new LocalFileBackend("local-json");
      const x = revisionFakeHandle({ text: "", lastModified: 1000 });
      const y = revisionFakeHandle({ text: "", lastModified: 2000 });

      await be.loadFrom(x); // preview X
      await be.setHandle(y); // commit a DIFFERENT handle, Y

      expect(be.revision()).toBeNull();
      await expect(be.save(emptyWorkspace())).rejects.toBeInstanceOf(SaveConflictError);
    });

    it("is overwritten (never merged) by a later loadFrom of a different handle", async () => {
      const be = new LocalFileBackend("local-json");
      const x = revisionFakeHandle({ text: "", lastModified: 1000 });
      const y = revisionFakeHandle({ text: "", lastModified: 2000 });

      await be.loadFrom(x); // remembers X
      await be.loadFrom(y); // overwrites the memory with Y
      await be.setHandle(x); // X's pre-read is gone — no match

      expect(be.revision()).toBeNull();
    });
  });

  // §4 fix round 1 (R10 change 4) — force flag survives a failed write.
  it("forceNextSave keeps the flag when the forced write fails, for a retry", async () => {
    const be = new LocalFileBackend("local-json");
    const handle = revisionFakeHandle({ text: "", lastModified: 1000 });
    await be.setHandle(handle);
    await be.load();

    // The file now conflicts AND the next write attempt will itself fail.
    handle.externalWrite("mutated-by-someone-else");
    handle.armWriteFailure();

    be.forceNextSave();
    await expect(be.save(emptyWorkspace())).rejects.toThrow(); // the write failure, not SaveConflictError

    // The flag must still be set: a retry (the write will succeed this time)
    // must STILL skip the compare, even though the file is still "conflicting".
    await expect(be.save(emptyWorkspace())).resolves.toBeUndefined();
    const file = await handle.getFile();
    expect(await file.text()).toBe(workspaceToJson(emptyWorkspace()));
  });

  // §4 fix round 1 (R10 change 3) — adoptFrom.
  it("adoptFrom(other): an instance adopted from a loaded instance saves without conflict and writes the adopted handle, not the slot's current one", async () => {
    const op = new LocalFileBackend("local-json");
    const x = revisionFakeHandle({ text: "", lastModified: 1000 });
    await op.setHandle(x);
    await op.load();

    const live = new LocalFileBackend("local-json");
    const y = revisionFakeHandle({ text: "Y-original", lastModified: 2000 });
    // live's OWN bind, simulating the shared slot currently pointing elsewhere.
    await live.setHandle(y);

    live.adoptFrom(op);

    await expect(live.save({ ...emptyWorkspace(), tasks: [] })).resolves.toBeUndefined();

    const xFile = await x.getFile();
    const yFile = await y.getFile();
    expect(await xFile.text()).toBe(workspaceToJson({ ...emptyWorkspace(), tasks: [] }));
    expect(await yFile.text()).toBe("Y-original");
  });

  // §4 fix round 3 (Important #1) — a leftover force from a FAILED forced
  // save must not carry over to a different target (or a genuinely
  // re-established baseline).
  describe("a failed forced save's leftover force does not carry over (fix round 3)", () => {
    it("is cleared by setHandle, so re-binding to a different target still refuses", async () => {
      const be = new LocalFileBackend("local-json");
      const a = revisionFakeHandle({ text: "", lastModified: 1000 });
      await be.setHandle(a);
      await be.load();

      a.externalWrite("mutated-by-someone-else");
      a.armWriteFailure();
      be.forceNextSave();
      await expect(be.save(emptyWorkspace())).rejects.toThrow(); // the forced write itself fails

      // Re-bind to a DIFFERENT target B. Without the fix, the leftover force
      // would let the next save on B skip BOTH the null check and the
      // compare — a silent overwrite of whatever B actually holds.
      const b = revisionFakeHandle({ text: "B-original", lastModified: 2000 });
      await be.setHandle(b);

      await expect(be.save(emptyWorkspace())).rejects.toBeInstanceOf(SaveConflictError);
      const bFile = await b.getFile();
      expect(await bFile.text()).toBe("B-original");
    });

    it("is cleared by a successful reload of the bound target", async () => {
      const be = new LocalFileBackend("local-json");
      const handle = revisionFakeHandle({ text: "", lastModified: 1000 });
      await be.setHandle(handle);
      await be.load();

      // Bump the revision without touching content validity — `be.load()`
      // below must successfully re-parse it (empty text takes the
      // empty-workspace short-circuit), so this is NOT about a parse failure.
      handle.externalWrite("");
      handle.armWriteFailure();
      be.forceNextSave();
      await expect(be.save(emptyWorkspace())).rejects.toThrow();

      // A real reload of the SAME bound handle re-establishes a genuine
      // baseline — the leftover force must not survive it.
      await be.load();

      // Another foreign write lands AFTER this reload.
      handle.externalWrite("");

      await expect(be.save(emptyWorkspace())).rejects.toBeInstanceOf(SaveConflictError);
    });

    it("is cleared by adoptRevision", async () => {
      const be = new LocalFileBackend("local-json");
      const handle = revisionFakeHandle({ text: "", lastModified: 1000 });
      await be.setHandle(handle);
      await be.load();

      handle.externalWrite("mutated-by-someone-else");
      handle.armWriteFailure();
      be.forceNextSave();
      await expect(be.save(emptyWorkspace())).rejects.toThrow();

      // Catch up via adoptRevision instead of retrying the forced write.
      const file = await handle.getFile();
      be.adoptRevision(rev(file.lastModified, await file.text()));

      handle.externalWrite("mutated-again");

      await expect(be.save(emptyWorkspace())).rejects.toBeInstanceOf(SaveConflictError);
    });

    it("is cleared by adoptFrom on the LIVE instance", async () => {
      const live = new LocalFileBackend("local-json");
      const handle = revisionFakeHandle({ text: "", lastModified: 1000 });
      await live.setHandle(handle);
      await live.load();
      handle.externalWrite("mutated");
      handle.armWriteFailure();
      live.forceNextSave();
      await expect(live.save(emptyWorkspace())).rejects.toThrow();

      const op = new LocalFileBackend("local-json");
      const other = revisionFakeHandle({ text: "", lastModified: 5000 });
      await op.setHandle(other);
      await op.load();

      live.adoptFrom(op);
      other.externalWrite("mutated-other");

      await expect(live.save(emptyWorkspace())).rejects.toBeInstanceOf(SaveConflictError);
    });
  });

  // §4 fix round 3 (controller ruling R11) — a parse failure must not become
  // the save baseline.
  describe("a parse failure does not become the save baseline (R11)", () => {
    it("leaves revision() unchanged when the BOUND handle's content fails to parse", async () => {
      const be = new LocalFileBackend("local-json");
      const handle = revisionFakeHandle({ text: "", lastModified: 1000 });
      await be.setHandle(handle);
      await be.load(); // establishes a real baseline
      const before = be.revision();

      handle.externalWrite("{not valid json"); // corrupt + bumps the revision

      await expect(be.load()).rejects.toThrow(); // WorkspaceParseError (strict JSON)

      expect(be.revision()).toBe(before); // the corrupt read was never adopted
    });

    it("records no pendingRead when an unbound preview handle fails to parse", async () => {
      const be = new LocalFileBackend("local-json");
      const handle = revisionFakeHandle({ text: "{not valid json", lastModified: 1000 });

      // Preview via loadFrom on an UNBOUND handle (§287/§590) — fails to parse.
      await expect(be.loadFrom(handle)).rejects.toThrow();

      // Binding it now must NOT pick up a pendingRead from the failed parse —
      // there is none, so this falls back to unknown.
      await be.setHandle(handle);
      expect(be.revision()).toBeNull();
    });
  });

  describe("with navigator.locks present", () => {
    const defineLocks = (
      request: (name: string, options: unknown, cb: () => Promise<unknown>) => Promise<unknown>,
    ) => {
      Object.defineProperty(navigator, "locks", { value: { request }, configurable: true });
    };

    it("runs save() under navigator.locks.request with the per-kind lock name", async () => {
      const seenNames: string[] = [];
      defineLocks((name, _options, cb) => {
        seenNames.push(name);
        return cb();
      });

      const be = new LocalFileBackend("local-csv");
      const handle = revisionFakeHandle({ text: "", lastModified: 1000 });
      await be.setHandle(handle);
      await be.load();

      await be.save(emptyWorkspace());

      expect(seenNames).toEqual(["aipm-cockpit:save:local-csv"]);
    });

    // §4 fix round 1 (R10 change 6) — lock-wait timeout.
    it("a lock-wait timeout surfaces as SaveLockTimeoutError and writes nothing", async () => {
      const handle = revisionFakeHandle({ text: "original", lastModified: 1000 });
      const be = new LocalFileBackend("local-json");
      await be.setHandle(handle);
      // The wait itself is aborted before the callback ever runs — modelling
      // AbortSignal.timeout firing while another window still holds the lock.
      defineLocks(async () => {
        throw new DOMException("The operation was aborted.", "AbortError");
      });

      await expect(be.save(emptyWorkspace())).rejects.toBeInstanceOf(SaveLockTimeoutError);

      const file = await handle.getFile();
      expect(await file.text()).toBe("original");
    });

    it("a real failure INSIDE the held lock (e.g. a save conflict) passes through unchanged, not as a timeout", async () => {
      defineLocks((_name, _options, cb) => cb());

      const be = new LocalFileBackend("local-json");
      const handle = revisionFakeHandle({ text: "", lastModified: 1000 });
      await be.setHandle(handle);
      await be.load();
      handle.externalWrite("mutated-by-someone-else");

      await expect(be.save(emptyWorkspace())).rejects.toBeInstanceOf(SaveConflictError);
    });
  });

  describe("with navigator.locks absent", () => {
    it("still compares and rejects a stale save (same result as with a lock)", async () => {
      expect((navigator as { locks?: unknown }).locks).toBeUndefined();

      const be = new LocalFileBackend("local-json");
      const handle = revisionFakeHandle({ text: "", lastModified: 1000 });
      await be.setHandle(handle);
      await be.load();

      handle.externalWrite("mutated-by-someone-else");

      await expect(be.save(emptyWorkspace())).rejects.toBeInstanceOf(SaveConflictError);
    });
  });
});

// §4 fix round 1 of Task 9 — the conditional overwrite: `forceNextSave(expected)` writes the whole
// file ONLY while it is still at `expected` (the version the user was shown), and a refusal reports
// the revision storage holds.
describe("LocalFileBackend §4 conditional overwrite", () => {
  beforeEach(() => { kvStore.clear(); });

  async function loaded(text = "") {
    const be = new LocalFileBackend("local-json");
    const handle = revisionFakeHandle({ text, lastModified: 1000 });
    await be.setHandle(handle);
    await be.load();
    return { be, handle };
  }
  const refusal = (p: Promise<unknown>) => p.then(() => null, (err: unknown) => err as SaveConflictError);

  it("a refused save reports the file's current revision", async () => {
    const { be, handle } = await loaded();
    handle.externalWrite("peer");
    const err = await refusal(be.save(emptyWorkspace()));
    expect(err).toBeInstanceOf(SaveConflictError);
    expect(err!.currentRevision).toBe(rev(1001, "peer"));
  });

  it("a bound-but-never-loaded instance reads the file before refusing, and reports its revision", async () => {
    const be = new LocalFileBackend("local-json");
    const handle = revisionFakeHandle({ text: "original", lastModified: 1000 });
    await be.setHandle(handle);
    const err = await refusal(be.save(emptyWorkspace()));
    expect(err).toBeInstanceOf(SaveConflictError);
    expect(err!.currentRevision).toBe(rev(1000, "original"));
    expect(await (await handle.getFile()).text()).toBe("original");
  });

  it("writes when the file is still at the expected revision, and adopts the new one", async () => {
    const { be, handle } = await loaded();
    handle.externalWrite("peer");
    be.forceNextSave(rev(1001, "peer"));
    expect(be.revision()).toBe(rev(1000, "")); // arming does not move the instance's own revision
    await be.save(emptyWorkspace());
    const file = await handle.getFile();
    expect(await file.text()).toBe(workspaceToJson(emptyWorkspace()));
    expect(be.revision()).toBe(rev(file.lastModified, await file.text()));
  });

  it("refuses when the file moved past the expected revision, writes nothing, and reports the new one", async () => {
    const { be, handle } = await loaded();
    handle.externalWrite("peer");
    be.forceNextSave(rev(1001, "peer"));
    handle.externalWrite("peer again");
    const err = await refusal(be.save(emptyWorkspace()));
    expect(err).toBeInstanceOf(SaveConflictError);
    expect(err!.currentRevision).toBe(rev(1002, "peer again"));
    expect(await (await handle.getFile()).text()).toBe("peer again");
  });

  it("the conditional one-shot is consumed by a failed attempt: the next save compares its own revision again", async () => {
    const { be, handle } = await loaded();
    handle.externalWrite("peer");
    handle.armWriteFailure();
    be.forceNextSave(rev(1001, "peer"));
    const failed = await refusal(be.save(emptyWorkspace()));
    expect(failed).toBeInstanceOf(Error);
    expect(failed).not.toBeInstanceOf(SaveConflictError); // the write failed; nothing refused it
    await expect(be.save(emptyWorkspace())).rejects.toBeInstanceOf(SaveConflictError);
    expect(await (await handle.getFile()).text()).toBe("peer");
  });
});

// §645 (final re-review RC1) — the shared slot stores the tab-sync binding WITH the handle, so a later
// instance (a reload, a new window) reads the binding of the file it opens.
describe("LocalFileBackend §645 the slot's binding", () => {
  beforeEach(() => { kvStore.clear(); });

  it("setHandle and pickFile store the binding with the handle, and a fresh instance reads it back", async () => {
    const handle = revisionFakeHandle();
    const a = new LocalFileBackend("local-json");
    await a.setHandle(handle, "p1");
    expect(kvStore.get("file-handle:local-json")).toEqual({ handle, binding: "p1" });
    expect(a.fileBinding()).toBe("p1");
    const b = new LocalFileBackend("local-json");
    expect(b.fileBinding()).toBeNull(); // unbound
    await b.load();
    expect(b.fileBinding()).toBe("p1");
    const picked = revisionFakeHandle();
    vi.stubGlobal("showSaveFilePicker", vi.fn(async () => picked));
    try {
      await a.pickFile("picked:u1");
    } finally {
      vi.unstubAllGlobals();
    }
    expect(kvStore.get("file-handle:local-json")).toEqual({ handle: picked, binding: "picked:u1" });
    expect(a.fileBinding()).toBe("picked:u1");
  });

  it("an old slot holding the bare handle still opens the file, and is upgraded with a binding (RI3)", async () => {
    const handle = revisionFakeHandle({ text: workspaceToJson(emptyWorkspace()) });
    kvStore.set("file-handle:local-json", handle);
    const be = new LocalFileBackend("local-json");
    await be.load();
    expect(be.fileBinding()).toMatch(/^picked:/);
    expect(be.revision()).not.toBeNull(); // it really read the file
  });

  it("adoptFrom carries the binding, and clearFile drops it", async () => {
    const from = new LocalFileBackend("local-json");
    await from.setHandle(revisionFakeHandle(), "p2");
    const live = new LocalFileBackend("local-json");
    live.adoptFrom(from);
    expect(live.fileBinding()).toBe("p2");
    await live.clearFile();
    expect(live.fileBinding()).toBeNull();
  });
});

// §645 (final re-review 3 RI3) — a bare-handle slot (written before the binding was stored, or by a tab
// still on old code) is UPGRADED by the first load that reads it, so later loads of that file share one
// binding instead of each isolating.
describe("LocalFileBackend §645 a bare slot is upgraded on first read", () => {
  const SLOT = "file-handle:local-json";
  beforeEach(() => { kvStore.clear(); PROJECT_HANDLES.clear(); localStorage.clear(); readHook.current = null; writeHook.current = null; logDiagSpy.mockClear(); });
  afterEach(() => { readHook.current = null; writeHook.current = null; localStorage.clear(); });

  // Final re-review 4, minor: the upgrade is a courtesy to LATER windows. A write that fails must not fail
  // the load that a bare slot used to serve fine. The window keeps the binding it computed for the handle it
  // actually opened, so it can never name another file.
  it("an upgrade whose idbSet rejects still loads, logs it, keeps the computed binding and leaves the slot bare", async () => {
    const handle = revisionFakeHandle({ text: workspaceToJson(emptyWorkspace()) });
    kvStore.set(SLOT, handle);
    writeHook.current = (key) => { if (key === SLOT) throw new DOMException("quota", "QuotaExceededError"); };
    const be = new LocalFileBackend("local-json");
    await expect(be.load()).resolves.toBeDefined();
    expect(be.revision()).not.toBeNull(); // it really read the file
    expect(be.fileBinding()).toMatch(/^picked:/);
    expect(kvStore.get(SLOT)).toBe(handle); // still bare: a later window upgrades it
    expect(logDiagSpy).toHaveBeenCalledWith("warn", "storage.slotUpgradeFailed", expect.objectContaining({ kind: "local-json" }));
  });

  it("writes the bare handle back with a fresh picked binding, which the next instance reads", async () => {
    const handle = revisionFakeHandle({ text: workspaceToJson(emptyWorkspace()) });
    kvStore.set(SLOT, handle);
    const first = new LocalFileBackend("local-json");
    await first.load();
    expect(first.fileBinding()).toMatch(/^picked:/);
    expect(kvStore.get(SLOT)).toEqual({ handle, binding: first.fileBinding() });
    const second = new LocalFileBackend("local-json");
    await second.load();
    expect(second.fileBinding()).toBe(first.fileBinding());
  });

  it("adopts the record another tab wrote between its read and its write, instead of overwriting it", async () => {
    const bare = revisionFakeHandle({ text: workspaceToJson(emptyWorkspace()) });
    const theirs = revisionFakeHandle({ text: workspaceToJson(emptyWorkspace()) });
    kvStore.set(SLOT, bare);
    const theirRecord = { handle: theirs, binding: "picked:theirs" };
    readHook.current = (key) => { if (key === SLOT) { kvStore.set(SLOT, theirRecord); readHook.current = null; } };
    const be = new LocalFileBackend("local-json");
    await be.load();
    expect(be.fileBinding()).toBe("picked:theirs");
    expect(kvStore.get(SLOT)).toBe(theirRecord); // untouched
  });

  it("uses the registered project's id when the bare handle is the same file as that project's stored handle", async () => {
    const projectHandle = revisionFakeHandle({ text: workspaceToJson(emptyWorkspace()) });
    const bare = { ...revisionFakeHandle({ text: workspaceToJson(emptyWorkspace()) }), isSameEntry: async (other: FsHandle) => other === projectHandle };
    PROJECT_HANDLES.set("p1", projectHandle);
    saveRegistry(addProject(emptyRegistry(), { id: "p1", name: "P", code: "P", storageConfig: { kind: "local-json" } }, false));
    kvStore.set(SLOT, bare);
    const be = new LocalFileBackend("local-json");
    await be.load();
    expect(be.fileBinding()).toBe("p1");
    expect(kvStore.get(SLOT)).toEqual({ handle: bare, binding: "p1" });
  });
});
