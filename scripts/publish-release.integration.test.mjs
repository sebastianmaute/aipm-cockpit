// @vitest-environment node
//
// scripts/publish-release.mjs END TO END: the real CLI, spawned as a child
// process, against a fake Releases API on an ephemeral loopback port.
//
// ★★ The classifiers have their own unit tests; THIS file covers what only a
// real run can see — `redirect: "manual"`, the unknown-argument guard, the
// trailing-slash strip, and redaction of an echoed body BEFORE it is cut to
// its excerpt. Each of those was mutation-proved against this file. It also
// pins the catch's exit code, the missing-env exit, the lib's tag guard
// reaching exit 2, and the Content-Type header (through the fake API's 415).
//
// ★ The child is started with async `spawn`, never `spawnSync`: the fake API
// lives in THIS process, and a synchronous spawn would block the event loop
// that has to answer the child's request.
//
// ★ Every CI_* variable is stripped from the child's environment before the
// fake ones are set, so a real CI_JOB_TOKEN from the pipeline running this
// test can never reach the child — and the canary is the only token it sees.
//
// ★★ The tag is `v` + this checkout's APP_VERSION, read the way the CLI reads
// it. The lib refuses any other tag, so a hardcoded one would turn every row
// but the unknown-argument one red on the next version bump.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SOURCE_FILE, readSourceFrom } from "./version-sync-lib.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const CLI = fileURLToPath(new URL("./publish-release.mjs", import.meta.url));
const TAG = `v${readSourceFrom(readFileSync(path.join(REPO, SOURCE_FILE), "utf8")).version}`;
const TOKEN = "canary-not-a-token";
const RELEASES = "/api/v4/projects/1/releases";
const EXISTING = `${RELEASES}/${TAG}`;
const MOVED = "/api/v4/moved";

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};
/** The Release body a real GitLab would return for the payload we POSTed. */
const echo = (payload) => ({ tag_name: payload.tag_name, assets: { links: payload.assets.links } });
const withOtherLink = (payload) => ({
  tag_name: payload.tag_name,
  assets: { links: [{ url: "https://example.com/other.exe" }] },
});

let api;
afterEach(async () => {
  if (!api) return;
  api.server.closeAllConnections();
  await new Promise((resolve) => api.server.close(resolve));
  api = undefined;
});

/** The only paths a row's `respond` is ever asked to answer. */
const KNOWN_PATHS = new Set([RELEASES, EXISTING, MOVED]);

/**
 * Start the fake API. `respond({ req, res, posted, body })` answers each
 * request to a KNOWN path; `posted` is the payload of the first POST to the
 * releases endpoint.
 *
 * ★ Every other path gets a 404 here, before any row sees it. A CLI that
 * builds a wrong URL (a `v4//projects` path, say) must fail FAST on the
 * `requests` assertion — without this, a row's `respond` ran against a null
 * `posted`, threw inside the server, left the request unanswered, and the row
 * died on the 20 s test timeout instead of on the assertion that names the
 * defect.
 *
 * ★ A POST without a JSON content-type gets a 415, so a CLI that drops its
 * Content-Type header fails every row that expects a POST to land — fetch
 * labels a string body text/plain by default. Whether real GitLab answers
 * 415 or misreads the body is not established; either way the header is
 * required.
 */
async function startApi(respond) {
  const requests = [];
  let posted = null;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push(`${req.method} ${req.url}`);
      if (!KNOWN_PATHS.has(req.url)) return send(res, 404, { message: "404 Not Found" });
      if (req.method === "POST" && !String(req.headers["content-type"] ?? "").startsWith("application/json")) {
        return send(res, 415, { message: "415 Unsupported Media Type" });
      }
      if (req.method === "POST" && req.url === RELEASES && posted === null) posted = JSON.parse(body);
      respond({ req, res, posted, body });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, requests, url: `http://127.0.0.1:${server.address().port}/api/v4` };
}

/** An API base nothing listens on: a loopback port bound, read, then closed. */
async function closedApiUrl() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return `http://127.0.0.1:${port}/api/v4`;
}

/** ★ An `overrides` value of `undefined` DELETES that variable from the child's env. */
function runCli(apiUrl, args, overrides = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("CI_")));
  Object.assign(env, {
    CI_PROJECT_URL: "https://gitlab.example/g/p",
    CI_COMMIT_TAG: TAG,
    CI_PROJECT_ID: "1",
    CI_API_V4_URL: apiUrl,
    CI_JOB_TOKEN: TOKEN,
  });
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: REPO, env });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out }));
  });
}

// Each row: how the fake API answers, what the CLI must exit with, exactly
// which requests the API must have received, and text the output must hold.
const ROWS = [
  {
    name: "201 echoing our tag and link exits 0",
    respond: ({ res, posted }) => send(res, 201, echo(posted)),
    code: 0,
    requests: [`POST ${RELEASES}`],
    outHas: [`created release for ${TAG}`],
  },
  {
    name: "201 naming another tag exits 2",
    respond: ({ res, posted }) => send(res, 201, { ...echo(posted), tag_name: "v0.999.0" }),
    code: 2,
    requests: [`POST ${RELEASES}`],
    outHas: ["CANNOT CONFIRM: 201 but the body lacks"],
  },
  {
    // Followed, a 302 turns the POST into a GET whose `200 []` once read as "created".
    name: "302 exits 2 and is NOT followed",
    respond: ({ req, res }) =>
      req.url === RELEASES ? send(res, 302, "", { Location: MOVED }) : send(res, 200, []),
    code: 2,
    requests: [`POST ${RELEASES}`],
    outHas: ["HTTP 302 redirect"],
  },
  {
    // A followed 307 RE-POSTS to the new location, which here would confirm —
    // so this row exits 0 and records two requests if the redirect is followed.
    name: "307 exits 2 and is NOT followed, even to a location that would confirm",
    respond: ({ req, res, body }) =>
      req.url === RELEASES ? send(res, 307, "", { Location: MOVED }) : send(res, 201, echo(JSON.parse(body))),
    code: 2,
    requests: [`POST ${RELEASES}`],
    outHas: ["HTTP 307 redirect"],
  },
  {
    name: "409, then a GET carrying our link, exits 0",
    respond: ({ req, res, posted }) =>
      req.method === "POST" ? send(res, 409, { message: "Release already exists" }) : send(res, 200, echo(posted)),
    code: 0,
    requests: [`POST ${RELEASES}`, `GET ${EXISTING}`],
    outHas: ["already exists with this asset link"],
  },
  {
    name: "409, then a GET without our link, exits 1",
    respond: ({ req, res, posted }) =>
      req.method === "POST" ? send(res, 409, { message: "Release already exists" }) : send(res, 200, withOtherLink(posted)),
    code: 1,
    requests: [`POST ${RELEASES}`, `GET ${EXISTING}`],
    outHas: ["exists WITHOUT", "Release links API"],
  },
  {
    // The GET after a 409 must not follow a redirect either: here the moved
    // location would CONFIRM, so a followed GET exits 0 on a Release nobody read.
    name: "409, then a GET answering 307, exits 2 and does NOT follow it",
    respond: ({ req, res, posted }) => {
      if (req.method === "POST") return send(res, 409, { message: "Release already exists" });
      if (req.url === EXISTING) return send(res, 307, "", { Location: MOVED });
      return send(res, 200, echo(posted));
    },
    code: 2,
    requests: [`POST ${RELEASES}`, `GET ${EXISTING}`],
    outHas: ["returned HTTP 307, not 200"],
  },
  {
    name: "403 exits 1 with the Developer+ advice",
    respond: ({ res }) => send(res, 403, { message: "403 Forbidden" }),
    code: 1,
    requests: [`POST ${RELEASES}`],
    outHas: ["API refused: HTTP 403", "Developer+"],
  },
  {
    name: "429 exits 2 (transient)",
    respond: ({ res }) => send(res, 429, { message: "Retry later" }),
    code: 2,
    requests: [`POST ${RELEASES}`],
    outHas: ["HTTP 429 is transient"],
  },
  {
    name: "500 exits 2",
    respond: ({ res }) => send(res, 500, { message: "500 Internal Server Error" }),
    code: 2,
    requests: [`POST ${RELEASES}`],
    outHas: ["HTTP 500"],
  },
  {
    name: "400 whose body echoes the token exits 1, with the token redacted",
    respond: ({ req, res }) => send(res, 400, { message: `bad request from token ${req.headers["job-token"]}` }),
    code: 1,
    requests: [`POST ${RELEASES}`],
    outHas: ["API refused: HTTP 400", "bad request from token [REDACTED]"],
  },
  {
    // `{"message":"` is 12 chars, so 1983 filler puts the token at char 1995,
    // straddling the CLI's 2000-char excerpt cut. Truncate-then-redact would
    // leave "canar" in the output; redact-then-truncate cuts the MARKER.
    name: "a token straddling the 2000-char excerpt cut leaks no prefix",
    respond: ({ req, res }) => send(res, 400, { message: `${"y".repeat(1983)}${req.headers["job-token"]} tail` }),
    code: 1,
    requests: [`POST ${RELEASES}`],
    outHas: ["yyyyy[REDA"],
  },
  {
    // The API would CONFIRM a POST, so only the guard keeps this at 2.
    name: "--dryrun (a typo) exits 2 and sends nothing",
    args: ["--dryrun"],
    respond: ({ res, posted }) => send(res, 201, echo(posted)),
    code: 2,
    requests: [],
    outHas: ["unknown argument(s) --dryrun"],
  },
  {
    name: "--dry-run exits 0 and sends nothing",
    args: ["--dry-run"],
    respond: ({ res, posted }) => send(res, 201, echo(posted)),
    code: 0,
    requests: [],
    outHas: ["--dry-run, nothing sent", "JOB-TOKEN present"],
  },
  {
    name: "trailing slashes on CI_API_V4_URL do not reach the request path",
    apiSuffix: "//",
    respond: ({ res, posted }) => send(res, 201, echo(posted)),
    code: 0,
    requests: [`POST ${RELEASES}`],
    outHas: [`created release for ${TAG}`],
  },
  {
    // Nothing listens, so fetch itself throws and the CLI's catch decides:
    // exit 2, retry-safe — never 1, the refusal code.
    name: "a network failure exits 2 from the catch",
    closedApi: true,
    respond: ({ res, posted }) => send(res, 201, echo(posted)),
    code: 2,
    requests: [],
    outHas: ["CANNOT PUBLISH: TypeError: fetch failed"],
  },
  {
    // Without the missing-env check the POST goes to .../projects/undefined/
    // releases, which the fake API 404s: a refusal, exit 1.
    name: "CI_PROJECT_ID unset exits 2 and sends nothing",
    env: { CI_PROJECT_ID: undefined },
    respond: ({ res, posted }) => send(res, 201, echo(posted)),
    code: 2,
    requests: [],
    outHas: ["CANNOT PUBLISH: missing CI_PROJECT_ID"],
  },
  {
    // The API would CONFIRM a POST, so only the lib's tag guard keeps this at 2.
    name: "a tag that is not v + APP_VERSION exits 2 and sends nothing",
    env: { CI_COMMIT_TAG: `${TAG}-not-this-version` },
    respond: ({ res, posted }) => send(res, 201, echo(posted)),
    code: 2,
    requests: [],
    outHas: [`CI_COMMIT_TAG "${TAG}-not-this-version" is not "${TAG}"`],
  },
];

describe("publish-release.mjs against a fake Releases API", () => {
  it.each(ROWS)("$name", async ({ respond, args = [], apiSuffix = "", env = {}, closedApi = false, code, requests, outHas }) => {
    api = await startApi(respond);
    const r = await runCli(closedApi ? await closedApiUrl() : `${api.url}${apiSuffix}`, args, env);
    // Requests first: a wrong URL or a followed redirect shows up here, by name.
    expect(api.requests).toEqual(requests);
    expect(r.code, r.out).toBe(code);
    for (const text of outHas) expect(r.out).toContain(text);
    // The canary must never reach the output — not whole, and not as a prefix.
    expect(r.out).not.toContain(TOKEN);
    expect(r.out).not.toContain("canar");
  });
});
