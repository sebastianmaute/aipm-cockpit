#!/usr/bin/env node
// Compare docs/open-followups.md's Work item lines with the OPEN GitHub issues,
// in both directions. WARN-ONLY in CI (register-sync). Replaces
// check-followup-gitlab.mjs at the flip (docs/superpowers/specs/2026-09-23-issues-migration-design.md);
// until then the repository variable REGISTER_TRACKER keeps this job dormant.
//
// EXIT CODES:
//   0  REGISTER_TRACKER is not "github" (a clean skip, checked FIRST — issues are
//      not on GitHub yet, so a run before the flip must never fail), or the
//      register and GitHub agree
//   1  DRIFT: at least one problem from compareWithTracker — fix the Work item
//      line or the issue
//   2  COULD NOT COMPARE: GITHUB_TOKEN unset once enabled, a token containing
//      whitespace or a control character, an unknown argument, missing
//      GITHUB_REPOSITORY, an invalid REGISTER_SYNC_TIMEOUT_MS (not an integer
//      from 1 to 2^31-1), an unreadable register, fewer than 50 open entries, a
//      network failure, the timeout, a non-2xx, a redirect, a body that is not a
//      JSON array of issues, more than 50 pages, an issue served twice while
//      paging, fewer than 50 REGISTER issues, or any structural failure (a
//      renamed lib export)
//
// ENVIRONMENT:
//   REGISTER_TRACKER           must be exactly "github", else a clean skip
//   GITHUB_TOKEN               required once enabled; never printed
//   GITHUB_REPOSITORY          "owner/name", set by Actions
//   GITHUB_API_URL             default "https://api.github.com"; tests point it
//                              at a local server
//   REGISTER_SYNC_TIMEOUT_MS   optional per-request timeout, default 30000. It
//                              exists so the integration test can pin the timeout
//                              path in milliseconds; CI does not set it.
//
// ★★ The blocking followups-workitems-check reads the register ONLY. This is the
//   half it cannot do: an issue closed on GitHub, an issue with the wrong title,
//   an issue with no entry. Every decision is made by the pure compareWithTracker
//   in followup-workitem-lib.mjs; this file fetches, redacts, prints, and maps a
//   verdict to an exit code.
// ★★★ 50 REGISTER ISSUES, NOT 50 open issues and NOT 0 — the floor counts open
//   issues carrying a `§NNN:` title or the source::register label. A fetch that
//   returns no or few register issues (a token that cannot see them, or register
//   issues that lost both their title prefix and their label) would make every
//   entry read ISSUE_NOT_OPEN. That is a scan that could not see the register's
//   issues, not drift, so it is 2 — however many unrelated issues came back
//   beside them.
// ★★ Link-header pagination is opaque URLs, not an offset, so — unlike the GitLab
//   script — there is no "steps on past a missing header" fallback: an absent
//   `next` link is simply the last page.
// ★★ `redirect: "manual"`: a followed redirect reads an answer from a URL nobody
//   asked.
// ★★ The token is redacted out of every printed line and every body excerpt —
//   BEFORE truncation, so a token straddling the cut cannot leak a prefix — and
//   out of the caught error. Request headers are never printed.
// ★ The libraries are imported dynamically inside the one try, so a renamed
//   export exits 2 instead of Node's default 1, which here means DRIFT.
import { readFileSync } from "node:fs";

const REGISTER = "docs/open-followups.md";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const BODY_EXCERPT_CHARS = 2000;
const PER_PAGE = 100;
const MAX_PAGES = 50;
const MIN_OPEN_ENTRIES = 50;
const MIN_REGISTER_ISSUES = 50;

// ★★★ Checked FIRST, before anything else — including the token. Until the flip
// sets the repository variable, issues live on GitLab and this job must stay a
// silent no-op rather than fail on a missing GITHUB_TOKEN nobody configured yet.
const tracker = process.env.REGISTER_TRACKER;
if (tracker !== "github") {
  console.log('skipped: REGISTER_TRACKER is not "github" — issues are not on GitHub yet.');
  process.exit(0);
}

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("CANNOT COMPARE: GITHUB_TOKEN is not set");
  process.exit(2);
}
// ★★★ Before ANY use of the value. fetch's header validation TRIMS the value
// before quoting it in its error, so a padded token with an embedded newline
// escaped a plain `split(token)` and leaked verbatim. No real token has
// whitespace or a control character, so refuse it here — and never print it.
if (/[\s\p{Cc}]/u.test(token)) {
  console.error(
    "CANNOT COMPARE: GITHUB_TOKEN contains whitespace or a control character; re-enter the variable without it (the value is not printed).",
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
  const raw = process.env.GITHUB_API_URL ?? "https://api.github.com";
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

function timeoutMs() {
  const raw = process.env.REGISTER_SYNC_TIMEOUT_MS;
  if (raw === undefined || raw === "") return DEFAULT_TIMEOUT_MS;
  const n = Number(raw);
  // ★★ Node clamps a timer above 2^31-1 ms to 1 ms (TimeoutOverflowWarning), so
  // every request would "time out" and the message would blame the network.
  if (!Number.isInteger(n) || n <= 0 || n > MAX_TIMEOUT_MS) {
    throw new CannotCompare(`REGISTER_SYNC_TIMEOUT_MS must be an integer from 1 to ${MAX_TIMEOUT_MS}`);
  }
  return n;
}

async function fetchPage(url, page, timeout, parseNextLink) {
  const res = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(timeout),
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
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
  return { items: json, next: parseNextLink(res.headers.get("link")) };
}

async function fetchOpenIssues(startUrl, timeout, toTrackerIssue, parseNextLink) {
  const issues = [];
  const seen = new Set();
  let url = startUrl;
  let page = 1;
  while (url) {
    if (page > MAX_PAGES) throw new CannotCompare(`more than ${MAX_PAGES} pages of open issues`);
    const { items, next } = await fetchPage(url, page, timeout, parseNextLink);
    for (const raw of items) {
      const issue = toTrackerIssue(raw);
      if (issue === null) continue; // a pull request
      // ★★ A repeat means the pages shifted under us, or the Link header looped;
      // comparing anyway would report a phantom SECTION_ON_TWO_ISSUES `§N on #X, #X`.
      if (seen.has(issue.iid)) {
        throw new CannotCompare(`issue #${issue.iid} was served twice — issues changed while paging; re-run`);
      }
      seen.add(issue.iid);
      issues.push(issue);
    }
    // ★ Link-header pagination is opaque URLs, not an offset: an absent `next`
    // relation is simply the last page, with no "step on and see" fallback.
    url = next;
    page += 1;
  }
  return issues;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 0) throw new CannotCompare(`unknown argument(s) ${args.join(" ")} — this command takes none`);

  const { parseEntries, isClosed } = await import("./followup-claims-lib.mjs");
  const { compareWithTracker, TRACKER_PROBLEM_HELP } = await import("./followup-workitem-lib.mjs");
  const { parseNextLink, toTrackerIssue } = await import("./github-issues-lib.mjs");

  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new CannotCompare("missing GITHUB_REPOSITORY");

  const timeout = timeoutMs();
  const entries = readOpenEntries(parseEntries, isClosed);
  const startUrl = `${apiBase()}/repos/${repo}/issues?state=open&per_page=${PER_PAGE}`;
  const issues = await fetchOpenIssues(startUrl, timeout, toTrackerIssue, parseNextLink);

  const { problems, counts } = compareWithTracker(entries, issues);
  if (counts.registerIssues < MIN_REGISTER_ISSUES) {
    throw new CannotCompare(
      `fetched only ${counts.registerIssues} register issues among ${counts.openIssues} open issues ` +
        `(floor is ${MIN_REGISTER_ISSUES} register issues) — can the token see them?`,
    );
  }
  say(
    `Register vs GitHub — ${counts.openEntries} open entries (${counts.linked} linked, ` +
      `${counts.decisionRecords} decision records), ${counts.openIssues} open issues ` +
      `(${counts.registerIssues} register issues)`,
  );
  if (problems.length === 0) {
    say("Register and GitHub agree.");
    return 0;
  }
  for (const p of problems) say(`  ${p.code}: ${p.detail}\n      ${TRACKER_PROBLEM_HELP[p.code]}`);
  say(`\n${problems.length} problem(s) between the register and GitHub.`);
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
