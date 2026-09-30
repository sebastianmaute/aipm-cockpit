// §4 — BrowserBackend's revision guard: a save that would overwrite another
// writer's newer data throws SaveConflictError and writes nothing, instead
// of silently clobbering it. Uses fake-indexeddb for a real IDB implementation
// under jsdom (same setup as browser-backend.test.ts), with two independent
// BrowserBackend instances sharing ONE fake IndexedDB to stand in for two
// tabs/windows on the same browser storage.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { BrowserBackend } from "./browser-backend";
import { emptyWorkspace } from "./workspace";
import { SaveConflictError } from "./storage-error";
import type { Milestone, Task } from "./types";

// Fix round 1 — lets one test hold back the REAL `idbGet("revision")` call
// (not merely its delivery: the underlying fetch itself) until released, to
// deterministically model `load()`'s revision read genuinely executing AFTER
// a concurrent writer's save has landed. `gate: null` (the default) makes
// every call pass straight through, so this mock is inert for every other
// test in this file. One-shot: arming it holds back only the very NEXT
// `idbGet("revision")` call (b's stalled load) — a's own save() reads the
// revision too (to compare/bump it) and must not be blocked by the same gate,
// or the test deadlocks on itself.
const revisionReadCtl = vi.hoisted(() => ({ gate: null as Promise<void> | null }));
// Fix round 2 (R10 change 5) — makes the NEXT `idbGetAll` call (one of
// load()'s parallel data reads, which all run AFTER the revision read
// succeeds) throw once, so a test can model "the revision read succeeded but
// a data read rejected" without touching the revision-read gate above.
const dataReadFailCtl = vi.hoisted(() => ({ armed: false }));
// Fix round 2 (R10 change 4) — makes the NEXT `idbBulkUpdate` call (one of
// saveLocked()'s parallel writes) throw once, so a test can prove a forced
// save's flag survives a genuine write failure.
const writeFailCtl = vi.hoisted(() => ({ armed: false }));
vi.mock("./idb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./idb")>();
  return {
    ...actual,
    idbGet: async (key: string) => {
      if (key === "revision" && revisionReadCtl.gate) {
        const gate = revisionReadCtl.gate;
        revisionReadCtl.gate = null;
        await gate;
      }
      return actual.idbGet(key);
    },
    idbGetAll: async (...args: Parameters<typeof actual.idbGetAll>) => {
      if (dataReadFailCtl.armed) {
        dataReadFailCtl.armed = false;
        throw new Error("simulated data read failure");
      }
      return actual.idbGetAll(...args);
    },
    idbBulkUpdate: async (...args: Parameters<typeof actual.idbBulkUpdate>) => {
      if (writeFailCtl.armed) {
        writeFailCtl.armed = false;
        throw new Error("simulated write failure");
      }
      return actual.idbBulkUpdate(...args);
    },
    // §4 round 7 — the save's one transaction; the same one-shot write failure.
    idbTransaction: (...args: Parameters<typeof actual.idbTransaction>) => {
      if (writeFailCtl.armed) {
        writeFailCtl.armed = false;
        return Promise.reject(new Error("simulated write failure"));
      }
      return actual.idbTransaction(...args);
    },
  };
});

const taskA = {
  id: 1,
  taskName: "A's task",
  assignee: "Ada",
  priority: "Medium",
  startDate: "2026-01-01",
  dueDate: "2026-01-05",
} as unknown as Task;

const taskB = {
  id: 2,
  taskName: "B's task",
  assignee: "Bea",
  priority: "Medium",
  startDate: "2026-01-01",
  dueDate: "2026-01-05",
} as unknown as Task;

const taskD = {
  id: 3,
  taskName: "D's task",
  assignee: "Dee",
  priority: "Medium",
  startDate: "2026-01-01",
  dueDate: "2026-01-05",
} as unknown as Task;

const milestoneA: Milestone = {
  id: 5,
  name: "A's milestone",
  date: "2026-12-01",
  linkedTaskIds: [],
};

describe("BrowserBackend §4 revision guard", () => {
  beforeEach(() => {
    // Fresh in-memory IDB per test so saves don't leak across cases.
    globalThis.indexedDB = new IDBFactory();
    revisionReadCtl.gate = null;
    dataReadFailCtl.armed = false;
    writeFailCtl.armed = false;
  });

  afterEach(() => {
    // Restore navigator state even if a test below threw before its own cleanup.
    Reflect.deleteProperty(navigator, "locks");
  });

  it("load on an empty store gives revision 0; the first save stamps 1", async () => {
    const backend = new BrowserBackend();
    const ws = await backend.load();
    expect(backend.revision()).toBe("0");

    await backend.save({ ...ws, tasks: [taskA] });
    expect(backend.revision()).toBe("1");
  });

  it("rejects a stale save with SaveConflictError and writes nothing", async () => {
    const a = new BrowserBackend();
    const b = new BrowserBackend();
    await a.load();
    await b.load(); // b loads BEFORE a's save, so both start at revision 0

    await a.save({ ...emptyWorkspace(), tasks: [taskA] });
    expect(a.revision()).toBe("1");

    await expect(b.save({ ...emptyWorkspace(), tasks: [taskB] })).rejects.toBeInstanceOf(
      SaveConflictError,
    );

    // b's rejected save wrote nothing: a fresh load still shows only a's task.
    const reloaded = await new BrowserBackend().load();
    expect(reloaded.tasks.map((t) => t.id)).toEqual([1]);
  });

  it("adoptRevision lets a stale writer catch up and succeed", async () => {
    const a = new BrowserBackend();
    const b = new BrowserBackend();
    await a.load();
    await b.load();

    await a.save({ ...emptyWorkspace(), tasks: [taskA] });
    await expect(b.save({ ...emptyWorkspace(), tasks: [taskB] })).rejects.toBeInstanceOf(
      SaveConflictError,
    );

    b.adoptRevision(a.revision()!);
    await expect(b.save({ ...emptyWorkspace(), tasks: [taskB] })).resolves.toBeUndefined();
    expect(b.revision()).toBe("2");
  });

  it("forceNextSave skips the compare and forces a full rewrite; a later normal save compares again", async () => {
    const a = new BrowserBackend();
    const b = new BrowserBackend();
    await a.load();
    await b.load(); // both at revision 0

    await a.save({ ...emptyWorkspace(), tasks: [taskA] }); // revision -> 1

    // b is stale (still at 0) and would normally conflict; force skips that.
    b.forceNextSave();
    await expect(b.save({ ...emptyWorkspace(), tasks: [taskB] })).resolves.toBeUndefined();
    expect(b.revision()).toBe("2");

    // Full rewrite: a's task — which b never loaded — is gone after reload.
    const afterForce = await new BrowserBackend().load();
    expect(afterForce.tasks.map((t) => t.id)).toEqual([2]);

    // Someone else (d) writes after b's forced save.
    const d = new BrowserBackend();
    await d.load(); // revision 2
    await d.save({ ...emptyWorkspace(), tasks: [taskB, taskD] }); // revision -> 3

    // b's SECOND save is a normal (non-forced) save: it checks again and,
    // since b is now stale (still adopted at 2), rejects.
    await expect(b.save({ ...emptyWorkspace(), tasks: [taskB] })).rejects.toBeInstanceOf(
      SaveConflictError,
    );
  });

  // Fix round 1 (Important finding) — `load()` used to read the revision
  // LAST, in the SAME Promise.all as every data store/KV read. Each of those
  // opens its OWN IndexedDB transaction (idb.ts), so that Promise.all was
  // never one snapshot: a load overlapping another tab's locked save could
  // read OLD data but a NEWER revision (the save writes data first, revision
  // last) — the next save would then pass the compare and silently rewrite
  // every KV blob with the stale view, dropping the other writer's change.
  describe("fix round 1 — a load racing a concurrent save", () => {
    it("never ends up with a revision newer than the data it actually read", async () => {
      const a = new BrowserBackend();
      const b = new BrowserBackend();
      await a.load();
      await b.load(); // both at revision 0, no milestones yet

      // Hold b's revision read back until released, below.
      let releaseGate: () => void = () => {};
      revisionReadCtl.gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });
      const bReloadPromise = b.load();

      // a saves a milestone WHILE b's load is stalled on its revision read.
      await a.save({ ...emptyWorkspace(), milestones: [milestoneA] });
      expect(a.revision()).toBe("1");

      releaseGate();
      revisionReadCtl.gate = null;
      const bWs = await bReloadPromise;

      // Whatever b's (possibly torn) reload actually produced, b's NEXT
      // save — built from exactly what it just read, plus its own small
      // edit, the realistic app pattern — must never silently drop a's
      // concurrent milestone. Either b's load genuinely caught up (so the
      // save succeeds AND preserves a's milestone, because bWs already
      // carried it) or b's load is genuinely stale and the save is
      // rejected — either outcome is safe; only a save that both SUCCEEDS
      // and DROPS a's milestone is the bug this round closes.
      let saveError: unknown;
      try {
        await b.save({ ...bWs, tasks: [...bWs.tasks, taskB] });
      } catch (err) {
        saveError = err;
      }
      if (saveError !== undefined) {
        expect(saveError).toBeInstanceOf(SaveConflictError);
      }

      const reloaded = await new BrowserBackend().load();
      expect(reloaded.milestones?.some((m) => m.id === milestoneA.id)).toBe(true);
    });
  });

  describe("with navigator.locks absent", () => {
    it("still compares and rejects a stale save (same result as with a lock)", async () => {
      expect((navigator as { locks?: unknown }).locks).toBeUndefined();

      const a = new BrowserBackend();
      const b = new BrowserBackend();
      await a.load();
      await b.load();

      await a.save({ ...emptyWorkspace(), tasks: [taskA] });
      await expect(b.save({ ...emptyWorkspace(), tasks: [taskB] })).rejects.toBeInstanceOf(
        SaveConflictError,
      );
    });
  });

  // §4 round 7 — the whole compare-and-write is ONE readwrite IndexedDB transaction, opened from the one
  // connection a save requests in its caller's own turn. Measured in Chromium: a page closing lets the IDB
  // work it requested in the pagehide flush finish, but work requested in a LATER task (after a Web Lock
  // grant, or in a revision read's callback that then opens another connection) never lands, so the
  // close-time save was lost (e2e/pagehide-draft-persist.spec.ts). Readwrite transactions over the same
  // stores serialise across tabs, so the compare-and-set stays atomic without a lock.
  describe("one transaction, no lock (round 7)", () => {
    const defineLocks = (request: (...args: unknown[]) => Promise<unknown>) => {
      Object.defineProperty(navigator, "locks", { value: { request }, configurable: true });
    };

    it("takes no Web Lock", async () => {
      const request = vi.fn((...args: unknown[]) => (args[args.length - 1] as () => Promise<unknown>)());
      defineLocks(request);
      const backend = new BrowserBackend();
      await backend.load();
      await backend.save({ ...emptyWorkspace(), tasks: [taskA] });
      expect(request).not.toHaveBeenCalled();
      expect(backend.revision()).toBe("1");
    });

    it("opens ONE IndexedDB connection per save, requested in the caller's own turn", async () => {
      const backend = new BrowserBackend();
      await backend.load();
      const open = vi.spyOn(indexedDB, "open");
      try {
        const saving = backend.save({ ...emptyWorkspace(), tasks: [taskA], milestones: [milestoneA] });
        expect(open).toHaveBeenCalledTimes(1); // before the caller's turn ends
        await saving;
        expect(open).toHaveBeenCalledTimes(1); // and nothing more afterwards
      } finally {
        open.mockRestore();
      }
      const reloaded = await new BrowserBackend().load();
      expect(reloaded.tasks.map((t) => t.id)).toEqual([1]);
      expect(reloaded.milestones?.map((m) => m.id)).toEqual([5]);
    });

    it("two saves racing from the same revision: exactly one lands, the other is refused and writes nothing", async () => {
      const a = new BrowserBackend();
      const b = new BrowserBackend();
      await a.load();
      await b.load();
      const results = await Promise.allSettled([
        a.save({ ...emptyWorkspace(), tasks: [taskA] }),
        b.save({ ...emptyWorkspace(), tasks: [taskB] }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const refused = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(refused).toHaveLength(1);
      expect(refused[0].reason).toBeInstanceOf(SaveConflictError);
      const reloaded = await new BrowserBackend().load();
      expect(reloaded.tasks).toHaveLength(1);
      const fresh = new BrowserBackend();
      await fresh.load();
      expect(fresh.revision()).toBe("1");
    });
  });

  // §4 fix round 1 (R10 change 1) — fail closed.
  describe("fail-closed on an unknown revision (R10 change 1)", () => {
    it("a never-loaded instance refuses to save, and writes nothing", async () => {
      const backend = new BrowserBackend();
      // Never loaded, never forced, never adopted: currentRevision is UNKNOWN.

      await expect(backend.save({ ...emptyWorkspace(), tasks: [taskA] })).rejects.toBeInstanceOf(
        SaveConflictError,
      );

      const reloaded = await new BrowserBackend().load();
      expect(reloaded.tasks).toEqual([]);
    });

    it("forceNextSave lets a never-loaded instance write anyway (the intentional-blind-write escape hatch)", async () => {
      const backend = new BrowserBackend();
      backend.forceNextSave();

      await expect(backend.save({ ...emptyWorkspace(), tasks: [taskA] })).resolves.toBeUndefined();

      const reloaded = await new BrowserBackend().load();
      expect(reloaded.tasks.map((t) => t.id)).toEqual([1]);
    });
  });

  // §4 fix round 1 (R10 change 4) — force flag survives a failed write.
  it("forceNextSave keeps the flag when the forced write fails, for a retry", async () => {
    const a = new BrowserBackend();
    const b = new BrowserBackend();
    await a.load();
    await b.load();
    await a.save({ ...emptyWorkspace(), tasks: [taskA] }); // b is now stale

    b.forceNextSave();
    writeFailCtl.armed = true;
    await expect(b.save({ ...emptyWorkspace(), tasks: [taskB] })).rejects.toThrow(
      /simulated write failure/,
    );

    // The flag must still be set: a retry (the write will succeed this time)
    // must STILL skip the compare, even though b is still stale.
    await expect(b.save({ ...emptyWorkspace(), tasks: [taskB] })).resolves.toBeUndefined();
    const reloaded = await new BrowserBackend().load();
    expect(reloaded.tasks.map((t) => t.id).sort()).toEqual([2]);
  });

  // §4 fix round 3 (Important #1) — a leftover force from a FAILED forced
  // save must not carry over past a genuine new baseline.
  describe("a failed forced save's leftover force does not carry over (fix round 3)", () => {
    it("is cleared by a successful reload, so a later stale save refuses instead of full-rewriting", async () => {
      const b = new BrowserBackend();
      await b.load(); // revision 0

      b.forceNextSave();
      writeFailCtl.armed = true;
      await expect(b.save({ ...emptyWorkspace(), tasks: [taskB] })).rejects.toThrow(
        /simulated write failure/,
      );

      // b reloads — a genuine new baseline (still revision 0 here).
      await b.load();

      // NOW another tab (a) saves.
      const a = new BrowserBackend();
      await a.load();
      await a.save({ ...emptyWorkspace(), tasks: [taskA] }); // revision -> 1

      // b's NEXT save (no forceNextSave() call this time) must refuse: b is
      // stale relative to a's write, and the leftover force from the earlier
      // FAILED attempt must not have survived b's reload to skip this compare.
      await expect(b.save({ ...emptyWorkspace(), tasks: [taskB] })).rejects.toBeInstanceOf(
        SaveConflictError,
      );

      const reloaded = await new BrowserBackend().load();
      expect(reloaded.tasks.map((t) => t.id)).toEqual([1]); // a's task intact, b never wrote
    });

    it("is cleared by adoptFrom on the LIVE instance", async () => {
      const live = new BrowserBackend();
      await live.load();
      live.forceNextSave();
      writeFailCtl.armed = true;
      await expect(live.save({ ...emptyWorkspace(), tasks: [taskB] })).rejects.toThrow(
        /simulated write failure/,
      );

      const a = new BrowserBackend();
      await a.load();
      await a.save({ ...emptyWorkspace(), tasks: [taskA] }); // revision -> 1

      const op = new BrowserBackend();
      await op.load(); // sees taskA, revision 1

      live.adoptFrom(op); // live's leftover force must be cleared here

      const d = new BrowserBackend();
      await d.load();
      await d.save({ ...emptyWorkspace(), tasks: [taskA, taskD] }); // revision -> 2

      await expect(live.save({ ...emptyWorkspace(), tasks: [taskB] })).rejects.toBeInstanceOf(
        SaveConflictError,
      );

      const reloaded = await new BrowserBackend().load();
      expect(reloaded.tasks.map((t) => t.id).sort()).toEqual([1, 3]); // a's + d's intact
    });

    it("is cleared by adoptRevision", async () => {
      const b = new BrowserBackend();
      await b.load();
      b.forceNextSave();
      writeFailCtl.armed = true;
      await expect(b.save({ ...emptyWorkspace(), tasks: [taskB] })).rejects.toThrow(
        /simulated write failure/,
      );

      const a = new BrowserBackend();
      await a.load();
      await a.save({ ...emptyWorkspace(), tasks: [taskA] }); // revision -> 1

      b.adoptRevision("1"); // catches b up; must ALSO clear the leftover force

      const d = new BrowserBackend();
      await d.load();
      await d.save({ ...emptyWorkspace(), tasks: [taskA, taskD] }); // revision -> 2

      await expect(b.save({ ...emptyWorkspace(), tasks: [taskB] })).rejects.toBeInstanceOf(
        SaveConflictError,
      );

      const reloaded = await new BrowserBackend().load();
      expect(reloaded.tasks.map((t) => t.id).sort()).toEqual([1, 3]);
    });
  });

  // §4 fix round 1 (R10 change 3) — adoptFrom.
  it("adoptFrom(other): an instance adopted from a loaded instance saves without conflict", async () => {
    const op = new BrowserBackend();
    await op.load();
    await op.save({ ...emptyWorkspace(), tasks: [taskA] });

    const live = new BrowserBackend();
    // live never loaded — would fail-closed on its own.
    live.adoptFrom(op);

    await expect(live.save({ ...emptyWorkspace(), tasks: [taskA, taskB] })).resolves.toBeUndefined();

    const reloaded = await new BrowserBackend().load();
    expect(reloaded.tasks.map((t) => t.id).sort()).toEqual([1, 2]);
  });

  // §4 fix round 1 (R10 change 5) — a failed data read must not adopt a revision.
  describe("a failed browser load must not adopt a revision (R10 change 5)", () => {
    it("load() with a real stored revision but a rejecting data read leaves the revision UNKNOWN", async () => {
      const seed = new BrowserBackend();
      seed.forceNextSave();
      await seed.save({ ...emptyWorkspace(), tasks: [taskA] }); // stores revision 1

      const b = new BrowserBackend();
      dataReadFailCtl.armed = true;
      const ws = await b.load(); // revision read succeeds (1); a data read then throws

      expect(ws.tasks).toEqual([]); // the outer catch's fallback/empty state
      expect(b.revision()).toBeNull();
      await expect(b.save({ ...emptyWorkspace(), tasks: [taskB] })).rejects.toBeInstanceOf(
        SaveConflictError,
      );
    });
  });

  // §4 fix round 1 (R10 change 7) — adoptRevision only accepts an all-digit string.
  describe("adoptRevision accepts only an all-digit string (R10 change 7)", () => {
    it("ignores a non-digit string rather than partially parsing it", async () => {
      const backend = new BrowserBackend();
      await backend.load();
      expect(backend.revision()).toBe("0");

      backend.adoptRevision("12abc");
      expect(backend.revision()).toBe("0"); // unchanged — not silently parsed as 12

      backend.adoptRevision("");
      expect(backend.revision()).toBe("0");

      backend.adoptRevision("7");
      expect(backend.revision()).toBe("7");
    });
  });
});

// §4 fix round 1 of Task 9 — the conditional overwrite: `forceNextSave(expected)` is a FULL rewrite
// performed only while the stored revision is still `expected`; a refusal reports the stored revision.
describe("BrowserBackend §4 conditional overwrite", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    revisionReadCtl.gate = null;
    dataReadFailCtl.armed = false;
    writeFailCtl.armed = false;
  });
  const taskE = { ...taskB, id: 9, taskName: "E's task" } as unknown as Task;
  const refusal = (p: Promise<unknown>) => p.then(() => null, (err: unknown) => err as SaveConflictError);

  /** Seeds [A, D] (revision 1); `peer` and `mine` both load it; the peer then saves [A, B] (revision 2). */
  async function peerMovedOn() {
    const seed = new BrowserBackend();
    await seed.load();
    await seed.save({ ...emptyWorkspace(), tasks: [taskA, taskD] });
    const peer = new BrowserBackend();
    const mine = new BrowserBackend();
    await peer.load();
    await mine.load();
    await peer.save({ ...emptyWorkspace(), tasks: [taskA, taskB] });
    return { peer, mine };
  }

  it("a refused save reports the stored revision", async () => {
    const { mine } = await peerMovedOn();
    const err = await refusal(mine.save({ ...emptyWorkspace(), tasks: [taskA, taskE] }));
    expect(err).toBeInstanceOf(SaveConflictError);
    expect(err!.currentRevision).toBe("2");
  });

  it("at the expected revision it is a FULL rewrite: nothing only the peer had survives, nothing it deleted returns", async () => {
    const { mine } = await peerMovedOn();
    mine.forceNextSave("2");
    expect(mine.revision()).toBe("1"); // arming does not move the instance's own revision
    await mine.save({ ...emptyWorkspace(), tasks: [taskA, taskE] });
    const stored = await new BrowserBackend().load();
    expect(stored.tasks.map((t) => t.id).sort()).toEqual([1, 9]); // B (the peer's) gone; D not back
    expect(mine.revision()).toBe("3");
  });

  it("refuses when storage moved past the expected revision, writes nothing, and reports the new revision", async () => {
    const { peer, mine } = await peerMovedOn();
    mine.forceNextSave("2");
    await peer.save({ ...emptyWorkspace(), tasks: [taskA, taskB, taskD] }); // revision 3
    const err = await refusal(mine.save({ ...emptyWorkspace(), tasks: [taskE] }));
    expect(err).toBeInstanceOf(SaveConflictError);
    expect(err!.currentRevision).toBe("3");
    expect((await new BrowserBackend().load()).tasks.map((t) => t.id).sort()).toEqual([1, 2, 3]);
  });

  it("the conditional one-shot is consumed by a failed attempt: the next save compares its own revision again", async () => {
    const { mine } = await peerMovedOn();
    mine.forceNextSave("2");
    writeFailCtl.armed = true;
    await expect(mine.save({ ...emptyWorkspace(), tasks: [taskE] })).rejects.toThrow("simulated write failure");
    await expect(mine.save({ ...emptyWorkspace(), tasks: [taskE] })).rejects.toBeInstanceOf(SaveConflictError);
  });
});
