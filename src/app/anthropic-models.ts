// src/app/anthropic-models.ts — the ONE `GET /v1/models` fetch, shared by the model picker
// (`use-chat-models.ts`) and the §650 start-up key check (`use-ai-key-check.ts`).
//
// SECURITY: the key goes only into the request header; it is never logged, echoed, or put in a
// URL. The response body is read only on success (the model list). Every answer the server gives
// feeds the in-memory key verdict (`ai-key-status.ts`): 2xx → ok, 401 → rejected, 403 → forbidden,
// anything else unchanged. A network failure or an abort THROWS before any report — a key is never
// flagged on a network failure.
import { ANTHROPIC_VERSION } from "./chat-api";
import type { LiveModel } from "./chat-models";
import { reportAiKeyResponse } from "./ai-key-status";

export const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models?limit=1000";

export type ModelsFetchResult =
  | { kind: "ok"; models: readonly LiveModel[] }
  | { kind: "http"; status: number };

/** Fetch the live model list with `key`. Resolves `{kind:"ok"}` on 2xx and `{kind:"http"}` on any
 *  other status (both reported to the key verdict); rejects on a network error, a parse error of a
 *  2xx body, or an abort. */
export async function fetchAnthropicModels(key: string, signal?: AbortSignal): Promise<ModelsFetchResult> {
  const res = await fetch(ANTHROPIC_MODELS_URL, {
    headers: {
      "x-api-key": key,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
    },
    signal,
  });
  if (!res.ok) {
    reportAiKeyResponse(key, res.status);
    return { kind: "http", status: res.status };
  }
  reportAiKeyResponse(key, 200);
  const body = (await res.json()) as { data?: LiveModel[] };
  return { kind: "ok", models: Array.isArray(body.data) ? body.data : [] };
}
