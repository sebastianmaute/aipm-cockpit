// Remap backticked commit citations in tracked *.md onto a rewritten history (sanitise plan,
// Task 13).
//
// Usage, from the root of a working tree of the REWRITTEN history:
//   node scripts/remap-commit-citations.mjs --old <original-mirror> --map <commit-map>          # dry run
//   node scripts/remap-commit-citations.mjs --old <original-mirror> --map <commit-map> --write
//
//   --old  the untouched ORIGINAL mirror. A citation counts as resolving when
//          `<token>^{commit}` resolves there — the same definition the inventory used.
//   --map  git-filter-repo's commit map (`<mirror>/filter-repo/commit-map`): old → new, full SHAs.
//
// A citation is a backticked token of 7–40 lowercase hex characters. Each resolving one is
// replaced by its new commit, abbreviated to the length it was cited at and lengthened until the
// prefix names exactly one object in this repository. ★★ A token that does not resolve in the
// original is LEFT ALONE and counted: it was already dangling, and mapping it onto whatever
// matches would hide that.
//
// After --write it verifies both failure modes: every remapped citation resolves to its new
// commit, AND the citation total is unchanged — a silent drop cannot fail the first check.
// Exit 0 = pass, 1 = a check failed, 2 = could not scan.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const CITATION_RE = /`([0-9a-f]{7,40})`/g;

/** Number of backticked 7–40 hex citations in `text`. */
export function count(text) {
  return [...text.matchAll(CITATION_RE)].length;
}

/** `text` with every citation found in `map` replaced, in one pass (no chaining). */
export function remap(text, map) {
  return text.replace(CITATION_RE, (whole, token) => (map.has(token) ? `\`${map.get(token)}\`` : whole));
}

/** filter-repo commit-map text → Map(old full SHA → new full SHA). */
export function parseCommitMap(text) {
  const m = new Map();
  for (const line of text.split(/\r?\n/)) {
    const [oldSha, newSha] = line.trim().split(/\s+/);
    if (/^[0-9a-f]{40}$/.test(oldSha ?? "") && /^[0-9a-f]{40}$/.test(newSha ?? "")) m.set(oldSha, newSha);
  }
  return m;
}

/** Shortest prefix of `full`, at least `len` long, for which `isAmbiguous` is false. */
export function abbreviateUnique(full, len, isAmbiguous) {
  for (let n = len; n < full.length; n++) {
    const prefix = full.slice(0, n);
    if (!isAmbiguous(prefix)) return prefix;
  }
  return full;
}

/**
 * Decide the replacement for every distinct token.
 * `oldFull` holds only the tokens that resolve in the original history.
 */
export function planRemap({ tokens, oldFull, commitMap, isAmbiguous }) {
  const map = new Map();
  const dangling = [];
  const unmapped = [];
  for (const token of tokens) {
    const full = oldFull.get(token);
    if (!full) {
      dangling.push(token);
      continue;
    }
    const next = commitMap.get(full);
    if (!next) {
      unmapped.push(token);
      continue;
    }
    map.set(token, abbreviateUnique(next, token.length, isAmbiguous));
  }
  return { map, dangling, unmapped };
}

/** Both failure modes: a changed total (silent drop) and a remapped citation that misses. */
export function judgeRemap({ beforeTotal, afterTotal, expected, resolvedAfter }) {
  const totalHeld = beforeTotal === afterTotal;
  const allResolve = resolvedAfter === expected;
  return { ok: totalHeld && allResolve, totalHeld, allResolve };
}

/** `cat-file --batch-check` over `names`; returns one output line per input. */
function batchCheck(repo, names) {
  if (names.length === 0) return [];
  return execFileSync("git", ["-C", repo, "cat-file", "--batch-check=%(objectname) %(objecttype)"], {
    input: names.join("\n") + "\n",
    encoding: "utf8",
    maxBuffer: 1 << 28,
  })
    .trimEnd()
    .split("\n");
}

function readDocs() {
  const files = execFileSync("git", ["ls-files", "-z", "--", "*.md"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  return files.map((file) => ({ file, text: readFileSync(file, "utf8") }));
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function main() {
  const oldRepo = arg("--old");
  const mapPath = arg("--map");
  const write = process.argv.includes("--write");
  if (!oldRepo || !mapPath) {
    console.error("usage: remap-commit-citations.mjs --old <original-mirror> --map <commit-map> [--write]");
    process.exit(2);
  }

  let docs, commitMap;
  try {
    docs = readDocs();
    commitMap = parseCommitMap(readFileSync(mapPath, "utf8"));
  } catch (e) {
    console.error(`could not read the docs or the commit map: ${e.message}`);
    process.exit(2);
  }
  if (docs.length === 0 || commitMap.size === 0) {
    console.error(`nothing to scan: ${docs.length} docs, ${commitMap.size} map entries`);
    process.exit(2);
  }

  const beforeTotal = docs.reduce((n, d) => n + count(d.text), 0);
  const tokens = [...new Set(docs.flatMap((d) => [...d.text.matchAll(CITATION_RE)].map((m) => m[1])))];
  const oldFull = new Map();
  batchCheck(oldRepo, tokens.map((t) => `${t}^{commit}`)).forEach((line, i) => {
    const m = /^([0-9a-f]{40}) commit$/.exec(line);
    if (m) oldFull.set(tokens[i], m[1]);
  });

  // Prefill the ambiguity cache in one batch: each candidate at its cited length and 4 longer.
  const ambiguous = new Map();
  const candidates = [];
  for (const t of tokens) {
    const next = commitMap.get(oldFull.get(t));
    if (!next) continue;
    for (let n = t.length; n < Math.min(40, t.length + 5); n++) candidates.push(next.slice(0, n));
  }
  const uniq = [...new Set(candidates)];
  batchCheck(".", uniq).forEach((line, i) => ambiguous.set(uniq[i], line.endsWith(" ambiguous")));
  const isAmbiguous = (p) => {
    if (!ambiguous.has(p)) ambiguous.set(p, batchCheck(".", [p])[0].endsWith(" ambiguous"));
    return ambiguous.get(p);
  };

  const { map, dangling, unmapped } = planRemap({ tokens, oldFull, commitMap, isAmbiguous });
  const lengthened = [...map].filter(([t, r]) => r.length > t.length).length;
  const expected = docs.reduce(
    (n, d) => n + [...d.text.matchAll(CITATION_RE)].filter((m) => map.has(m[1])).length,
    0,
  );
  console.log(
    `docs=${docs.length} citations=${beforeTotal} distinct=${tokens.length} remap=${map.size} ` +
      `(occurrences ${expected}, lengthened ${lengthened}) dangling=${dangling.length} unmapped=${unmapped.length}`,
  );
  if (unmapped.length > 0) {
    console.error(`resolving citations the commit map does not cover: ${unmapped.join(" ")}`);
    process.exit(1);
  }
  if (!write) return;

  let changedFiles = 0;
  for (const d of docs) {
    const next = remap(d.text, map);
    if (next !== d.text) {
      writeFileSync(d.file, next, "utf8");
      changedFiles++;
    }
  }

  const after = readDocs();
  const afterTotal = after.reduce((n, d) => n + count(d.text), 0);
  const newFull = new Map([...map].map(([t, r]) => [r, commitMap.get(oldFull.get(t))]));
  const cited = after.flatMap((d) => [...d.text.matchAll(CITATION_RE)].map((m) => m[1])).filter((t) => newFull.has(t));
  const distinct = [...new Set(cited)];
  const got = new Map();
  batchCheck(".", distinct.map((t) => `${t}^{commit}`)).forEach((line, i) => got.set(distinct[i], line.slice(0, 40)));
  const resolvedAfter = cited.filter((t) => got.get(t) === newFull.get(t)).length;
  const verdict = judgeRemap({ beforeTotal, afterTotal, expected, resolvedAfter });
  console.log(
    `wrote ${changedFiles} files; total ${beforeTotal} → ${afterTotal}; ` +
      `remapped citations resolving to their new commit: ${resolvedAfter}/${expected}`,
  );
  console.log(verdict.ok ? "PASS" : "FAIL");
  process.exit(verdict.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
