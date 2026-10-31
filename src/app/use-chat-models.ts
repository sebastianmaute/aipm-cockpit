// src/app/use-chat-models.ts
"use client";
import { useEffect, useMemo, useState } from "react";
import { isInteractiveAiAllowed } from "./ai-consent";
import { AiKeyCheckUnavailableError } from "./ai-errors";
import { fetchAnthropicModels } from "./anthropic-models";
import { CHAT_MODELS, type AiConfig } from "./settings-types";
import {
  buildModelOptions,
  isValidAnthropicApiKey,
  type LiveModel,
  type ModelOption,
} from "./chat-models";

/** Live model list for the picker. Fetches Anthropic /v1/models browser-direct
 *  when AI is switched on with a current interactive consent (`isInteractiveAiAllowed`, M4: no
 *  request to Anthropic before consent) and the key is well-formed. Until a poll SUCCEEDS the
 *  option list is NOT pre-filled from the offline registry — it holds only the
 *  current selection, and `loaded` is false (callers show a "enter a valid key"
 *  hint). `checkUnavailable` is true when the relay could not check the key's organisation for the
 *  current key (`AiKeyCheckUnavailableError`): Settings → AI says so beside the key field. Never logs the
 *  key or response body. */
export function useChatModels(
  apiKey: string,
  ai: Pick<AiConfig, "enabled" | "consent">,
  currentId: string,
): { options: ModelOption[]; loaded: boolean; checkUnavailable: boolean } {
  // Carry the source key alongside the models so a valid A->B key switch can't
  // momentarily surface A's models while B's request is in flight.
  const [liveState, setLiveState] = useState<{ key: string; models: readonly LiveModel[]; checkUnavailable: boolean }>({
    key: "",
    models: [],
    checkUnavailable: false,
  });
  const key = apiKey.trim();
  const shouldFetch = isInteractiveAiAllowed(ai) && isValidAnthropicApiKey(key);

  useEffect(() => {
    if (!shouldFetch) return;
    let active = true;
    const ctrl = new AbortController();
    void (async () => {
      try {
        // §650 — the shared fetch reports a 401/403 into the key verdict (`ai-key-status.ts`)
        // instead of the failure being swallowed here.
        const result = await fetchAnthropicModels(key, ctrl.signal);
        if (active) setLiveState({ key, models: result.kind === "ok" ? result.models : [], checkUnavailable: false });
      } catch (err) {
        // The relay could not check the key: recorded for this key, so Settings → AI can say so. The list
        // falls back exactly as below.
        if (err instanceof AiKeyCheckUnavailableError) {
          if (active) setLiveState({ key, models: [], checkUnavailable: true });
          return;
        }
        // Network/parse/abort — silent fallback to the registry.
        if (active) setLiveState({ key: "", models: [], checkUnavailable: false });
      }
    })();
    return () => {
      active = false;
      ctrl.abort();
    };
  }, [shouldFetch, key]);

  // Only consume the live models when they were produced by the CURRENT key and
  // a fetch is warranted; otherwise fall back to the registry. (Gating here
  // instead of synchronously resetting state in the effect keeps the
  // react-hooks/set-state-in-effect ban satisfied. The gate lives inside the
  // memo so the dep is the stable `liveState` object, not a fresh array each
  // render.)
  return useMemo(() => {
    const current = shouldFetch && liveState.key === key;
    const polled = current && liveState.models.length > 0;
    const live = polled ? liveState.models : [];
    // registryAsBase:false — no offline pre-fill; the dropdown stays empty (bar
    // the current selection) until a live /v1/models poll returns models.
    return {
      options: buildModelOptions(CHAT_MODELS, live, currentId, { registryAsBase: false }),
      loaded: polled,
      checkUnavailable: current && liveState.checkUnavailable,
    };
  }, [shouldFetch, liveState, key, currentId]);
}
