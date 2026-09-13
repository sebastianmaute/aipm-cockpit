#!/usr/bin/env node
// Compare docs/open-followups.md's Work item lines with the OPEN GitLab issues,
// in both directions. WARN-ONLY in CI (followups-gitlab-sync).
//
// EXIT CODES:
//   0  REGISTER_SYNC_TOKEN is unset or empty (a clean skip, checked FIRST so a
//      local run without a token never fails), or the register and GitLab agree
//   1  DRIFT: at least one problem from compareWithGitLab — fix the Work item
//      line or the issue
//   2  COULD NOT COMPARE: a token containing whitespace or a control character,
//      an unknown argument, missing CI_API_V4_URL or CI_PROJECT_ID, an unreadable
//      register, fewer than 50 open entries, a network failure, the timeout, a
//      non-2xx, a redirect, a body that is not a JSON array of issues, more than
//      50 pages, an issue served twice while paging, fewer than 50 REGISTER
//      issues, or any structural failure (a renamed lib export)
//
// ENVIRONMENT:
//   REGISTER_SYNC_TOKEN        the read_api token; unset or empty skips
//   CI_API_V4_URL, CI_PROJECT_ID  set by GitLab CI
//   REGISTER_SYNC_TIMEOUT_MS   optional per-request timeout, default 30000. It
//                              exists so the integration test can pin the timeout
//                              path in milliseconds; CI does not set it.
//
// ★★ The blocking followups-workitems-check reads the register ONLY. This is the
//   half it cannot do: an issue closed in the GitLab UI, an issue with the wrong
//   title, an issue with no entry. Every decision is made by the pure
//   compareWithGitLab in followup-workitem-lib.mjs; this file fetches, redacts,
//   prints, and maps a verdict to an exit code.
// ★★★ 50 REGISTER ISSUES, NOT 50 open issues and NOT 0 — the floor counts open
//   issues carrying a `§NNN:` title or the source::register label. A fetch that
//   returns no or few register issues (a token that cannot see confidential
//   issues, or register issues that lost both their title prefix and their label)
//   would make every entry read ISSUE_NOT_OPEN. That is a scan that could not see
//   the register's issues, not drift, so it is 2 — however many unrelated issues
//   came back beside them.
// ★★ Offset pagination is not a snapshot: an issue opened or closed mid-fetch
//   shifts the pages, so one issue can be served twice or skipped. A repeat is
//   detected (exit 2, re-run); a skip cannot be, and surfaces as a transient
//   ISSUE_NOT_OPEN that clears on the next run — tolerable because the job is
//   warn-only.
// ★★ `redirect: "manual"`, as in publish-release.mjs: a followed redirect reads
//   an answer from a URL nobody asked.
// ★★ The token is redacted out of every printed line and every body excerpt —
//   BEFORE truncation, so a token straddling the cut cannot leak a prefix — and
//   out of the caught error. Request headers are never printed.
// ★ The libraries are imported dynamically inside the one try, so a renamed
//   export exits 2 instead of Node's default 1, which here means DRIFT.
import { readFileSync } from "node:fs";

const REGISTER = "docs/open-followups.md";
const DEFAULT_TIMEOUT_MS = 30_000;
const BODY_EXCERPT_CHARS = 2000;
const PER_PAGE = 100;
const MAX_PAGES = 50;
const MIN_OPEN_ENTRIES = 50;
const MIN_REGISTER_ISSUES = 50;

const token = process.env.REGISTER_SYNC_TOKEN;
if (!token) {
  console.log("skipped: REGISTER_SYNC_TOKEN is not set, so the register was not compared with GitLab.");
  process.exit(0);
}
// ★★★ Before ANY use of the value. fetch's header validation TRIMS the value
// before quoting it in its error, so a padded token with an embedded newline
// escaped `split(token)` and leaked verbatim. No real token has whitespace or a
// control character, so refuse it here — and never print it.
if (/[\s\p{Cc}]/u.test(token)) {
  console.error(
    "CANNOT COMPARE: REGISTER_SYNC_TOKEN contains whitespace or a control character; re-enter the variable without it (the value is not printed).",
  );
  process.exit(2);
}

const redact = (s) => String(s).split(token).join("[REDACTED]");
const say = (msg) => console.log(redact(msg));

class CannotCompare extends Error {
  constructor(message, body) {
    super(message);
    this.body = body;
  }
}

function apiBase() {
  // ★ A backward scan, not `/\/+$/` — see publish-release.mjs for the measured
  // quadratic backtrack.
  const raw = process.env.CI_API_V4_URL ?? "";
  let end = raw.length;
  while (end > 0 && raw[end - 1] === "/") end--;
  return raw.slice(0, end);
}

function readOpenEntries(parseEntries, isClosed) {
  let src;
  try {
    src = readFileSync(REGISTER, "utf8");
  } catch (err) {
    throw new CannotCompare(`${REGISTER} is unreadable (${err.code ?? err.message})`);
  }
  const entries = parseEntries(src);
  const open = entries.filter((e) => !isClosed(e.title));
  if (open.length < MIN_OPEN_ENTRIES) {
    throw new CannotCompare(`parsed only ${open.length} open entries from ${REGISTER} (floor is ${MIN_OPEN_ENTRIES})`);
  }
  return entries;
}

function toIssue(raw) {
  const ok =
    raw && Number.isInteger(raw.iid) && typeof raw.title === "string" && Array.isArray(raw.labels);
  if (!ok) throw new CannotCompare("an issue in the response lacks an integer iid, a title or a labels array");
  return { iid: raw.iid, title: raw.title, labels: raw.labels.map(String) };
}

function timeoutMs() {
  const raw = process.env.REGISTER_SYNC_TIMEOUT_MS;
  if (raw === undefined || raw === "") return DEFAULT_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new CannotCompare("REGISTER_SYNC_TIMEOUT_MS is not a positive integer");
  return n;
}

async function fetchPage(endpoint, page, timeout) {
  const url = new URL(endpoint);
  url.searchParams.set("state", "opened");
  url.searchParams.set("per_page", String(PER_PAGE));
  url.searchParams.set("page", String(page));
  const res = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(timeout),
    headers: { "PRIVATE-TOKEN": token },
  });
  const body = await res.text();
  if (res.status >= 300 && res.status < 400) {
    throw new CannotCompare(`page ${page} answered HTTP ${res.status} redirect, which is not followed`);
  }
  if (!res.ok) throw new CannotCompare(`page ${page} answered HTTP ${res.status}`, body);
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    json = null;
  }
  if (!Array.isArray(json)) throw new CannotCompare(`page ${page} is not a JSON array`, body);
  return { issues: json, next: res.headers.get("x-next-page") };
}

async function fetchOpenIssues(endpoint, timeout) {
  const issues = [];
  const seen = new Set();
  let page = 1;
  for (;;) {
    if (page > MAX_PAGES) throw new CannotCompare(`more than ${MAX_PAGES} pages of open issues`);
    const { issues: batch, next } = await fetchPage(endpoint, page, timeout);
    if (batch.length === 0) break;
    for (const issue of batch.map(toIssue)) {
      // ★★ A repeat means the pages shifted under us (see the header); comparing
      // anyway would report a phantom SECTION_ON_TWO_ISSUES `§N on #X, #X`.
      if (seen.has(issue.iid)) {
        throw new CannotCompare(`issue #${issue.iid} was served twice — issues changed while paging; re-run`);
      }
      seen.add(issue.iid);
      issues.push(issue);
    }
    // ★ x-next-page when GitLab sends it; an empty one is the last page. Absent
    // (GitLab omits it past 10,000 results), step on until an empty page.
    if (next === null) {
      page += 1;
      continue;
    }
    if (next.trim() === "") break;
    const n = Number(next);
    if (!Number.isInteger(n) || n <= page) throw new CannotCompare(`x-next-page "${next}" does not advance`);
    page = n;
  }
  return issues;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 0) throw new CannotCompare(`unknown argument(s) ${args.join(" ")} — this command takes none`);

  const { parseEntries, isClosed } = await import("./followup-claims-lib.mjs");
  const { compareWithGitLab, GITLAB_PROBLEM_HELP } = await import("./followup-workitem-lib.mjs");

  const api = apiBase();
  const projectId = process.env.CI_PROJECT_ID;
  // ★ Name WHICH one is missing, never the value of any of them.
  const missing = [!api && "CI_API_V4_URL", !projectId && "CI_PROJECT_ID"].filter(Boolean);
  if (missing.length > 0) throw new CannotCompare(`missing ${missing.join(", ")}`);

  const timeout = timeoutMs();
  const entries = readOpenEntries(parseEntries, isClosed);
  const endpoint = new URL(`${api}/projects/${encodeURIComponent(projectId)}/issues`).href;
  const issues = await fetchOpenIssues(endpoint, timeout);

  const { problems, counts } = compareWithGitLab(entries, issues);
  if (counts.registerIssues < MIN_REGISTER_ISSUES) {
    throw new CannotCompare(
      `fetched only ${counts.registerIssues} register issues among ${counts.openIssues} open issues ` +
        `(floor is ${MIN_REGISTER_ISSUES} register issues) — can the token see them?`,
    );
  }
  say(
    `Register vs GitLab — ${counts.openEntries} open entries (${counts.linked} linked, ` +
      `${counts.decisionRecords} decision records), ${counts.openIssues} open issues ` +
      `(${counts.registerIssues} register issues)`,
  );
  if (problems.length === 0) {
    say("Register and GitLab agree.");
    return 0;
  }
  for (const p of problems) say(`  ${p.code}: ${p.detail}\n      ${GITLAB_PROBLEM_HELP[p.code]}`);
  say(`\n${problems.length} problem(s) between the register and GitLab.`);
  return 1;
}

function describe(err) {
  // ★ Describing `err` can itself throw (a prototype-less object), so a fixed
  // fallback keeps this path at exit 2.
  try {
    const cause = err?.cause?.code ?? err?.cause?.message;
    return err instanceof Error ? `${err.name}: ${err.message}${cause ? ` (${cause})` : ""}` : String(err);
  } catch {
    return "an error that could not be described";
  }
}

try {
  process.exitCode = await main();
} catch (err) {
  if (err instanceof CannotCompare) {
    console.error(redact(`CANNOT COMPARE: ${err.message}`));
    if (err.body) console.error(redact(err.body).slice(0, BODY_EXCERPT_CHARS));
  } else {
    console.error(redact(`CANNOT COMPARE: ${describe(err)}`));
  }
  process.exitCode = 2;
}
