// src/app/secrets-store.ts
//
// Persistence + accessors for sealed secrets. Ciphertext lives in
// localStorage["aipm-cockpit:secrets"], keyed by SecretId; the device key lives in
// IndexedDB (see secrets.ts). Kept OUT of aipm-cockpit:settings and out of Turso.

import { type SealedSecret, type SecretId, openDevice, sealDevice, isSealedSecret } from "./secrets";
import { logDiag } from "./diagnostics";

export const SECRETS_KEY = "aipm-cockpit:secrets";
type Store = Partial<Record<SecretId, SealedSecret>>;

function readStore(): Store {
  try {
    const raw = localStorage.getItem(SECRETS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Store = {};
    for (const id of [
      "anthropicApiKey",
      "tursoAuthToken",
      "jiraApiToken",
      "timelogApiToken",
      "sttApiKey",
    ] as const) {
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
  let apiKeyOut = "";
  let authTokenOut = "";
  let jiraApiTokenOut = "";
  let timelogApiTokenOut = "";
  let sttApiKeyOut = "";
  if (apiKey && !loadSealed("anthropicApiKey")) {
    try {
      saveSealed(await sealDevice("anthropicApiKey", apiKey));
    } catch {
      apiKeyOut = apiKey; // seal failed → keep plaintext un-migrated
    }
  }
  if (authToken && !loadSealed("tursoAuthToken")) {
    try {
      saveSealed(await sealDevice("tursoAuthToken", authToken));
    } catch {
      authTokenOut = authToken; // seal failed → keep plaintext un-migrated
    }
  }
  if (jiraApiToken && !loadSealed("jiraApiToken")) {
    try {
      saveSealed(await sealDevice("jiraApiToken", jiraApiToken));
    } catch {
      jiraApiTokenOut = jiraApiToken; // seal failed → keep plaintext un-migrated
    }
  }
  if (timelogApiToken && !loadSealed("timelogApiToken")) {
    try {
      saveSealed(await sealDevice("timelogApiToken", timelogApiToken));
    } catch {
      timelogApiTokenOut = timelogApiToken; // seal failed → keep plaintext un-migrated
    }
  }
  if (sttApiKey && !loadSealed("sttApiKey")) {
    try {
      saveSealed(await sealDevice("sttApiKey", sttApiKey));
    } catch {
      sttApiKeyOut = sttApiKey; // seal failed → keep plaintext un-migrated
    }
  }
  return {
    apiKey: apiKeyOut,
    authToken: authTokenOut,
    jiraApiToken: jiraApiTokenOut,
    timelogApiToken: timelogApiTokenOut,
    sttApiKey: sttApiKeyOut,
  };
}
