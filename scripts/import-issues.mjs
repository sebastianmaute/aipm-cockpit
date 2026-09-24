// CLI for importing the register's open GitLab issues into a fresh GitHub repository with
// their numbers preserved (sub-project 4 spec,
// docs/superpowers/specs/2026-09-23-issues-migration-design.md). Implements `--plan` (read
// GitLab's issue list and the register, plan with the pure lib (issue-import-lib.mjs),
// leak-scan the plan (identifier-leak-lib.mjs), write the plan JSON), `--apply` (replay a
// written plan onto a real GitHub repo through issue-import-apply.mjs's `applyPlan`, with a
// real `fetch`-based GitHub client) and `--close-gitlab` (mark the GitLab originals moved,
// through `closeOnGitLab` and a `glab`-based GitLab client). No shebang: this file is a CLI
// run by node, never imported.
//
// Usage:
//   node scripts/import-issues.mjs --plan --out <file> --repo <owner/name> \
//     --pointer anchor|search [--gitlab-json <file>]
//   node scripts/import-issues.mjs --apply --plan <file> --repo <owner/name> [--resume]
//   node scripts/import-issues.mjs --close-gitlab --plan <file> --repo <owner/name>
//
// `--gitlab-json <file>` reads the GitLab issue list from that file instead of paging
// `glab api`. Tests use it; so does a dry run against a saved snapshot.
//
// `--plan` is overloaded: bare (followed by another flag or nothing) it SELECTS the plan
// mode, exactly as `--apply`/`--close-gitlab` do; followed by a bare value it instead NAMES
// the plan JSON to read for `--apply`/`--close-gitlab`. `--resume` is a modifier, not a mode
// — it is only valid together with `--apply`, and is passed through to `applyPlan` as
// `resume: true` so a crashed run can be replayed onto the issues it already created.
//
// `--apply`'s guards run in this order, all before any client is built or any network call:
// the plan's own recorded leak scan, its registerSha against the live register, its repoUrl
// against `--repo`, and a fresh re-scan of the plan's actions for a leak (defence against a
// plan hand-edited after `--plan` wrote it) — all local; only then a paged `glab` listing
// (the same one `--plan` uses) to find GitLab's live highest issue number and compare it
// against the plan's maxNumber (still before any GitHub call). `--close-gitlab` runs the
// same repoUrl-vs-`--repo` check, then lists the GitHub issues and refuses unless every
// planned `open` #N exists there, open, with its planned title (`verifyImported`) — both
// before its own first `glab` call, since it is not idempotent to recover from: it comments
// on and closes the GitLab originals. Both modes also refuse a plan whose `version` is not
// 1. Any of these failing is a refusal (exit 1), not a crash.
//
// GH_TOKEN, if set, is used as the GitHub token; otherwise `gh auth token` supplies it. The
// token is never logged, and any GitHub API error body echoed here has it redacted first
// (before being capped to 500 characters, so a token straddling the cut can't leak a tail).
//
// LEAK_LIST_FILE must name the identifier list (kept outside the repo) or the command exits
// 2. Checked by `--plan` (the planned actions) and again by `--apply` (a live re-scan of the
// plan file's actions, in case it was edited after `--plan` wrote it); `--close-gitlab`
// doesn't leak-scan — it posts no new text, only a fixed "moved to GitHub #N" comment.
//
// EXIT CODES:
//   0  the plan was written / applied / the GitLab originals were closed
//   1  REFUSED: the plan would leak an identifier (stdout names the hit action numbers and
//      classes, never the matched text), or an `--apply` guard fired (stale/mismatched plan)
//   2  CANNOT RUN: bad, missing or unknown arguments, an unimplemented mode, an unreadable
//      register/leak list/plan file, a malformed GitLab issue list, a planner failure (e.g.
//      an open issue naming an entry that is not OPEN), a `glab`/GitHub API failure, or any
//      other structural failure — including a renamed lib export, since the libs used only
//      by `--plan` are imported dynamically inside the try below
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { graphQLRateLimitMs, parseNextLink, rateLimitRetryMs, redactAndCap, toTrackerIssue } from "./github-issues-lib.mjs";
import { applyPlan, closeOnGitLab, RateLimited, Refused, verifyImported } from "./issue-import-apply.mjs";

const REGISTER = "docs/open-followups.md";
const PER_PAGE = 100;
const MAX_PAGES = 50;
const PLAN_VERSION = 1;
const GITHUB_API =
  process.env.IMPORT_ISSUES_TEST_GITHUB_API && process.env.VITEST
    ? process.env.IMPORT_ISSUES_TEST_GITHUB_API
    : "https://api.github.com";
const MODE_FLAGS = ["plan", "apply", "close-gitlab"];
const VALUE_FLAGS = { "--out": "out", "--repo": "repo", "--pointer": "pointer", "--gitlab-json": "gitlabJson" };
const REPO_RE = /^[^\s/]+\/[^\s/]+$/;

class CannotRun extends Error {}

// Test-only hook: when set, every `glab` call below runs `node <this path> <args>` instead
// of the real `glab` binary. This exists so a test can prove a guard fires before any real
// `glab`/network call, WITHOUT depending on whether the test machine happens to have `glab`
// on PATH (it may well be installed and authenticated in a dev/CI environment) and without
// needing a shell (a `.cmd`/`.bat` shim for a fake `glab` cannot be exec'd directly on
// Windows without one, and these calls deliberately use no shell). Never set this outside a
// test.
//
// GATED on `VITEST` (vitest sets this in its own process, and a CLI spawned from a test
// inherits it): the bare env-var check alone would otherwise substitute for `glab` in a REAL
// `--apply`/`--close-gitlab` run too, if the variable were ever set outside a test (a
// forgotten export from a local session, a copied `.env`, an inherited CI variable) — silently
// defeating both the maxNumber-vs-GitLab guard (an empty fake listing reads as "0 issues",
// which passes for any maxNumber) and every GitLab write `--close-gitlab` makes (comments and
// closes would be silently redirected while the tool reports success). `assertTestHooksAllowed`
// below refuses loudly instead of falling back silently when the hook is set without `VITEST`.
const FAKE_GLAB = process.env.IMPORT_ISSUES_TEST_FAKE_GLAB;

// Second test-only hook, same gate: points the GitHub client at a local fake server instead
// of api.github.com, so a test can drive `--close-gitlab`'s GitHub-side check without the
// network. Outside vitest it would send the token to an arbitrary URL, so it is refused
// there as loudly as the glab hook.
const FAKE_GITHUB_API = process.env.IMPORT_ISSUES_TEST_GITHUB_API;

function assertTestHooksAllowed() {
  if (FAKE_GLAB && !process.env.VITEST) {
    throw new CannotRun("IMPORT_ISSUES_TEST_FAKE_GLAB is a test-only hook and is refused outside vitest");
  }
  if (FAKE_GITHUB_API && !process.env.VITEST) {
    throw new CannotRun("IMPORT_ISSUES_TEST_GITHUB_API is a test-only hook and is refused outside vitest");
  }
}

function runGlab(args) {
  if (FAKE_GLAB && process.env.VITEST) return execFileSync(process.execPath, [FAKE_GLAB, ...args], { encoding: "utf8" });
  return execFileSync("glab", args, { encoding: "utf8" });
}

function parseArgs(argv) {
  const modes = [];
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--resume") {
      opts.resume = true;
      continue;
    }
    // `--plan` is dual-purpose: a value flag when a bare value follows (apply/close-gitlab
    // naming the plan file to read), a mode flag otherwise (plan generation) — see the header.
    if (arg === "--plan") {
      const value = argv[i + 1];
      if (value !== undefined && !value.startsWith("--")) {
        opts.planFile = value;
        i += 1;
        continue;
      }
      modes.push("plan");
      continue;
    }
    if (arg.startsWith("--") && MODE_FLAGS.includes(arg.slice(2))) {
      modes.push(arg.slice(2));
      continue;
    }
    if (arg in VALUE_FLAGS) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new CannotRun(`${arg} needs a value.`);
      }
      opts[VALUE_FLAGS[arg]] = value;
      i += 1;
      continue;
    }
    throw new CannotRun(`unknown flag ${arg}.`);
  }
  if (modes.length !== 1) {
    throw new CannotRun("exactly one of --plan, --apply, --close-gitlab is required.");
  }
  if (opts.resume && modes[0] !== "apply") {
    throw new CannotRun("--resume is only valid together with --apply.");
  }
  return { mode: modes[0], ...opts };
}

async function loadPatterns() {
  const { parseList, buildPatterns } = await import("./identifier-leak-lib.mjs");
  const listPath = process.env.LEAK_LIST_FILE;
  if (!listPath || listPath.trim() === "") {
    throw new CannotRun("LEAK_LIST_FILE is unset — point it at the identifier list (kept outside the repo).");
  }
  let text;
  try {
    text = readFileSync(listPath, "utf8");
  } catch (err) {
    throw new CannotRun(`the list named by LEAK_LIST_FILE is unreadable (${err.code ?? err.message}).`);
  }
  const entries = parseList(text);
  if (entries.length === 0) throw new CannotRun("the list named by LEAK_LIST_FILE holds no entries.");
  try {
    return buildPatterns(entries);
  } catch (err) {
    throw new CannotRun(`the list named by LEAK_LIST_FILE is malformed: ${err.message}.`);
  }
}

function toGitlabIssue(raw) {
  const ok =
    raw &&
    Number.isInteger(raw.iid) &&
    typeof raw.state === "string" &&
    typeof raw.title === "string" &&
    Array.isArray(raw.labels);
  if (!ok) {
    throw new CannotRun("a GitLab issue in the list lacks an integer iid, a state, a title or a labels array.");
  }
  return { iid: raw.iid, state: raw.state, title: raw.title, labels: raw.labels.map(String) };
}

function fetchGitlabIssuesFromApi() {
  const issues = [];
  let page = 1;
  for (;;) {
    let out;
    try {
      out = runGlab(["api", `projects/:id/issues?state=all&per_page=${PER_PAGE}&page=${page}`]);
    } catch (err) {
      throw new CannotRun(`glab api page ${page} failed (${err.message.split("\n")[0]}).`);
    }
    let batch;
    try {
      batch = JSON.parse(out);
    } catch {
      throw new CannotRun(`glab api page ${page} did not return JSON.`);
    }
    if (!Array.isArray(batch)) throw new CannotRun(`glab api page ${page} did not return a JSON array.`);
    if (batch.length === 0) break;
    issues.push(...batch);
    page += 1;
    if (page > MAX_PAGES) throw new CannotRun(`glab issue listing exceeded ${MAX_PAGES} pages.`);
  }
  return issues;
}

function readGitlabIssues(gitlabJsonPath) {
  let raw;
  if (gitlabJsonPath) {
    let text;
    try {
      text = readFileSync(gitlabJsonPath, "utf8");
    } catch (err) {
      throw new CannotRun(`--gitlab-json file is unreadable (${err.code ?? err.message}).`);
    }
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new CannotRun(`--gitlab-json file is not valid JSON (${err.message}).`);
    }
  } else {
    raw = fetchGitlabIssuesFromApi();
  }
  if (!Array.isArray(raw)) throw new CannotRun("the GitLab issue list is not a JSON array.");
  return raw.map(toGitlabIssue);
}

function readRegisterText() {
  try {
    return readFileSync(REGISTER, "utf8");
  } catch (err) {
    throw new CannotRun(`${REGISTER} is unreadable (${err.code ?? err.message}).`);
  }
}

function registerSha() {
  try {
    return execFileSync("git", ["hash-object", REGISTER], { encoding: "utf8" }).trim();
  } catch (err) {
    throw new CannotRun(`git hash-object ${REGISTER} failed (${err.message.split("\n")[0]}).`);
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function tally(actions) {
  const counts = { open: 0, stub: 0, placeholder: 0 };
  for (const a of actions) counts[a.kind] += 1;
  return counts;
}

async function planMode(opts) {
  if (!opts.out) throw new CannotRun("--out is required.");
  if (!opts.repo || !REPO_RE.test(opts.repo)) throw new CannotRun("--repo must be owner/name.");
  if (opts.pointer !== "anchor" && opts.pointer !== "search") {
    throw new CannotRun("--pointer must be anchor or search.");
  }

  const { planImport, leakCheckPlan } = await import("./issue-import-lib.mjs");
  const patterns = await loadPatterns();
  const gitlabIssues = readGitlabIssues(opts.gitlabJson);
  const registerText = readRegisterText();
  const sha = registerSha();
  const repoUrl = `https://github.com/${opts.repo}`;
  const date = today();

  const actions = planImport(gitlabIssues, registerText, { repoUrl, pointerStyle: opts.pointer, date });
  const leak = leakCheckPlan(actions, patterns);

  if (leak.hitLines > 0) {
    for (const [cls, count] of Object.entries(leak.classes)) {
      console.log(`LEAK class=${cls} count=${count}`);
    }
    console.log(`LEAK actions ${leak.actionsHit.map((n) => `#${n}`).join(", ")}`);
    return 1;
  }

  const counts = tally(actions);
  const maxNumber = Math.max(0, ...actions.map((a) => a.n));
  const plan = {
    version: PLAN_VERSION,
    createdAt: date,
    registerSha: sha,
    maxNumber,
    pointerStyle: opts.pointer,
    repoUrl,
    counts,
    leak,
    actions,
  };
  writeFileSync(opts.out, `${JSON.stringify(plan, null, 2)}\n`);
  console.log(`open ${counts.open} · stub ${counts.stub} · placeholder ${counts.placeholder} · total ${actions.length}`);
  return 0;
}

function readPlanFile(planFile) {
  let text;
  try {
    text = readFileSync(planFile, "utf8");
  } catch (err) {
    throw new CannotRun(`--plan file is unreadable (${err.code ?? err.message}).`);
  }
  let plan;
  try {
    plan = JSON.parse(text);
  } catch (err) {
    throw new CannotRun(`--plan file is not valid JSON (${err.message}).`);
  }
  const ok =
    plan &&
    typeof plan === "object" &&
    plan.leak &&
    typeof plan.leak.hitLines === "number" &&
    typeof plan.registerSha === "string" &&
    typeof plan.repoUrl === "string" &&
    typeof plan.maxNumber === "number" &&
    Array.isArray(plan.actions);
  if (!ok) {
    throw new CannotRun(
      "--plan file is missing or misshapes a required field (leak.hitLines, registerSha, repoUrl, maxNumber, actions).",
    );
  }
  // Only format 1 exists. A plan written by some later format would otherwise be replayed
  // under this version's reading of its fields — refused, not guessed at.
  if (plan.version !== PLAN_VERSION) {
    throw new Refused(`the plan's version is ${JSON.stringify(plan.version)}; this tool reads version ${PLAN_VERSION} only.`);
  }
  return plan;
}

function repoFromUrl(repoUrl) {
  const m = /^https:\/\/github\.com\/([^\s/]+\/[^\s/]+)$/.exec(repoUrl);
  if (!m) {
    throw new CannotRun(`the plan's repoUrl "${repoUrl}" is not a recognised https://github.com/<owner>/<name> URL.`);
  }
  return m[1];
}

// One-off check, run right before `--apply` builds a GitHub client: GitLab's own highest
// issue number must not have grown past the plan's maxNumber since the plan was written,
// or a placeholder/open/stub number the plan assigned could collide with a real GitLab
// issue nobody has imported yet.
//
// This does NOT sort server-side by iid: GitLab's List project issues endpoint does not
// accept `order_by=iid` (confirmed against a real GitLab instance — Grape rejects it with
// a 400; its documented `order_by` values are created_at/due_date/label_priority/
// milestone_due/popularity/priority/relative_position/title/updated_at/weight). Instead
// this reuses the same paged, capped `state=all` listing `--plan` already implements
// (`fetchGitlabIssuesFromApi`) and takes the max iid client-side, which is correct
// regardless of server-side ordering.
function fetchGitlabHighestIssueNumber() {
  let highest = 0;
  for (const raw of fetchGitlabIssuesFromApi()) {
    const iid = raw?.iid;
    if (!Number.isInteger(iid)) throw new CannotRun("a GitLab issue in the listing lacks an integer iid.");
    if (iid > highest) highest = iid;
  }
  return highest;
}

function realSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getGithubToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch (err) {
    throw new CannotRun(`gh auth token failed (${err.message.split("\n")[0]}).`);
  }
}

async function githubRequest(url, token, { method = "GET", body } = {}) {
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  if (!res.ok) {
    let rawBody = "";
    try {
      rawBody = await res.text();
    } catch {
      // leave rawBody empty — nothing more to report
    }
    // The raw body, not the capped one: a secondary-limit 403 with no header is told apart
    // from a permission 403 only by its message (see rateLimitRetryMs).
    const retry = rateLimitRetryMs(res.status, res.headers, rawBody);
    // Redact THEN cap — capping first can leave a token's tail exposed when it straddles
    // the 500-character cut (see github-issues-lib.mjs's redactAndCap docstring).
    const bodyText = redactAndCap(rawBody, token);
    if (retry !== null) throw new RateLimited(`GitHub ${method} ${url} -> ${res.status}: ${bodyText}`, retry);
    throw new Error(`GitHub ${method} ${url} -> ${res.status}: ${bodyText}`);
  }
  return res;
}

async function githubGraphQL(token, query, variables) {
  const res = await githubRequest(`${GITHUB_API}/graphql`, token, { method: "POST", body: { query, variables } });
  const json = await res.json();
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    const rateLimitMs = graphQLRateLimitMs(json.errors, res.headers);
    const errorText = redactAndCap(JSON.stringify(json.errors), token);
    if (rateLimitMs !== null) throw new RateLimited(`GitHub GraphQL rate limited: ${errorText}`, rateLimitMs);
    throw new Error(`GitHub GraphQL error: ${errorText}`);
  }
  return json.data;
}

/** The real GitHub client `applyPlan` drives for `--apply`, and whose `listIssues` feeds
 *  `--close-gitlab`'s `verifyImported`. Every guard that can run without it
 *  (leak/registerSha/repo-match/maxNumber-vs-GitLab for `--apply`, repo-match for
 *  `--close-gitlab`) has already run by the time this is built. */
function makeGitHubClient(repo, token) {
  const [owner, name] = repo.split("/");
  return {
    async counts() {
      const data = await githubGraphQL(
        token,
        "query($o:String!,$r:String!){repository(owner:$o,name:$r){issues{totalCount} pullRequests{totalCount}}}",
        { o: owner, r: name },
      );
      return { issues: data.repository.issues.totalCount, pulls: data.repository.pullRequests.totalCount };
    },
    async listIssues() {
      const out = [];
      let url = `${GITHUB_API}/repos/${repo}/issues?state=all&per_page=${PER_PAGE}`;
      for (let page = 0; url; page += 1) {
        if (page >= MAX_PAGES) throw new CannotRun(`GitHub issue listing exceeded ${MAX_PAGES} pages.`);
        const res = await githubRequest(url, token);
        const batch = await res.json();
        for (const raw of batch) {
          if (toTrackerIssue(raw) === null) continue; // a pull request
          out.push({ number: raw.number, title: raw.title, state: raw.state, nodeId: raw.node_id });
        }
        url = parseNextLink(res.headers.get("link"));
      }
      return out;
    },
    async ensureLabels(names) {
      const existing = new Set();
      let url = `${GITHUB_API}/repos/${repo}/labels?per_page=${PER_PAGE}`;
      for (let page = 0; url; page += 1) {
        if (page >= MAX_PAGES) throw new CannotRun(`GitHub label listing exceeded ${MAX_PAGES} pages.`);
        const res = await githubRequest(url, token);
        const batch = await res.json();
        for (const label of batch) existing.add(label.name);
        url = parseNextLink(res.headers.get("link"));
      }
      for (const labelName of names) {
        if (existing.has(labelName)) continue;
        await githubRequest(`${GITHUB_API}/repos/${repo}/labels`, token, { method: "POST", body: { name: labelName } });
      }
    },
    // Both `createIssue` and `closeIssue` pace themselves at 1100ms — GitHub's secondary
    // rate limit on content-generating requests. A full run of the spec's own counts is
    // roughly 397 creates + 92 closes + 37 deletes + ~23 labels — about 530 writes, above
    // the documented 500-per-hour secondary limit, so expect at least one 403/429 — with a
    // `retry-after`, or a 403 naming the secondary limit with none, which waits 60 s
    // (`rateLimitRetryMs`); `withRetry` (issue-import-apply.mjs) waits it out, and `--resume`
    // covers a hard stop if the process dies instead.
    async createIssue({ title, body, labels }) {
      const res = await githubRequest(`${GITHUB_API}/repos/${repo}/issues`, token, {
        method: "POST",
        body: { title, body, labels },
      });
      const data = await res.json();
      // Only a SUCCESSFUL create paces itself — a failed create throws out of `githubRequest`
      // before this line, and its own retry (via `withRetry`) already carries a wait.
      await realSleep(1100);
      return { number: data.number, nodeId: data.node_id };
    },
    async closeIssue(number) {
      await githubRequest(`${GITHUB_API}/repos/${repo}/issues/${number}`, token, {
        method: "PATCH",
        body: { state: "closed", state_reason: "not_planned" },
      });
      await realSleep(1100);
    },
    async deleteIssue(nodeId) {
      await githubGraphQL(token, "mutation($id:ID!){deleteIssue(input:{issueId:$id}){clientMutationId}}", { id: nodeId });
    },
  };
}

function glabApiCall(iid, args) {
  try {
    return runGlab(args);
  } catch {
    // Nothing of the response is printed here except the iid — the underlying `glab`
    // error can carry response bodies we don't want to echo.
    throw new CannotRun(`glab api failed for GitLab #${iid}.`);
  }
}

/** The real GitLab client `closeOnGitLab` drives for `--close-gitlab`. */
function makeGitLabClient() {
  return {
    // Pages through ALL of an issue's notes: `closeOnGitLab` decides whether the pointer
    // comment is already there, and reading only the first page would post it a second time
    // on an issue with more than PER_PAGE notes. A page shorter than PER_PAGE is the last.
    async get(iid) {
      let issue;
      const notes = [];
      try {
        issue = JSON.parse(glabApiCall(iid, ["api", `projects/:id/issues/${iid}`]));
        for (let page = 1; ; page += 1) {
          if (page > MAX_PAGES) throw new CannotRun(`GitLab #${iid}'s notes exceeded ${MAX_PAGES} pages.`);
          const batch = JSON.parse(
            glabApiCall(iid, ["api", `projects/:id/issues/${iid}/notes?per_page=${PER_PAGE}&page=${page}`]),
          );
          if (!Array.isArray(batch)) throw new CannotRun(`glab api returned a non-array notes page for GitLab #${iid}.`);
          notes.push(...batch.map((n) => n.body));
          if (batch.length < PER_PAGE) break;
        }
      } catch (err) {
        if (err instanceof CannotRun) throw err;
        throw new CannotRun(`glab api returned unparsable JSON for GitLab #${iid}.`);
      }
      return { state: issue.state, notes };
    },
    async comment(iid, body) {
      glabApiCall(iid, ["api", "-X", "POST", `projects/:id/issues/${iid}/notes`, "-f", `body=${body}`]);
    },
    async close(iid) {
      glabApiCall(iid, ["api", "-X", "PUT", `projects/:id/issues/${iid}`, "-f", "state_event=close"]);
    },
  };
}

// Re-scans the plan's OWN actions with the live identifier-leak list, independent of the
// plan file's self-reported `leak` field (defence in depth: a plan edited by hand after
// `--plan` wrote it — to fix a title, say — carries whatever `leak.hitLines` the planner
// last computed, not a re-check of the edit). Same exit codes as `--plan`'s own leak check:
// CannotRun (exit 2) if LEAK_LIST_FILE is unset/unreadable/malformed, Refused (exit 1) on
// any hit.
async function rescanPlanLeak(plan) {
  const { leakCheckPlan } = await import("./issue-import-lib.mjs");
  const patterns = await loadPatterns();
  const leak = leakCheckPlan(plan.actions, patterns);
  if (leak.hitLines > 0) {
    throw new Refused(
      `re-scanning the plan's actions found ${leak.hitLines} leak hit line(s) across ` +
        `#${leak.actionsHit.join(", #")} — the plan file may have been edited after \`--plan\` wrote it; ` +
        "regenerate it.",
    );
  }
}

async function applyMode(opts) {
  if (!opts.planFile) throw new CannotRun("--plan is required.");
  if (!opts.repo || !REPO_RE.test(opts.repo)) throw new CannotRun("--repo must be owner/name.");

  const plan = readPlanFile(opts.planFile);

  // These local guards need no network at all — they run first, in this order, always
  // before the paged `glab` listing below and before any GitHub call.
  if (plan.leak.hitLines !== 0) {
    throw new Refused(
      `the plan has ${plan.leak.hitLines} leak hit line(s) across #${plan.leak.actionsHit?.join(", #")} — ` +
        "regenerate a clean plan before applying it.",
    );
  }
  const currentSha = registerSha();
  if (plan.registerSha !== currentSha) {
    throw new Refused(
      `the register has changed since the plan was written (plan ${plan.registerSha}, now ${currentSha}) — ` +
        "regenerate the plan.",
    );
  }
  const planRepo = repoFromUrl(plan.repoUrl);
  if (opts.repo !== planRepo) {
    throw new Refused(`--repo ${opts.repo} does not match the plan's repo ${planRepo}.`);
  }
  await rescanPlanLeak(plan);

  // Needs `glab` (a paged listing, not a single call — see fetchGitlabHighestIssueNumber's
  // own comment), so it runs after every local check above, but still before any GitHub call.
  const gitlabHighest = fetchGitlabHighestIssueNumber();
  if (plan.maxNumber < gitlabHighest) {
    throw new Refused(
      `the plan's maxNumber (${plan.maxNumber}) is below GitLab's current highest issue number ` +
        `(${gitlabHighest}) — regenerate the plan.`,
    );
  }

  const client = makeGitHubClient(opts.repo, getGithubToken());
  const result = await applyPlan(plan.actions, client, { resume: !!opts.resume, sleep: realSleep, log: console.log });
  console.log(`created ${result.created} · closed ${result.closed} · deleted ${result.deleted}`);
  return 0;
}

async function closeGitlabMode(opts) {
  if (!opts.planFile) throw new CannotRun("--plan is required.");
  if (!opts.repo || !REPO_RE.test(opts.repo)) throw new CannotRun("--repo must be owner/name.");

  const plan = readPlanFile(opts.planFile);
  // Same repo-match guard `--apply` runs, before any glab call: this step comments on and
  // closes GitLab issues with a link to `--repo`'s GitHub URL, and is not idempotent to
  // recover from — a typo'd `--repo` would post and close against the wrong repository.
  const planRepo = repoFromUrl(plan.repoUrl);
  if (opts.repo !== planRepo) {
    throw new Refused(`--repo ${opts.repo} does not match the plan's repo ${planRepo}.`);
  }

  // The GitHub side must already be what the plan says, before the first GitLab write: every
  // planned `open` #N exists, is open and carries its planned title (verifyImported). Run
  // after a partial or failed `--apply`, or against a repository not yet imported, this
  // step would otherwise post ~270 pointers to missing or wrong issues and close the
  // originals — undone only by hand, one issue at a time.
  const github = makeGitHubClient(opts.repo, getGithubToken());
  const verified = verifyImported(plan.actions, await github.listIssues());
  console.log(`verified ${verified} imported issue(s) on GitHub`);

  const githubUrl = `https://github.com/${opts.repo}`;
  const gitlab = makeGitLabClient();
  const result = await closeOnGitLab(plan.actions, gitlab, { githubUrl, log: console.log });
  console.log(`closed ${result.closed} · skipped ${result.skipped}`);
  return 0;
}

async function main() {
  // Checked before anything else, including argument parsing: a misconfigured test-only
  // hook must never silently fall through to a real `glab` call in any mode.
  assertTestHooksAllowed();
  const opts = parseArgs(process.argv.slice(2));
  if (opts.mode === "plan") return planMode(opts);
  if (opts.mode === "apply") return applyMode(opts);
  return closeGitlabMode(opts);
}

try {
  process.exitCode = await main();
} catch (err) {
  if (err instanceof Refused) {
    console.error(`REFUSED: ${err.message}`);
    process.exitCode = 1;
  } else {
    console.error(`CANNOT RUN: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 2;
  }
}
