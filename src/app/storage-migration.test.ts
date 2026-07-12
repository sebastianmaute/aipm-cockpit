import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { migrateLocalStorage, migrateIndexedDb } from "./storage-migration";

describe("migrateLocalStorage", () => {
  beforeEach(() => localStorage.clear());

  it("renames lop-app: prefixed keys and removes old", () => {
    localStorage.setItem("lop-app:settings", "{}");
    localStorage.setItem("lop-app:color-schemes", "[]");
    migrateLocalStorage();
    expect(localStorage.getItem("aipm-cockpit:settings")).toBe("{}");
    expect(localStorage.getItem("aipm-cockpit:color-schemes")).toBe("[]");
    expect(localStorage.getItem("lop-app:settings")).toBeNull();
  });

  it("renames the 5 non-prefixed scheme/style/theme keys", () => {
    localStorage.setItem("lop-style", "custom");
    localStorage.setItem("lop-theme", "dark");
    localStorage.setItem("lop-active-scheme-colors", "{}");
    localStorage.setItem("lop-active-scheme-structural", "{}");
    localStorage.setItem("lop-scheme-supports-dark", "1");
    migrateLocalStorage();
    expect(localStorage.getItem("aipm-cockpit-style")).toBe("custom");
    expect(localStorage.getItem("aipm-cockpit-theme")).toBe("dark");
    expect(localStorage.getItem("aipm-cockpit-active-scheme-colors")).toBe("{}");
    expect(localStorage.getItem("aipm-cockpit-active-scheme-structural")).toBe("{}");
    expect(localStorage.getItem("aipm-cockpit-scheme-supports-dark")).toBe("1");
    expect(localStorage.getItem("lop-style")).toBeNull();
  });

  it("is idempotent and does not clobber a newer target", () => {
    localStorage.setItem("aipm-cockpit:settings", "NEW");
    localStorage.setItem("lop-app:settings", "OLD");
    migrateLocalStorage();
    expect(localStorage.getItem("aipm-cockpit:settings")).toBe("NEW");
    expect(localStorage.getItem("lop-app:settings")).toBeNull();
    migrateLocalStorage();
    expect(localStorage.getItem("aipm-cockpit:settings")).toBe("NEW");
  });
});

function openDb(name: string, store: string): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(store);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function put(db: IDBDatabase, store: string, key: string, val: unknown): Promise<void> {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
function get(db: IDBDatabase, store: string, key: string): Promise<unknown> {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, "readonly");
    const g = tx.objectStore(store).get(key);
    g.onsuccess = () => res(g.result);
    g.onerror = () => rej(g.error);
  });
}
function dbExists(name: string): Promise<boolean> {
  return indexedDB.databases().then((l) => l.some((d) => d.name === name));
}
function deleteDb(name: string): Promise<void> {
  return new Promise((res) => {
    const r = indexedDB.deleteDatabase(name);
    r.onsuccess = r.onerror = r.onblocked = () => res();
  });
}

describe("migrateIndexedDb", () => {
  const DB_NAMES = [
    "lop-app",
    "aipm-cockpit",
    "lop-app-secrets",
    "aipm-cockpit-secrets",
    "lop-app-project-handles",
    "aipm-cockpit-project-handles",
  ];
  beforeEach(async () => {
    localStorage.clear(); // also clears the aipm-cockpit:idb-migrated completion flag
    for (const name of DB_NAMES) await deleteDb(name);
  });

  it("copies records to the new DB and deletes the old", async () => {
    const old = await openDb("lop-app", "kv");
    await put(old, "kv", "workspace", { hello: "world" });
    old.close();
    await migrateIndexedDb();
    const nw = await openDb("aipm-cockpit", "kv");
    expect(await get(nw, "kv", "workspace")).toEqual({ hello: "world" });
    nw.close();
    expect(await dbExists("lop-app")).toBe(false);
  });

  it("preserves a non-extractable CryptoKey value", async () => {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const old = await openDb("lop-app-secrets", "keys");
    await put(old, "keys", "device", key);
    old.close();
    await migrateIndexedDb();
    const nw = await openDb("aipm-cockpit-secrets", "keys");
    const got = (await get(nw, "keys", "device")) as CryptoKey;
    expect(got).toBeTruthy();
    expect(got.type).toBe("secret");
    nw.close();
  });

  // Regression: an interrupted / quota-failed prior run can leave an EMPTY new
  // DB. It must NOT shadow a still-populated old DB — re-copy instead of skip.
  it("re-copies when the new DB exists but is empty", async () => {
    await (await openDb("aipm-cockpit-secrets", "keys")).close(); // empty shell
    const old = await openDb("lop-app-secrets", "keys");
    await put(old, "keys", "device", "SECRET-KEY");
    old.close();
    await migrateIndexedDb();
    const nw = await openDb("aipm-cockpit-secrets", "keys");
    expect(await get(nw, "keys", "device")).toBe("SECRET-KEY"); // not lost
    nw.close();
    expect(await dbExists("lop-app-secrets")).toBe(false);
  });

  // A genuinely-migrated (populated) new DB is left untouched; old is retired.
  it("skips the copy when the new DB is already populated, and retires old", async () => {
    const nwSeed = await openDb("aipm-cockpit", "kv");
    await put(nwSeed, "kv", "workspace", { v: "NEW" });
    nwSeed.close();
    const old = await openDb("lop-app", "kv");
    await put(old, "kv", "workspace", { v: "OLD" });
    old.close();
    await migrateIndexedDb();
    const nw = await openDb("aipm-cockpit", "kv");
    expect(await get(nw, "kv", "workspace")).toEqual({ v: "NEW" }); // not overwritten
    nw.close();
    expect(await dbExists("lop-app")).toBe(false); // old retired
  });

  // A non-empty new DB is live user data — never overwrite it from a stale,
  // larger old DB just because old has more records (user deleted rows).
  it("never clobbers a non-empty new DB even if old has more records", async () => {
    const nw = await openDb("aipm-cockpit", "kv");
    await put(nw, "kv", "a", "NEW-A"); // new: 1 record
    nw.close();
    const old = await openDb("lop-app", "kv");
    await put(old, "kv", "a", "OLD-A");
    await put(old, "kv", "b", "OLD-B"); // old: 2 records (more)
    old.close();
    await migrateIndexedDb();
    const nw2 = await openDb("aipm-cockpit", "kv");
    expect(await get(nw2, "kv", "a")).toBe("NEW-A"); // not overwritten
    expect(await get(nw2, "kv", "b")).toBeUndefined(); // stale old row NOT resurrected
    nw2.close();
    expect(await dbExists("lop-app")).toBe(true); // ambiguous → old left, not deleted
  });

  // Firefox / Safari<14 have no indexedDB.databases(). The migration MUST work
  // without it (content-based) — a databases()-gated version silently no-ops.
  it("migrates without indexedDB.databases() (Firefox path)", async () => {
    const old = await openDb("lop-app", "kv");
    await put(old, "kv", "workspace", { hello: "ff" });
    old.close();
    const orig = indexedDB.databases;
    // @ts-expect-error — simulate a browser that doesn't implement databases()
    indexedDB.databases = undefined;
    try {
      await migrateIndexedDb();
    } finally {
      indexedDB.databases = orig;
    }
    const nw = await openDb("aipm-cockpit", "kv");
    expect(await get(nw, "kv", "workspace")).toEqual({ hello: "ff" });
    nw.close();
  });

  it("sets the completion flag after a clean run and then short-circuits", async () => {
    const old = await openDb("lop-app", "kv");
    await put(old, "kv", "x", 1);
    old.close();
    await migrateIndexedDb();
    expect(localStorage.getItem("aipm-cockpit:idb-migrated")).toBe("1");
    // flag set → a fresh old DB is NOT touched (zero-work fast path)
    const old2 = await openDb("lop-app", "kv");
    await put(old2, "kv", "y", 2);
    old2.close();
    await migrateIndexedDb();
    expect(await dbExists("lop-app")).toBe(true);
  });
});
