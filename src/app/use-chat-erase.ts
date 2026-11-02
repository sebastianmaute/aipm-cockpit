// src/app/use-chat-erase.ts — deleting saved chat threads, for useChatThreads (a deps-object hook,
// AGENTS.md "Extraction conventions", rule 1): one thread from the sidebar (after a confirm), the
// ticked ones, and every thread of this browser's owner. Each takes the deleted threads off the list,
// the registry, the retry slots and the rename outbox. It also starts a new chat identity in place of a
// locked one, asking first whether the old chats go too.
//
// Deletes run as the stored owner id, which stays readable while the stored identity cannot be opened
// ("identity-locked"), so a locked identity can still erase its own chats; a delete-all also erases
// the rows of the entry's earlier owner ids (`previousOwnerIds`, chat-key-vault.ts).
//
// Holds the delete rules (which owner a delete runs as, what a delete-all removes and reloads), so it
// is coverage-gated, not excluded.
import { useRef } from "react";
import type React from "react";
import { type Lang, t } from "./i18n";
import type { TursoConfig } from "./turso-config";
import type { ConfirmFn } from "./confirm-dialog";
import type { ChatIdentity } from "./chat-thread-codec";
import type { ChatThread } from "./chat-threads";
import type { ApiMessage, DisplayItem } from "./chat-api";
import { deleteThread as deleteThreadRow, deleteOwnerThreads, loadLegacyThreadIds, loadOwnerThreads } from "./chat-threads-store";
import { findThreadsMentioning } from "./chat-thread-mentions";
import { logDiag } from "./diagnostics";
import { pendingEditScope, dropPendingEdit, dropPendingEditsWhere } from "./pending-edits";
import { RENAME_KIND, outboxScope } from "./chat-thread-writes";
import { removeChatPassphrase } from "./chat-passphrase";

/** How a delete-all ended when it did not fail: "done" (deleted and the list reloaded, or nothing of this
 *  browser's to delete), "not-refreshed" (deleted, but the reload afterwards failed), or "passphrase-kept"
 *  (deleted, but a chat passphrase asked to go with them could not be removed). */
export type DeleteAllOutcome = "done" | "not-refreshed" | "passphrase-kept";

/** What a delete-all removes besides the chats: with `removePassphrase`, the chat passphrase (the
 *  `chat_keys` row) of every owner id it erased, once their chats are gone. */
export interface DeleteAllOptions {
  removePassphrase?: boolean;
}

/** The sidebar's erase controls: delete every chat of this browser's owner, and delete chosen ones. */
export interface ChatEraseActions {
  /** False while the chat status is unknown or outside Turso mode. True otherwise, even while chats
   *  are not saved: a delete needs no encryption, and older shared chats are still listed. */
  enabled: boolean;
  /** This browser's owner id for the current database; null when none is stored (nothing of yours to delete). */
  ownerId: string | null;
  /** Deletes every thread of this owner in the database (all projects). Rejects when the delete fails;
   *  resolves "not-refreshed" when it succeeded but the list could not be reloaded afterwards. */
  deleteAll: (options?: DeleteAllOptions) => Promise<DeleteAllOutcome>;
  /** Deletes the listed threads, each in its own project: threads of the list, or found by the last
   *  `findMentioning`. Rejects when any of them could not be deleted. */
  deleteSelected: (ids: readonly string[]) => Promise<void>;
  /** The chats that mention `query`: this owner's in every project of the database (read and opened
   *  here) and the older shared ones of this project. Never a colleague's private chat. */
  findMentioning: (query: string) => Promise<ChatThread[]>;
}

export interface UseChatEraseDeps {
  tursoConfig: TursoConfig | null;
  projectId: string;
  lang: Lang;
  confirm: ConfirmFn;
  /** Whether deletes are sent: the chat status known, in Turso mode. */
  deleteGate: boolean;
  /** The owner id this browser's deletes run as for the current database (also while its identity is
   *  locked), or null when none is stored. */
  eraseOwnerId: string | null;
  threads: ChatThread[];
  threadsRef: React.MutableRefObject<ChatThread[]>;
  threadIdRef: React.MutableRefObject<string | null>;
  projectEpochRef: React.MutableRefObject<number>;
  setThreads: React.Dispatch<React.SetStateAction<ChatThread[]>>;
  setActiveThreadId: React.Dispatch<React.SetStateAction<string | null>>;
  setHistory: React.Dispatch<React.SetStateAction<ApiMessage[]>>;
  setDisplay: React.Dispatch<React.SetStateAction<DisplayItem[]>>;
  /** The identity already read for a database (synchronous), and every owner id stored there, current
   *  first (never created; readable while the identity is locked). */
  knownIdentity: (config: TursoConfig | null) => ChatIdentity | null;
  storedOwnerIds: (config: TursoConfig | null) => string[];
  /** Starts a new identity over a locked one; `keepOld` keeps the old owner ids for a later delete-all. */
  startNewIdentityInVault: (keepOld: boolean) => Promise<void>;
  writeConfig: (pinned: TursoConfig | null) => TursoConfig | null;
  renameScope: (config?: TursoConfig | null) => string | null;
  runPersist: (key: string, action: () => Promise<void>) => void;
  forgetRetries: (ids: readonly string[]) => void;
  /** Resolves once no save to `config`'s database is on its way. */
  savesSettled: (config: TursoConfig | null) => Promise<void>;
  loadVisibleThreads: (config: TursoConfig | null, pid: string) => Promise<ChatThread[]>;
}

export function useChatErase(deps: UseChatEraseDeps) {
  const {
    tursoConfig, projectId, lang, confirm, deleteGate, eraseOwnerId, threads, threadsRef, threadIdRef, projectEpochRef,
    setThreads, setActiveThreadId, setHistory, setDisplay, knownIdentity, storedOwnerIds, startNewIdentityInVault, writeConfig,
    renameScope, runPersist, forgetRetries, savesSettled, loadVisibleThreads,
  } = deps;

  async function requestDeleteThread(id: string): Promise<void> {
    const target = threads.find((th) => th.id === id);
    if (!target) return;
    const displayName = target.name || t(lang, "chatThreadUntitled");
    // §604. The database the dialog was opened in, captured BEFORE the confirm await: the row is
    // deleted there even if the config moves while the dialog is open.
    const deleteConfig = tursoConfig;
    if (!(await confirm({ message: t(lang, "chatThreadDeleteConfirm", displayName), tone: "danger" }))) return;
    // `threads`/`activeThreadId` above were captured at render time, BEFORE
    // this await — a concurrent write (the busy-persist effect settling, or
    // a rename) while the confirm dialog was open must not be clobbered by
    // reverting to that stale snapshot. `threadsRef`/`threadIdRef` mirror the
    // latest COMMITTED state (kept fresh by their own sync effects) — read
    // those instead of relying on a setState updater's side effect (React
    // does not guarantee an updater runs synchronously before the next
    // line — updaters are meant to be pure).
    const remaining = threadsRef.current.filter((th) => th.id !== id);
    setThreads((prev) => prev.filter((th) => th.id !== id));
    if (threadIdRef.current === id) {
      const next = remaining[0] ?? null;
      setActiveThreadId(next?.id ?? null);
      setHistory(next?.history ?? []);
      setDisplay(next?.display ?? []);
    }
    const scope = renameScope(deleteConfig);
    if (scope) dropPendingEdit(scope, RENAME_KIND, id);
    // Scope the delete by project (defense-in-depth against a project-id
    // collision in the id space) — `target` was resolved from `threads`
    // before the confirm await and still carries the row's own projectId.
    if (!deleteGate) return;
    runPersist(id, async () => {
      const config = writeConfig(deleteConfig);
      await deleteThreadRow(config, id, target.projectId, deleteOwnerId(config));
    });
  }

  /** Takes the deleted threads `ids` off this browser: their pending renames (in `scope`), their retry
   *  slots, and — while the project is still the one the delete was issued in — the list (and so the
   *  registry). A deleted active thread is cleared, not replaced. */
  function removeDeleted(scope: string | null, ids: readonly string[], epoch: number): void {
    if (ids.length === 0) return;
    const gone = new Set(ids);
    if (scope) for (const id of ids) dropPendingEdit(scope, RENAME_KIND, id);
    forgetRetries(ids);
    if (epoch !== projectEpochRef.current) return;
    setThreads((prev) => prev.filter((th) => !gone.has(th.id)));
    if (threadIdRef.current !== null && gone.has(threadIdRef.current)) {
      setActiveThreadId(null);
      setHistory([]);
      setDisplay([]);
    }
  }

  /** The owner ids a delete-all erases in `config`'s database: the known identity's and every one
   *  stored there (current and earlier), without repeats. Never creates an identity. */
  function eraseOwnerIds(config: TursoConfig | null): string[] {
    const known = knownIdentity(config)?.ownerId;
    return [...new Set([...(known ? [known] : []), ...storedOwnerIds(config)])];
  }

  /** The owner id a single delete runs as: this browser's (known, or stored — readable while locked),
   *  or — with none stored — one that is never stored, which matches only legacy rows (the delete's
   *  legacy branch). Never creates an identity. */
  function deleteOwnerId(config: TursoConfig | null): string {
    return eraseOwnerIds(config)[0] ?? crypto.randomUUID();
  }

  // The last search's matches, so a ticked match of another project can be deleted in its own project.
  const foundRef = useRef<ChatThread[]>([]);

  async function findMentioning(query: string): Promise<ChatThread[]> {
    const config = writeConfig(tursoConfig);
    const identity = knownIdentity(config);
    // Without an opened identity (none yet, or locked) only this project's older shared chats are searched.
    const owned = identity ? await loadOwnerThreads(config, identity) : [];
    const byId = new Map<string, ChatThread>(owned.map((th) => [th.id, th]));
    // This project's list is newer than the database for a chat still being saved.
    for (const th of threadsRef.current) byId.set(th.id, th);
    const found = findThreadsMentioning([...byId.values()], query, identity?.ownerId ?? null);
    foundRef.current = found;
    return found;
  }

  async function deleteSelected(ids: readonly string[]): Promise<void> {
    if (!deleteGate) return;
    const config = writeConfig(tursoConfig);
    const epoch = projectEpochRef.current;
    const byId = new Map<string, ChatThread>(foundRef.current.map((th) => [th.id, th]));
    for (const th of threadsRef.current) byId.set(th.id, th);
    const targets = ids.map((id) => byId.get(id)).filter((th): th is ChatThread => th !== undefined);
    const owner = deleteOwnerId(config);
    const results = await Promise.allSettled(targets.map((th) => deleteThreadRow(config, th.id, th.projectId, owner)));
    const deleted = targets.filter((_, i) => results[i].status === "fulfilled");
    // Each deleted thread's pending rename goes from its own project's outbox.
    for (const th of deleted) {
      const scope = outboxScope(config, th.projectId);
      if (scope) dropPendingEdit(scope, RENAME_KIND, th.id);
    }
    removeDeleted(null, deleted.map((th) => th.id), epoch);
    foundRef.current = foundRef.current.filter((th) => !deleted.includes(th));
    if (results.some((r) => r.status === "rejected")) throw new Error("some chat threads could not be deleted");
  }

  async function deleteAll({ removePassphrase = false }: DeleteAllOptions = {}): Promise<DeleteAllOutcome> {
    if (!deleteGate) return "done";
    const config = writeConfig(tursoConfig);
    const owners = eraseOwnerIds(config);
    if (owners.length === 0) return "done";
    const epoch = projectEpochRef.current;
    const pid = projectId;
    // A save still on its way (a first send's insert) would land after the delete and leave its row.
    await savesSettled(config);
    for (const owner of owners) await deleteOwnerThreads(config, owner);
    // Only after every chat is gone: a passphrase removed first would leave chats nobody can open elsewhere.
    const passphraseKept = removePassphrase && !(await removePassphrases(config, owners));
    await dropDeletedDraftNames(config);
    // These owners' threads are gone in every project, so whichever project is open now loses them.
    const gone = new Set(owners);
    const owned = threadsRef.current.filter((th) => th.ownerId !== null && gone.has(th.ownerId)).map((th) => th.id);
    removeDeleted(null, owned, projectEpochRef.current);
    // An extra check against the database. The delete itself succeeded, so a failed reload is reported
    // as such ("not-refreshed"), never as a failed delete.
    let left: Set<string>;
    try {
      left = new Set((await loadVisibleThreads(config, pid)).map((th) => th.id));
    } catch {
      logDiag("warn", "chat.deleteAllReloadFailed");
      return passphraseKept ? "passphrase-kept" : "not-refreshed";
    }
    removeDeleted(null, threadsRef.current.filter((th) => th.projectId === pid && !left.has(th.id)).map((th) => th.id), epoch);
    return passphraseKept ? "passphrase-kept" : "done";
  }

  /** Removes the chat passphrase of each owner id; true when every removal succeeded. A failure is
   *  logged without detail and the others are still tried. */
  async function removePassphrases(config: TursoConfig | null, owners: readonly string[]): Promise<boolean> {
    const results = await Promise.allSettled(owners.map((owner) => removeChatPassphrase(config, owner)));
    const ok = results.every((r) => r.status === "fulfilled");
    if (!ok) logDiag("warn", "chat.passphraseRemoveFailed");
    return ok;
  }

  /** After a delete-all: every thread-name draft of this database, in every project's scope, stored or
   *  live, goes — except those of the legacy rows still standing. When those cannot be read, all go. */
  async function dropDeletedDraftNames(config: TursoConfig | null): Promise<void> {
    const url = config?.httpUrl;
    if (!url) return;
    let legacy: Set<string> | null = null;
    try {
      legacy = new Set(await loadLegacyThreadIds(config));
    } catch {
      logDiag("warn", "chat.legacyThreadIdsReadFailed");
    }
    dropPendingEditsWhere(pendingEditScope(url, "chat:"), RENAME_KIND, (id) => legacy?.has(id) ?? false);
  }

  /** "Start a new chat identity" in place of a locked one. Asks first whether the old chats go too (a
   *  cancel keeps them, the default). Deleting them runs the delete-all; if it fails, the new identity is
   *  still started and the old owner ids are kept, so a later delete-all can still erase their rows. */
  async function startNewIdentity(): Promise<void> {
    const config = writeConfig(tursoConfig);
    const deleteOld = deleteGate && eraseOwnerIds(config).length > 0 && (await confirm({
      title: t(lang, "chatNewIdentityDeleteOldTitle"),
      message: t(lang, "chatNewIdentityDeleteOldMessage"),
      confirmLabel: t(lang, "chatNewIdentityDeleteOldConfirm"),
      cancelLabel: t(lang, "chatNewIdentityKeepOld"),
      tone: "danger",
    }));
    let keepOld = true;
    if (deleteOld) {
      try {
        await deleteAll();
        keepOld = false;
      } catch {
        logDiag("warn", "chat.oldChatsDeleteFailed");
      }
    }
    await startNewIdentityInVault(keepOld);
  }

  const erase: ChatEraseActions = { enabled: deleteGate, ownerId: eraseOwnerId, deleteAll, deleteSelected, findMentioning };
  return { erase, requestDeleteThread, startNewIdentity };
}
