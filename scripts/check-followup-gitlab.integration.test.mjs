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
import { readFileSync } from "node:fs";
import http from "node:http";
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
afterEach(async () => {
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

/** ★ An `overrides` value of `undefined` DELETES that variable from the child's env. */
function runCli(apiUrl, overrides = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("CI_") && k !== "REGISTER_SYNC_TOKEN"),
  );
  Object.assign(env, { CI_PROJECT_ID: "1", CI_API_V4_URL: apiUrl, REGISTER_SYNC_TOKEN: TOKEN });
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI], { cwd: REPO, env });
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
    name: "fewer than 50 open issues exits 2 — a wrong-project token, not drift",
    respond: paged(REAL.slice(0, 10)),
    code: 2,
    requests: [pageReq(1)],
    outHas: ["fetched only 10 open issues (floor is 50)"],
  },
  {
    name: "a body that is not an array exits 2",
    respond: ({ res }) => send(res, 200, { message: "not a list" }),
    code: 2,
    requests: [pageReq(1)],
    outHas: ["page 1 is not a JSON array"],
  },
];

describe("check-followup-gitlab.mjs against a fake Issues API", () => {
  it.each(ROWS)("$name", async ({ respond, env = {}, code, requests, outHas }) => {
    api = await startApi(respond);
    const r = await runCli(api.url, env);
    if (requests) expect(api.requests).toEqual(requests);
    expect(r.code, r.out).toBe(code);
    for (const text of outHas) expect(r.out).toContain(text);
    // The token header was the canary on every request that was sent.
    for (const t of api.tokens) expect(t).toBe(TOKEN);
    expect(r.out).not.toContain(TOKEN);
    expect(r.out).not.toContain("canar");
  });

  it("the register yields enough linked issues to span three pages", () => {
    expect(REAL.length).toBeGreaterThan(200);
  });
});
