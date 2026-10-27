// src/app/ai-status-request.ts — the one request `confirmAiDeployment` (`ai-transport.ts`) sends to
// learn this deployment's AI setting before every AI send. Kept in a module with NO imports so the
// test setup can replace it without loading anything else first.
//
// Tests: `vitest.setup.ts` answers this request with the direct state before every test, so a test
// that stubs `fetch` for one Anthropic call does not also have to answer the status request.
// `ai-transport.test.ts` restores the real request (`__setAiStatusRequestForTests(null)`) and drives
// the status through its own `fetch` stub.

export const AI_STATUS_URL = "/api/ai/status";

type StatusRequest = (signal?: AbortSignal) => Promise<Response>;

let override: StatusRequest | null = null;

/** GET the status route, bypassing the HTTP cache. */
export function requestAiStatus(signal?: AbortSignal): Promise<Response> {
  if (override) return override(signal);
  return fetch(AI_STATUS_URL, { cache: "no-store", signal });
}

/** Test seam only: replace the status request; null restores the real one. */
export function __setAiStatusRequestForTests(request: StatusRequest | null): void {
  override = request;
}
