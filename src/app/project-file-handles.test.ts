// Round-trip tests for project-file-handles.ts.
// Uses fake-indexeddb (already a dev-dep, see storage-browser-kv.test.ts) to
// provide a real IDB implementation under jsdom.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { saveHandle, getHandle, deleteHandle } from "./project-file-handles";
import type { FsHandle } from "./storage";

// Minimal stand-in for a FileSystemFileHandle — only the fields IDB cares
// about (structured-cloneable object).
const makeHandle = (name: string): FsHandle =>
  ({ name } as unknown as FsHandle);

describe("project-file-handles", () => {
  beforeEach(() => {
    // Fresh in-memory IDB per test so operations don't bleed across cases.
    globalThis.indexedDB = new IDBFactory();
  });
  afterEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it("returns null for an unknown projectId", async () => {
    expect(await getHandle("proj-unknown")).toBeNull();
  });

  it("round-trips a handle: save → get", async () => {
    const handle = makeHandle("project-alpha.json");
    await saveHandle("proj-1", handle);
    const retrieved = await getHandle("proj-1");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.name).toBe("project-alpha.json");
  });

  it("overwrites an existing handle with a new save", async () => {
    await saveHandle("proj-2", makeHandle("old.json"));
    await saveHandle("proj-2", makeHandle("new.json"));
    const retrieved = await getHandle("proj-2");
    expect(retrieved?.name).toBe("new.json");
  });

  it("deleteHandle removes a stored handle", async () => {
    await saveHandle("proj-3", makeHandle("gone.json"));
    await deleteHandle("proj-3");
    expect(await getHandle("proj-3")).toBeNull();
  });

  it("deleteHandle resolves silently for a non-existent key", async () => {
    await expect(deleteHandle("proj-never-existed")).resolves.toBeUndefined();
  });

  it("different projectIds are stored independently", async () => {
    await saveHandle("proj-a", makeHandle("a.json"));
    await saveHandle("proj-b", makeHandle("b.json"));
    expect((await getHandle("proj-a"))?.name).toBe("a.json");
    expect((await getHandle("proj-b"))?.name).toBe("b.json");
  });

  describe("SSR / no-indexedDB guard", () => {
    it("saveHandle resolves without throwing when indexedDB is absent", async () => {
      const original = globalThis.indexedDB;
      // @ts-expect-error intentional removal to simulate SSR
      delete globalThis.indexedDB;
      try {
        await expect(
          saveHandle("proj-x", makeHandle("x.json")),
        ).resolves.toBeUndefined();
      } finally {
        globalThis.indexedDB = original;
      }
    });

    it("getHandle returns null when indexedDB is absent", async () => {
      const original = globalThis.indexedDB;
      // @ts-expect-error intentional removal to simulate SSR
      delete globalThis.indexedDB;
      try {
        expect(await getHandle("proj-x")).toBeNull();
      } finally {
        globalThis.indexedDB = original;
      }
    });

    it("deleteHandle resolves without throwing when indexedDB is absent", async () => {
      const original = globalThis.indexedDB;
      // @ts-expect-error intentional removal to simulate SSR
      delete globalThis.indexedDB;
      try {
        await expect(deleteHandle("proj-x")).resolves.toBeUndefined();
      } finally {
        globalThis.indexedDB = original;
      }
    });
  });
});
