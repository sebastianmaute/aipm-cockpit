import { useEffect } from "react";
import type { TursoConfig } from "./turso-config";
import { getAiDeploymentState } from "./ai-deployment";
import { expireThreads, loadAllThreadIds } from "./chat-threads-store";
import { dropPendingEditsWhere, pendingEditScope } from "./pending-edits";
import { retryPendingProjectSweeps } from "./pending-project-sweeps";
import { logDiag } from "./diagnostics";

// Databases already handled this page load, one set per job. The URL goes in when the job
// STARTS, so a remount during the call cannot start a second one and a failed run is not
// retried until the next page load.
const sweptThisLoad = new Set<string>();
const projectSweepsRetriedThisLoad = new Set<string>();

/** Test only: forget which databases were swept. */
export function resetChatRetentionSweepForTests(): void {
  sweptThisLoad.clear();
  projectSweepsRetriedThisLoad.clear();
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
 */
export function useChatRetentionSweep({ tursoConfig, loadPending }: ChatRetentionSweepDeps): void {
  const chat = getAiDeploymentState().chat;
  const retentionDays = chat && !chat.retentionInvalid ? chat.retentionDays : null;
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
