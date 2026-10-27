// src/app/anthropic-models.ts — the ONE model-list request (sent by `getAiModels` in `ai-transport.ts`), shared by the model picker
// (`use-chat-models.ts`) and the §650 start-up key check (`use-ai-key-check.ts`).
//
// SECURITY: the key goes only into the request header; it is never logged, echoed, or put in a
// URL. The response body is read only on success (the model list). Every answer the server gives
// feeds the in-memory key verdict (`ai-key-status.ts`): 2xx → ok, 401 → rejected, 403 → forbidden,
// anything else unchanged. A network failure, an abort, an unconfirmed or changed AI setting
// (`AiDeploymentError`) and a failure of the organisation's AI gateway (`AiGatewayError`) all THROW
// before any report — a key is never flagged on any of them.
import { getAiModels } from "./ai-transport";
import type { LiveModel } from "./chat-models";
import { reportAiKeyResponse } from "./ai-key-status";

export { ANTHROPIC_MODELS_URL } from "./ai-transport";

export type ModelsFetchResult =
  | { kind: "ok"; models: readonly LiveModel[] }
  | { kind: "http"; status: number };

/** Fetch the live model list with `key`. Resolves `{kind:"ok"}` on 2xx and `{kind:"http"}` on any
 *  other status (both reported to the key verdict); rejects on a network error, a parse error of a
 *  2xx body, an abort, or a transport error (`AiDeploymentError`, `AiGatewayError`). */
export async function fetchAnthropicModels(key: string, signal?: AbortSignal): Promise<ModelsFetchResult> {
  const res = await getAiModels(key, signal);
  if (!res.ok) {
    reportAiKeyResponse(key, res.status);
    return { kind: "http", status: res.status };
  }
  reportAiKeyResponse(key, 200);
  const body = (await res.json()) as { data?: LiveModel[] };
  return { kind: "ok", models: Array.isArray(body.data) ? body.data : [] };
}
