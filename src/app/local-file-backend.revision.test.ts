// src/app/local-file-backend.revision.test.ts
//
// §4 §645 — LocalFileBackend's revision guard: a save that would overwrite
// another writer's newer data throws SaveConflictError and writes nothing,
// AND a project switch in one window/tab must not redirect another window's
// save (the "handle per window" half of §645). Mirrors
// browser-backend.revision.test.ts's shape, but the "other writer" here is
// modelled as a foreign process mutating the same FsHandle's content +
// lastModified directly (createWritable/close bypassed), and the "other
// window" is a second LocalFileBackend instance sharing the same mocked IDB
// handle-slot.
//
// ★ `./idb` is mocked with an in-memory Map, exactly like
// local-file-backend.test.ts: an FsHandle is an object of methods, and a real
// IDB store structure-clones its values, so a genuine round-trip through
// fake-indexeddb would throw DataCloneError.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const kvStore = vi.hoisted(() => new Map<string, unknown>());

vi.mock("./idb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./idb")>();
  return {
    ...actual,
    idbGet: async (key: string) => kvStore.get(key),
    idbSet: async (key: string, value: unknown) => {
      kvStore.set(key, value);
    },
    idbDelete: async (key: string) => {
      kvStore.delete(key);
    },
  };
});

import type { FsHandle } from "./fs-access";
import { LocalFileBackend } from "./local-file-backend";
import { emptyWorkspace, workspaceToJson } from "./workspace";
import { SaveConflictError } from "./storage-error";

/**
 * Extends the `writableFakeHandle` pattern from local-file-backend.test.ts
 * with a `lastModified` that actually changes on every real write — via a
 * monotonic COUNTER, never `Date.now()`, so two writes inside the same
 * millisecond still produce distinct revisions (controller ruling).
 *
 * `externalWrite` simulates a FOREIGN process (another program, or — for the
 * §645 "handle per window" tests — nothing at all, since those tests instead
 * point a SECOND backend instance at a different handle) mutating the file
 * directly, bypassing `createWritable`/`close`, but through the SAME counter
 * so the bump is still observable and still monotonic.
 */
function revisionFakeHandle(initial: { text?: string; lastModified?: number } = {}): FsHandle & {
  externalWrite(text: string): void;
} {
  let text = initial.text ?? "";
  let counter = initial.lastModified ?? 1000;
  return {
    name: "project.json",
    queryPermission: async () => "granted",
    requestPermission: async () => "granted",
    getFile: async () => ({ text: async () => text, lastModified: counter }) as unknown as File,
    createWritable: async () => ({
      write: async (data: string | Blob) => {
        text = typeof data === "string" ? data : text;
      },
      close: async () => {
        counter += 1;
      },
    }),
    externalWrite(newText: string) {
      text = newText;
      counter += 1;
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

  it("revision() after load matches the file's lastModified; after save it's the new one", async () => {
    const be = new LocalFileBackend("local-json");
    const handle = revisionFakeHandle({ text: "", lastModified: 1000 });
    await be.setHandle(handle);

    await be.load();
    expect(be.revision()).toBe("1000");

    await be.save(emptyWorkspace());
    const file = await handle.getFile();
    expect(be.revision()).toBe(String(file.lastModified));
    expect(be.revision()).not.toBe("1000");
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
    expect(fresh.revision()).toBe("1000");
  });

  it("forceNextSave() writes despite a foreign change and adopts the new lastModified", async () => {
    const be = new LocalFileBackend("local-json");
    const handle = revisionFakeHandle({ text: "", lastModified: 1000 });
    await be.setHandle(handle);
    await be.load();

    handle.externalWrite("mutated-by-someone-else");

    be.forceNextSave();
    await expect(be.save(emptyWorkspace())).resolves.toBeUndefined();

    const file = await handle.getFile();
    expect(await file.text()).toBe(workspaceToJson(emptyWorkspace()));
    expect(be.revision()).toBe(String(file.lastModified));
    expect(be.revision()).not.toBe("1000");
  });

  describe("with navigator.locks present", () => {
    it("runs save() under navigator.locks.request with the per-kind lock name", async () => {
      const seenNames: string[] = [];
      Object.defineProperty(navigator, "locks", {
        value: {
          request: (name: string, cb: () => Promise<unknown>) => {
            seenNames.push(name);
            return cb();
          },
        },
        configurable: true,
      });

      const be = new LocalFileBackend("local-csv");
      const handle = revisionFakeHandle({ text: "", lastModified: 1000 });
      await be.setHandle(handle);
      await be.load();

      await be.save(emptyWorkspace());

      expect(seenNames).toEqual(["aipm-cockpit:save:local-csv"]);
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
