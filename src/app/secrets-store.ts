// src/app/secrets-store.ts
//
// Persistence + accessors for sealed secrets. Ciphertext lives in
// localStorage["aipm-cockpit:secrets"], keyed by SecretId; the device key lives in
// IndexedDB (see secrets.ts). Kept OUT of aipm-cockpit:settings and out of Turso.

import { type SealedSecret, type SecretId, SECRET_IDS, openDevice, sealDevice, isSealedSecret } from "./secrets";
import { logDiag } from "./diagnostics";

export const SECRETS_KEY = "aipm-cockpit:secrets";
type Store = Partial<Record<SecretId, SealedSecret>>;

function readStore(): Store {
  try {
    const raw = localStorage.getItem(SECRETS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Store = {};
    // §567 — every sealed id, from the one runtime list (see `isSealedSecret`).
    for (const id of SECRET_IDS) {
      if (isSealedSecret(parsed[id])) out[id] = parsed[id] as SealedSecret;
    }
    return out;
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
  bumpGeneration(id);
  const s = readStore();
  delete s[id];
  writeStore(s);
}

// ★★ §609 — A LATE SEAL MUST NEVER RESURRECT A CLEARED SECRET. A seal awaits WebCrypto (and, for
//   a passphrase, PBKDF2) BEFORE it writes, and the settings fields fire one per keystroke without
//   awaiting it. A clear (`removeSealed`) is synchronous, so a seal still in flight used to land
//   AFTER it and write the old ciphertext back; two keystrokes could also land out of order.
// ★ So every write carries a per-id GENERATION: `beginSealedWrite` bumps it and hands back a commit
//   that writes only if nothing bumped it since. The newest START wins, whichever seal finishes
//   first. The counter lives HERE, not in use-secrets, so EVERY clear from any caller (settings
//   sections, jira/timelog settings, a factory reset) cancels in-flight seals without having to
//   know they exist. `saveSealed` stays the raw writer and does NOT bump; the boot migration
//   commits through `snapshotSealedWrite` (see `migrateOne`).
const writeGenerations = new Map<SecretId, number>();

function bumpGeneration(id: SecretId): number {
  const next = (writeGenerations.get(id) ?? 0) + 1;
  writeGenerations.set(id, next);
  return next;
}

function commitAt(id: SecretId, generation: number): (sealed: SealedSecret) => boolean {
  return (sealed) => {
    if ((writeGenerations.get(id) ?? 0) !== generation) return false;
    saveSealed(sealed);
    return true;
  };
}

/** Start a sealed write for `id`: call it BEFORE the seal's await. The returned commit stores
 *  the sealed value and returns true — or, when a newer write or a clear for the same id began
 *  in the meantime, writes nothing and returns false.
 *  ★ No fallback: when the newest seal FAILS, the older ones it superseded stay unwritten, so the
 *    store keeps its previous record (or nothing). Deliberate — letting a superseded older seal
 *    commit after all would bring back "older value wins", and it would need a second guard. The
 *    in-memory settings still hold the plaintext for the session. */
export function beginSealedWrite(id: SecretId): (sealed: SealedSecret) => boolean {
  return commitAt(id, bumpGeneration(id));
}

/** Like `beginSealedWrite`, but WITHOUT bumping: the commit writes only if no write or clear for
 *  `id` began since this snapshot, and it never cancels one already in flight. For background
 *  writers that must yield to the user (the boot migration, see `migrateOne`). */
export function snapshotSealedWrite(id: SecretId): (sealed: SealedSecret) => boolean {
  return commitAt(id, writeGenerations.get(id) ?? 0);
}

/** Cancel every sealed write in flight, for every id. For callers that wipe the store without
 *  going through `removeSealed` (the factory reset clears the whole `aipm-cockpit:*` prefix). */
export function invalidateAllSealedWrites(): void {
  for (const id of SECRET_IDS) bumpGeneration(id);
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
  } catch (err) {
    // A sealed device secret exists but can't be decrypted (corrupt ciphertext
    // or device-key mismatch after a profile change / IndexedDB reset). Log it
    // (never the value) so it's distinguishable from "never configured" — the
    // caller can then tell the user to re-enter it. See probeDeviceSecretReadable.
    logDiag("warn", "secrets.decryptFailed", { id, message: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** Distinguish an unreadable sealed device secret from one that was never set:
 *  "empty" = nothing sealed (or passphrase-wrapped), "ok" = decrypts,
 *  "unreadable" = a device-sealed record exists but can't be decrypted. Lets the
 *  load path warn the user that a saved credential was lost (vs. silently
 *  showing the field as unconfigured). */
export async function probeDeviceSecretReadable(id: SecretId): Promise<"ok" | "empty" | "unreadable"> {
  const sealed = loadSealed(id);
  if (!sealed || sealed.wrap !== "device") return "empty";
  try {
    await openDevice(sealed);
    return "ok";
  } catch {
    return "unreadable";
  }
}

/** Seal any non-empty plaintext secrets device-wrapped and return the blanked
 *  values to write back into settings. Idempotent.
 *
 *  Intentional migration skip: a secret is sealed ONLY when nothing is already
 *  sealed for that id. An already-sealed secret — including a passphrase-wrapped
 *  one — is deliberately left untouched, so migrating legacy plaintext never
 *  clobbers a user's chosen wrap mode (e.g. downgrading passphrase to device). */
export async function migratePlaintextSecrets(input: {
  apiKey?: string;
  authToken?: string;
  jiraApiToken?: string;
  timelogApiToken?: string;
  sttApiKey?: string;
}): Promise<{
  apiKey: string;
  authToken: string;
  jiraApiToken: string;
  timelogApiToken: string;
  sttApiKey: string;
}> {
  const apiKey = (input.apiKey ?? "").trim();
  const authToken = (input.authToken ?? "").trim();
  const jiraApiToken = (input.jiraApiToken ?? "").trim();
  const timelogApiToken = (input.timelogApiToken ?? "").trim();
  const sttApiKey = (input.sttApiKey ?? "").trim();
  // Per-secret seal: a crypto/IndexedDB failure on one secret must neither
  // reject the whole migration nor blank a secret we failed to persist. On a
  // failed seal we return the ORIGINAL plaintext so the caller keeps it.
  // Sequential, as before: one seal at a time.
  const apiKeyOut = await migrateOne("anthropicApiKey", apiKey);
  const authTokenOut = await migrateOne("tursoAuthToken", authToken);
  const jiraApiTokenOut = await migrateOne("jiraApiToken", jiraApiToken);
  const timelogApiTokenOut = await migrateOne("timelogApiToken", timelogApiToken);
  const sttApiKeyOut = await migrateOne("sttApiKey", sttApiKey);
  return {
    apiKey: apiKeyOut,
    authToken: authTokenOut,
    jiraApiToken: jiraApiTokenOut,
    timelogApiToken: timelogApiTokenOut,
    sttApiKey: sttApiKeyOut,
  };
}

/** Seal one legacy plaintext value if nothing is sealed for `id` yet. Returns "" (migrated, or
 *  nothing to do, or superseded by the user) or the ORIGINAL plaintext when the seal failed. */
async function migrateOne(id: SecretId, value: string): Promise<string> {
  if (!value || loadSealed(id)) return "";
  // ★★ §609 — the migration SNAPSHOTS the generation instead of bumping it. Its seal can land
  //   after the §548 merge timeout has already handed the UI over, so a clear or a new value the
  //   user commits in that window must win: any bump since the snapshot drops the migration's
  //   write. It must NOT bump itself — that would cancel a newer user seal already in flight and
  //   let the legacy value win instead. ★ It also re-checks "nothing sealed yet" at commit: a user
  //   seal that began BEFORE the snapshot (so it bumped nothing after it) may have landed during
  //   the await, and the legacy value must not overwrite it.
  const commit = snapshotSealedWrite(id);
  try {
    const sealed = await sealDevice(id, value);
    if (!loadSealed(id)) commit(sealed);
    return ""; // stored, or superseded by a newer user write/clear — either way not plaintext
  } catch {
    return value; // seal failed → keep plaintext un-migrated
  }
}
