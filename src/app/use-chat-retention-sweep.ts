import { useEffect } from "react";
import type { TursoConfig } from "./turso-config";
import type { ChatSettings } from "./ai-chat-retention-config";
import { expireThreads } from "./chat-threads-store";
import { retentionCutoff } from "./chat-threads-schema";
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

export type ChatRetentionSweepDeps = {
  tursoConfig: TursoConfig | null;
  /** The server-rendered chat settings; null while unknown. */
  chat: ChatSettings | null;
  loadPending: boolean;
};

/**
 * Deletes expired chat threads across the whole database, once per database per page load.
 * Independent of the AI switch and of which view is open.
 *
 * Then, also once per database per page load, retries the side-table sweeps of deleted projects
 * that failed earlier (`retryPendingProjectSweeps`). That retry does not wait for the chat
 * settings: with them unknown there is no chat sweep to run first.
 */
export function useChatRetentionSweep({ tursoConfig, chat, loadPending }: ChatRetentionSweepDeps): void {
  const retentionDays = chat ? chat.retentionDays : null;
  useEffect(() => {
    if (!tursoConfig || loadPending) return;
    const url = tursoConfig.httpUrl;
    const sweepChats = retentionDays !== null && !sweptThisLoad.has(url);
    const retryProjects = !projectSweepsRetriedThisLoad.has(url);
    if (!sweepChats && !retryProjects) return;
    let chatSweep: Promise<void> = Promise.resolve();
    if (sweepChats) {
      sweptThisLoad.add(url);
      const cutoff = retentionCutoff(new Date(), retentionDays);
      chatSweep = expireThreads(tursoConfig, cutoff).catch(() => {
        logDiag("warn", "chat.retentionSweepFailed");
      });
    }
    if (retryProjects) {
      projectSweepsRetriedThisLoad.add(url);
      void chatSweep.then(() => retryPendingProjectSweeps(tursoConfig));
    }
  }, [tursoConfig, retentionDays, loadPending]);
}
