// Pure citation-parsing logic for the doc-claims ratchet, split out of
// `check-doc-claims.mjs` so it can be unit-tested. The driver script keeps the
// filesystem walk, the baseline diff and the reporting; everything a bug has
// actually lived in lives here.
//
// ★★★ EVERY DEFECT THIS GATE HAS SHIPPED WAS IN THIS FILE'S REGEXES, and every
// one was found by RUNNING it against the real docs, never by reading it. Two in
// the first hour: an anchor that skipped a colon-less file mention, and an
// extension alternation that truncated `.tsx` to `.ts`. Both reported a green
// branch as red — dozens of violations that did not exist. That is why this is a
// module with a test rather than a hundred lines inside a CI script nobody runs
// locally. Add a case here before changing a pattern.
import { readdirSync } from "node:fs";

// Extensions that denote a real source file. A bare `foo.io:80` or a version
// like `0.227.0` must never match, so the extension list is a closed set.
// ★★ LONGEST-FIRST, and it matters. `CITE_RE` survives any order because the `:`
// after the extension forces a backtrack, but `PATH_RE` has no such anchor: with
// `ts` before `tsx` it matched `notes-badge-button.tsx` as `notes-badge-button.ts`
// and reported 47 phantom citations to files that do not exist (58 unresolvable
// against the fixed pattern's 11, over 25 distinct truncated paths). The
// first write of that comment said "20" — read off a display truncated at 20
// lines, which is a floor, never a count. The `(?!...)` boundary in
// PATH_RE is the real guard; this order is the belt to its braces.
export const SOURCE_EXT = "tsx|ts|mjs|json|js|yaml|yml|css";

export const CITE_RE = new RegExp(
  `([A-Za-z0-9_][A-Za-z0-9_/.-]*\\.(?:${SOURCE_EXT})):(\\d+)`,
  "g",
);

// ★★ CONTINUATION cites. Docs routinely write one path and then several bare
// line numbers: "`use-resource-planner.ts:710` and `:723`, returned at `:1023`".
// Only the FIRST carries a path, so CITE_RE saw one of that row's FOUR numbers —
// and the three it missed were all broken too. Measured 2026-08-09: 150 bare
// `:NNN` spans across the tracked docs.
//
// ★★★ ONLY the ones with a full cite EARLIER ON THE SAME LINE are resolved (37
// of the 150). The other 113 take their path from a previous line or an adjacent
// table cell, and resolving those needs a nearest-preceding-path heuristic that
// WILL mis-attribute. The bare form is genuinely ambiguous, which is not a
// theory: AGENTS.md's `` `:3000` `` is a PORT NUMBER, and a cross-line rule
// would have hunted for a source file to hang it on. A gate that invents a
// citation is worse than one with a known blind spot. See open-followups §131.
export const BARE_CITE_RE = /`:(\d+)`/g;

// ★★★ The anchor is the nearest preceding FILE MENTION, with or without a line
// number — NOT the nearest preceding `path:LINE`. Measured: a first cut used the
// latter and mis-attributed four cites. `tooltip-inventory.md` row B10 reads
// "`insights-card.tsx:102` … `onAcknowledgeInsight` (`task-manager.tsx` — grep
// the symbol; `:821` …)". The bare numbers are task-manager's, but that mention
// carries no colon, so a full-cite anchor skipped past it to insights-card — a
// 153-line file — and reported four out-of-range violations that do not exist.
// A gate reporting a green branch as red is the expensive direction.
export const PATH_RE = new RegExp(
  `[A-Za-z0-9_][A-Za-z0-9_/.-]*\\.(?:${SOURCE_EXT})(?![A-Za-z0-9_])`,
  "g",
);

// ★★ A citation into a DEPENDENCY is not repo debt and must not be counted as
// it. Ten of the eleven originally-grandfathered "unresolvable" cites were
// dompurify / prosemirror / vitest / eslint-plugin internals — legitimate
// references to code this repo does not own and cannot fix. Lumping them in
// made the debt look 11× worse than the ONE real broken pointer, which is the
// fastest way to get a number ignored.
// ★ They are not harmless: they rot silently on any upgrade, and
// `vitest/dist/chunks/coverage.DM_a_rWm.js` carries a CONTENT HASH in its
// filename, so that one is guaranteed to break and nothing will announce it.
// Classified, not exempted — `thirdParty` is reported separately every run.
export const THIRD_PARTY_RE =
  /^(?:node_modules\/|(?:vitest|eslint|dompurify|prosemirror-\w+|@[\w.-]+)\/)|^(?:purify\.cjs|minimatch|version)\.js$|^(?:lib\/util|rules)\//;

// Docs whose citations are in scope. `docs/superpowers/` is gitignored working
// material, not shipped documentation — scanning it would gate files that are
// not in the repo.
export const SKIP_DIRS = ["docs/superpowers"];
export const ROOT_DOCS = ["AGENTS.md", "CONTRIBUTING.md", "README.md"];

// Walk with node's fs, NOT `git ls-files` — the slim CI image has no git.
export function collectDocs() {
  const fromDocs = readdirSync("docs", { recursive: true, encoding: "utf8" })
    .map((f) => `docs/${f}`.replace(/\\/g, "/"))
    .filter((f) => f.endsWith(".md"))
    .filter((f) => !SKIP_DIRS.some((d) => f.startsWith(`${d}/`)));
  return [...ROOT_DOCS, ...fromDocs].sort();
}

// Index every source file once, so a partial cite like `jira/_helpers.ts:115`
// (really `src/app/api/jira/_helpers.ts`) can still be resolved by suffix.
export function collectSources() {
  const out = [];
  const isSource = new RegExp(`\\.(?:${SOURCE_EXT})$`);
  for (const dir of ["src", "scripts", "e2e"]) {
    let entries;
    try {
      entries = readdirSync(dir, { recursive: true, encoding: "utf8" });
    } catch {
      continue; // directory absent in a partial checkout — not this gate's problem
    }
    for (const f of entries) {
      const p = `${dir}/${f}`.replace(/\\/g, "/");
      if (isSource.test(p)) out.push(p);
    }
  }
  // ★ Root-level config files are cited too (`vitest.config.ts:24`,
  // `.gitlab-ci.yml:99`) and live in none of the three directories above.
  // Omitting them made every such citation look deleted on the first run.
  for (const f of readdirSync(".", { encoding: "utf8" })) {
    const p = f.replace(/\\/g, "/");
    if (isSource.test(p)) out.push(p);
  }
  return out;
}

// ★ A fenced block holds EXAMPLES — command output, stack traces, sample code.
// A `foo.ts:12` in there is not a claim about this repo, and gating it would
// make the rule fire on its own documentation. Prose is what makes claims.
export function stripFencedBlocks(text) {
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

export function resolveCandidates(citedPath, sources) {
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

// Every citation a single line makes: the explicit `path:LINE` ones, plus each
// bare `` `:LINE` `` attributed to the nearest file MENTION to its LEFT. A bare
// span with no mention before it on the same line is skipped — see BARE_CITE_RE.
export function citesOnLine(line) {
  const out = [...line.matchAll(CITE_RE)].map((m) => ({
    citedPath: m[1],
    lineNo: m[2],
    index: m.index,
  }));
  const mentions = [...line.matchAll(PATH_RE)];
  for (const b of line.matchAll(BARE_CITE_RE)) {
    const anchor = mentions.filter((f) => f.index < b.index).pop();
    if (anchor) out.push({ citedPath: anchor[0], lineNo: b[1], index: b.index });
  }
  return out.sort((a, b) => a.index - b.index);
}
