// §4 — BrowserBackend's revision guard: a save that would overwrite another
// writer's newer data throws SaveConflictError and writes nothing, instead
// of silently clobbering it. Uses fake-indexeddb for a real IDB implementation
// under jsdom (same setup as browser-backend.test.ts), with two independent
// BrowserBackend instances sharing ONE fake IndexedDB to stand in for two
// tabs/windows on the same browser storage.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { BrowserBackend } from "./browser-backend";
import { emptyWorkspace } from "./workspace";
import { SaveConflictError } from "./storage-error";
import type { Task } from "./types";

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

describe("BrowserBackend §4 revision guard", () => {
  beforeEach(() => {
    // Fresh in-memory IDB per test so saves don't leak across cases.
    globalThis.indexedDB = new IDBFactory();
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

  describe("with navigator.locks present", () => {
    const defineLocks = (
      request: (name: string, cb: () => Promise<unknown>) => Promise<unknown>,
    ) => {
      Object.defineProperty(navigator, "locks", { value: { request }, configurable: true });
    };

    it("runs save() under navigator.locks.request with the fixed lock name", async () => {
      const seenNames: string[] = [];
      defineLocks((name, cb) => {
        seenNames.push(name);
        return cb();
      });

      const backend = new BrowserBackend();
      await backend.load();
      await backend.save({ ...emptyWorkspace(), tasks: [taskA] });

      expect(seenNames).toEqual(["aipm-cockpit:save:browser"]);
      expect(backend.revision()).toBe("1");
    });

    it("still compares and rejects a stale save (same result as without a lock)", async () => {
      defineLocks((_name, cb) => cb());

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
});
