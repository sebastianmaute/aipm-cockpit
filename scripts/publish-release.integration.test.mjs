// @vitest-environment node
//
// scripts/publish-release.mjs END TO END: the real CLI, spawned as a child
// process, against a fake Releases API on an ephemeral loopback port.
//
// ★★ The classifiers have their own unit tests; THIS file covers what only a
// real run can see — `redirect: "manual"`, the unknown-argument guard, the
// trailing-slash strip, and redaction of an echoed body BEFORE it is cut to
// its excerpt. Each of those was mutation-proved against this file.
//
// ★ The child is started with async `spawn`, never `spawnSync`: the fake API
// lives in THIS process, and a synchronous spawn would block the event loop
// that has to answer the child's request.
//
// ★ Every CI_* variable is stripped from the child's environment before the
// fake ones are set, so a real CI_JOB_TOKEN from the pipeline running this
// test can never reach the child — and the canary is the only token it sees.
import { spawn } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const CLI = fileURLToPath(new URL("./publish-release.mjs", import.meta.url));
const TOKEN = "canary-not-a-token";
const RELEASES = "/api/v4/projects/1/releases";
const EXISTING = `${RELEASES}/v0.301.0`;
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

/**
 * Start the fake API. `respond({ req, res, posted, body })` answers each
 * request; `posted` is the payload of the first POST to the releases endpoint.
 */
async function startApi(respond) {
  const requests = [];
  let posted = null;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push(`${req.method} ${req.url}`);
      if (req.method === "POST" && req.url === RELEASES && posted === null) posted = JSON.parse(body);
      respond({ req, res, posted, body });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, requests, url: `http://127.0.0.1:${server.address().port}/api/v4` };
}

function runCli(apiUrl, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("CI_")));
  Object.assign(env, {
    CI_PROJECT_URL: "https://gitlab.example/g/p",
    CI_COMMIT_TAG: "v0.301.0",
    CI_PROJECT_ID: "1",
    CI_API_V4_URL: apiUrl,
    CI_JOB_TOKEN: TOKEN,
  });
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
    outHas: ["created release for v0.301.0"],
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
    outHas: ["created release for v0.301.0"],
  },
];

describe("publish-release.mjs against a fake Releases API", () => {
  it.each(ROWS)("$name", async ({ respond, args = [], apiSuffix = "", code, requests, outHas }) => {
    api = await startApi(respond);
    const r = await runCli(`${api.url}${apiSuffix}`, args);
    expect(r.code, r.out).toBe(code);
    expect(api.requests).toEqual(requests);
    for (const text of outHas) expect(r.out).toContain(text);
    // The canary must never reach the output — not whole, and not as a prefix.
    expect(r.out).not.toContain(TOKEN);
    expect(r.out).not.toContain("canar");
  });
});
