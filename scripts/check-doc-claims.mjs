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
import { readFileSync, writeFileSync } from "node:fs";
import {
  citesOnLine,
  collectDocs,
  collectSources,
  resolveCandidates,
  stripFencedBlocks,
  THIRD_PARTY_RE,
} from "./doc-claims-lib.mjs";

// ★ The parsing itself lives in doc-claims-lib.mjs, which has a unit test.
// Every defect this gate has shipped was a regex defect, so the regexes are the
// part that had to become testable; this file stays a driver — walk, diff the
// baseline, report.
const BASELINE = "docs/baselines/doc-line-cites.json";

const sources = collectSources();

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

const cites = {}; // doc -> citedPath -> count
const unresolved = [];
const outOfRange = [];
const thirdParty = [];

for (const doc of collectDocs()) {
  let text;
  try {
    text = readFileSync(doc, "utf8");
  } catch {
    continue; // an optional root doc may be absent
  }
  const lines = stripFencedBlocks(text);
  lines.forEach((line, i) => {
    for (const { citedPath, lineNo } of citesOnLine(line)) {
      cites[doc] ??= {};
      cites[doc][citedPath] = (cites[doc][citedPath] ?? 0) + 1;

      // ★ The key deliberately omits the DOC's own line number: doc line numbers
      // shift on every edit, so a key carrying one would churn the baseline on
      // unrelated changes — the same instability this gate exists to fight.
      const key = `${doc} :: ${citedPath}:${lineNo}`;
      const candidates = resolveCandidates(citedPath, sources);
      if (candidates.length === 0) {
        // A dependency path is unresolvable BY DESIGN — this repo does not ship
        // it. Record it, but never as repo debt.
        (THIRD_PARTY_RE.test(citedPath) ? thirdParty : unresolved).push({
          key,
          msg: `${doc}:${i + 1}  ${citedPath}:${lineNo} — no such file`,
        });
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
        thirdParty: thirdParty.map((t) => t.key).sort(),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `baseline written: ${totalCites} line citations across ${Object.keys(cites).length} docs` +
      ` (${unresolved.length} unresolvable, ${outOfRange.length} out of range, both grandfathered;` +
      ` ${thirdParty.length} third-party, classified not counted)`,
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
// 11 unresolvable and 8 out-of-range citations predate this gate. Failing on them
// would have made the gate unlandable, and a gate that cannot land protects
// nothing. They are recorded so the number can only fall.
//
// ★ 8, not the 5 the first cut reported: widening to continuation cites raised
// it. Re-measure this comment against the baseline file rather than trusting it.
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
    ` (${knownUnresolved.size} unresolvable + ${knownOutOfRange.size} out-of-range grandfathered;` +
    ` ${thirdParty.length} third-party, not repo debt)`,
);
