// src/app/chat-thread-writes.ts — the small helpers useChatThreads and its sibling hooks share for
// writing chat threads: the rename outbox's scope and replay, confirmed names, which database a config
// names, and the retention expiry. No React.
import type { TursoConfig } from "./turso-config";
import type { ChatSettings } from "./ai-chat-retention-config";
import type { ChatThread } from "./chat-threads";
import { expireThreads } from "./chat-threads-store";
import { retentionCutoff } from "./chat-threads-schema";
import { logDiag } from "./diagnostics";
import { pendingEditScope, takePendingEdits, dropPendingEdit } from "./pending-edits";

/** §626 — the outbox kind for a thread rename. */
export const RENAME_KIND = "chat-thread-name" as const;

/** The database URL a config names; "" without one. Every per-database fact is keyed by it. */
export function urlOf(config: TursoConfig | null): string {
  return config?.httpUrl ?? "";
}

/** The outbox scope for a Turso database and project, or null when there is no usable config (no
 *  config, or one without a non-empty `httpUrl` — hashing an absent URL would throw inside a load
 *  settle). */
export function outboxScope(tursoConfig: TursoConfig | null, projectId: string): string | null {
  const url: unknown = tursoConfig?.httpUrl;
  // `chat:` keeps a project whose id is literally "templates" off the templates outbox's key.
  return typeof url === "string" && url.length > 0 ? pendingEditScope(url, `chat:${projectId}`) : null;
}

/** §604. Two configs name the same Turso database when their URLs match; the token may differ. */
export function sameDatabase(a: TursoConfig | null, b: TursoConfig | null): boolean {
  return a?.httpUrl === b?.httpUrl;
}

/** The stored rename edits for `scope` that still apply to `loaded`. An edit whose thread is gone
 *  (`missing`) or whose name has moved on since the draft began (`changed`) is dropped and logged —
 *  kind and id only, never the typed value. */
export function takeRenameReplays(scope: string, loaded: readonly ChatThread[]): { target: ChatThread; value: string }[] {
  const replays: { target: ChatThread; value: string }[] = [];
  for (const edit of takePendingEdits(scope, Date.now())) {
    if (edit.kind !== RENAME_KIND) continue;
    const target = loaded.find((th) => th.id === edit.id);
    if (!target) {
      logDiag("warn", "storage.pendingEditDropped", { reason: "missing", kind: edit.kind, id: edit.id });
    } else if (target.name !== edit.base) {
      logDiag("warn", "storage.pendingEditDropped", { reason: "changed", kind: edit.kind, id: edit.id });
    } else {
      replays.push({ target, value: edit.value });
    }
  }
  return replays;
}

/** A thread's newest landed write: its issue `seq`, and `at`, the landing count when it landed. */
export type LandedWrite = { seq: number; at: number };

/** §626 (R11). Adopts a load's names as the confirmed ones, except for a thread whose save landed
 *  after the load started (`landingsAtStart`): that name is newer than anything the load can have read. */
export function adoptConfirmedNames(
  confirmed: Map<string, string>,
  landed: ReadonlyMap<string, LandedWrite>,
  loaded: readonly ChatThread[],
  landingsAtStart: number,
): void {
  for (const th of loaded) {
    if ((landed.get(th.id)?.at ?? 0) > landingsAtStart) continue;
    confirmed.set(th.id, th.name);
  }
}

/** What a save needs from the server's settings, present only while persistence is "on".
 *  `retentionDays` is null while the server's retention setting is invalid: no period is in force,
 *  so nothing is expired (deleting is paused until the setting is fixed). */
export type SaveGate = { recoveryKey: string; retentionDays: number | null };

/** The retention period in force: the server's, or null while it is unknown or its setting is invalid
 *  (then nothing is expired, and nothing is hidden for its age). */
export function retentionInForce(chat: ChatSettings | null): number | null {
  return chat && !chat.retentionInvalid ? chat.retentionDays : null;
}

/** Whether a thread last updated at `updatedAt` is gone after an expiry at `cutoffIso`: the same test as
 *  the expiry statement (older than the cutoff, or no usable date). */
export function expiredBy(updatedAt: string, cutoffIso: string): boolean {
  return !updatedAt || Number.isNaN(Date.parse(updatedAt)) || updatedAt < cutoffIso;
}

/** Deletes the project's threads older than the retention period. Never blocks the caller: a failure
 *  is logged without any detail. Once it has run, the pending renames of the threads in `known()` that
 *  it removed are dropped from this browser's outbox. */
export function expireOldThreads(
  config: TursoConfig | null,
  retentionDays: number,
  projectId: string,
  known: () => readonly ChatThread[],
): void {
  // The delete runs on the database's clock; this browser's clock only decides which local
  // renames to drop afterwards.
  const cutoffIso = retentionCutoff(new Date(), retentionDays);
  Promise.resolve()
    .then(() => expireThreads(config, retentionDays, projectId))
    .then(() => {
      const scope = outboxScope(config, projectId);
      if (!scope) return;
      for (const th of known()) {
        if (th.projectId === projectId && expiredBy(th.updatedAt, cutoffIso)) dropPendingEdit(scope, RENAME_KIND, th.id);
      }
    })
    .catch(() => logDiag("warn", "chat.retentionExpireFailed"));
}
