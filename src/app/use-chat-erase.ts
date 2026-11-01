// src/app/use-chat-erase.ts — deleting saved chat threads, for useChatThreads (a deps-object hook,
// AGENTS.md "Extraction conventions", rule 1): one thread from the sidebar (after a confirm), the
// ticked ones, and every thread of this browser's owner. Each takes the deleted threads off the list,
// the registry, the retry slots and the rename outbox.
//
// Holds the delete rules (which owner a delete runs as, what a delete-all removes and reloads), so it
// is coverage-gated, not excluded.
import type React from "react";
import { type Lang, t } from "./i18n";
import type { TursoConfig } from "./turso-config";
import type { ConfirmFn } from "./confirm-dialog";
import type { ChatIdentity } from "./chat-thread-codec";
import type { ChatThread } from "./chat-threads";
import type { ApiMessage, DisplayItem } from "./chat-api";
import { deleteThread as deleteThreadRow, deleteOwnerThreads, loadLegacyThreadIds } from "./chat-threads-store";
import { logDiag } from "./diagnostics";
import { pendingEditScope, dropPendingEdit, dropPendingEditsWhere } from "./pending-edits";
import { RENAME_KIND } from "./chat-thread-writes";

/** How a delete-all ended when it did not fail: "done" (deleted and the list reloaded, or nothing of this
 *  browser's to delete), or "not-refreshed" (deleted, but the reload afterwards failed). */
export type DeleteAllOutcome = "done" | "not-refreshed";

/** The sidebar's erase controls: delete every chat of this browser's owner, and delete chosen ones. */
export interface ChatEraseActions {
  /** False while the chat status is unknown or outside Turso mode. True otherwise, even while chats
   *  are not saved: a delete needs no encryption, and older shared chats are still listed. */
  enabled: boolean;
  /** This browser's owner id for the current database; null when none is stored (nothing of yours to delete). */
  ownerId: string | null;
  /** Deletes every thread of this owner in the database (all projects). Rejects when the delete fails;
   *  resolves "not-refreshed" when it succeeded but the list could not be reloaded afterwards. */
  deleteAll: () => Promise<DeleteAllOutcome>;
  /** Deletes the listed threads of this project. Rejects when any of them could not be deleted. */
  deleteSelected: (ids: readonly string[]) => Promise<void>;
}

export interface UseChatEraseDeps {
  tursoConfig: TursoConfig | null;
  projectId: string;
  lang: Lang;
  confirm: ConfirmFn;
  /** Whether deletes are sent: the chat status known, in Turso mode. */
  deleteGate: boolean;
  /** This browser's owner id for the current database, or null. */
  knownOwnerId: string | null;
  threads: ChatThread[];
  threadsRef: React.MutableRefObject<ChatThread[]>;
  threadIdRef: React.MutableRefObject<string | null>;
  projectEpochRef: React.MutableRefObject<number>;
  setThreads: React.Dispatch<React.SetStateAction<ChatThread[]>>;
  setActiveThreadId: React.Dispatch<React.SetStateAction<string | null>>;
  setHistory: React.Dispatch<React.SetStateAction<ApiMessage[]>>;
  setDisplay: React.Dispatch<React.SetStateAction<DisplayItem[]>>;
  /** The identity already read for a database (synchronous), and the one stored there (never created). */
  knownIdentity: (config: TursoConfig | null) => ChatIdentity | null;
  storedIdentity: (config: TursoConfig | null) => Promise<ChatIdentity | null>;
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
    tursoConfig, projectId, lang, confirm, deleteGate, knownOwnerId, threads, threadsRef, threadIdRef, projectEpochRef,
    setThreads, setActiveThreadId, setHistory, setDisplay, knownIdentity, storedIdentity, writeConfig, renameScope, runPersist,
    forgetRetries, savesSettled, loadVisibleThreads,
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
      // A delete never creates an identity. Without one, only legacy rows are this browser's to delete,
      // and an owner id that is never stored matches exactly those (the delete's legacy branch).
      const identity = knownIdentity(config) ?? (await storedIdentity(config));
      await deleteThreadRow(config, id, target.projectId, identity?.ownerId ?? crypto.randomUUID());
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

  /** The owner id deletes run as: this browser's identity, or — with none stored — one that is never
   *  stored, which matches only legacy rows (the delete's legacy branch). Never creates an identity. */
  async function deleteOwnerId(config: TursoConfig | null): Promise<string> {
    const identity = knownIdentity(config) ?? (await storedIdentity(config));
    return identity?.ownerId ?? crypto.randomUUID();
  }

  async function deleteSelected(ids: readonly string[]): Promise<void> {
    if (!deleteGate) return;
    const config = writeConfig(tursoConfig);
    const scope = renameScope(tursoConfig);
    const epoch = projectEpochRef.current;
    const targets = threadsRef.current.filter((th) => ids.includes(th.id));
    const owner = await deleteOwnerId(config);
    const results = await Promise.allSettled(targets.map((th) => deleteThreadRow(config, th.id, th.projectId, owner)));
    removeDeleted(scope, targets.filter((_, i) => results[i].status === "fulfilled").map((th) => th.id), epoch);
    if (results.some((r) => r.status === "rejected")) throw new Error("some chat threads could not be deleted");
  }

  async function deleteAll(): Promise<DeleteAllOutcome> {
    if (!deleteGate) return "done";
    const config = writeConfig(tursoConfig);
    const identity = knownIdentity(config) ?? (await storedIdentity(config));
    if (!identity) return "done";
    const epoch = projectEpochRef.current;
    const pid = projectId;
    // A save still on its way (a first send's insert) would land after the delete and leave its row.
    await savesSettled(config);
    await deleteOwnerThreads(config, identity.ownerId);
    await dropDeletedDraftNames(config);
    // This owner's threads are gone in every project, so whichever project is open now loses them.
    const owned = threadsRef.current.filter((th) => th.ownerId === identity.ownerId).map((th) => th.id);
    removeDeleted(null, owned, projectEpochRef.current);
    // An extra check against the database. The delete itself succeeded, so a failed reload is reported
    // as such ("not-refreshed"), never as a failed delete.
    let left: Set<string>;
    try {
      left = new Set((await loadVisibleThreads(config, pid)).map((th) => th.id));
    } catch {
      logDiag("warn", "chat.deleteAllReloadFailed");
      return "not-refreshed";
    }
    removeDeleted(null, threadsRef.current.filter((th) => th.projectId === pid && !left.has(th.id)).map((th) => th.id), epoch);
    return "done";
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

  const erase: ChatEraseActions = { enabled: deleteGate, ownerId: knownOwnerId, deleteAll, deleteSelected };
  return { erase, requestDeleteThread };
}
