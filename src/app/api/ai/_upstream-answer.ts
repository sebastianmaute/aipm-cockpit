// What the relay (`_relay.ts`) and its key check (`_key-check.ts`) both do with an upstream
// answer: refuse with a code of their own, read an error body under a cap, tell whether it is
// Anthropic-shaped, and drop an answer unread. Server-only; logs nothing.

import type { UpstreamRequest, UpstreamResponse } from "./_relay";

// A non-2xx body is read whole to decide whether it is Anthropic-shaped; error
// bodies are small, so anything larger is treated as not Anthropic-shaped.
export const MAX_ERROR_BODY_BYTES = 1024 * 1024;

/** The relay's own refusal: `{ error: <code> }`, never cached. */
export function fail(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

/** An answer the relay drops unread: destroying the upstream request makes it emit 'error'
 *  (ECONNRESET), which with no listener would be thrown as an uncaught exception. */
export function discard(res: UpstreamResponse, upstream: UpstreamRequest | null): void {
  res.on("error", () => {});
  upstream?.destroy();
}

/** The whole upstream body, or null when it is larger than `cap` or fails. */
export async function readCapped(res: UpstreamResponse, cap: number): Promise<Buffer | null> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for await (const chunk of res) {
      total += chunk.byteLength;
      if (total > cap) return null;
      chunks.push(chunk);
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** `{ type: "error", error: { type: <string>, … } }` — what Anthropic answers on an error. */
export function isAnthropicError(bytes: Buffer): boolean {
  try {
    const v: unknown = JSON.parse(bytes.toString("utf8"));
    return isRecord(v) && v.type === "error" && isRecord(v.error) && typeof v.error.type === "string";
  } catch {
    return false;
  }
}
