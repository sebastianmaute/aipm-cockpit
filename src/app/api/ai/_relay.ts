// Same-origin relay from the browser to the deployment's AI gateway
// (AIPM_AI_GATEWAY_URL). Used only when the deployment routes AI through a gateway;
// a direct deployment answers 404 and the browser calls the provider itself.
//
// What it does and does not do:
//   - forwards only `x-api-key`, `anthropic-version`, `anthropic-beta` and
//     `content-type` from the browser, plus `cf-aig-authorization` with the
//     deployment's gateway token when one is set. Cookies and every other header stay
//     here;
//   - accepts same-origin browser calls only (see `isSameOrigin`);
//   - streams a 2xx answer back without buffering it; passes an error through only
//     when it is Anthropic-shaped, otherwise answers 502 with a code of its own;
//   - logs nothing: not the key, the token, the URL or the body.
//
// The upstream call goes through `send` (default `node:https.request`) so tests never
// reach the network. https.request does not follow redirects, so a 3xx from the
// gateway is answered as a gateway error rather than followed.

import { request as httpsRequest } from "node:https";
import type { RequestOptions } from "node:http";
import { refuseIfDisabled } from "../_shared/integration-switch";
import { readAiGatewayConfig } from "../../ai-gateway-config";

// Anthropic's documented maximum request size for Messages and Token Counting is
// 32 MB; larger requests get 413 `request_too_large`. Source (checked 2026-10-27):
// https://platform.claude.com/docs/en/api/overview#request-size-limits
export const RELAY_MAX_BODY_BYTES = 32 * 1024 * 1024;
// Idle timeout on the upstream socket (node's `timeout` option): a streamed answer
// that keeps sending is never cut off, a silent one is after 15 minutes.
export const RELAY_TIMEOUT_MS = 15 * 60 * 1000;
// A non-2xx body is read whole to decide whether it is Anthropic-shaped; error
// bodies are small, so anything larger is treated as not Anthropic-shaped.
const MAX_ERROR_BODY_BYTES = 1024 * 1024;

export const AI_GATEWAY_REJECTED = "ai-gateway-rejected";
export const AI_GATEWAY_ERROR = "ai-gateway-error";
export const AI_GATEWAY_INVALID = "ai-gateway-invalid";
export const NOT_SAME_ORIGIN = "not-same-origin";
export const MISSING_API_KEY = "missing-api-key";

export type RelayOp = "messages" | "models";

const FORWARDED_HEADERS = ["x-api-key", "anthropic-version", "anthropic-beta", "content-type"] as const;

/** The part of `http.ClientRequest` the relay uses. */
export interface UpstreamRequest {
  on(event: "error" | "timeout", listener: (err?: Error) => void): unknown;
  end(body?: Uint8Array): unknown;
  destroy(): unknown;
}

/** The part of `http.IncomingMessage` the relay uses. */
export type UpstreamResponse = AsyncIterable<Uint8Array> & {
  statusCode?: number;
  headers: Record<string, string | string[] | undefined>;
};

export type RelaySend = (
  url: URL,
  options: RequestOptions,
  onResponse: (res: UpstreamResponse) => void,
) => UpstreamRequest;

const httpsSend: RelaySend = (url, options, onResponse) => httpsRequest(url, options, onResponse);

type Env = Record<string, string | undefined>;

function fail(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

/**
 * A browser call from this app's own pages. `Sec-Fetch-Site` decides when the browser
 * sent it (every current browser does); otherwise a present `Origin` must equal this
 * request's own origin, taken from `request.url`. Next builds that URL from the
 * incoming `Host` header and protocol. That is acceptable here because a browser
 * cannot forge `Host` for a cross-site request, and this comparison is only the
 * fallback for a browser that sent no `Sec-Fetch-Site`. Behind a TLS-terminating
 * ingress the protocol may read `http:` while `Origin` reads `https:`; such an old
 * browser is then refused (fails closed). `X-Forwarded-Host` and its peers are never
 * consulted: whoever sends the request sets them, so they cannot grant access.
 * A call with neither header (not a browser) passes; `relay` still requires an
 * `x-api-key` of the caller's own.
 */
function isSameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin";
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  return origin === new URL(request.url).origin;
}

/** The request body, or null when it is over the cap (declared or counted). */
async function readCappedBody(request: Request): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > RELAY_MAX_BODY_BYTES) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > RELAY_MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** The whole upstream body, or null when it is larger than `cap` or fails. */
async function readCapped(res: UpstreamResponse, cap: number): Promise<Buffer | null> {
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
function isAnthropicError(bytes: Buffer): boolean {
  try {
    const v: unknown = JSON.parse(bytes.toString("utf8"));
    return isRecord(v) && v.type === "error" && isRecord(v.error) && typeof v.error.type === "string";
  } catch {
    return false;
  }
}

function passThroughHeaders(res: UpstreamResponse): Headers {
  const headers = new Headers({ "cache-control": "no-store" });
  const type = res.headers["content-type"];
  if (typeof type === "string") headers.set("content-type", type);
  return headers;
}

function forwardHeaders(request: Request, token: string | null, body: Uint8Array | null): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  if (token) headers["cf-aig-authorization"] = `Bearer ${token}`;
  if (body) headers["content-length"] = String(body.byteLength);
  return headers;
}

/**
 * Sends the request upstream and resolves with the answer for the browser. An abort
 * of `signal` (the browser went away) destroys the upstream request, before or while
 * the answer streams.
 */
function forward(
  send: RelaySend,
  url: URL,
  options: RequestOptions,
  body: Uint8Array | null,
  signal: AbortSignal,
): Promise<Response> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (response: Response) => {
      if (settled) return;
      settled = true;
      resolve(response);
    };
    if (signal.aborted) {
      finish(fail(502, AI_GATEWAY_ERROR));
      return;
    }

    let upstream: UpstreamRequest | null = null;
    const onAbort = () => {
      upstream?.destroy();
      finish(fail(502, AI_GATEWAY_ERROR));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);

    const onResponse = async (res: UpstreamResponse) => {
      const status = res.statusCode ?? 502;
      const headers = passThroughHeaders(res);
      if (status >= 200 && status < 300) {
        finish(new Response(status === 204 || status === 205 ? null : streamOf(res), { status, headers }));
        return;
      }
      if (status < 400 || status > 599) {
        // 1xx/3xx or out of range: never passed through (a 304 cannot carry a body,
        // and the Response constructor rejects anything outside 200–599).
        cleanup();
        upstream?.destroy();
        finish(fail(502, AI_GATEWAY_ERROR));
        return;
      }
      const bytes = await readCapped(res, MAX_ERROR_BODY_BYTES);
      cleanup();
      if (bytes && isAnthropicError(bytes)) {
        finish(new Response(new Uint8Array(bytes), { status, headers }));
        return;
      }
      finish(fail(502, status === 401 || status === 403 ? AI_GATEWAY_REJECTED : AI_GATEWAY_ERROR));
    };

    const streamOf = (res: UpstreamResponse): ReadableStream<Uint8Array> => {
      const it = res[Symbol.asyncIterator]();
      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const { done, value } = await it.next();
            if (done) {
              cleanup();
              controller.close();
            } else {
              controller.enqueue(value);
            }
          } catch {
            cleanup();
            controller.error(new Error(AI_GATEWAY_ERROR));
          }
        },
        cancel() {
          cleanup();
          upstream?.destroy();
        },
      });
    };

    try {
      upstream = send(url, options, (res) => {
        onResponse(res).catch(() => {
          // A response that cannot be built must still settle the call.
          cleanup();
          upstream?.destroy();
          finish(fail(502, AI_GATEWAY_ERROR));
        });
      });
    } catch {
      // e.g. a token with characters a header cannot carry; never echo the error.
      finish(fail(502, AI_GATEWAY_ERROR));
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    const req = upstream;
    req.on("error", () => {
      cleanup();
      finish(fail(502, AI_GATEWAY_ERROR));
    });
    req.on("timeout", () => {
      req.destroy();
      cleanup();
      finish(fail(504, AI_GATEWAY_ERROR));
    });
    req.end(body ?? undefined);
  });
}

export async function relay(
  request: Request,
  op: RelayOp,
  env: Env = process.env,
  send: RelaySend = httpsSend,
): Promise<Response> {
  const refused = refuseIfDisabled("ai", env);
  if (refused) return refused;
  const config = readAiGatewayConfig(env);
  if (config.kind === "invalid") return fail(503, AI_GATEWAY_INVALID);
  if (config.kind === "direct") return new Response(null, { status: 404 });
  if (!isSameOrigin(request)) return fail(403, NOT_SAME_ORIGIN);
  // The gateway token is attached to every relayed call, and a gateway can hold a
  // stored provider key; a call without a key of its own must never reach it.
  // 400, never 401/403: the client reads those as a rejected key.
  if (!request.headers.get("x-api-key")?.trim()) return fail(400, MISSING_API_KEY);

  let body: Uint8Array | null = null;
  if (op === "messages") {
    try {
      body = await readCappedBody(request);
    } catch {
      return fail(400, "bad-request");
    }
    if (body === null) {
      // Anthropic-shaped, so the client reads it exactly like the provider's own 413.
      return Response.json(
        { type: "error", error: { type: "request_too_large", message: "Request exceeds the maximum allowed size." } },
        { status: 413, headers: { "cache-control": "no-store" } },
      );
    }
  }

  const url =
    op === "messages" ? new URL(`${config.baseUrl}/v1/messages`) : new URL(`${config.baseUrl}/v1/models?limit=1000`);
  const options: RequestOptions = {
    method: op === "messages" ? "POST" : "GET",
    headers: forwardHeaders(request, config.token, body),
    timeout: RELAY_TIMEOUT_MS,
  };
  return forward(send, url, options, body, request.signal);
}
