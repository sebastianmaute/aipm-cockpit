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

vi.mock("./idb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./idb")>();
  return {
    ...actual,
    idbGet: async (key: string) => kv.get(key),
    idbSet: async (key: string, value: unknown) => {
      kv.set(key, value);
    },
    idbDelete: async (key: string) => {
      kv.delete(key);
    },
  };
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
});
