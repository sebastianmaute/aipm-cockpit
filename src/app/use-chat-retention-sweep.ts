import { useEffect } from "react";
import type { TursoConfig } from "./turso-config";
import { getAiDeploymentState } from "./ai-deployment";
import { expireThreads, loadAllThreadIds } from "./chat-threads-store";
import { dropPendingEditsWhere, dropStoredEditsWhere, pendingEditScope } from "./pending-edits";
import { retryPendingProjectSweeps } from "./pending-project-sweeps";
import { logDiag } from "./diagnostics";

// Databases already handled this page load, one set per job. The URL goes in when the job
// STARTS, so a remount during the call cannot start a second one and a failed run is not
// retried until the next page load.
const sweptThisLoad = new Set<string>();
const projectSweepsRetriedThisLoad = new Set<string>();
// Old thread-name drafts of the other databases are dropped once per page load.
let otherDraftsDroppedThisLoad = false;

/** Test only: forget which databases were swept. */
export function resetChatRetentionSweepForTests(): void {
  sweptThisLoad.clear();
  projectSweepsRetriedThisLoad.clear();
  otherDraftsDroppedThisLoad = false;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** The age past which another database's thread-name drafts go while no retention period is in force
 *  (unknown, or its setting invalid). */
const DEFAULT_DRAFT_DAYS = 30;
/** A chat thread-name outbox scope: `<database hash>:chat:<project id>` (`pendingEditScope`). */
const CHAT_SCOPE_RE = /^[^:]+:chat:/;

/** Drops the stored chat thread-name drafts of every database other than `currentUrl` older than `days`.
 *  This page never opens those scopes, so without this a draft (a chat name, in plain text) would stay
 *  in localStorage after its chat has long expired. The current database's drafts are left to its own
 *  load and sweep. */
function dropOldDraftsOfOtherDatabases(currentUrl: string, days: number): void {
  const current = pendingEditScope(currentUrl, "chat:");
  const cutoff = Date.now() - days * DAY_MS;
  dropStoredEditsWhere(
    "chat-thread-name",
    (scope) => CHAT_SCOPE_RE.test(scope) && !scope.startsWith(current),
    (edit) => edit.savedAt < cutoff,
  );
}

/** After a sweep: the pending chat-thread renames of this database (every project's scope) whose
 *  thread no longer exists are dropped. One id-only read; when it fails, nothing is dropped and
 *  nothing is logged (the next page load tries again). */
async function dropOrphanedRenames(tursoConfig: TursoConfig): Promise<void> {
  if (!tursoConfig.httpUrl) return;
  let existing: Set<string>;
  try {
    existing = new Set(await loadAllThreadIds(tursoConfig));
  } catch {
    return;
  }
  dropPendingEditsWhere(pendingEditScope(tursoConfig.httpUrl, "chat:"), "chat-thread-name", (id) => existing.has(id));
}

export type ChatRetentionSweepDeps = {
  tursoConfig: TursoConfig | null;
  loadPending: boolean;
};

/**
 * Deletes expired chat threads across the whole database, once per database per page load.
 * Independent of the AI switch and of which view is open.
 *
 * Then, also once per database per page load, retries the side-table sweeps of deleted projects
 * that failed earlier (`retryPendingProjectSweeps`). That retry does not wait for the chat
 * settings: with them unknown there is no chat sweep to run first.
 *
 * The retention comes from the server-rendered chat settings in the deployment state
 * (`getAiDeploymentState().chat`, null while unknown), read on every render. While the server's
 * retention setting is invalid no period is in force: the chat sweep is skipped (paused), and the
 * project-sweep retry still runs. After a sweep that ran, the pending renames of threads that no
 * longer exist in this database are dropped (`dropOrphanedRenames`).
 *
 * Also once per page load (with a database open, after the load): the thread-name drafts of every OTHER
 * database older than the retention period — 30 days while none is in force — are dropped
 * (`dropOldDraftsOfOtherDatabases`).
 */
export function useChatRetentionSweep({ tursoConfig, loadPending }: ChatRetentionSweepDeps): void {
  const chat = getAiDeploymentState().chat;
  const retentionDays = chat && !chat.retentionInvalid ? chat.retentionDays : null;
  useEffect(() => {
    if (!tursoConfig?.httpUrl || loadPending || otherDraftsDroppedThisLoad) return;
    otherDraftsDroppedThisLoad = true;
    dropOldDraftsOfOtherDatabases(tursoConfig.httpUrl, retentionDays ?? DEFAULT_DRAFT_DAYS);
  }, [tursoConfig, retentionDays, loadPending]);
  useEffect(() => {
    if (!tursoConfig || loadPending) return;
    const url = tursoConfig.httpUrl;
    const sweepChats = retentionDays !== null && !sweptThisLoad.has(url);
    const retryProjects = !projectSweepsRetriedThisLoad.has(url);
    if (!sweepChats && !retryProjects) return;
    let chatSweep: Promise<void> = Promise.resolve();
    if (sweepChats) {
      sweptThisLoad.add(url);
      chatSweep = expireThreads(tursoConfig, retentionDays).then(
        () => dropOrphanedRenames(tursoConfig),
        () => {
          logDiag("warn", "chat.retentionSweepFailed");
        },
      );
    }
    if (retryProjects) {
      projectSweepsRetriedThisLoad.add(url);
      void chatSweep.then(() => retryPendingProjectSweeps(tursoConfig));
    }
  }, [tursoConfig, retentionDays, loadPending]);
}
