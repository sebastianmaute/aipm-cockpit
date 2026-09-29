// src/app/use-ai-key-check.ts — §650: the start-up and on-save Anthropic key check, and the
// React read of the in-memory key verdict (`ai-key-status.ts`).
"use client";
import { useEffect, useSyncExternalStore } from "react";
import { getAiKeyStatus, subscribeAiKeyStatus, syncAiKey, type AiKeyStatus } from "./ai-key-status";
import { fetchAnthropicModels } from "./anthropic-models";
import { isValidAnthropicApiKey } from "./chat-models";
import type { AiConfig } from "./settings-types";

/** Keystrokes in Settings → AI commit per character; the check runs only on the key that has
 *  stayed unchanged this long, so typing a key never fires a request per character. */
export const AI_KEY_CHECK_DEBOUNCE_MS = 1500;
/** A hung check is abandoned (and the verdict left unchanged) after this long. */
export const AI_KEY_CHECK_TIMEOUT_MS = 15_000;

function getServerSnapshot(): AiKeyStatus {
  return "unknown";
}

/** The live key verdict, re-rendering on every change. */
export function useAiKeyStatus(): AiKeyStatus {
  return useSyncExternalStore(subscribeAiKeyStatus, getAiKeyStatus, getServerSnapshot);
}

export interface UseAiKeyCheckArgs {
  ai: Pick<AiConfig, "enabled" | "apiKey"> | undefined;
  hydrated: boolean;
  isPopout: boolean;
}

/**
 * Mounted ONCE per session, unconditionally, in task-manager.tsx.
 *
 * 1. Keeps the store's live-key token in step with `settings.ai.apiKey` (after hydration), so a
 *    changed key resets the verdict to "unknown". Popouts sync too — harmless, and their own
 *    envelopes then report against the right key.
 * 2. When AI is enabled, settings are hydrated, this is the main window and the key is well-formed,
 *    it runs ONE `GET /v1/models` on the settled key (debounced), which reports 2xx/401/403 into
 *    the verdict via `fetchAnthropicModels`. A network error, a timeout or any other status leaves
 *    the verdict unchanged — a key is never flagged on a network failure. It runs again only when
 *    the key changes or the check becomes eligible again (AI switched back on); a re-render with
 *    the same key does not re-check, because the effect's deps do not change.
 */
export function useAiKeyCheck({ ai, hydrated, isPopout }: UseAiKeyCheckArgs): void {
  const key = (ai?.apiKey ?? "").trim();
  const enabled = ai?.enabled === true;

  useEffect(() => {
    if (hydrated) syncAiKey(key);
  }, [hydrated, key]);

  const shouldCheck = hydrated && !isPopout && enabled && isValidAnthropicApiKey(key);
  useEffect(() => {
    if (!shouldCheck) return;
    const ctrl = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const debounce = setTimeout(() => {
      timeout = setTimeout(() => ctrl.abort(), AI_KEY_CHECK_TIMEOUT_MS);
      fetchAnthropicModels(key, ctrl.signal)
        .catch(() => {
          // Network error, abort or timeout: says nothing about the key — verdict unchanged.
        })
        .finally(() => clearTimeout(timeout));
    }, AI_KEY_CHECK_DEBOUNCE_MS);
    return () => {
      clearTimeout(debounce);
      clearTimeout(timeout);
      ctrl.abort();
    };
  }, [shouldCheck, key]);
}
