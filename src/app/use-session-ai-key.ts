// src/app/use-session-ai-key.ts — React's view of the page-only unlocked Anthropic key (§717, `session-ai-key.ts`).
import { useSyncExternalStore } from "react";
import { getSessionAiKey, subscribeSessionAiKey } from "./session-ai-key";

/** The unlocked key, re-rendering the caller when it is set or cleared. "" on the server and before any unlock. */
export function useSessionAiKey(): string {
  return useSyncExternalStore(subscribeSessionAiKey, getSessionAiKey, () => "");
}
