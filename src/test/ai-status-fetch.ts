// src/test/ai-status-fetch.ts — the shared test answer to the AI transport's per-send status check.
//
// Every AI request (`ai-transport.ts`) first asks `GET /api/ai/status` whether this deployment's AI
// setting is still the one the page loaded with. `vitest.setup.ts` answers that request with
// `DIRECT_AI_STATUS` before every test (`answerAiStatusDirect`), so a test that stubs `fetch` for one
// Anthropic call sees only that call. A test of the status check itself restores the real request.
// ★ Imports only types, so the setup file loads no app module (and no `diagnostics`) through it:
// a module the setup file loads is cached before a test file's `vi.mock` runs, and would stay real.
import type { AiDeploymentState } from "../app/ai-deployment";

export const DIRECT_AI_STATUS: AiDeploymentState = { off: false, route: "direct", invalid: false };

/** The status route's answer for `state`. */
export function aiStatusResponse(state: AiDeploymentState = DIRECT_AI_STATUS): Response {
  return new Response(JSON.stringify(state), { status: 200, headers: { "content-type": "application/json" } });
}

/** The status request the test setup installs: always the direct state. */
export function answerAiStatusDirect(): Promise<Response> {
  return Promise.resolve(aiStatusResponse(DIRECT_AI_STATUS));
}
