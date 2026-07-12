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

  it("skips when the new DB already exists", async () => {
    await (await openDb("aipm-cockpit", "kv")).close();
    const old = await openDb("lop-app", "kv");
    await put(old, "kv", "x", 1);
    old.close();
    await migrateIndexedDb();
    expect(await dbExists("lop-app")).toBe(true);
  });
});
