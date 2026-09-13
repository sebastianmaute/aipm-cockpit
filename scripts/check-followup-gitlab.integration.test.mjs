// @vitest-environment node
//
// scripts/check-followup-gitlab.mjs END TO END: the real CLI, spawned as a child
// process with cwd = the repo root (so it reads the REAL register), against a
// fake Issues API on an ephemeral loopback port.
//
// ★★ The in-sync issue list is BUILT FROM the real register (parseEntries +
// workItemLines + parseWorkItem), so it matches the tree without hardcoding a
// single iid, and stays green when an entry is added or closed.
//
// ★ Async `spawn`, never `spawnSync`: the fake API lives in THIS process, and a
// synchronous spawn would block the event loop that has to answer the child.
//
// ★ Every CI_* variable and any real REGISTER_SYNC_TOKEN are stripped from the
// child's environment, so the canary is the only token the child can see.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { isClosed, parseEntries } from "./followup-claims-lib.mjs";
import { parseWorkItem, workItemLines } from "./followup-workitem-lib.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const CLI = fileURLToPath(new URL("./check-followup-gitlab.mjs", import.meta.url));
const TOKEN = "canary-not-a-token";
const ISSUES = "/api/v4/projects/1/issues";
const MOVED = "/api/v4/moved";

/** One open issue per linked open entry, titled and labelled as the convention says. */
function issuesFromRegister() {
  const entries = parseEntries(readFileSync(path.join(REPO, "docs/open-followups.md"), "utf8"));
  const out = [];
  for (const e of entries) {
    if (isClosed(e.title)) continue;
    const lines = workItemLines(e);
    const w = lines.length === 1 ? parseWorkItem(lines[0]) : null;
    if (w?.kind !== "issue") continue;
    out.push({ iid: w.iid, title: `§${e.n}: ${e.title.replace(/ — OPEN$/, "")}`, labels: ["source::register"] });
  }
  return out;
}
const REAL = issuesFromRegister();

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};

/** Serve `list` 100 per page, as GitLab does, with `x-next-page` unless told not to. */
function paged(list, { nextHeader = true } = {}) {
  return ({ res, url }) => {
    const page = Number(url.searchParams.get("page") ?? "1");
    const per = Number(url.searchParams.get("per_page") ?? "20");
    const slice = list.slice((page - 1) * per, page * per);
    const headers = {};
    if (nextHeader) headers["x-next-page"] = page * per < list.length ? String(page + 1) : "";
    send(res, 200, slice, headers);
  };
}

let api;
let resetServer;
const tempDirs = [];
afterEach(async () => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop(), { recursive: true, force: true });
  if (resetServer) {
    const s = resetServer;
    resetServer = undefined;
    await new Promise((resolve) => s.close(resolve));
  }
  if (!api) return;
  api.server.closeAllConnections();
  await new Promise((resolve) => api.server.close(resolve));
  api = undefined;
});

async function startApi(respond) {
  const requests = [];
  const tokens = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    requests.push(`${req.method} ${req.url}`);
    tokens.push(req.headers["private-token"]);
    if (url.pathname !== ISSUES && url.pathname !== MOVED) return send(res, 404, { message: "404 Not Found" });
    respond({ req, res, url });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, requests, tokens, url: `http://127.0.0.1:${server.address().port}/api/v4` };
}

/**
 * A loopback URL whose server accepts the TCP connection and destroys it at
 * once, so the CLI sees a network error deterministically. ★ Not a bound-then-
 * closed port: another process can take that port before the child connects.
 * Kept open for the test and closed in afterEach.
 */
async function resetOnConnectUrl() {
  const s = net.createServer((socket) => socket.destroy());
  await new Promise((resolve) => s.listen(0, "127.0.0.1", resolve));
  resetServer = s;
  return `http://127.0.0.1:${s.address().port}/api/v4`;
}

/** A temp cwd whose register holds only `count` open entries; removed in afterEach. */
function smallRegisterDir(count) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "followup-gitlab-"));
  tempDirs.push(dir);
  mkdirSync(path.join(dir, "docs"));
  let md = "# register\n\n";
  for (let i = 1; i <= count; i++) md += `## ${i}. entry ${i} — OPEN\n\n**Work item:** #${i}\n\n`;
  writeFileSync(path.join(dir, "docs", "open-followups.md"), md, "utf8");
  return dir;
}

/** ★ An `overrides` value of `undefined` DELETES that variable from the child's env. */
function runCli(apiUrl, overrides = {}, { args = [], cwd = REPO } = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("CI_") && k !== "REGISTER_SYNC_TOKEN"),
  );
  Object.assign(env, { CI_PROJECT_ID: "1", CI_API_V4_URL: apiUrl, REGISTER_SYNC_TOKEN: TOKEN });
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out }));
  });
}

const pageReq = (page) => `GET ${ISSUES}?state=opened&per_page=100&page=${page}`;
const pages = Math.ceil(REAL.length / 100);

const ROWS = [
  {
    name: "no token exits 0, says skipped, and sends nothing",
    env: { REGISTER_SYNC_TOKEN: undefined },
    respond: paged(REAL),
    code: 0,
    requests: [],
    outHas: ["skipped: REGISTER_SYNC_TOKEN is not set"],
  },
  {
    name: "an EMPTY token also skips and sends nothing",
    env: { REGISTER_SYNC_TOKEN: "" },
    respond: paged(REAL),
    code: 0,
    requests: [],
    outHas: ["skipped: REGISTER_SYNC_TOKEN is not set"],
  },
  {
    name: "in sync across several pages exits 0, stopping on an empty x-next-page",
    respond: paged(REAL),
    code: 0,
    requests: Array.from({ length: pages }, (_, i) => pageReq(i + 1)),
    outHas: ["Register and GitLab agree.", `${REAL.length} open issues`],
  },
  {
    name: "without x-next-page it steps on until an empty page",
    respond: paged(REAL, { nextHeader: false }),
    code: 0,
    requests: Array.from({ length: pages + 1 }, (_, i) => pageReq(i + 1)),
    outHas: ["Register and GitLab agree."],
  },
  {
    name: "drift — a closed linked issue and an untitled register issue — exits 1 naming both",
    respond: paged([...REAL.slice(1), { iid: 999999, title: "stray", labels: ["source::register"] }]),
    code: 1,
    outHas: [`ISSUE_NOT_OPEN: ${REAL[0].title.split(":")[0]} → #${REAL[0].iid}`, "ISSUE_UNTITLED: #999999"],
  },
  {
    name: "401 whose body echoes the token exits 2 with the token redacted",
    respond: ({ req, res }) => send(res, 401, { message: `401 Unauthorized for ${req.headers["private-token"]}` }),
    code: 2,
    requests: [pageReq(1)],
    outHas: ["CANNOT COMPARE: page 1 answered HTTP 401", "401 Unauthorized for [REDACTED]"],
  },
  {
    // Followed, the redirect would land on a location that serves the real list
    // and exits 0 — so only `redirect: "manual"` keeps this at 2.
    name: "302 exits 2 and is NOT followed, even to a location that would agree",
    respond: ({ res, url }) =>
      url.pathname === ISSUES
        ? send(res, 302, "", { Location: `${MOVED}${url.search}` })
        : paged(REAL)({ res, url }),
    code: 2,
    requests: [pageReq(1)],
    outHas: ["HTTP 302 redirect"],
  },
  {
    name: "CI_PROJECT_ID unset with a token exits 2 and sends nothing",
    env: { CI_PROJECT_ID: undefined },
    respond: paged(REAL),
    code: 2,
    requests: [],
    outHas: ["CANNOT COMPARE: missing CI_PROJECT_ID"],
  },
  {
    name: "fewer than 50 register issues exits 2 — a blind fetch, not drift",
    respond: paged(REAL.slice(0, 10)),
    code: 2,
    requests: [pageReq(1)],
    outHas: ["fetched only 10 register issues among 10 open issues (floor is 50 register issues)"],
  },
  {
    // ★★ The floor counts REGISTER issues: counted over all open issues, these 60
    // would pass it and every entry would read ISSUE_NOT_OPEN — exit 1, 200+ findings.
    name: "60 unrelated open issues and no register issue exits 2, not drift",
    respond: paged(Array.from({ length: 60 }, (_, i) => ({ iid: 5000 + i, title: `bug ${i}`, labels: ["bug"] }))),
    code: 2,
    requests: [pageReq(1)],
    outHas: ["fetched only 0 register issues among 60 open issues"],
  },
  {
    name: "an issue served twice across pages exits 2 — the pages shifted, re-run",
    respond: ({ res, url }) =>
      url.searchParams.get("page") === "1"
        ? send(res, 200, REAL.slice(0, 100), { "x-next-page": "2" })
        : send(res, 200, REAL.slice(99), { "x-next-page": "" }),
    code: 2,
    requests: [pageReq(1), pageReq(2)],
    outHas: [`issue #${REAL[99].iid} was served twice — issues changed while paging; re-run`],
  },
  {
    name: "a body that is not an array exits 2",
    respond: ({ res }) => send(res, 200, { message: "not a list" }),
    code: 2,
    requests: [pageReq(1)],
    outHas: ["page 1 is not a JSON array"],
  },
  {
    // ★★★ fetch TRIMS a header value before quoting it in its error, so the old
    // `split(token)` redaction missed a padded token and leaked it verbatim.
    name: "a padded token with an embedded newline exits 2, sends nothing, and never prints it",
    env: { REGISTER_SYNC_TOKEN: "  canary-pad-head\ncanary-pad-tail  " },
    respond: paged(REAL),
    code: 2,
    requests: [],
    outHas: ["REGISTER_SYNC_TOKEN contains whitespace or a control character"],
    outLacks: [
      "  canary-pad-head\ncanary-pad-tail  ",
      "canary-pad-head\ncanary-pad-tail",
      "  canary-pad-head",
      "canary-pad-tail  ",
      "canary-pad-head",
      "canary-pad-tail",
    ],
  },
  {
    // `requests: []` is the fake API's log: zero successful responses.
    name: "a network error (connection reset on connect) exits 2",
    apiUrl: resetOnConnectUrl,
    respond: paged(REAL),
    code: 2,
    requests: [],
    outHas: ["CANNOT COMPARE: TypeError: fetch failed"],
  },
  {
    // ★★ Node clamps 3000000000 ms to 1 ms, so without the upper bound every
    // request "times out" and the message blames the network.
    name: "a REGISTER_SYNC_TIMEOUT_MS above 2^31-1 exits 2 on the value and sends nothing",
    env: { REGISTER_SYNC_TIMEOUT_MS: "3000000000" },
    respond: paged(REAL),
    code: 2,
    requests: [],
    outHas: ["REGISTER_SYNC_TIMEOUT_MS must be an integer from 1 to 2147483647"],
    outLacks: ["TimeoutError", "fetch failed"],
  },
  {
    name: "a server that never answers exits 2 on the timeout",
    env: { REGISTER_SYNC_TIMEOUT_MS: "300" },
    respond: () => {},
    code: 2,
    requests: [pageReq(1)],
    outHas: ["CANNOT COMPARE: TimeoutError"],
  },
  {
    name: "more than 50 pages exits 2",
    respond: ({ res, url }) => {
      const page = Number(url.searchParams.get("page"));
      send(res, 200, [{ iid: page, title: `§${page}: x`, labels: ["source::register"] }], {
        "x-next-page": String(page + 1),
      });
    },
    code: 2,
    requests: Array.from({ length: 50 }, (_, i) => pageReq(i + 1)),
    outHas: ["more than 50 pages of open issues"],
  },
  {
    name: "an x-next-page that does not advance exits 2",
    respond: ({ res }) => send(res, 200, REAL.slice(0, 100), { "x-next-page": "1" }),
    code: 2,
    requests: [pageReq(1)],
    outHas: ['x-next-page "1" does not advance'],
  },
  {
    name: "an unknown argument with a token exits 2 and sends nothing",
    args: ["--fix"],
    respond: paged(REAL),
    code: 2,
    requests: [],
    outHas: ["unknown argument(s) --fix"],
  },
  {
    name: "CI_API_V4_URL unset with a token exits 2 and sends nothing",
    env: { CI_API_V4_URL: undefined },
    respond: paged(REAL),
    code: 2,
    requests: [],
    outHas: ["CANNOT COMPARE: missing CI_API_V4_URL"],
  },
  {
    name: "fewer than 50 open entries exits 2 and sends nothing",
    cwd: () => smallRegisterDir(10),
    respond: paged(REAL),
    code: 2,
    requests: [],
    outHas: ["parsed only 10 open entries from docs/open-followups.md (floor is 50)"],
  },
  {
    // ★★ The canary starts 10 chars before the 2000-char excerpt cut. Redacted
    // AFTER truncation, its first 10 chars would survive and not match the token.
    name: "a long 401 body with the token straddling the excerpt cut leaks no prefix of it",
    respond: ({ res }) => send(res, 401, `${"x".repeat(1990)}${TOKEN}${"y".repeat(100)}`),
    code: 2,
    requests: [pageReq(1)],
    outHas: ["CANNOT COMPARE: page 1 answered HTTP 401", "[REDACTED"],
    outLacks: Array.from({ length: TOKEN.length - 7 }, (_, i) => TOKEN.slice(0, i + 8)),
  },
];

describe("check-followup-gitlab.mjs against a fake Issues API", () => {
  it.each(ROWS)("$name", async ({ respond, env = {}, args, cwd, apiUrl, code, requests, outHas, outLacks = [] }) => {
    api = await startApi(respond);
    const url = apiUrl ? await apiUrl() : api.url;
    const r = await runCli(url, env, { args, cwd: cwd ? cwd() : REPO });
    if (requests) expect(api.requests).toEqual(requests);
    expect(r.code, r.out).toBe(code);
    for (const text of outHas) expect(r.out).toContain(text);
    for (const text of outLacks) expect(r.out).not.toContain(text);
    // The token header was the canary on every request that was sent.
    for (const t of api.tokens) expect(t).toBe(TOKEN);
    expect(r.out).not.toContain(TOKEN);
    expect(r.out).not.toContain("canar");
  });

  it("the register yields enough linked issues to span three pages", () => {
    expect(REAL.length).toBeGreaterThan(200);
  });
});
