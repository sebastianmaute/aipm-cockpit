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
  const [live, setLive] = useState<readonly LiveModel[]>([]);
  const key = apiKey.trim();
  const shouldFetch = enabled && isValidAnthropicApiKey(key);

  useEffect(() => {
    if (!shouldFetch) return;
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
          setLive([]);
          return;
        }
        const body = (await res.json()) as { data?: LiveModel[] };
        setLive(Array.isArray(body.data) ? body.data : []);
      } catch {
        // Network/parse/abort — silent fallback to the registry.
        setLive([]);
      }
    })();
    return () => ctrl.abort();
  }, [shouldFetch, key]);

  // Gate the live list reactively (instead of synchronously resetting state in
  // the effect, which the react-hooks/set-state-in-effect rule bans): a stale
  // `live` from a previously-valid key is ignored the moment shouldFetch flips.
  return useMemo(
    () => buildModelOptions(CHAT_MODELS, shouldFetch ? live : [], currentId),
    [shouldFetch, live, currentId],
  );
}
