// §99 follow-up: `openIdb` must create every record store idb-layout.ts lists.
// The e2e seed creates its stores from that same list, so a store that only the
// layout named would exist in every e2e run and be missing in a real browser.
// Uses fake-indexeddb, as idb.blocked.test.ts does.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { idbGet } from "./idb";
import { IDB_DB_NAME, IDB_DB_VERSION, IDB_ENTITY_STORES, IDB_KV_STORE } from "./idb-layout";

function storesAfterOpen(): Promise<{ version: number; names: string[] }> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME); // no version: never upgrades
    req.onsuccess = () => {
      const db = req.result;
      const out = { version: db.version, names: [...db.objectStoreNames] };
      db.close();
      resolve(out);
    };
    req.onerror = () => reject(req.error as Error);
  });
}

describe("openIdb creates the layout's stores", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });
  afterEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it("creates the kv store and every IDB_ENTITY_STORES store on a fresh database, at IDB_DB_VERSION", async () => {
    await idbGet("probe"); // any call opens (and so upgrades) the database
    const { version, names } = await storesAfterOpen();
    expect(version).toBe(IDB_DB_VERSION);
    expect(names.sort()).toEqual([IDB_KV_STORE, ...Object.values(IDB_ENTITY_STORES)].sort());
  });

  it("adds a store the database lacks when an older version is upgraded", async () => {
    // An older database holding only the kv store, as version 1 did.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(IDB_DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_KV_STORE);
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error as Error);
    });
    await idbGet("probe");
    const { names } = await storesAfterOpen();
    expect(names).toEqual(expect.arrayContaining(Object.values(IDB_ENTITY_STORES)));
  });
});
