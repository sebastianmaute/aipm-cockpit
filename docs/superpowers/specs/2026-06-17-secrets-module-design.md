# Local Secrets Module — Design Spec

**Date:** 2026-06-17
**Branch:** `fix-turso-emptystate-and-askclaude-placement` (fold-in)
**Status:** Approved (brainstorming complete)

## Goal

Stop storing the Anthropic API key and the Turso `authToken` as **plaintext in
`localStorage` (`lop-app:settings`)**. Encrypt both at rest via WebCrypto, with a
**device-bound key by default (B)** and an **opt-in, per-secret passphrase lock
(C)**.

## Threat model (honest ceiling)

The app is browser-only and local-first — Anthropic and Turso are called directly
from the browser. The secret must be in browser memory at call time, so **same-origin
JS (XSS, malicious dependency) can always read the live secret.** Encryption at rest
does NOT defend against code execution. It buys down the *other* blast radii:
localStorage exfiltration, disk/backup theft, browser-profile sync, shared machines,
casual inspection. A true XSS defense would require a server proxy holding the secret
(out of scope — it would break the direct-browser-access, local-first design).

## Locked decisions (from brainstorming)

1. **Per-secret choice.** Each secret is independently wrapped `"device"` (B) or
   `"passphrase"` (C). The locked-Turso-token-at-boot path must exist.
2. **No recovery (zero-knowledge).** The passphrase is never stored. Forgetting it
   makes the ciphertext unrecoverable — the user re-enters the key/token. A clear
   warning is shown at setup.
3. **KDF = PBKDF2-SHA-256, ≥600,000 iterations** (native WebCrypto, **zero new
   dependency**). Argon2id is stronger but needs a wasm lib — explicitly future work.
4. **Persistence-boundary interception** (not a consumer refactor): intercept in
   `use-settings.ts`; all `settings.ai.apiKey` / `settings.integrations.turso.authToken`
   consumers stay unchanged.

## Architecture — persistence-boundary interception

Consumers across the app read `settings.ai.apiKey` and
`settings.integrations.turso.authToken`. Keep those in-memory fields; intercept only
at persistence:

- **`writeSettings(settings)`**: extract the two secret fields → `secrets.ts` seals
  them into `localStorage["lop-app:secrets"]`; persist the rest of `lop-app:settings`
  with those two fields **blanked** (`""` / `undefined`).
- **load (on mount)**: read the (blanked) settings → `secrets.ts` decrypts every
  **device-wrapped** secret → merge back into the in-memory `Settings`.
  **Passphrase-wrapped** secrets stay empty until an explicit unlock, then fill in
  memory only (never re-persisted into settings).

Result: minimal blast radius. Secrets never re-enter persisted settings, the
`project`/`settings` BroadcastChannel, popout mirrors, the Workspace, exports
(CSV/MD/JSON), or snapshots.

## `secrets.ts` (new pure-ish WebCrypto module, i18n-free)

```ts
export type WrapMode = "device" | "passphrase";
export type SecretId = "anthropicApiKey" | "tursoAuthToken";
export interface SealedSecret {
  v: 1;
  id: SecretId;
  wrap: WrapMode;
  alg: "AES-GCM";
  iv: string;                 // base64, 12 bytes
  salt?: string;              // base64, 16 bytes — passphrase only
  kdf?: { name: "PBKDF2"; iters: number; hash: "SHA-256" }; // passphrase only
  ciphertext: string;         // base64
}

export async function sealDevice(id: SecretId, plaintext: string): Promise<SealedSecret>;
export async function sealPassphrase(id: SecretId, plaintext: string, passphrase: string): Promise<SealedSecret>;
export async function openDevice(s: SealedSecret): Promise<string>;
export async function openPassphrase(s: SealedSecret, passphrase: string): Promise<string>;
```

- **Device key (B):** one `AES-GCM` `CryptoKey` with `extractable: false`, generated
  once and stored as a **`CryptoKey` object in IndexedDB** (store `lop-app-secrets`,
  key `device-key`). JS can use it to decrypt but cannot export it, so copying
  `localStorage` alone yields undecryptable ciphertext.
- **Passphrase (C):** PBKDF2-SHA-256 (≥600k iters) over a random 16-byte salt →
  AES-GCM-256 key; fresh random 12-byte IV per seal. `openPassphrase` rejects on a
  wrong passphrase (AES-GCM auth-tag failure surfaces as a typed `SecretUnlockError`).
- Base64 helpers for `ArrayBuffer` ↔ string; no plaintext ever logged.

## Storage format

`localStorage["lop-app:secrets"]` = `Partial<Record<SecretId, SealedSecret>>`.
Lives **outside** `lop-app:settings`; never written to Turso (stays out of
`TABLE_NAMES`) or any export.

## Migration (auto, one-time, silent)

On first load with the module: if `lop-app:settings` still carries a non-empty
`apiKey` or `authToken`, seal each **device-wrapped** (no passphrase yet), write
`lop-app:secrets`, and blank the fields in settings. Idempotent — once blanked,
migration is a no-op.

## UX states

- **Settings → AI section / Integrations (Turso):** per-secret checkbox *"Require a
  passphrase to unlock"* + a passphrase field shown when checked. Enabling re-seals
  that secret with `sealPassphrase`; disabling re-seals with `sealDevice`. A warning
  states there is **no recovery**.
- **Anthropic key passphrase-locked:** `chat-panel` shows an inline **Unlock** prompt
  (passphrase input) in place of the "no API key" state; a successful unlock fills the
  key in memory for the session.
- **Turso token passphrase-locked (boot path):** at startup the token is empty → the
  Turso backend cannot initialise → show an **unlock gate** before the workspace loads
  (a dedicated prompt, NOT the storage-error banner). On unlock, fill the token and
  proceed/reload. Device-wrapped Turso (the default) boots unattended exactly as today.
- Unlock prompts must not echo the passphrase; inputs are `type="password"` with an
  accessible label.

## Out of scope

- No backend/edge proxy (the only real XSS defense) — would break local-first.
- No Argon2id (PBKDF2 only this slice).
- No cross-device sync of secrets (device key is per-device by design).

## Testing

- **Pure crypto (vitest):** device seal/open round-trip; passphrase seal/open
  round-trip; wrong passphrase → `SecretUnlockError`; tampered ciphertext/iv → reject;
  base64 round-trip. (`crypto.subtle` is present in the Node/jsdom test env;
  `fake-indexeddb` is already a dependency for the device-key store.)
- **Migration:** plaintext settings → sealed secrets + blanked fields; idempotent on
  re-run.
- **Persistence boundary:** `writeSettings` strips secrets from the persisted settings
  blob and stores ciphertext; load merges device-wrapped secrets back; passphrase
  secrets stay empty pre-unlock.
- **Locked states:** chat shows Unlock (not "no API key") when the Anthropic key is
  passphrase-locked; Turso unlock gate renders when the token is passphrase-locked at
  boot.
- No secret value appears in any persisted/broadcast/exported artifact (assert the
  blanked settings blob + that `lop-app:secrets` holds only ciphertext).

## Release

Patch within the `0.99.x` "Brackett" line (no version bump required for this fold-in
unless shipped separately); add a CHANGELOG note under the existing `0.99.1` entry.
