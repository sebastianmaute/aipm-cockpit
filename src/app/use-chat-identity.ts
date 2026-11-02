// src/app/use-chat-identity.ts — this browser's chat identity for the current Turso database, for
// useChatThreads (a deps-object hook, AGENTS.md "Extraction conventions", rule 1). It owns the last
// vault read, the identity a save or a delete uses, the reload signal when another tab changes the
// identity, "start a new chat identity", and whether chats are saved at all (`persistence`).
//
// Holds real logic (when a stored identity is trusted, when a new one is created, what counts as
// locked), so it is coverage-gated, not excluded.
import { useEffect, useRef, useState } from "react";
import type { TursoConfig } from "./turso-config";
import type { ChatSettings } from "./ai-chat-retention-config";
import type { ChatIdentity } from "./chat-thread-codec";
import {
  CHAT_IDENTITY_KEY, chatVaultAvailable, ensureChatIdentity, getChatIdentity, readChatIdentity, startNewChatIdentity,
  storedChatOwnerId,
} from "./chat-key-vault";
import { logDiag } from "./diagnostics";

/** Whether this browser saves chats: "on", or why not. Anything but "on" means no save is sent; the
 *  panel shows one line saying why. Deletes need no encryption and are sent whenever the status is
 *  known (`deleteGate`), so a deleted chat does not come back on reload. */
/** "identity-retry": the vault could not be read right now for a reason other than a lost key; nothing is
 *  saved until a later save or load reads it, and no new identity is offered. */
export type ChatPersistence = "on" | "no-recovery-key" | "no-crypto" | "identity-locked" | "identity-retry" | "status-unknown";

/** The persistence for the server's chat settings (`null` = not known yet), whether this browser can
 *  encrypt at all (Web Crypto and IndexedDB), whether its stored identity for the database is one
 *  the device key cannot open, and whether the last vault read failed for another reason. Checked in
 *  this order: status unknown, no crypto, identity locked, no recovery key, identity retry. */
export function chatPersistence(
  chat: ChatSettings | null, canEncrypt: boolean, identityLocked: boolean, identityTransient = false,
): ChatPersistence {
  if (chat === null) return "status-unknown";
  if (!canEncrypt) return "no-crypto";
  if (identityLocked) return "identity-locked";
  if (!chat.recoveryKey) return "no-recovery-key";
  if (identityTransient) return "identity-retry";
  return "on";
}

/** This browser's identity per database URL, as last read here; `null` identity = none stored yet. */
type VaultRead = { url: string; kind: "found" | "absent" | "unavailable" | "transient"; identity: ChatIdentity | null };

export interface UseChatIdentityDeps {
  tursoMode: boolean;
  tursoConfig: TursoConfig | null;
  /** The server's saved-chat settings; `null` until the status has answered. */
  chat: ChatSettings | null;
}

const urlOf = (config: TursoConfig | null): string => config?.httpUrl ?? "";

export function useChatIdentity({ tursoMode, tursoConfig, chat }: UseChatIdentityDeps) {
  // This browser's identity for the current database, as last read from the vault. Read before every
  // load (a load never creates one); a save creates one on first use (`ensureChatIdentity`).
  const [vaultRead, setVaultRead] = useState<VaultRead | null>(null);
  const vaultReadRef = useRef(vaultRead);
  useEffect(() => {
    vaultReadRef.current = vaultRead;
  }, [vaultRead]);
  const currentUrl = urlOf(tursoConfig);
  const vaultLocked = vaultRead?.url === currentUrl && vaultRead.kind === "unavailable";
  const vaultTransient = vaultRead?.url === currentUrl && vaultRead.kind === "transient";
  const persistence = chatPersistence(chat, chatVaultAvailable(), vaultLocked, vaultTransient);
  const knownOwnerId = vaultRead?.url === currentUrl && vaultRead.kind === "found" ? vaultRead.identity?.ownerId ?? null : null;

  function record(next: VaultRead): void {
    vaultReadRef.current = next;
    setVaultRead(next);
  }

  /** Reads this browser's identity for `config`'s database and keeps it as the last read. Never
   *  creates one: a load uses it. */
  async function readIdentity(config: TursoConfig | null): Promise<ChatIdentity | null> {
    const url = urlOf(config);
    const read = await readChatIdentity(url);
    const identity = read.kind === "found" ? read.identity : null;
    record({ url, kind: read.kind, identity });
    return identity;
  }

  // Bumped when another tab changes this database's chat identity (`storage` event): the load effect
  // then reloads the list under the identity now stored.
  const targetUrl = tursoConfig?.httpUrl;
  const [identityReloads, setIdentityReloads] = useState(0);
  useEffect(() => {
    if (!tursoMode) return;
    const url = targetUrl ?? "";
    let live = true;
    function onStorage(e: StorageEvent): void {
      // `key` is null when the other tab cleared all of localStorage (a factory reset).
      if (e.key !== CHAT_IDENTITY_KEY && e.key !== null) return;
      void readChatIdentity(url).then((read) => {
        if (!live) return;
        const known = vaultReadRef.current;
        const before = known?.url === url ? known.identity?.ownerId ?? null : null;
        const after = read.kind === "found" ? read.identity.ownerId : null;
        if (before !== after || known?.url !== url || known.kind !== read.kind) setIdentityReloads((n) => n + 1);
      });
    }
    window.addEventListener("storage", onStorage);
    return () => {
      live = false;
      window.removeEventListener("storage", onStorage);
    };
  }, [tursoMode, targetUrl]);

  /** The identity already read for `config`'s database, if any — synchronous, so a write that has
   *  one starts without waiting. */
  function knownIdentity(config: TursoConfig | null): ChatIdentity | null {
    const known = vaultReadRef.current;
    return known?.url === urlOf(config) ? known.identity : null;
  }

  /** The identity a write to `config`'s database uses, read from the vault and created on first
   *  use. Throws when this browser cannot encrypt or its stored identity cannot be opened (and records
   *  that, so persistence reads "no-crypto" or "identity-locked"), or when the vault could not be read
   *  right now (recorded as "identity-retry"; the next save or load reads it again). Throws WITHOUT recording anything
   *  when a new identity could not be stored: that is a failed save, offered for retry, not a lock. */
  async function writeIdentity(config: TursoConfig | null): Promise<ChatIdentity> {
    const url = urlOf(config);
    const created = await ensureChatIdentity(url);
    // Null means one of two things, told apart by reading the vault again: an entry the device key
    // cannot open, or no crypto ("unavailable"), or a new entry whose write failed (still "absent").
    const reread = created ? null : await readChatIdentity(url);
    if (reread?.kind === "absent") throw new Error("chat identity not stored");
    const identity = created ?? (reread?.kind === "found" ? reread.identity : null);
    const kind: VaultRead["kind"] = identity ? "found" : reread?.kind === "transient" ? "transient" : "unavailable";
    const known = vaultReadRef.current;
    const unchanged = known?.url === url && known.kind === kind
      && (known.identity?.ownerId ?? null) === (identity?.ownerId ?? null);
    if (!unchanged) record({ url, kind, identity });
    if (kind === "transient") throw new Error("chat identity not readable right now");
    if (!identity) throw new Error("chat identity unavailable");
    return identity;
  }

  /** The identity already read for `config`'s database while it is still the one stored, checked
   *  right before every save so a tab that missed another tab's change of identity never saves under
   *  the old one (one localStorage read). Null means the save reads the vault afresh (`writeIdentity`).
   *  Synchronous, so a save that has one starts its write without waiting. */
  function trustedIdentity(config: TursoConfig | null): ChatIdentity | null {
    const known = knownIdentity(config);
    return known && storedChatOwnerId(urlOf(config)) === known.ownerId ? known : null;
  }

  /** The identity stored for `config`'s database, or null; never creates one. A delete runs as it,
   *  after `knownIdentity`. */
  function storedIdentity(config: TursoConfig | null): Promise<ChatIdentity | null> {
    return getChatIdentity(urlOf(config));
  }

  /** Replaces a stored identity this browser can no longer open ("identity-locked") with a new one,
   *  so saving resumes. The old rows are not touched; they expire. A failure is logged without detail
   *  and leaves the state as it was. */
  async function startNewIdentity(): Promise<void> {
    const url = urlOf(tursoConfig);
    if (!url) return;
    try {
      record({ url, kind: "found", identity: await startNewChatIdentity(url) });
    } catch {
      logDiag("warn", "chat.newIdentityFailed");
    }
  }

  return {
    persistence, knownOwnerId, identityReloads, readIdentity, knownIdentity, trustedIdentity, writeIdentity, storedIdentity,
    startNewIdentity,
  };
}
