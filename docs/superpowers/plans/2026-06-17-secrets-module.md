# Local Secrets Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypt the Anthropic API key and Turso `authToken` at rest (device-bound by default, opt-in per-secret passphrase) instead of plaintext in `localStorage`.

**Architecture:** New pure `secrets.ts` (WebCrypto AES-GCM) + `secrets-store.ts` (localStorage ciphertext record + IndexedDB device key). `writeSettings` blanks the two secret fields **synchronously** on persist; sealing happens **async only when a secret value/wrap changes** (explicit save path); load decrypts device-wrapped secrets and merges them back into the in-memory `Settings`. Passphrase-wrapped secrets stay empty until an explicit unlock. All app consumers keep reading `settings.ai.apiKey` / `settings.integrations.turso.authToken` unchanged.

**Tech Stack:** TypeScript, WebCrypto SubtleCrypto (AES-GCM, PBKDF2-SHA-256), IndexedDB (non-extractable CryptoKey), React, vitest.

**Spec:** `docs/superpowers/specs/2026-06-17-secrets-module-design.md`

**Branch:** `fix-turso-emptystate-and-askclaude-placement` (fold-in; do NOT branch).

---

## File Structure

- Create `src/app/secrets.ts` — pure crypto: base64 helpers, `SealedSecret`, `sealDevice`/`openDevice`/`sealPassphrase`/`openPassphrase`, `SecretUnlockError`, `getDeviceKey` (IndexedDB).
- Create `src/app/secrets-store.ts` — `lop-app:secrets` record I/O: `loadSealed`/`saveSealed`/`removeSealed`/`readDeviceSecret`/`isPassphraseLocked`, plus `migratePlaintextSecrets`.
- Modify `src/app/use-settings.ts` — `writeSettings` blanks secrets; mount-load decrypts device secrets + runs migration.
- Modify `src/app/settings-sections/ai-section.tsx` — route `apiKey` edits through a seal callback + passphrase toggle.
- Modify `src/app/settings-sections/integrations-section.tsx` — same for Turso `authToken`.
- Modify `src/app/task-manager.tsx` — own a `useSecrets`-style controller, thread save/unlock callbacks; Turso-token unlock-gate at boot.
- Modify `src/app/chat-panel.tsx` — unlock prompt when the Anthropic key is passphrase-locked.
- Modify `src/app/i18n.ts` + `src/app/i18n.de.ts` — new keys.
- Tests beside each module.

**Constants:** `SECRETS_KEY = "lop-app:secrets"`; `PBKDF2_ITERS = 600_000`; IndexedDB db `"lop-app-secrets"`, store `"keys"`, key `"device-key"`.

---

### Task 1: Crypto core — base64 + device seal/open

**Files:**
- Create: `src/app/secrets.ts`
- Test: `src/app/secrets.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/app/secrets.test.ts
import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { sealDevice, openDevice } from "./secrets";

describe("secrets device wrap", () => {
  it("round-trips a secret through the device key", async () => {
    const sealed = await sealDevice("anthropicApiKey", "sk-ant-secret-123");
    expect(sealed.wrap).toBe("device");
    expect(sealed.ciphertext).not.toContain("sk-ant"); // ciphertext, not plaintext
    expect(await openDevice(sealed)).toBe("sk-ant-secret-123");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`Cannot find module './secrets'`)

Run: `npx vitest run src/app/secrets.test.ts`

- [ ] **Step 3: Implement `secrets.ts` (base64 + device key + device seal/open)**

```ts
// src/app/secrets.ts
//
// At-rest encryption for the two browser-held secrets (Anthropic API key, Turso
// auth token). Pure WebCrypto: AES-256-GCM with either a non-extractable
// device-bound key (default) or a PBKDF2-derived passphrase key. i18n-free.

export type WrapMode = "device" | "passphrase";
export type SecretId = "anthropicApiKey" | "tursoAuthToken";

export interface SealedSecret {
  v: 1;
  id: SecretId;
  wrap: WrapMode;
  alg: "AES-GCM";
  iv: string; // base64, 12 bytes
  salt?: string; // base64, 16 bytes (passphrase only)
  kdf?: { name: "PBKDF2"; iters: number; hash: "SHA-256" };
  ciphertext: string; // base64
}

/** Wrong passphrase / tampered ciphertext. Thrown by openPassphrase/openDevice. */
export class SecretUnlockError extends Error {
  constructor(message = "secret-unlock-failed") {
    super(message);
    this.name = "SecretUnlockError";
  }
}

const PBKDF2_ITERS = 600_000;
const DB_NAME = "lop-app-secrets";
const STORE = "keys";
const DEVICE_KEY_ID = "device-key";

const subtle = (): SubtleCrypto => globalThis.crypto.subtle;

function toB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}
function randomBytes(n: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}
const enc = new TextEncoder();
const dec = new TextDecoder();

// --- device key (non-extractable, persisted as a CryptoKey in IndexedDB) ------

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbGet(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Get the persisted non-extractable device key, generating + storing it once. */
export async function getDeviceKey(): Promise<CryptoKey> {
  const db = await idbOpen();
  try {
    const existing = (await idbGet(db, DEVICE_KEY_ID)) as CryptoKey | undefined;
    if (existing) return existing;
    const key = await subtle().generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    await idbPut(db, DEVICE_KEY_ID, key); // structured-clone stores the CryptoKey itself
    return key;
  } finally {
    db.close();
  }
}

async function aesEncrypt(
  key: CryptoKey,
  id: SecretId,
  plaintext: string,
  extra: Partial<SealedSecret>,
): Promise<SealedSecret> {
  const iv = randomBytes(12);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  return { v: 1, id, alg: "AES-GCM", iv: toB64(iv.buffer), ciphertext: toB64(ct), ...extra } as SealedSecret;
}
async function aesDecrypt(key: CryptoKey, s: SealedSecret): Promise<string> {
  try {
    const pt = await subtle().decrypt(
      { name: "AES-GCM", iv: fromB64(s.iv) },
      key,
      fromB64(s.ciphertext),
    );
    return dec.decode(pt);
  } catch {
    throw new SecretUnlockError();
  }
}

export async function sealDevice(id: SecretId, plaintext: string): Promise<SealedSecret> {
  return aesEncrypt(await getDeviceKey(), id, plaintext, { wrap: "device" });
}
export async function openDevice(s: SealedSecret): Promise<string> {
  return aesDecrypt(await getDeviceKey(), s);
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/app/secrets.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/app/secrets.ts src/app/secrets.test.ts
git commit -m "feat(secrets): WebCrypto device-wrap seal/open core"
```

---

### Task 2: Passphrase seal/open

**Files:**
- Modify: `src/app/secrets.ts`
- Test: `src/app/secrets.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
import { sealPassphrase, openPassphrase, SecretUnlockError } from "./secrets";

it("round-trips a secret through a passphrase", async () => {
  const sealed = await sealPassphrase("tursoAuthToken", "tok-abc", "correct horse");
  expect(sealed.wrap).toBe("passphrase");
  expect(sealed.salt).toBeTruthy();
  expect(sealed.kdf?.iters).toBe(600_000);
  expect(await openPassphrase(sealed, "correct horse")).toBe("tok-abc");
});

it("rejects a wrong passphrase with SecretUnlockError", async () => {
  const sealed = await sealPassphrase("tursoAuthToken", "tok-abc", "right");
  await expect(openPassphrase(sealed, "wrong")).rejects.toBeInstanceOf(SecretUnlockError);
});
```

- [ ] **Step 2: Run — expect FAIL** (`sealPassphrase is not a function`)

Run: `npx vitest run src/app/secrets.test.ts`

- [ ] **Step 3: Implement passphrase wrap (append to `secrets.ts`)**

```ts
async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await subtle().importKey("raw", enc.encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return subtle().deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealPassphrase(
  id: SecretId,
  plaintext: string,
  passphrase: string,
): Promise<SealedSecret> {
  const salt = randomBytes(16);
  const key = await deriveKey(passphrase, salt);
  return aesEncrypt(await Promise.resolve(key), id, plaintext, {
    wrap: "passphrase",
    salt: toB64(salt.buffer),
    kdf: { name: "PBKDF2", iters: PBKDF2_ITERS, hash: "SHA-256" },
  });
}
export async function openPassphrase(s: SealedSecret, passphrase: string): Promise<string> {
  if (!s.salt) throw new SecretUnlockError("missing-salt");
  const key = await deriveKey(passphrase, fromB64(s.salt));
  return aesDecrypt(key, s);
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/app/secrets.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/app/secrets.ts src/app/secrets.test.ts
git commit -m "feat(secrets): PBKDF2 passphrase seal/open + SecretUnlockError"
```

---

### Task 3: Secrets store (localStorage record + device read)

**Files:**
- Create: `src/app/secrets-store.ts`
- Test: `src/app/secrets-store.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/app/secrets-store.test.ts
import "fake-indexeddb/auto";
import { describe, it, expect, afterEach } from "vitest";
import { sealDevice, sealPassphrase } from "./secrets";
import { saveSealed, loadSealed, removeSealed, readDeviceSecret, isPassphraseLocked } from "./secrets-store";

afterEach(() => localStorage.clear());

describe("secrets-store", () => {
  it("saves, reads back a device secret, and reports not passphrase-locked", async () => {
    saveSealed(await sealDevice("anthropicApiKey", "sk-1"));
    expect(loadSealed("anthropicApiKey")?.wrap).toBe("device");
    expect(await readDeviceSecret("anthropicApiKey")).toBe("sk-1");
    expect(isPassphraseLocked("anthropicApiKey")).toBe(false);
  });

  it("returns null for a passphrase secret on device read, and flags it locked", async () => {
    saveSealed(await sealPassphrase("tursoAuthToken", "tok-1", "pw"));
    expect(await readDeviceSecret("tursoAuthToken")).toBeNull();
    expect(isPassphraseLocked("tursoAuthToken")).toBe(true);
  });

  it("removeSealed deletes the entry", async () => {
    saveSealed(await sealDevice("anthropicApiKey", "sk-1"));
    removeSealed("anthropicApiKey");
    expect(loadSealed("anthropicApiKey")).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/app/secrets-store.test.ts`

- [ ] **Step 3: Implement `secrets-store.ts`**

```ts
// src/app/secrets-store.ts
//
// Persistence + accessors for sealed secrets. Ciphertext lives in
// localStorage["lop-app:secrets"], keyed by SecretId; the device key lives in
// IndexedDB (see secrets.ts). Kept OUT of lop-app:settings and out of Turso.

import { type SealedSecret, type SecretId, openDevice } from "./secrets";

export const SECRETS_KEY = "lop-app:secrets";
type Store = Partial<Record<SecretId, SealedSecret>>;

function readStore(): Store {
  try {
    const raw = localStorage.getItem(SECRETS_KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}
function writeStore(s: Store): void {
  try {
    localStorage.setItem(SECRETS_KEY, JSON.stringify(s));
  } catch {
    /* quota / disabled — degrade */
  }
}

export function loadSealed(id: SecretId): SealedSecret | null {
  return readStore()[id] ?? null;
}
export function saveSealed(sealed: SealedSecret): void {
  const s = readStore();
  s[sealed.id] = sealed;
  writeStore(s);
}
export function removeSealed(id: SecretId): void {
  const s = readStore();
  delete s[id];
  writeStore(s);
}
export function isPassphraseLocked(id: SecretId): boolean {
  return loadSealed(id)?.wrap === "passphrase";
}

/** Decrypt a device-wrapped secret. Returns null when absent OR passphrase-wrapped
 *  (the caller must prompt for unlock instead). Never throws on a missing key. */
export async function readDeviceSecret(id: SecretId): Promise<string | null> {
  const sealed = loadSealed(id);
  if (!sealed || sealed.wrap !== "device") return null;
  try {
    return await openDevice(sealed);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/app/secrets-store.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/app/secrets-store.ts src/app/secrets-store.test.ts
git commit -m "feat(secrets): localStorage sealed-secret store + device read"
```

---

### Task 4: One-time migration of plaintext secrets

**Files:**
- Modify: `src/app/secrets-store.ts`
- Test: `src/app/secrets-store.test.ts`

- [ ] **Step 1: Add failing test**

```ts
import { migratePlaintextSecrets } from "./secrets-store";

it("migrates plaintext apiKey + authToken to device-sealed secrets, blanks input", async () => {
  const blanked = await migratePlaintextSecrets({ apiKey: "sk-x", authToken: "tok-y" });
  expect(blanked).toEqual({ apiKey: "", authToken: "" });
  expect(await readDeviceSecret("anthropicApiKey")).toBe("sk-x");
  expect(await readDeviceSecret("tursoAuthToken")).toBe("tok-y");
});

it("is a no-op when inputs are already blank", async () => {
  const blanked = await migratePlaintextSecrets({ apiKey: "", authToken: undefined });
  expect(blanked).toEqual({ apiKey: "", authToken: "" });
  expect(loadSealed("anthropicApiKey")).toBeNull();
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/app/secrets-store.test.ts`

- [ ] **Step 3: Implement (append to `secrets-store.ts`)**

```ts
import { sealDevice } from "./secrets";

/** Seal any non-empty plaintext secrets device-wrapped (only if not already
 *  sealed) and return the blanked values to write back into settings. Idempotent. */
export async function migratePlaintextSecrets(input: {
  apiKey?: string;
  authToken?: string;
}): Promise<{ apiKey: string; authToken: string }> {
  const apiKey = (input.apiKey ?? "").trim();
  const authToken = (input.authToken ?? "").trim();
  if (apiKey && !loadSealed("anthropicApiKey")) {
    saveSealed(await sealDevice("anthropicApiKey", apiKey));
  }
  if (authToken && !loadSealed("tursoAuthToken")) {
    saveSealed(await sealDevice("tursoAuthToken", authToken));
  }
  return { apiKey: "", authToken: "" };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/app/secrets-store.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/app/secrets-store.ts src/app/secrets-store.test.ts
git commit -m "feat(secrets): one-time plaintext-secret migration helper"
```

---

### Task 5: Persistence boundary — `writeSettings` blanks secrets

**Files:**
- Modify: `src/app/use-settings.ts:17-24`
- Test: `src/app/use-settings.secrets.test.ts` (new)

- [ ] **Step 1: Write failing test**

```ts
// src/app/use-settings.secrets.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { writeSettings, SETTINGS_KEY } from "./use-settings";
import { defaultSettings } from "./settings-types";

afterEach(() => localStorage.clear());

describe("writeSettings secret blanking", () => {
  it("never persists apiKey or turso authToken into lop-app:settings", () => {
    writeSettings({
      ...defaultSettings,
      ai: { ...defaultSettings.ai, apiKey: "sk-secret" },
      integrations: { ...defaultSettings.integrations, turso: { databaseUrl: "libsql://x", authToken: "tok-secret" } },
    });
    const persisted = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(persisted.ai.apiKey).toBe("");
    expect(persisted.integrations.turso.authToken ?? "").toBe("");
    // Non-secret config still persisted.
    expect(persisted.integrations.turso.databaseUrl).toBe("libsql://x");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (apiKey persisted as "sk-secret")

Run: `npx vitest run src/app/use-settings.secrets.test.ts`

- [ ] **Step 3: Implement — blank secrets in `writeSettings`**

```ts
// src/app/use-settings.ts — replace writeSettings
/** Synchronously write settings to localStorage WITH the two at-rest secrets
 *  blanked. Secret ciphertext is persisted separately (secrets-store) on change;
 *  see use-settings mount-load for the decrypt+merge back into memory. */
export function writeSettings(settings: Settings): void {
  const turso = settings.integrations?.turso;
  const persistable: Settings = {
    ...settings,
    ai: { ...settings.ai, apiKey: "" },
    integrations: turso
      ? { ...settings.integrations, turso: { ...turso, authToken: "" } }
      : settings.integrations,
  };
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(persistable));
  } catch {
    // quota exceeded / storage disabled — degrade gracefully, keep in-memory settings
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/app/use-settings.secrets.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/app/use-settings.ts src/app/use-settings.secrets.test.ts
git commit -m "feat(secrets): writeSettings blanks apiKey + turso authToken on persist"
```

---

### Task 6: Load-time decrypt + migration in `useSettings`

**Files:**
- Modify: `src/app/use-settings.ts` (mount-load effect, ~lines 149-250)
- Test: `src/app/use-settings.secrets.test.ts`

Context: the mount effect reads `lop-app:settings`, builds the in-memory `Settings`, and calls `setSettings`. It is already `async`-capable (it gates `hydrated`). Add a step after the settings object is assembled and BEFORE the first persist: run `migratePlaintextSecrets` against the freshly-read raw values, then `readDeviceSecret` for both and merge into the in-memory settings.

- [ ] **Step 1: Add failing integration test** (drives a tiny exported helper to keep the effect testable)

```ts
import { hydrateSecretsInto } from "./use-settings";
import { sealDevice } from "./secrets";
import { saveSealed } from "./secrets-store";

it("hydrateSecretsInto merges device secrets into in-memory settings", async () => {
  saveSealed(await sealDevice("anthropicApiKey", "sk-live"));
  const merged = await hydrateSecretsInto({
    ...defaultSettings,
    ai: { ...defaultSettings.ai, apiKey: "" },
  });
  expect(merged.ai.apiKey).toBe("sk-live");
});

it("hydrateSecretsInto leaves a passphrase-locked secret empty", async () => {
  const { sealPassphrase } = await import("./secrets");
  saveSealed(await sealPassphrase("anthropicApiKey", "sk-live", "pw"));
  const merged = await hydrateSecretsInto({
    ...defaultSettings,
    ai: { ...defaultSettings.ai, apiKey: "" },
  });
  expect(merged.ai.apiKey).toBe("");
});
```

- [ ] **Step 2: Run — expect FAIL** (`hydrateSecretsInto` undefined)

Run: `npx vitest run src/app/use-settings.secrets.test.ts`

- [ ] **Step 3: Implement helper + wire into mount-load**

```ts
// src/app/use-settings.ts — add import + helper
import { migratePlaintextSecrets, readDeviceSecret } from "./secrets-store";

/** Merge device-wrapped secrets into an in-memory Settings (passphrase-wrapped
 *  ones stay blank until an explicit unlock). Pure w.r.t. settings; reads the
 *  secret store. */
export async function hydrateSecretsInto(settings: Settings): Promise<Settings> {
  const apiKey = (await readDeviceSecret("anthropicApiKey")) ?? settings.ai.apiKey;
  const token = await readDeviceSecret("tursoAuthToken");
  const turso = settings.integrations?.turso;
  return {
    ...settings,
    ai: { ...settings.ai, apiKey },
    integrations:
      turso && token !== null
        ? { ...settings.integrations, turso: { ...turso, authToken: token } }
        : settings.integrations,
  };
}
```

In the mount effect, AFTER the settings object (`next`) is assembled from `lop-app:settings` and BEFORE `setSettings(next)`:

```ts
// Migrate any legacy plaintext secrets, then merge device-wrapped secrets in.
await migratePlaintextSecrets({
  apiKey: next.ai.apiKey,
  authToken: next.integrations?.turso?.authToken,
});
const hydrated = await hydrateSecretsInto({
  ...next,
  ai: { ...next.ai, apiKey: "" },
  integrations: next.integrations?.turso
    ? { ...next.integrations, turso: { ...next.integrations.turso, authToken: "" } }
    : next.integrations,
});
setSettings(hydrated);
```

(If the mount effect body is not already `async`, wrap this tail in an inner `void (async () => { ... })()` that resolves before flipping `hydrated` state — mirror the existing Turso `refreshTursoProjects` IIFE pattern in task-manager.)

- [ ] **Step 4: Run — expect PASS**; then full `npx vitest run src/app/use-settings.secrets.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/app/use-settings.ts src/app/use-settings.secrets.test.ts
git commit -m "feat(secrets): hydrate device secrets + migrate plaintext on load"
```

---

### Task 7: Secrets controller hook (save / unlock)

**Files:**
- Create: `src/app/use-secrets.ts`
- Test: `src/app/use-secrets.test.ts`

Purpose: the single place the UI calls to (a) save a secret value, (b) change its wrap mode, (c) unlock a passphrase secret into memory. It updates the in-memory `Settings` (via the passed setter) AND seals to the store.

- [ ] **Step 1: Write failing test**

```ts
// src/app/use-secrets.test.ts
import "fake-indexeddb/auto";
import { describe, it, expect, afterEach, vi } from "vitest";
import { saveSecretValue, setSecretPassphrase, unlockSecret } from "./use-secrets";
import { loadSealed, readDeviceSecret } from "./secrets-store";

afterEach(() => localStorage.clear());

describe("use-secrets controller", () => {
  it("saveSecretValue device-seals and stores", async () => {
    await saveSecretValue("anthropicApiKey", "sk-1", "device");
    expect(await readDeviceSecret("anthropicApiKey")).toBe("sk-1");
  });
  it("setSecretPassphrase re-seals an existing value under a passphrase", async () => {
    await saveSecretValue("tursoAuthToken", "tok-1", "device");
    await setSecretPassphrase("tursoAuthToken", "tok-1", "pw");
    expect(loadSealed("tursoAuthToken")?.wrap).toBe("passphrase");
  });
  it("unlockSecret returns the plaintext for a correct passphrase, null for wrong", async () => {
    await setSecretPassphrase("anthropicApiKey", "sk-1", "pw");
    expect(await unlockSecret("anthropicApiKey", "pw")).toBe("sk-1");
    expect(await unlockSecret("anthropicApiKey", "nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/app/use-secrets.test.ts`

- [ ] **Step 3: Implement `use-secrets.ts` (pure functions; hook wrapper thin)**

```ts
// src/app/use-secrets.ts
import {
  type SecretId,
  type WrapMode,
  sealDevice,
  sealPassphrase,
  openPassphrase,
  SecretUnlockError,
} from "./secrets";
import { loadSealed, saveSealed } from "./secrets-store";

/** Seal `value` under the chosen wrap (device by default) and store it. */
export async function saveSecretValue(
  id: SecretId,
  value: string,
  wrap: WrapMode,
  passphrase?: string,
): Promise<void> {
  if (wrap === "passphrase") {
    if (!passphrase) throw new Error("passphrase required");
    saveSealed(await sealPassphrase(id, value, passphrase));
  } else {
    saveSealed(await sealDevice(id, value));
  }
}

/** Re-seal an existing/known value under a passphrase. */
export async function setSecretPassphrase(
  id: SecretId,
  value: string,
  passphrase: string,
): Promise<void> {
  saveSealed(await sealPassphrase(id, value, passphrase));
}

/** Try to unlock a passphrase secret. Returns plaintext or null on wrong passphrase. */
export async function unlockSecret(id: SecretId, passphrase: string): Promise<string | null> {
  const sealed = loadSealed(id);
  if (!sealed || sealed.wrap !== "passphrase") return null;
  try {
    return await openPassphrase(sealed, passphrase);
  } catch (e) {
    if (e instanceof SecretUnlockError) return null;
    throw e;
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/app/use-secrets.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/app/use-secrets.ts src/app/use-secrets.test.ts
git commit -m "feat(secrets): save/passphrase/unlock controller functions"
```

---

### Task 8: i18n keys

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Add keys to `i18n.ts` (EN)** — place near the AI/integrations groups:

```ts
  secretLockPassphrase: "Require a passphrase to unlock",
  secretLockWarning: "No recovery: if you forget this passphrase you must re-enter the value.",
  secretPassphrasePlaceholder: "Passphrase",
  secretUnlockTitle: "Unlock to continue",
  secretUnlockApiKey: "Enter your passphrase to unlock the Claude API key.",
  secretUnlockTursoToken: "Enter your passphrase to unlock the Turso token and load your projects.",
  secretUnlock: "Unlock",
  secretUnlockFailed: "Wrong passphrase.",
```

- [ ] **Step 2: Add the SAME keys to `i18n.de.ts` (DE, real umlauts) via a node UTF-8 CRLF write** (the Edit tool corrupts umlauts; the file is CRLF — match `\r\n`):

```bash
node -e 'const fs=require("fs");const p="src/app/i18n.de.ts";let s=fs.readFileSync(p,"utf8");const anchor="\r\n";/* insert block before the closing of the de dict — locate a stable existing DE key and append after it */; const ins=[`  secretLockPassphrase: "Passphrase zum Entsperren verlangen",`,`  secretLockWarning: "Keine Wiederherstellung: Wenn Sie diese Passphrase vergessen, mussen Sie den Wert neu eingeben.",`,`  secretPassphrasePlaceholder: "Passphrase",`,`  secretUnlockTitle: "Zum Fortfahren entsperren",`,`  secretUnlockApiKey: "Geben Sie Ihre Passphrase ein, um den Claude-API-Schlussel zu entsperren.",`,`  secretUnlockTursoToken: "Geben Sie Ihre Passphrase ein, um das Turso-Token zu entsperren und Ihre Projekte zu laden.",`,`  secretUnlock: "Entsperren",`,`  secretUnlockFailed: "Falsche Passphrase.",`].join("\r\n");/* NOTE: replace the placeholder umlaut-free words above with real umlauts: muessen→müssen, Schluessel→Schlüssel — write them as proper UTF-8 here */;s=s.replace(/(\r\n)(\} as const;?\s*)$/,(m,nl,tail)=>nl+ins+nl+tail);fs.writeFileSync(p,s,"utf8");console.log("DE keys added");'
```

  IMPORTANT: in the actual write, use real German umlauts (`müssen`, `Schlüssel`) — the `i18n-encoding` test BANS ASCII substitutions. Verify the exact closing-token regex against the real file before running; adjust the anchor to a stable existing key if `} as const` is not the literal tail.

- [ ] **Step 3: Verify parity + encoding**

Run: `npx tsc --noEmit` (EN/DE key parity) and `npx vitest run src/app/i18n-encoding`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(secrets): EN/DE strings for passphrase lock + unlock"
```

---

### Task 9: AI section — route apiKey through seal + passphrase toggle

**Files:**
- Modify: `src/app/settings-sections/ai-section.tsx`
- Modify: `src/app/task-manager.tsx` (thread the save callback)
- Test: `src/app/settings-sections/ai-section.test.tsx`

- [ ] **Step 1: Write failing test** (the apiKey input change seals via the injected callback, NOT plain settings)

```tsx
it("seals the API key via onSaveSecret instead of persisting it in settings", () => {
  const onSaveSecret = vi.fn();
  render(<AiSection {...baseProps()} onSaveSecret={onSaveSecret} />);
  fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: "sk-new" } });
  expect(onSaveSecret).toHaveBeenCalledWith("anthropicApiKey", "sk-new");
});
```

- [ ] **Step 2: Run — expect FAIL** (`onSaveSecret` not a prop)

Run: `npx vitest run src/app/settings-sections/ai-section.test.tsx`

- [ ] **Step 3: Implement**

In `ai-section.tsx`: add props `onSaveSecret: (id: "anthropicApiKey", value: string) => void` and `passphraseLocked: boolean`. The apiKey `<input>` onChange both updates the in-memory config (existing `onChange`) AND calls `onSaveSecret("anthropicApiKey", value)`. Add a checkbox `secretLockPassphrase` + (when checked) a passphrase `<input type="password">` calling a new `onSetPassphrase("anthropicApiKey", passphrase)` prop; show `secretLockWarning`.

In `task-manager.tsx`: implement `onSaveSecret = (id, value) => { setSettings(s => merge value into memory); void saveSecretValue(id, value, currentWrapMode(id)); }` and `onSetPassphrase = (id, pw) => void setSecretPassphrase(id, inMemoryValue(id), pw)`, importing from `./use-secrets`. Thread both into `<SettingsView>` → `<AiSection>` (mirror the existing `config`/settings prop threading).

- [ ] **Step 4: Run — expect PASS** (`ai-section.test.tsx` + `npx tsc --noEmit`)

- [ ] **Step 5: Commit**

```bash
git add src/app/settings-sections/ai-section.tsx src/app/task-manager.tsx src/app/settings-sections/ai-section.test.tsx
git commit -m "feat(secrets): AI section seals API key + passphrase toggle"
```

---

### Task 10: Integrations section — Turso token seal + passphrase toggle

**Files:**
- Modify: `src/app/settings-sections/integrations-section.tsx`
- Modify: `src/app/task-manager.tsx` (callback already exists from Task 9; extend for `tursoAuthToken`)
- Test: `src/app/settings-sections/integrations-snapshots.test.tsx` (or a focused new test)

- [ ] **Step 1: Write failing test**

```tsx
it("seals the Turso auth token via onSaveSecret", () => {
  const onSaveSecret = vi.fn();
  render(<IntegrationsSection {...baseProps()} onSaveSecret={onSaveSecret} />);
  fireEvent.change(screen.getByLabelText(/auth token/i), { target: { value: "tok-new" } });
  expect(onSaveSecret).toHaveBeenCalledWith("tursoAuthToken", "tok-new");
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/app/settings-sections/integrations-snapshots.test.tsx`

- [ ] **Step 3: Implement** — same shape as Task 9: `authToken` input onChange updates memory + `onSaveSecret("tursoAuthToken", value)`; passphrase checkbox + field → `onSetPassphrase("tursoAuthToken", pw)`; warning string. `databaseUrl` stays plain (not secret).

- [ ] **Step 4: Run — expect PASS** + `npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/app/settings-sections/integrations-section.tsx src/app/task-manager.tsx src/app/settings-sections/integrations-snapshots.test.tsx
git commit -m "feat(secrets): Turso token seals + passphrase toggle"
```

---

### Task 11: Chat unlock prompt (Anthropic passphrase-locked)

**Files:**
- Modify: `src/app/chat-panel.tsx`
- Test: `src/app/chat-panel.test.tsx`

Context: `chat-panel.tsx` shows the "no API key" state when `!ai.apiKey.trim()`. When the Anthropic secret is passphrase-locked, render an Unlock prompt instead. Thread an `apiKeyLocked: boolean` + `onUnlockApiKey: (passphrase: string) => Promise<boolean>` prop (wired in task-manager via `unlockSecret`, which on success sets the key in memory and returns true).

- [ ] **Step 1: Write failing test**

```tsx
it("shows an Unlock prompt (not 'no API key') when the key is passphrase-locked", () => {
  render(<ChatPanel {...baseProps({ ai: { ...ai, apiKey: "", consentAccepted: true } })}
    apiKeyLocked onUnlockApiKey={vi.fn().mockResolvedValue(true)} />);
  expect(screen.getByRole("button", { name: /unlock/i })).toBeInTheDocument();
  expect(screen.queryByText(/no api key/i)).toBeNull();
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/app/chat-panel.test.tsx`

- [ ] **Step 3: Implement** — when `apiKeyLocked && !ai.apiKey.trim()`, render a small form: `secretUnlockApiKey` text, `<input type="password" aria-label={t(lang,"secretPassphrasePlaceholder")}>`, `secretUnlock` button → `await onUnlockApiKey(pw)`; on false show `secretUnlockFailed` (role="alert"). On success the parent fills `ai.apiKey` → normal chat renders.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/app/chat-panel.tsx src/app/chat-panel.test.tsx
git commit -m "feat(secrets): chat unlock prompt for passphrase-locked API key"
```

---

### Task 12: Turso token unlock-gate at boot

**Files:**
- Create: `src/app/secret-unlock-gate.tsx`
- Modify: `src/app/task-manager.tsx`
- Test: `src/app/secret-unlock-gate.test.tsx`

Context: when `portfolioMode === "turso"` and `isPassphraseLocked("tursoAuthToken")` and the in-memory token is empty, the Turso backend cannot init. Render a dedicated unlock gate BEFORE the normal tree (sibling to the empty-state gate at task-manager.tsx ~line 2041), NOT the storage-error banner. On unlock (`unlockSecret` success), set the token in memory and reload (`window.location.reload()`) so the backend re-inits with the token.

- [ ] **Step 1: Write failing test** (presentational gate)

```tsx
// src/app/secret-unlock-gate.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SecretUnlockGate } from "./secret-unlock-gate";

describe("SecretUnlockGate", () => {
  it("calls onUnlock with the typed passphrase and shows error on failure", async () => {
    const onUnlock = vi.fn().mockResolvedValue(false);
    render(<SecretUnlockGate lang="en-US" messageKey="secretUnlockTursoToken" onUnlock={onUnlock} />);
    fireEvent.change(screen.getByLabelText(/passphrase/i), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: /unlock/i }));
    expect(onUnlock).toHaveBeenCalledWith("pw");
    expect(await screen.findByText(/wrong passphrase/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/app/secret-unlock-gate.test.tsx`

- [ ] **Step 3: Implement `secret-unlock-gate.tsx`** — a `Modal`-wrapped form (reuse `./modal` + `ModalHeader`, non-dismissable like the empty state): title `secretUnlockTitle`, message from `messageKey`, `<input type="password" aria-label={secretPassphrasePlaceholder}>`, `secretUnlock` button → `const ok = await onUnlock(pw); if (!ok) setError(secretUnlockFailed)`. Props: `{ lang: Lang; messageKey: TranslationKey; onUnlock: (pw: string) => Promise<boolean> }`.

In `task-manager.tsx`, add a gate before `showEmptyState`:

```ts
const showTursoUnlock =
  hydrated && portfolioMode === "turso" &&
  isPassphraseLocked("tursoAuthToken") &&
  !(settings.integrations?.turso?.authToken ?? "").trim();
```

Render `<SecretUnlockGate lang={lang} messageKey="secretUnlockTursoToken" onUnlock={async (pw) => { const v = await unlockSecret("tursoAuthToken", pw); if (!v) return false; setSettings(s => merge token v); window.location.reload(); return true; }} />` when `showTursoUnlock` (ahead of the empty-state / main tree branches). Import `isPassphraseLocked` from `./secrets-store`, `unlockSecret` from `./use-secrets`.

- [ ] **Step 4: Run — expect PASS** + `npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/app/secret-unlock-gate.tsx src/app/secret-unlock-gate.test.tsx src/app/task-manager.tsx
git commit -m "feat(secrets): Turso token unlock gate at boot"
```

---

### Task 13: Full gates + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md` (under the existing `0.99.1` entry)

- [ ] **Step 1: Add CHANGELOG note**

```markdown
### Security
- **Encrypted local credentials** — the Anthropic API key and Turso auth token are no
  longer stored in plaintext; they are encrypted at rest with WebCrypto AES-GCM
  (device-bound key by default) and can optionally be locked behind a per-secret
  passphrase (PBKDF2). Existing plaintext keys are migrated automatically on first load.
```

- [ ] **Step 2: Run the full local gate**

Run:
```
npx tsc --noEmit
npm run lint
npm run test:run
npm run build
```
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(secrets): CHANGELOG entry for encrypted local credentials"
```

---

## Self-Review

**Spec coverage:** device wrap (T1) ✓, passphrase wrap (T2) ✓, store + device read (T3) ✓, migration (T4) ✓, writeSettings blanking (T5) ✓, load decrypt+merge (T6) ✓, save/unlock controller (T7) ✓, per-secret passphrase toggles (T9/T10) ✓, chat unlock (T11) ✓, Turso boot gate (T12) ✓, no-recovery warning (T8 string + T9/T10 UI) ✓, i18n (T8) ✓, never-persist-secret assertions (T5) ✓.

**Type consistency:** `SecretId` = `"anthropicApiKey" | "tursoAuthToken"`, `WrapMode` = `"device" | "passphrase"`, `SealedSecret`, `SecretUnlockError` used identically across T1–T12. Store fns `loadSealed/saveSealed/removeSealed/readDeviceSecret/isPassphraseLocked/migratePlaintextSecrets`. Controller fns `saveSecretValue/setSecretPassphrase/unlockSecret`. Boundary helper `hydrateSecretsInto`. Consistent.

**Known integration risks to verify during execution:**
- The `useSettings` mount effect must `await` the migrate+hydrate before flipping `hydrated` (no plaintext flash, no race). Confirm the effect is structured to allow it (IIFE).
- `task-manager` callbacks (`onSaveSecret`/`onSetPassphrase`/unlock) must update in-memory settings AND seal; confirm `currentWrapMode`/`inMemoryValue` read live state.
- Verify the DE i18n closing-token regex against the real file before the node write.
