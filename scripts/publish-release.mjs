#!/usr/bin/env node
// Create the GitLab Release for the current tag and attach the installer link.
//
// EXIT CODES — outside --dry-run, 0 means a CONFIRMED Release and nothing
// else does:
//   0  a 201 whose body echoes this tag AND this asset link; or a 409 whose
//      existing Release already carries this link (an earlier create landed
//      and only its response was lost); or --dry-run printed the payload
//   1  the API REFUSED: a 4xx other than 408, 409 and 429, or a 409 whose
//      existing Release for this tag lacks this link. A human has to act; a
//      retry fails the same way.
//   2  everything else, all of it safe to retry: missing env, an unknown
//      argument, a network failure, the 30 s timeout, a 5xx, a 408 or 429
//      (transient, not a refusal), a redirect, a 2xx that does not confirm, a
//      GET after a 409 that cannot be read, and any structural failure (a
//      moved version.ts shape, a renamed lib export).
//
// ★★ A retry on 2 is safe BECAUSE of the 409 path: if a create landed and
//   only its response was lost, the retry answers 409 and the GET confirms it.
// ★★★ EVERY decision about a response is made by the pure classifiers in
//   release-publish-lib.mjs, which are unit- and mutation-tested, against an
//   `expected` taken from the payload by expectedFromPayload(). This file only
//   fetches, redacts, prints, and maps a verdict to an exit code.
// ★★ `redirect: "manual"` on BOTH requests. A followed redirect turns the POST
//   into a GET, and that GET's 200 once read as "created".
// ★★ No classifier message contains a response body. This file is the one
//   place a body is printed, so it redacts CI_JOB_TOKEN out of every body
//   excerpt — BEFORE truncating it, so a token straddling the cut cannot leak
//   a prefix — and out of the caught error. It never prints its own headers.
// ★ --dry-run validates CI_API_V4_URL and CI_PROJECT_ID exactly as a real run
//   does, builds and prints the payload, and says only whether a token is
//   PRESENT. It makes no network call, and it is the only part runnable
//   locally. Any other argument exits 2: a typo'd `--dryrun` used to send a
//   real POST.
// ★ Both libraries are imported dynamically, inside the one try, so a renamed
//   export or a moved version.ts shape exits 2 with a clean message instead
//   of Node's default exit 1, which here is the REFUSAL code.
import { readFileSync } from "node:fs";

const TIMEOUT_MS = 30_000;
const BODY_EXCERPT_CHARS = 2000;

const token = process.env.CI_JOB_TOKEN;
// ★ An empty token is falsy on purpose: split("") would put the marker
// between every character of the text.
const redact = (s) => (token ? String(s).split(token).join("[REDACTED]") : String(s));
const say = (msg) => console.log(`[release:publish] ${redact(msg)}`);
const fail = (code, msg, body) => {
  console.error(`[release:publish] ${redact(msg)}`);
  if (body) console.error(redact(body).slice(0, BODY_EXCERPT_CHARS));
  process.exit(code);
};

const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== "--dry-run");
if (unknown.length > 0) {
  fail(2, `CANNOT PUBLISH: unknown argument(s) ${unknown.join(" ")} — the only flag is --dry-run`);
}
const dryRun = args.includes("--dry-run");

/** The body as JSON, or null — a proxy's HTML page is not an answer. */
function parseJsonOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

try {
  const { SOURCE_FILE, readSourceFrom } = await import("./version-sync-lib.mjs");
  const { buildReleasePayload, expectedFromPayload, classifyCreateResponse, classifyExistingRelease } = await import(
    "./release-publish-lib.mjs"
  );

  const { version, milestone } = readSourceFrom(readFileSync(SOURCE_FILE, "utf8"));
  const payload = buildReleasePayload(process.env, version, milestone);
  const expected = expectedFromPayload(payload);

  // ★ Trailing slashes stripped, so `.../api/v4/` cannot build `v4//projects`.
  // A backward scan, not `/\/+$/`: that regex backtracks quadratically when a
  // long run of slashes is NOT at the end (measured: 100k slashes then one
  // other character took ~12 s), and this scan is linear.
  const rawApi = process.env.CI_API_V4_URL ?? "";
  let apiEnd = rawApi.length;
  while (apiEnd > 0 && rawApi[apiEnd - 1] === "/") apiEnd--;
  const api = rawApi.slice(0, apiEnd);
  const projectId = process.env.CI_PROJECT_ID;
  // ★ Name WHICH one is missing, never the value of any of them.
  const missing = [!api && "CI_API_V4_URL", !projectId && "CI_PROJECT_ID", !dryRun && !token && "CI_JOB_TOKEN"].filter(
    Boolean,
  );
  if (missing.length > 0) fail(2, `CANNOT PUBLISH: missing ${missing.join(", ")}`);

  // new URL() throws on a malformed CI_API_V4_URL, in --dry-run as well.
  const endpoint = new URL(`${api}/projects/${encodeURIComponent(projectId)}/releases`).href;

  if (dryRun) {
    say(`--dry-run, nothing sent. Would POST ${endpoint} (JOB-TOKEN ${token ? "present" : "absent"}). Payload:`);
    console.log(redact(JSON.stringify(payload, null, 2)));
    process.exit(0);
  }

  const call = (url, init) =>
    fetch(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "JOB-TOKEN": token, ...init.headers },
    });

  const res = await call(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  const created = classifyCreateResponse(res.status, parseJsonOrNull(body), expected);

  if (created.kind === "created") {
    say(`created release for ${expected.tagName}`);
    say(`asset: ${expected.assetUrl}`);
    process.exit(0);
  }

  if (created.kind === "check-existing") {
    say(`HTTP 409: a Release for ${expected.tagName} already exists — checking whether it carries this asset link`);
    const got = await call(`${endpoint}/${encodeURIComponent(expected.tagName)}`, { method: "GET" });
    const gotBody = await got.text();
    const existing = classifyExistingRelease(got.status, parseJsonOrNull(gotBody), expected);
    if (existing.code === 0) {
      say(existing.message);
      say(`asset: ${expected.assetUrl}`);
      process.exit(0);
    }
    // ★ Clamp: only the classifier's explicit 1 leaves as 1; anything else is 2.
    fail(existing.code === 1 ? 1 : 2, existing.message, gotBody);
  }

  // ★ Clamp: only an explicit fail/1 leaves as 1. Anything else — including a
  // verdict shape this file does not know — is 2, and never 0.
  fail(
    created.kind === "fail" && created.code === 1 ? 1 : 2,
    created.message ?? "CANNOT CONFIRM: the create classifier returned no verdict",
    body,
  );
} catch (err) {
  // ★ `err` need not be an Error (`throw null`), so never read .message off
  // it directly. fetch's own message is only "fetch failed"; the reason is on
  // `cause` — an errno code (ECONNREFUSED, ECONNRESET), or for a blocked port
  // no code at all, only a message ("bad port"). An AbortSignal timeout
  // arrives as a TimeoutError.
  // ★★ Describing `err` can itself throw — String() of a prototype-less
  // object has no toString — and a throw from INSIDE this catch is uncaught,
  // so Node would exit 1, the REFUSAL code. Hence its own try and a fixed
  // fallback: this catch always exits 2.
  let detail = "an error that could not be described";
  try {
    const cause = err?.cause?.code ?? err?.cause?.message;
    detail = err instanceof Error ? `${err.name}: ${err.message}${cause ? ` (${cause})` : ""}` : String(err);
  } catch {
    // keep the fallback
  }
  fail(2, `CANNOT PUBLISH: ${detail}`);
}
