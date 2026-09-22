#!/usr/bin/env node
// Gate: no internal identifier (the list is kept OUTSIDE the repository) may
// appear in any tracked text file. The pure half — list parsing, pattern
// building, classification — is `identifier-leak-lib.mjs`; this file owns the
// I/O and the exit codes.
//
// Usage:  LEAK_LIST_FILE=<path outside the repo> npm run leaks:check
//         node scripts/check-identifier-leaks.mjs [--root <dir>]
//
// ★★★ THE LIST IS NEVER TRACKED. It lives in a file named by the environment
// variable `LEAK_LIST_FILE`: locally a file outside the repository, in CI a
// masked file-type variable. Its format is documented in the lib's header.
// ★★ CI WIRING IS PENDING: no pipeline job runs this yet, because a blocking job
// needs the masked file-type variable to exist in the project settings first,
// and a job without it exits 2 on every pipeline. Run it locally until then.
//
// ★★ A report NEVER echoes an identifier — only `path:line` and the entry's
// class — so its output is safe to paste into a public log.
//
// ★★★ TWO FAILURE MODES, TWO EXIT CODES, as in the register gates. Exit 1 is a
// LEAK: a listed identifier sits on a line with no absence marker. Exit 2 is the
// gate UNABLE TO SCAN: the variable is unset, the file is missing or holds no
// entries, an entry is malformed, `git ls-files` failed, or fewer than
// MIN_FILES text files were read. A scan that reads nothing passes everything,
// so none of those may exit 0.
//
// ★★ TWO KNOWN BLIND SPOTS, both deliberate trade-offs, neither closed here:
//   1. It scans FILE CONTENT only. A tracked file's PATH is never matched
//      against a pattern (see `classifyHit`'s doc in the lib) — a file whose
//      NAME carries the identifier (e.g. a note file named after a customer)
//      is invisible to this gate.
//   2. A `word:` entry is bounded by Unicode `\p{L}`/`\p{N}`/`_` on both sides
//      (fixed from an ASCII-only `[A-Za-z0-9_]` class — that version treated
//      any non-ASCII letter, e.g. a German umlaut, as a non-word separator,
//      so a short fragment glued directly onto one could match "whole-word"
//      in the middle of an unrelated longer word; see the display-name
//      sanitisation task's fix round 1/2), so it matches a bare word but
//      still MISSES the same text glued into a longer compound: `acme_corp`
//      and `acmeCorp` both fail the boundary check for a `word:acme` entry,
//      because `_` counts as a word character and the adjoining letter is
//      one too (now true of ANY letter, ASCII or not, not just ASCII). A
//      literal (non-`word:`) entry still catches those as a plain substring;
//      use one for anything with a known compound form (the identifier-leak
//      sweep task hit exactly this for the retired brand trigram, which
//      needed a second, compound-aware regex pass beyond the word-bounded
//      one).
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { parseList, buildPatterns, isBinary, scanText } from "./identifier-leak-lib.mjs";

const ENV_VAR = "LEAK_LIST_FILE";
/** Same floor the register gates use (see `check-followup-index.mjs`): it
 *  catches a scan that reads nothing AND one that reads almost nothing. */
const MIN_FILES = 50;

function cannotScan(msg) {
  console.error(`CANNOT SCAN: ${msg}`);
  process.exit(2);
}

function parseRoot(argv) {
  const i = argv.indexOf("--root");
  if (i === -1) return process.cwd();
  const v = argv[i + 1];
  if (!v) cannotScan("--root needs a directory argument.");
  return path.resolve(v);
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

function trackedFiles(root) {
  try {
    const out = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out.split("\0").filter(Boolean);
  } catch (err) {
    return cannotScan(`git ls-files failed in ${root} (${err.message.split("\n")[0]}).`);
  }
}

const root = parseRoot(process.argv.slice(2));
const patterns = loadPatterns();
const files = trackedFiles(root);

let scanned = 0;
let binary = 0;
let missing = 0;
const leaks = [];
const allowed = [];
for (const rel of files) {
  let buf;
  try {
    buf = readFileSync(path.join(root, rel));
  } catch {
    missing += 1; // tracked but deleted in the working tree
    continue;
  }
  if (isBinary(buf)) {
    binary += 1;
    continue;
  }
  scanned += 1;
  for (const hit of scanText(rel, buf.toString("utf8"), patterns)) {
    if (hit.kind === "leak") leaks.push(hit);
    else allowed.push(hit);
  }
}

if (scanned < MIN_FILES) {
  cannotScan(`read ${scanned} text file(s) under ${root}; the floor is ${MIN_FILES}.`);
}

const summary =
  `${patterns.length} pattern(s), ${scanned} text file(s) scanned, ${binary} binary skipped, ` +
  `${missing} missing, ${allowed.length} marked-absent line(s), ${leaks.length} leak(s).`;

// Marked-absent lines are shown so a reviewer can judge each suppression.
for (const h of allowed) console.log(`ALLOWED ${h.path}:${h.line}  class=${h.classes.join(",")}`);

if (leaks.length > 0) {
  for (const h of leaks) console.error(`LEAK ${h.path}:${h.line}  class=${h.classes.join(",")}`);
  console.error(summary);
  process.exit(1);
}
console.log(`OK — ${summary}`);
process.exit(0);
