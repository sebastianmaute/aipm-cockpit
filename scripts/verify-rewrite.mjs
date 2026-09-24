// Verify a rewritten history (sanitise plan, Task 12).
//
// Usage:
//   LEAK_LIST_FILE=<list> node scripts/verify-rewrite.mjs --repo <mirror> --allow <file> --expect clean
//   LEAK_LIST_FILE=<list> node scripts/verify-rewrite.mjs --repo <mirror> --expect dirty
//
// Three substrates, every ref:
//   blobs       every blob reachable from every ref (`rev-list --all --objects` into
//               `cat-file --batch`), not a checked-out tree — `git grep` sees one commit
//   messages    every commit message plus every annotated tag message
//   identities  author, committer and tagger ADDRESSES — a set-equality check against an
//               allowlist (one address per line), so an identity nobody predicted still fails
//
// ★★★ Run it twice. `--expect dirty` against the ORIGINAL mirror must find a nonzero blob count
// and a nonzero message count: a zero there means the scan is broken, and a later zero from
// `--expect clean` would prove nothing. `--expect clean` against the REWRITTEN mirror must find
// zero blobs, zero messages and the identity set equal to the allowlist.
//
// It prints counts only — never a matched line, a path or an identity — because every hit IS an
// identifier. Exit 0 = the expectation holds, 1 = it does not, 2 = could not scan.

import { readFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
// TRAILER_RE (the assistant trailers the rewrite must drop) lives in the lib, shared with
// check-commit-message-leaks.mjs.
import { parseList, buildPatterns, isBinary, TRAILER_RE } from "./identifier-leak-lib.mjs";

/** Number of LINES in `text` that match any pattern. */
export function countHitLines(text, patterns) {
  let n = 0;
  for (const line of text.split("\n")) {
    if (patterns.some((p) => p.re.test(line))) n++;
  }
  return n;
}

/** Number of trailer lines in `text`. */
export function countTrailerLines(text) {
  return text.split("\n").filter((l) => TRAILER_RE.test(l)).length;
}

/** Normalise one address for comparison. */
export function normaliseAddress(a) {
  return a.trim().replace(/^<|>$/g, "").toLowerCase();
}

/** Set equality of found vs allowed addresses; returns counts only. */
export function identityVerdict(found, allowed) {
  const f = new Set([...found].map(normaliseAddress).filter(Boolean));
  const a = new Set([...allowed].map(normaliseAddress).filter(Boolean));
  const unexpected = [...f].filter((x) => !a.has(x)).length;
  const missing = [...a].filter((x) => !f.has(x)).length;
  return { distinct: f.size, unexpected, missing, equal: unexpected === 0 && missing === 0 };
}

/** Judge one run's counts against the expectation. */
export function judge(expect, counts) {
  if (expect === "dirty") {
    return counts.blobHits > 0 && counts.messageHits > 0;
  }
  return counts.blobHits === 0 && counts.messageHits === 0 && counts.trailerLines === 0 &&
    counts.identities.equal;
}

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { maxBuffer: 1 << 30 }).toString("utf8");
}

/** Stream every reachable blob through `onBlob(buf)`. Resolves to the blob count. */
function forEachBlob(repo, onBlob) {
  return new Promise((resolve, reject) => {
    const list = spawn("git", ["-C", repo, "rev-list", "--all", "--objects"]);
    const cat = spawn("git", ["-C", repo, "cat-file", "--batch"]);
    let pending = "";
    list.stdout.on("data", (d) => {
      pending += d.toString("utf8");
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const l of lines) if (l) cat.stdin.write(l.slice(0, 40) + "\n");
    });
    list.on("close", (code) => {
      if (pending) cat.stdin.write(pending.slice(0, 40) + "\n");
      cat.stdin.end();
      if (code !== 0) reject(new Error(`rev-list exited ${code}`));
    });
    let buf = Buffer.alloc(0);
    let blobs = 0;
    cat.stdout.on("data", (d) => {
      buf = buf.length ? Buffer.concat([buf, d]) : d;
      for (;;) {
        const nl = buf.indexOf(10);
        if (nl < 0) return;
        const [, type, sizeStr] = buf.subarray(0, nl).toString("utf8").split(" ");
        const size = Number(sizeStr);
        if (buf.length < nl + 1 + size + 1) return;
        if (type === "blob") {
          blobs++;
          onBlob(buf.subarray(nl + 1, nl + 1 + size));
        }
        buf = buf.subarray(nl + 1 + size + 1);
      }
    });
    cat.on("close", (code) => (code === 0 ? resolve(blobs) : reject(new Error(`cat-file exited ${code}`))));
  });
}

export async function scanRepo(repo, patterns) {
  let blobHits = 0;
  let textBlobs = 0;
  const blobs = await forEachBlob(repo, (b) => {
    if (isBinary(b)) return;
    textBlobs++;
    blobHits += countHitLines(b.toString("utf8"), patterns);
  });
  const messages =
    git(repo, ["log", "--all", "--format=%B"]) +
    "\n" +
    git(repo, ["for-each-ref", "refs/tags", "--format=%(contents)"]);
  const addresses = new Set(
    (git(repo, ["log", "--all", "--format=%ae%n%ce"]) +
      "\n" +
      git(repo, ["for-each-ref", "refs/tags", "--format=%(taggeremail)"]))
      .split("\n")
      .filter((l) => l.trim()),
  );
  return {
    blobs,
    textBlobs,
    blobHits,
    messageHits: countHitLines(messages, patterns),
    trailerLines: countTrailerLines(messages),
    addresses,
  };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
}

async function main() {
  const repo = arg("--repo");
  const expect = arg("--expect");
  const allowPath = arg("--allow");
  const listPath = process.env.LEAK_LIST_FILE;
  if (!repo || !["clean", "dirty"].includes(expect) || !listPath || (expect === "clean" && !allowPath)) {
    console.error("usage: LEAK_LIST_FILE=<list> verify-rewrite.mjs --repo <mirror> --expect clean|dirty [--allow <file>]");
    process.exit(2);
  }
  let patterns;
  try {
    patterns = buildPatterns(parseList(readFileSync(listPath, "utf8")));
  } catch (e) {
    console.error(`could not read the identifier list: ${e.message}`);
    process.exit(2);
  }
  if (patterns.length === 0) {
    console.error("the identifier list is empty");
    process.exit(2);
  }
  let r;
  try {
    r = await scanRepo(repo, patterns);
  } catch (e) {
    console.error(`could not scan: ${e.message}`);
    process.exit(2);
  }
  if (r.blobs === 0 || r.textBlobs === 0) {
    console.error("scanned no blobs");
    process.exit(2);
  }
  const allowed = allowPath ? readFileSync(allowPath, "utf8").split(/\r?\n/) : [];
  const identities = identityVerdict(r.addresses, allowed);
  const counts = { ...r, identities };
  console.log(
    `blobs=${r.blobs} text=${r.textBlobs} blobHitLines=${r.blobHits} messageHitLines=${r.messageHits} ` +
      `trailerLines=${r.trailerLines} identities=${identities.distinct}` +
      (allowPath ? ` unexpected=${identities.unexpected} missing=${identities.missing}` : ""),
  );
  const ok = judge(expect, counts);
  console.log(ok ? `PASS (${expect})` : `FAIL (${expect})`);
  process.exit(ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
