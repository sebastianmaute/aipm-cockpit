import { useEffect } from "react";
import type { TursoConfig } from "./turso-config";
import type { ChatSettings } from "./ai-chat-retention-config";
import { expireThreads } from "./chat-threads-store";
import { retentionCutoff } from "./chat-threads-schema";
import { logDiag } from "./diagnostics";

// Databases already handled this page load. The URL goes in when the sweep STARTS, so a
// remount during the call cannot start a second one and a failed sweep is not retried
// until the next page load.
const sweptThisLoad = new Set<string>();

/** Test only: forget which databases were swept. */
export function resetChatRetentionSweepForTests(): void {
  sweptThisLoad.clear();
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
 */
export function useChatRetentionSweep({ tursoConfig, chat, loadPending }: ChatRetentionSweepDeps): void {
  const retentionDays = chat ? chat.retentionDays : null;
  useEffect(() => {
    if (!tursoConfig || retentionDays === null || loadPending) return;
    if (sweptThisLoad.has(tursoConfig.httpUrl)) return;
    sweptThisLoad.add(tursoConfig.httpUrl);
    const cutoff = retentionCutoff(new Date(), retentionDays);
    void expireThreads(tursoConfig, cutoff).catch(() => {
      logDiag("warn", "chat.retentionSweepFailed");
    });
  }, [tursoConfig, retentionDays, loadPending]);
}
