#!/usr/bin/env node
// Gate: no commit message (and no annotated tag message) in a commit range may carry an internal
// identifier from the leak list, or an assistant trailer (`TRAILER_RE`). `leaks:check` scans
// tracked FILES only, so a message was a blind spot: seven commits reached `main` carrying a
// session trailer and no check saw them (§200). The pure half — list parsing, `scanMessage`,
// `TRAILER_RE` — is `identifier-leak-lib.mjs`; this file owns the git calls and the exit codes.
//
// Usage:  LEAK_LIST_FILE=<path outside the repo> node scripts/check-commit-message-leaks.mjs <range>
//         <range> is any `git log` revision range: `base..head`, or `<sha>^!` for one commit.
//
// ★★ It never prints a matched line: only the commit's short SHA, the classes hit and the counts,
// because every hit IS an identifier. A trailer reports as `class=trailer`.
//
// ★★★ Exit codes as in `check-identifier-leaks.mjs`: 0 = clean, 1 = a pattern hit or ANY trailer
// line, 2 = could not scan (list unset, unreadable, empty or malformed; no range, a range that
// looks like an option, or one git cannot resolve; any failing git call). An EMPTY range is exit 0
// with "0 commits scanned" — a no-op push must not fail.
//
// ★ Tags: every annotated tag whose target commit is in the range is scanned too (one extra
// `for-each-ref`). A lightweight tag has no message and is skipped.
//
// ★ Not in `gate-local.mjs`'s GATE_STEPS: it needs a commit range that a local run does not have.
// CI's `static` job runs it; reproduce with `origin/main..HEAD`.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseList, buildPatterns, scanMessage } from "./identifier-leak-lib.mjs";

const ENV_VAR = "LEAK_LIST_FILE";
const SHORT = 12;
const RECORD_END = "\x01";
const FIELD_SEP = "\0";

function cannotScan(msg) {
  console.error(`CANNOT SCAN: ${msg}`);
  process.exit(2);
}

function loadPatterns() {
  const listPath = process.env[ENV_VAR];
  if (!listPath || listPath.trim() === "") {
    cannotScan(`${ENV_VAR} is unset — point it at the identifier list (kept outside the repo).`);
  }
  let text;
  try {
    text = readFileSync(listPath, "utf8");
  } catch (err) {
    cannotScan(`the list named by ${ENV_VAR} is unreadable (${err.code ?? err.message}).`);
  }
  const entries = parseList(text);
  if (entries.length === 0) cannotScan(`the list named by ${ENV_VAR} holds no entries.`);
  try {
    return buildPatterns(entries);
  } catch (err) {
    return cannotScan(`the list is malformed: ${err.message}.`);
  }
}

function parseRange(argv) {
  const range = argv[0];
  if (!range || range.trim() === "") cannotScan("no commit range given (e.g. base..head).");
  if (range.startsWith("-")) cannotScan("the range looks like an option; pass a revision range.");
  return range;
}

function git(args, what) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    return cannotScan(`${what} failed (${err.message.split("\n")[0]}).`);
  }
}

/** Split `%x00`-separated, `%x01`-terminated records; git puts a newline after each record. */
function records(out) {
  return out
    .split(RECORD_END)
    .map((r) => r.replace(/^\n/, ""))
    .filter((r) => r !== "" && r !== "\n")
    .map((r) => r.split(FIELD_SEP));
}

function commitMessages(range) {
  const out = git(["log", "--format=%H%x00%B%x01", "--end-of-options", range, "--"], `git log ${range}`);
  return records(out).map(([sha, body]) => ({ kind: "commit", sha, body: body ?? "" }));
}

function tagMessages(commitShas) {
  const out = git(
    ["for-each-ref", "refs/tags", "--format=%(objecttype)%00%(*objectname)%00%(contents)%01"],
    "git for-each-ref refs/tags",
  );
  return records(out)
    .filter(([type, target]) => type === "tag" && commitShas.has(target))
    .map(([, sha, body]) => ({ kind: "tag", sha, body: body ?? "" }));
}

const range = parseRange(process.argv.slice(2));
const patterns = loadPatterns();
const commits = commitMessages(range);
const tags = tagMessages(new Set(commits.map((c) => c.sha)));

let hitLines = 0;
let trailerLines = 0;
const offending = [];
for (const m of [...commits, ...tags]) {
  const r = scanMessage(m.body, patterns);
  hitLines += r.hitLines;
  trailerLines += r.trailerLines;
  const classes = Object.keys(r.classes);
  if (r.trailerLines > 0) classes.push("trailer");
  if (classes.length > 0) offending.push({ ...m, classes, r });
}

const summary =
  `${patterns.length} pattern(s); ${commits.length} commits scanned, ${tags.length} tag message(s) ` +
  `scanned; ${hitLines} pattern-hit line(s), ${trailerLines} trailer line(s); ` +
  `${offending.length} offending message(s).`;

if (offending.length > 0) {
  for (const o of offending) {
    console.error(
      `LEAK ${o.kind} ${o.sha.slice(0, SHORT)}  class=${o.classes.join(",")}  ` +
        `hitLines=${o.r.hitLines} trailerLines=${o.r.trailerLines}`,
    );
  }
  console.error(summary);
  process.exit(1);
}
console.log(`OK — ${summary}`);
process.exit(0);
