# Rename `lop-app` → `aipm-cockpit` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`. TDD, task-per-commit, `npx tsc --noEmit` + `npm run test:run` after each. Feature branch `refactor/rename-aipm-cockpit` off `main`. NOT a release until the user says "release".

**Goal:** Rename every `lop-app`/`lop-*` surface to `aipm-cockpit` and carry existing users' local data forward with a flawless idempotent boot migration.

**Architecture:** New pure `storage-migration.ts` (localStorage + IndexedDB copy-migrate) wired into the pre-paint boot IIFE and app-init before secrets/workspace load, then a deterministic scripted literal sweep + brand-string edits.

**Spec:** `docs/superpowers/specs/2026-07-12-rename-aipm-cockpit-design.md`

---

## File structure

- **Create:** `src/app/storage-migration.ts` — pure, i18n-free. Legacy→new maps + `migrateLocalStorage()` + `migrateIndexedDb()` + `copyDatabase()`. Holds BOTH old and new literals (EXEMPT from the Task 4 sweep).
- **Create:** `src/app/storage-migration.test.ts` — vitest + fake-indexeddb.
- **Modify:** `src/app/boot-theme-script.ts` — inline sync localStorage rename atop the IIFE, read new keys (EXEMPT from Task 4 sweep — hand-managed).
- **Modify:** `src/app/layout-boot-script.test.ts` — pinned boot string + eval (update in lockstep).
- **Modify (app-init wiring):** the load path that calls `hydrateSecretsInto` — await `migrateIndexedDb()` before it. (Locate in Task 3.)
- **Modify (constants):** `app-reset.ts`, `style-ci.ts`, `theme.ts`, `scheme-apply.ts`.
- **Modify (literal sweep, ~124 files):** all `src` files with lowercase `lop-*` tokens EXCEPT `storage-migration.ts`/`.test` + `boot-theme-script.ts`.
- **Modify (brand):** `public/manifest.webmanifest`, `src/app/layout.tsx`, `package.json`.
- **Modify (docs):** `AGENTS.md`, `CLAUDE.md`.

---

## Task 1: `storage-migration.ts` — localStorage half (TDD)

**Files:** Create `src/app/storage-migration.ts`, `src/app/storage-migration.test.ts`.

- [ ] **Step 1: failing test** `storage-migration.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { migrateLocalStorage } from "./storage-migration";

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
    expect(localStorage.getItem("aipm-cockpit:settings")).toBe("NEW"); // target present → keep, drop old
    expect(localStorage.getItem("lop-app:settings")).toBeNull();
    migrateLocalStorage(); // re-run no-op
    expect(localStorage.getItem("aipm-cockpit:settings")).toBe("NEW");
  });
});
```

- [ ] **Step 2: run, expect FAIL** `npx vitest run src/app/storage-migration.test.ts`
- [ ] **Step 3: implement** `src/app/storage-migration.ts`:

```ts
// One-time idempotent rename of the lop-app storage namespace to aipm-cockpit.
// Holds BOTH legacy and new literals on purpose — EXEMPT from the rename sweep.

const LEGACY_LS_PREFIX = "lop-app:";
const NEW_LS_PREFIX = "aipm-cockpit:";

const NONPREFIXED_LS: Readonly<Record<string, string>> = {
  "lop-style": "aipm-cockpit-style",
  "lop-theme": "aipm-cockpit-theme",
  "lop-active-scheme-colors": "aipm-cockpit-active-scheme-colors",
  "lop-active-scheme-structural": "aipm-cockpit-active-scheme-structural",
  "lop-scheme-supports-dark": "aipm-cockpit-scheme-supports-dark",
};

export const IDB_DB_RENAMES: ReadonlyArray<readonly [string, string]> = [
  ["lop-app-secrets", "aipm-cockpit-secrets"], // device key FIRST
  ["lop-app", "aipm-cockpit"],
  ["lop-app-project-handles", "aipm-cockpit-project-handles"],
];

function moveKey(oldKey: string, newKey: string): void {
  if (localStorage.getItem(newKey) !== null) {
    localStorage.removeItem(oldKey); // target already present → drop stale old
    return;
  }
  const v = localStorage.getItem(oldKey);
  if (v === null) return;
  localStorage.setItem(newKey, v);
  localStorage.removeItem(oldKey);
}

export function migrateLocalStorage(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) keys.push(k);
    }
    for (const k of keys) {
      if (k.startsWith(LEGACY_LS_PREFIX)) {
        moveKey(k, NEW_LS_PREFIX + k.slice(LEGACY_LS_PREFIX.length));
      }
    }
    for (const oldKey of Object.keys(NONPREFIXED_LS)) {
      moveKey(oldKey, NONPREFIXED_LS[oldKey]);
    }
  } catch {
    // private-mode / quota / disabled storage — never throw at boot
  }
}
```

- [ ] **Step 4: run, expect PASS**
- [ ] **Step 5: commit** `refactor(rename): storage-migration localStorage half`

---

## Task 2: `storage-migration.ts` — IndexedDB copy-migrate (TDD)

**Files:** `src/app/storage-migration.ts`, `src/app/storage-migration.test.ts`. (fake-indexeddb is already a devDependency + setup.)

- [ ] **Step 1: failing tests** append to the test file:

```ts
import { migrateIndexedDb } from "./storage-migration";

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

describe("migrateIndexedDb", () => {
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
    expect(await dbExists("lop-app")).toBe(true); // untouched — new already present
  });
});
```

- [ ] **Step 2: run, expect FAIL**
- [ ] **Step 3: implement** append to `storage-migration.ts`:

```ts
interface StoreDump {
  name: string;
  keyPath: IDBObjectStore["keyPath"];
  autoIncrement: boolean;
  records: Array<{ key: IDBValidKey; value: unknown }>;
}

function idbExists(name: string): Promise<boolean> {
  if (typeof indexedDB.databases !== "function") return Promise.resolve(false);
  return indexedDB.databases().then((l) => l.some((d) => d.name === name)).catch(() => false);
}
function deleteDb(name: string): Promise<void> {
  return new Promise((res) => {
    const r = indexedDB.deleteDatabase(name);
    r.onsuccess = r.onerror = r.onblocked = () => res();
  });
}
function dumpDb(name: string): Promise<StoreDump[] | null> {
  return new Promise((res) => {
    const open = indexedDB.open(name);
    open.onerror = () => res(null);
    open.onsuccess = () => {
      const db = open.result;
      const names = Array.from(db.objectStoreNames);
      if (names.length === 0) { db.close(); res([]); return; }
      const dumps: StoreDump[] = [];
      const tx = db.transaction(names, "readonly");
      let pending = names.length;
      for (const sn of names) {
        const store = tx.objectStore(sn);
        const dump: StoreDump = { name: sn, keyPath: store.keyPath, autoIncrement: store.autoIncrement, records: [] };
        const cur = store.openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (c) { dump.records.push({ key: c.primaryKey, value: c.value }); c.continue(); }
          else { dumps.push(dump); if (--pending === 0) { db.close(); res(dumps); } }
        };
        cur.onerror = () => { dumps.push(dump); if (--pending === 0) { db.close(); res(dumps); } };
      }
    };
  });
}
function writeDb(name: string, dumps: StoreDump[]): Promise<boolean> {
  return new Promise((res) => {
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      for (const d of dumps) {
        if (!db.objectStoreNames.contains(d.name)) {
          db.createObjectStore(d.name, d.keyPath != null ? { keyPath: d.keyPath, autoIncrement: d.autoIncrement } : { autoIncrement: d.autoIncrement });
        }
      }
    };
    open.onerror = () => res(false);
    open.onsuccess = () => {
      const db = open.result;
      if (dumps.length === 0) { db.close(); res(true); return; }
      const tx = db.transaction(dumps.map((d) => d.name), "readwrite");
      for (const d of dumps) {
        const store = tx.objectStore(d.name);
        const inline = d.keyPath != null;
        for (const rec of d.records) inline ? store.put(rec.value) : store.put(rec.value, rec.key);
      }
      tx.oncomplete = () => { db.close(); res(true); };
      tx.onerror = () => { db.close(); res(false); };
    };
  });
}

async function migrateOneDb(oldName: string, newName: string): Promise<void> {
  if (await idbExists(newName)) return;          // already migrated
  if (!(await idbExists(oldName))) return;        // nothing to migrate
  const dumps = await dumpDb(oldName);
  if (dumps === null) return;                     // couldn't read — leave old intact
  const ok = await writeDb(newName, dumps);
  if (!ok) return;                                // write failed — leave old intact
  const verify = await dumpDb(newName);           // read-back verify
  if (verify === null) return;
  const oldCount = dumps.reduce((n, d) => n + d.records.length, 0);
  const newCount = verify.reduce((n, d) => n + d.records.length, 0);
  if (newCount < oldCount) return;                // incomplete — keep old as safety
  await deleteDb(oldName);
}

export async function migrateIndexedDb(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  for (const [oldName, newName] of IDB_DB_RENAMES) {
    try { await migrateOneDb(oldName, newName); } catch { /* degrade: keep old */ }
  }
}
```

- [ ] **Step 4: run, expect PASS** (all migration tests)
- [ ] **Step 5: `npx tsc --noEmit`**
- [ ] **Step 6: commit** `refactor(rename): storage-migration IndexedDB copy-migrate`

---

## Task 3: Wire migration into boot + app-init; update pinned boot guard

**Files:** `src/app/boot-theme-script.ts`, `src/app/layout-boot-script.test.ts`, the secrets/workspace load path.

- [ ] **Step 1:** In `NO_FLASH_THEME_SCRIPT` (`boot-theme-script.ts`), prepend a synchronous inline rename BEFORE the first `getItem("lop-style")`, then change every boot `getItem("lop-…")` to the new key name:

Inline prelude (string-concatenated into the IIFE, guarded, wrapped in try/catch):
```js
try{var LS=localStorage;var mv=function(o,n){if(LS.getItem(n)!==null){LS.removeItem(o);return;}var v=LS.getItem(o);if(v===null)return;LS.setItem(n,v);LS.removeItem(o);};
var i,k,ks=[];for(i=0;i<LS.length;i++){k=LS.key(i);if(k)ks.push(k);}
for(i=0;i<ks.length;i++){if(ks[i].indexOf("lop-app:")===0)mv(ks[i],"aipm-cockpit:"+ks[i].slice(8));}
var NP={"lop-style":"aipm-cockpit-style","lop-theme":"aipm-cockpit-theme","lop-active-scheme-colors":"aipm-cockpit-active-scheme-colors","lop-active-scheme-structural":"aipm-cockpit-active-scheme-structural","lop-scheme-supports-dark":"aipm-cockpit-scheme-supports-dark"};for(var p in NP){if(Object.prototype.hasOwnProperty.call(NP,p))mv(p,NP[p]);}}catch(e){}
```
Then read: `getItem("aipm-cockpit-style")`, `getItem("aipm-cockpit-theme")`, `getItem("aipm-cockpit-active-scheme-colors")`, `getItem("aipm-cockpit-active-scheme-structural")`, `getItem("aipm-cockpit-scheme-supports-dark")`.

- [ ] **Step 2:** Update `layout-boot-script.test.ts` — it pins + `eval`s `NO_FLASH_THEME_SCRIPT`. Update the pinned expectation to the new string; keep the runtime-eval assertions (seed old `lop-style`/scheme keys, run script, assert new keys present + `data-scheme-dark`/`.dark` correct + old keys gone).
- [ ] **Step 3:** Locate the load path calling `hydrateSecretsInto` (grep `hydrateSecretsInto`), await `migrateIndexedDb()` immediately before it (and call `migrateLocalStorage()` defensively at the same init point — no-op after boot). Add the imports.
- [ ] **Step 4:** `npx tsc --noEmit` + `npx vitest run src/app/layout-boot-script.test.ts src/app/storage-migration.test.ts`
- [ ] **Step 5: commit** `refactor(rename): wire storage migration into boot + app-init`

---

## Task 4: Constant + literal sweep (deterministic script)

**Files:** all `src` files with lowercase `lop-*` tokens EXCEPT `storage-migration.ts`, `storage-migration.test.ts`, `boot-theme-script.ts` (hand-managed; hold legacy literals).

Ordered token replacements (apply to every eligible file; order avoids overlaps — prefixes cascade to `-change` events correctly):

| Find | Replace |
|---|---|
| `lop-app` | `aipm-cockpit` |
| `lop-style` | `aipm-cockpit-style` |
| `lop-theme` | `aipm-cockpit-theme` |
| `lop-active-scheme` | `aipm-cockpit-active-scheme` |
| `lop-scheme` | `aipm-cockpit-scheme` |
| `lop-thead` | `aipm-cockpit-thead` |
| `lop-popout` | `aipm-cockpit-popout` |
| `lop-tasks-` | `aipm-cockpit-tasks-` |
| `lop-digest` | `aipm-cockpit-digest` |
| `lop-secret-unreadable` | `aipm-cockpit-secret-unreadable` |
| `lop-settings-write-failed` | `aipm-cockpit-settings-write-failed` |

**MUST NOT touch:** `# LOP Tasks` / `LOP Tasks` (uppercase — not matched), `LOP-101` (uppercase), "List of Open Points" (no `lop-`). All replacements are lowercase `lop-` tokens, so uppercase brand/format strings are inherently safe.

- [ ] **Step 1:** Write `scripts/rename-lop-tokens.mjs` (scratchpad or repo-local, delete after): read the eligible file list from `git grep -l`, apply the ordered replacements in each, EXCLUDE the 3 exempt files. Log per-file replacement counts.
- [ ] **Step 2:** Run it. Then verify NO stray lowercase tokens remain:
```bash
git grep -n "lop-app\|lop-style\|lop-theme\|lop-active-scheme\|lop-scheme\|lop-thead\|lop-popout\|lop-tasks-\|lop-digest\|lop-secret-unreadable\|lop-settings-write-failed" -- src \
  | grep -v "storage-migration\|boot-theme-script"   # only exempt files may retain legacy literals
# expect: no output
git grep -n "# LOP Tasks\|LOP-101" -- src | head   # expect: STILL present (format/sample preserved)
```
- [ ] **Step 3:** `npx tsc --noEmit` (catches any `const`/import name drift) + `npm run lint` (`--max-warnings=0`; fix any unused).
- [ ] **Step 4:** `npm run test:run` — fix any test asserting an old literal the script missed (e.g. dynamic-built keys). Re-run.
- [ ] **Step 5:** `npm run size:check` + `npm run dup:check`.
- [ ] **Step 6: commit** `refactor(rename): sweep lop-* storage/event/class literals to aipm-cockpit`

---

## Task 5: Brand strings + manifest + package.json

**Files:** `public/manifest.webmanifest`, `src/app/layout.tsx`, `package.json`.

- [ ] **Step 1:** `public/manifest.webmanifest`: `"name": "AIPM Cockpit"`, `"short_name": "AIPM Cockpit"`, `"description": "AI-assisted project cockpit — tracking that plugs into M365, Jira and Timelog. Local-first, no backend."`
- [ ] **Step 2:** `src/app/layout.tsx`: `metadata.title = "AIPM Cockpit"`.
- [ ] **Step 3:** `package.json`: `"name": "aipm-cockpit"`.
- [ ] **Step 4:** `npm run build` (manifest/title compile; PWA manifest served).
- [ ] **Step 5: commit** `refactor(rename): brand to AIPM Cockpit (manifest, title, package name)`

---

## Task 6: Docs

**Files:** `AGENTS.md`, `CLAUDE.md` (+ any `docs/` referencing the storage namespace).

- [ ] **Step 1:** `AGENTS.md`: update every `lop-app:*` / IDB-DB-name / boot-key reference to `aipm-cockpit`; add a one-line "storage namespace = `aipm-cockpit:` (migrated from legacy `lop-app:` via `storage-migration.ts`)" note under the reset/clear-boundary bullet.
- [ ] **Step 2:** grep `docs/` for `lop-app` and update prose references (skip gitignored `docs/superpowers`).
- [ ] **Step 3: commit** `docs(rename): update AGENTS.md + docs for aipm-cockpit namespace`

---

## Task 7: Full-gate verification

- [ ] `npx tsc --noEmit` → 0
- [ ] `npm run lint` → 0 warnings
- [ ] `npm run test:run` → green
- [ ] `npm run build` → 0
- [ ] `npm run size:check` + `npm run dup:check` → green
- [ ] `npx playwright test e2e/a11y.spec.ts --project=chromium` → 5-combo scheme axe green (boot keys renamed — proves the boot migration + scheme paint still works)
- [ ] **Manual migration smoke** (dev server): in devtools seed `lop-app:settings`, `lop-style`, and an `indexedDB.open("lop-app-secrets")` device key + `lop-app` workspace; reload → assert `aipm-cockpit:*` keys + `aipm-cockpit*` DBs present, old gone, a sealed secret still decrypts, settings/schemes/saved-views intact; reload again → no re-migrate churn.

Then STOP — do not push/MR until the user says "release". Human repo-dir + GitLab-path steps are in the spec.
