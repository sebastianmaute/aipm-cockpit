// src/app/use-chat-models.ts
"use client";
import { useEffect, useMemo, useState } from "react";
import { ANTHROPIC_VERSION } from "./chat-api";
import { CHAT_MODELS } from "./settings-types";
import {
  buildModelOptions,
  isValidAnthropicApiKey,
  type LiveModel,
  type ModelOption,
} from "./chat-models";

/** Live model list for the picker. Fetches Anthropic /v1/models browser-direct
 *  when AI is enabled and the key is well-formed; on any failure returns the
 *  registry options. Never logs the key or response body. */
export function useChatModels(apiKey: string, enabled: boolean, currentId: string): ModelOption[] {
  // Carry the source key alongside the models so a valid A->B key switch can't
  // momentarily surface A's models while B's request is in flight.
  const [liveState, setLiveState] = useState<{ key: string; models: readonly LiveModel[] }>({
    key: "",
    models: [],
  });
  const key = apiKey.trim();
  const shouldFetch = enabled && isValidAnthropicApiKey(key);

  useEffect(() => {
    if (!shouldFetch) return;
    let active = true;
    const ctrl = new AbortController();
    void (async () => {
      try {
        const res = await fetch("https://api.anthropic.com/v1/models?limit=1000", {
          headers: {
            "x-api-key": key,
            "anthropic-version": ANTHROPIC_VERSION,
            "anthropic-dangerous-direct-browser-access": "true",
          },
          signal: ctrl.signal,
        });
        if (!res.ok) {
          if (active) setLiveState({ key, models: [] });
          return;
        }
        const body = (await res.json()) as { data?: LiveModel[] };
        if (active) setLiveState({ key, models: Array.isArray(body.data) ? body.data : [] });
      } catch {
        // Network/parse/abort — silent fallback to the registry.
        if (active) setLiveState({ key: "", models: [] });
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
    const live = shouldFetch && liveState.key === key ? liveState.models : [];
    return buildModelOptions(CHAT_MODELS, live, currentId);
  }, [shouldFetch, liveState, key, currentId]);
}
