// Shared server-side helpers for the /api/stt proxy route.
// Browser speech-to-text calls a user-configured OpenAI-compatible endpoint;
// this route proxies on the user's behalf so the API key never needs to be
// exposed to a third-party host directly from the browser. The key and the
// recorded audio are forwarded upstream only — never logged.

import { isPrivateHost } from "../_shared/proxy-ssrf";

const TIMEOUT_MS = 30_000;

export interface SttForward {
  url: string;
  key: string;
  form: FormData;
}

/** Validate + build the upstream request from the incoming multipart form. */
export async function parseSttRequest(
  request: Request,
): Promise<{ fwd: SttForward } | { error: Response }> {
  const key = request.headers.get("x-stt-key") ?? "";
  if (!key) return { error: new Response("missing key", { status: 400 }) };

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

  const upstream = new FormData();
  upstream.append("file", file, "audio.webm");
  upstream.append("model", model);
  const url = `${baseUrl.replace(/\/$/, "")}/audio/transcriptions`;
  return { fwd: { url, key, form: upstream } };
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
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    // Network-level failure before any response (DNS, connection refused, TLS,
    // timeout/abort). Never log the error object — it could echo the request
    // (key/audio); hand the client a structured 502 instead.
    return new Response(JSON.stringify({ error: "stt upstream failed" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  } finally {
    clearTimeout(timer);
  }
}
