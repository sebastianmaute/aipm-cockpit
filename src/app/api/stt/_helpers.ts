// Shared server-side helpers for the /api/stt proxy route.
// Browser speech-to-text calls a user-configured OpenAI-compatible endpoint;
// this route proxies on the user's behalf so the API key never needs to be
// exposed to a third-party host directly from the browser. The key and the
// recorded audio are forwarded upstream only — never logged.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPrivateHost } from "../_shared/proxy-ssrf";
import { rateLimit } from "../jira/_rate-limit";
import { refuseIfDisabled } from "../_shared/integration-switch";
import { readAiGatewayConfig } from "../../ai-gateway-config";
import { AI_GATEWAY_INVALID } from "../../ai-errors";

const TIMEOUT_MS = 30_000;
// §806: dictation requests one caller may send per minute (`rateLimit`, scope "stt").
export const STT_MAX_REQUESTS = 60;
// 25MB — short recordings only. Checked twice: once via content-length before
// formData() buffers the body (fast-path reject), and again post-parse on the
// actual file size (a chunked request has no content-length and would
// otherwise skip the pre-check, letting formData() buffer unbounded).
const MAX_BYTES = 25 * 1024 * 1024;

export interface SttForward {
  url: string;
  key: string;
  form: FormData;
}

/** Validate + build the upstream request from the incoming multipart form. */
export async function parseSttRequest(
  request: Request,
): Promise<{ fwd: SttForward } | { error: Response }> {
  // §762 — dictation sends speech to a model provider, so the AI switch closes it too.
  // §786 — so does the people-protection lock: audio cannot be redacted, and a tab opened before the lock was set
  // has not heard about it yet.
  const refused = refuseIfDisabled("stt") ?? refuseIfDisabled("ai") ?? refuseIfDisabled("ai-people");
  if (refused) return { error: refused };
  // An invalid AI gateway setting turns AI off for the deployment, so it closes dictation the same way: 503.
  if (readAiGatewayConfig(process.env).kind === "invalid") {
    return { error: Response.json({ error: AI_GATEWAY_INVALID }, { status: 503, headers: { "cache-control": "no-store" } }) };
  }
  const key = request.headers.get("x-stt-key") ?? "";
  if (!key) return { error: new Response("missing key", { status: 400 }) };
  // §806: after the key check, so a key-less call (all a web page can send cross-site without a CORS preflight)
  // never uses up a caller's count.
  const limited = rateLimit(request, "stt", STT_MAX_REQUESTS);
  if (limited) return { error: limited };

  // Cap the upload before request.formData() buffers the whole body — an
  // unbounded multipart body is a trivial memory-DoS on the serverless function.
  const len = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(len) && len > MAX_BYTES) {
    return { error: new Response("payload too large", { status: 413 }) };
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { error: new Response("bad form", { status: 400 }) };
  }

  const file = form.get("file");
  const model = form.get("model");
  const baseUrl = String(form.get("baseUrl") ?? "");
  if (!(file instanceof Blob) || typeof model !== "string" || !baseUrl) {
    return { error: new Response("missing fields", { status: 400 }) };
  }
  // Defense-in-depth: a chunked request has no content-length (the pre-check
  // above sees len=0 and skips), so re-check the actual parsed file size.
  if (file instanceof Blob && file.size > MAX_BYTES) {
    return { error: new Response("payload too large", { status: 413 }) };
  }

  // SSRF model: baseUrl is USER-configured (bring-your-own OpenAI-compatible
  // endpoint), so there is no fixed vendor apex to allowlist. We require https,
  // block private hosts — an IP literal as written, a host name by every address
  // it resolves to (§803) — and callStt refuses redirects so an upstream can't
  // 302 us into the internal network. Accepted residuals (inherent to an arbitrary
  // user endpoint): DNS rebinding (the name resolves public at check time and
  // private when fetch connects, because fetch resolves it again) and that this is
  // a generic authenticated egress proxy to any public host, bounded per caller by
  // the rate limit above.
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    return { error: new Response("bad baseUrl", { status: 400 }) };
  }
  if (u.protocol !== "https:") {
    return { error: new Response("https required", { status: 400 }) };
  }
  if (isPrivateHost(u.hostname)) {
    return { error: new Response("blocked host", { status: 400 }) };
  }
  const resolved = await classifyResolvedHost(u.hostname);
  if (resolved === "unresolved") return { error: upstreamFailed() };
  if (resolved === "private") return { error: new Response("blocked host", { status: 400 }) };

  const upstream = new FormData();
  upstream.append("file", file, "audio.webm");
  upstream.append("model", model);
  const url = `${baseUrl.replace(/\/$/, "")}/audio/transcriptions`;
  return { fwd: { url, key, form: upstream } };
}

/**
 * §803: a host name is judged by the addresses it resolves to — private when ANY of them is
 * (a name with one public and one private address could connect to either). An IP literal was
 * already judged as written and needs no lookup. A name that does not resolve cannot be
 * reached either, so it is answered like a failed upstream call, never forwarded.
 */
async function classifyResolvedHost(hostname: string): Promise<"public" | "private" | "unresolved"> {
  const bare = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  if (isIP(bare) !== 0) return "public";
  let addresses: { address: string }[];
  try {
    addresses = await lookup(bare, { all: true, verbatim: true });
  } catch {
    return "unresolved";
  }
  if (addresses.length === 0) return "unresolved";
  return addresses.some((a) => isPrivateHost(a.address)) ? "private" : "public";
}

function upstreamFailed(): Response {
  return new Response(JSON.stringify({ error: "stt upstream failed" }), {
    status: 502,
    headers: { "content-type": "application/json" },
  });
}

/** Forward the validated request upstream and relay its response. Never logs the key/audio. */
export async function callStt(fwd: SttForward): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(fwd.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${fwd.key}` },
      body: fwd.form,
      signal: controller.signal,
      // Refuse redirects: the SSRF host check ran on the initial baseUrl only, so
      // a 302 to an internal host (169.254.169.254 metadata, 127.0.0.1, …) would
      // bypass it if we followed. "manual" surfaces the 3xx so we can reject it.
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      return new Response(JSON.stringify({ error: "stt upstream redirect refused" }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    // Network-level failure before any response (DNS, connection refused, TLS,
    // timeout/abort). Never log the error object — it could echo the request
    // (key/audio); hand the client a structured 502 instead.
    return upstreamFailed();
  } finally {
    clearTimeout(timer);
  }
}
