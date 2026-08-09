// Ratchet: fails when a doc gains a NEW `path:LINE` citation, or cites a line
// that cannot exist. Regenerate baseline: node scripts/check-doc-claims.mjs --update
//
// ★★★ WHY THIS EXISTS. AGENTS.md has said "CITE THE SYMBOL, NOT A LINE RANGE"
// at three stars for a long time, and nothing enforced it. On 2026-08-09 a
// 10-line comment insertion in `src/proxy.ts` silently repointed EVERY
// `proxy.ts:NN` citation in the repo — nine of them across four tracked files,
// FOUR inside `docs/security/threat-model.md`, including the one cited twice as
// the evidence that `connect-src` is restricted to `*.turso.io`. Every one had
// been exact. A security reviewer following them lands on `return [`.
//
// ★★ WHAT IT CANNOT DO, stated plainly so nobody reads a green run as more than
// it is: it CANNOT tell you a citation still points at the right code. Nothing
// can, because the doc never records what was supposed to be at that line. It
// proves only that the line COULD exist and that the count is not growing.
// A cite silently shifted by an insertion still passes. That is the whole
// reason the rule is "prefer a symbol" rather than "keep the numbers fresh".
//
// ★ Staleness detection (cited file modified after the doc line was written) was
// designed and deliberately NOT built: it needs `git blame`/`git log`, and the
// slim CI image has no git — the same constraint `check-file-sizes.mjs` records.
// It would work locally and silently no-op in CI, which is the worst shape for a
// gate. See docs/open-followups.md §131.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const BASELINE = "docs/baselines/doc-line-cites.json";

// Extensions that denote a real source file. A bare `foo.io:80` or a version
// like `0.227.0` must never match, so the extension list is a closed set.
const SOURCE_EXT = "ts|tsx|mjs|js|json|yml|yaml|css";
const CITE_RE = new RegExp(
  `([A-Za-z0-9_][A-Za-z0-9_/.-]*\\.(?:${SOURCE_EXT})):(\\d+)`,
  "g",
);

// Docs whose citations are in scope. `docs/superpowers/` is gitignored working
// material, not shipped documentation — scanning it would gate files that are
// not in the repo.
const SKIP_DIRS = ["docs/superpowers"];
const ROOT_DOCS = ["AGENTS.md", "CONTRIBUTING.md", "README.md"];

// Walk with node's fs, NOT `git ls-files` — the slim CI image has no git.
function collectDocs() {
  const fromDocs = readdirSync("docs", { recursive: true, encoding: "utf8" })
    .map((f) => `docs/${f}`.replace(/\\/g, "/"))
    .filter((f) => f.endsWith(".md"))
    .filter((f) => !SKIP_DIRS.some((d) => f.startsWith(`${d}/`)));
  return [...ROOT_DOCS, ...fromDocs].sort();
}

// Index every source file once, so a partial cite like `jira/_helpers.ts:115`
// (really `src/app/api/jira/_helpers.ts`) can still be resolved by suffix.
function collectSources() {
  const out = [];
  for (const dir of ["src", "scripts", "e2e"]) {
    let entries;
    try {
      entries = readdirSync(dir, { recursive: true, encoding: "utf8" });
    } catch {
      continue; // directory absent in a partial checkout — not this gate's problem
    }
    for (const f of entries) {
      const p = `${dir}/${f}`.replace(/\\/g, "/");
      if (new RegExp(`\\.(?:${SOURCE_EXT})$`).test(p)) out.push(p);
    }
  }
  // ★ Root-level config files are cited too (`vitest.config.ts:24`,
  // `.gitlab-ci.yml:99`) and live in none of the three directories above.
  // Omitting them made every such citation look deleted on the first run.
  for (const f of readdirSync(".", { encoding: "utf8" })) {
    const p = f.replace(/\\/g, "/");
    if (new RegExp(`\\.(?:${SOURCE_EXT})$`).test(p)) out.push(p);
  }
  return out;
}

const lineCounts = new Map();
function lineCountOf(path) {
  if (!lineCounts.has(path)) {
    try {
      lineCounts.set(path, readFileSync(path, "utf8").split("\n").length);
    } catch {
      lineCounts.set(path, null);
    }
  }
  return lineCounts.get(path);
}

// ★ A fenced block holds EXAMPLES — command output, stack traces, sample code.
// A `foo.ts:12` in there is not a claim about this repo, and gating it would
// make the rule fire on its own documentation. Prose is what makes claims.
function stripFencedBlocks(text) {
  const lines = text.split(/\r?\n/);
  let fenced = false;
  return lines.map((l) => {
    if (/^\s*```/.test(l)) {
      fenced = !fenced;
      return "";
    }
    return fenced ? "" : l;
  });
}

const sources = collectSources();
function resolveCandidates(citedPath) {
  const needle = citedPath.startsWith("/") ? citedPath.slice(1) : citedPath;
  const exact = sources.filter((s) => s === needle);
  if (exact.length) return exact;
  const bySegment = sources.filter((s) => s.endsWith(`/${needle}`));
  if (bySegment.length) return bySegment;
  // ★ Dotfile case: `.gitlab-ci.yml` is cited as `gitlab-ci.yml` because the
  // leading dot reads as sentence punctuation. Accept a suffix match only when
  // the character before it is `.`, so `helpers.ts` can never match
  // `other-helpers.ts`.
  return sources.filter((s) => s.endsWith(needle) && s[s.length - needle.length - 1] === ".");
}

const cites = {}; // doc -> citedPath -> count
const unresolved = [];
const outOfRange = [];

for (const doc of collectDocs()) {
  let text;
  try {
    text = readFileSync(doc, "utf8");
  } catch {
    continue; // an optional root doc may be absent
  }
  const lines = stripFencedBlocks(text);
  lines.forEach((line, i) => {
    for (const m of line.matchAll(CITE_RE)) {
      const [, citedPath, lineNo] = m;
      cites[doc] ??= {};
      cites[doc][citedPath] = (cites[doc][citedPath] ?? 0) + 1;

      // ★ The key deliberately omits the DOC's own line number: doc line numbers
      // shift on every edit, so a key carrying one would churn the baseline on
      // unrelated changes — the same instability this gate exists to fight.
      const key = `${doc} :: ${citedPath}:${lineNo}`;
      const candidates = resolveCandidates(citedPath);
      if (candidates.length === 0) {
        unresolved.push({ key, msg: `${doc}:${i + 1}  ${citedPath}:${lineNo} — no such file` });
        continue;
      }
      // Ambiguous suffix match: only a violation if the line is out of range for
      // EVERY candidate, so a shared basename cannot produce a false positive.
      const counts = candidates.map(lineCountOf).filter((n) => n !== null);
      if (counts.length && counts.every((n) => Number(lineNo) > n)) {
        outOfRange.push({
          key,
          msg: `${doc}:${i + 1}  ${citedPath}:${lineNo} — file has ${Math.max(...counts)} lines`,
        });
      }
    }
  });
}

const sortedCites = Object.fromEntries(
  Object.entries(cites)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([doc, paths]) => [
      doc,
      Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
    ]),
);

const totalCites = Object.values(cites).reduce(
  (sum, paths) => sum + Object.values(paths).reduce((a, b) => a + b, 0),
  0,
);

if (process.argv.includes("--update")) {
  writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        cites: sortedCites,
        knownUnresolved: unresolved.map((u) => u.key).sort(),
        knownOutOfRange: outOfRange.map((o) => o.key).sort(),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `baseline written: ${totalCites} line citations across ${Object.keys(cites).length} docs` +
      ` (${unresolved.length} unresolvable, ${outOfRange.length} out of range, both grandfathered)`,
  );
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
const added = [];
for (const [doc, paths] of Object.entries(sortedCites)) {
  for (const [citedPath, n] of Object.entries(paths)) {
    const prev = baseline.cites?.[doc]?.[citedPath] ?? 0;
    if (n > prev) {
      added.push(
        prev === 0
          ? `${doc}: NEW line citation to ${citedPath} (${n}×)`
          : `${doc}: line citations to ${citedPath} grew ${prev} → ${n}`,
      );
    }
  }
}

// ★★ Pre-existing breakage is GRANDFATHERED, exactly like the file-size ratchet:
// the first run found 12 unresolvable and 6 out-of-range citations that predate
// this gate. Failing on them would have made the gate unlandable, and a gate that
// cannot land protects nothing. They are recorded so the number can only fall.
const knownUnresolved = new Set(baseline.knownUnresolved ?? []);
const knownOutOfRange = new Set(baseline.knownOutOfRange ?? []);
const newUnresolved = unresolved.filter((u) => !knownUnresolved.has(u.key));
const newOutOfRange = outOfRange.filter((o) => !knownOutOfRange.has(o.key));

const fatal = [...newUnresolved, ...newOutOfRange, ...added];
if (fatal.length) {
  if (newUnresolved.length) {
    console.error(
      "Line citations to files that do not exist:\n  " +
        newUnresolved.map((u) => u.msg).join("\n  "),
    );
  }
  if (newOutOfRange.length) {
    console.error(
      "\nLine citations past the end of the file:\n  " +
        newOutOfRange.map((o) => o.msg).join("\n  "),
    );
  }
  if (added.length) {
    console.error("\nNew `path:LINE` citations (the ratchet):\n  " + added.join("\n  "));
    console.error(
      "\nCite the SYMBOL and a grep instead — a line number is broken by any insertion above it,\n" +
        "including one in the same commit. See AGENTS.md and docs/open-followups.md §131.",
    );
  }
  console.error(
    "\nIf a citation was legitimately REMOVED or converted to a symbol, re-baseline with:\n" +
      "  node scripts/check-doc-claims.mjs --update",
  );
  process.exit(1);
}

console.log(
  `doc-claims ratchet ok — ${totalCites} line citations across ${Object.keys(sortedCites).length} docs, none added` +
    ` (${knownUnresolved.size} unresolvable + ${knownOutOfRange.size} out-of-range grandfathered)`,
);
