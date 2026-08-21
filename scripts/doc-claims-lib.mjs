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
import { existsSync, readdirSync, statSync } from "node:fs";

// Extensions that denote a real source file. A bare `foo.io:80` or a version
// like `0.227.0` must never match, so the extension list is a closed set.
// ★★ LONGEST-FIRST, and it matters. `CITE_RE` survives any order because the `:`
// after the extension forces a backtrack, but `PATH_RE` has no such anchor: with
// `ts` before `tsx` it matched `notes-badge-button.tsx` as `notes-badge-button.ts`
// and invented phantom citations to files that do not exist across 25 DISTINCT
// truncated paths. ★ Quote the 25, not a total: totals move with the corpus
// (47 on the tree that first measured it, 45 on `73935dab`), so a bare count is
// unreproducible a week later. An even earlier draft said "20" — read off a
// display truncated at 20 lines, which is a floor, never a count.
// The `(?!...)` boundary in
// PATH_RE is the real guard; this order is the belt to its braces.
export const SOURCE_EXT = "tsx|ts|mjs|json|js|yaml|yml|css";

// ★★ `@` IS IN BOTH CLASSES ON PURPOSE. Without it a cite to a scoped package —
// `node_modules/@tiptap/core/dist/index.js:88` — parsed as
// `tiptap/core/dist/index.js`: the `@` split the token, taking the
// `node_modules/` prefix with it. THIRD_PARTY_RE's `@[\w.-]+/` branch was then
// unreachable from anything the parser produced, so a legitimate dependency
// citation landed in `unresolved` and FAILED the gate on a branch that was fine.
// Found cold-review 2026-08-09; the classifier's own unit tests passed the whole
// time because they feed it hand-written literals, never `citesOnLine` output.
export const CITE_RE = new RegExp(
  `([@A-Za-z0-9_][@A-Za-z0-9_/.-]*\\.(?:${SOURCE_EXT})):(\\d+)`,
  "g",
);

// ★★ CONTINUATION cites. Docs routinely write one path and then several bare
// line numbers: "`use-resource-planner.ts:710` and `:723`, returned at `:1023`".
// Only the FIRST carries a path, so CITE_RE saw one of that row's FOUR numbers —
// and the three it missed were all broken too. Measured 2026-08-09: 156 bare
// `:NNN` spans across the tracked docs.
//
// ★★★ ONLY the ones with a file MENTION earlier on the SAME LINE are resolved
// (56 of 156, measured 2026-08-09). ★★ This said "37 of the 150" until a cold
// review caught it: those are the counts under the REJECTED full-cite anchor,
// carried forward from the first implementation and never re-derived after the
// rule changed to the mention anchor described at `PATH_RE` below. The comment
// contradicted both the code beneath it and its own neighbour. ★ That reference
// was a LINE OFFSET ("15 lines below") and had already drifted to point at a
// blank line — in the file whose whole purpose is to gate line citations. Name
// the symbol.
// The other 100 take their path from a previous line or an adjacent
// table cell, and resolving those needs a nearest-preceding-path heuristic that
// WILL mis-attribute. The bare form is genuinely ambiguous, which is not a
// theory: AGENTS.md's `` `:3000` `` is a PORT NUMBER, and a cross-line rule
// would have hunted for a source file to hang it on. A gate that invents a
// citation is worse than one with a known blind spot. See open-followups §131.
// ★★ The optional `-N` tail catches a bare RANGE — `` `:113-116` ``. Without it
// the gate was blind to exactly the form AGENTS.md tells authors NOT to write
// ("cite the SYMBOL, not a line RANGE"): a full `a.ts:12-40` was already caught
// (CITE_RE stops at the first number), but its bare continuations were not.
// `docs/security/threat-model.md` carries two of them on one line today. Only
// the START line is checked — that is what the range claims to begin at.
export const BARE_CITE_RE = /`:(\d+)(?:[-–]\d+)?`/g;

// ★★★ The anchor is the nearest preceding FILE MENTION, with or without a line
// number — NOT the nearest preceding `path:LINE`. Measured: a first cut used the
// latter and mis-attributed four cites, across tooltip-inventory rows B10 AND
// B11 — not one row, as this comment said until it was re-measured. B10 reads
// "`insights-card.tsx:102` … `onAcknowledgeInsight` (`task-manager.tsx` — grep
// the symbol; `:821` …)". The bare numbers are task-manager's, but that mention
// carries no colon, so a full-cite anchor skipped past it to insights-card — a
// 152-line file — and reported four out-of-range violations that do not exist.
// A gate reporting a green branch as red is the expensive direction.
// ★★ The same re-measurement found a SECOND failure mode nothing had recorded:
// on three further bare cites the rejected anchor finds NO preceding full cite
// at all and silently DROPS them (`modal-header.tsx` ×2, `raci-chip-picker.tsx`),
// so it loses coverage as well as mis-attributing. Seven disagreements in that
// one file; reproduce by resolving each bare cite both ways and diffing.
export const PATH_RE = new RegExp(
  `[@A-Za-z0-9_][@A-Za-z0-9_/.-]*\\.(?:${SOURCE_EXT})(?![A-Za-z0-9_])`,
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

// Docs whose citations are in scope. `docs/superpowers/` holds per-slice working
// material — brainstorms, designs and plans — not shipped documentation. Its
// citations describe the tree as it stood when the slice was written, so gating
// them would fail on every historical document the moment the code moved.
// ★★ IT IS NO LONGER GITIGNORED. The rule was dropped on 2026-08-21 and the whole
// corpus (~456 files, 298 of them recovered from zip archives that were their only
// copy) committed. This skip is a HARDCODED path, never a read of `.gitignore`, so
// tracking them changed nothing here — but do not restore the old justification:
// "not in the repo" is now false, while the reason above still holds.
export const SKIP_DIRS = ["docs/superpowers"];

// ★★ ALL tracked prose docs outside `docs/`, not just the obvious three. A cold
// review found `CHANGELOG.md`, `CLAUDE.md` and the two `lib/*.md` operating
// guides were never scanned, so AGENTS.md's "a ratchet over every tracked doc"
// was false. All four hold zero citations today, so this closed a latent gap
// rather than a live one — which is exactly when it is cheap to close.
// ★ `src/app/__fixtures__/golden-workspace.md` is deliberately absent: it is a
// byte-pinned serializer FIXTURE, not prose, and scanning it would gate
// generated output.
export const ROOT_DOCS = [
  "AGENTS.md",
  "CHANGELOG.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "README.md",
  "lib/app-feature-guide.md",
  "lib/project-leadership-operating-guide.md",
];

// Walk with node's fs, NOT `git ls-files` — the slim CI image has no git.
// ★★★ THE PARAMETER EXISTS SO ONE CONSTANT CAN SERVE TWO INCOMPATIBLE QUESTIONS.
// `check-doc-claims.mjs` asks "which docs do I SCAN for claims" and must keep
// skipping `docs/superpowers` — see SKIP_DIRS. `check-followup-claims.mjs` asks
// "does this path EXIST", and for that question the skip is simply wrong: the
// corpus has been tracked since 0.253.0, so reporting a present spec as
// PATH_MISSING is a false finding. Same tree, two questions.
// ★★ The DEFAULT is the blocking gate's contract. Changing it is a pipeline
// change; a test pins it.
export function collectDocs(skipDirs = SKIP_DIRS) {
  const fromDocs = readdirSync("docs", { recursive: true, encoding: "utf8" })
    .map((f) => `docs/${f}`.replace(/\\/g, "/"))
    .filter((f) => f.endsWith(".md"))
    .filter((f) => !skipDirs.some((d) => f.startsWith(`${d}/`)));
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

/** The index for "does this path exist", as distinct from `collectSources()`'s
 *  "is this a citable code file".
 *
 *  ★★★ TWO QUESTIONS, TWO INDEXES, AND CONFLATING THEM IS THE BUG THIS CLOSES.
 *  A citation always points at code, so `collectSources()` is exactly right for
 *  it. A register entry names DOCS as freely as code — the specs it defers to,
 *  the baselines the sibling gates read, a markdown fixture under `src/`. Handed
 *  a code-only index, every one of those reported PATH_MISSING.
 *
 *  ★★ WIDER, NOT UNCONDITIONAL. Every member is a file that EXISTS, so a path
 *  the register names and the tree no longer holds still reports PATH_MISSING —
 *  that is the whole finding, and tests pin both directions.
 *
 *  ★★ `md` IS THE ENTIRE WIDENING over the code tree, and that is a derivation
 *  rather than a guess: `pathsIn` accepts `tsx|ts|mjs|json|css|md|yml`, and every
 *  one of those except `md` is already in `SOURCE_EXT`. Widening further would
 *  add suffix-collision risk to `resolveCandidates` for no reachable case. If
 *  `pathsIn`'s alternation ever grows, revisit this comment, not just the code. */
export function collectResolutionSources() {
  const codeTreeDocs = [];
  for (const dir of ["src", "scripts", "e2e"]) {
    let entries;
    try {
      entries = readdirSync(dir, { recursive: true, encoding: "utf8" });
    } catch {
      continue; // absent in a partial checkout — same posture as collectSources
    }
    for (const f of entries) {
      const p = `${dir}/${f}`.replace(/\\/g, "/");
      if (p.endsWith(".md")) codeTreeDocs.push(p);
    }
  }
  // ★★★ THE NON-MARKDOWN HALF OF `docs/` IS LOAD-BEARING AND IS NOT `collectDocs`'s.
  // The register cites `docs/baselines/file-sizes.json` three times, plus
  // `followup-claims.json`, `doc-line-cites.json` and `jscpd-2026-07.json`. None
  // is under the code tree and none ends in `.md`, so dropping this loop would
  // turn six resolving citations into fresh PATH_MISSING findings — the exact
  // false-positive class this function exists to remove, reintroduced by the fix.
  // ★★ UNGUARDED, on purpose, and the reasoning came with the code: a truncated
  // index is indistinguishable from a deleted file, so every missing asset would
  // report PATH_MISSING — a screen of false findings under a tool that exits 0.
  // An unreadable `docs/` must throw. (`readFileSync(REGISTER)` in the caller
  // reads inside `docs/` and throws first anyway.)
  const docAssets = [];
  for (const f of readdirSync("docs", { recursive: true, encoding: "utf8" })) {
    const p = `docs/${f}`.replace(/\\/g, "/");
    if (p.endsWith(".md")) continue; // `collectDocs([])`'s half, just above
    if (existsSync(p) && statSync(p).isFile()) docAssets.push(p);
  }
  return [
    ...new Set([
      ...collectSources(),
      // ★ `[]` — the follow-up resolver is the one caller entitled to see the
      // planning corpus. See `collectDocs`.
      ...collectDocs([]).filter((d) => (ROOT_DOCS.includes(d) ? existsSync(d) : true)),
      ...codeTreeDocs,
      ...docAssets,
    ]),
  ];
}

// ★ A fenced block holds EXAMPLES — command output, stack traces, sample code.
// A `foo.ts:12` in there is not a claim about this repo, and gating it would
// make the rule fire on its own documentation. Prose is what makes claims.
// ★★★ This was a six-line parity toggle on `/^\s*```/` and had FOUR failure
// modes, three of them one authoring habit away. All four were reproduced in a
// cold review on 2026-08-09; the first already exists in the corpus.
//   1. A BLOCKQUOTED fence (`> ```bash`) did not match, so every command inside
//      it was scanned as prose. README.md carries one today — harmless only
//      because its content happens to hold nothing cite-shaped.
//   2. A TILDE fence (`~~~`) was not recognised at all.
//   3. A line holding an INLINE triple-backtick span toggled the parity, so
//      everything from there to the next fence line silently vanished from the
//      scan — a mass false NEGATIVE, and a baseline churn when someone reflows.
//   4. NESTED fences (` ````md ` wrapping ` ```js `) closed at the inner fence,
//      leaking fenced content back out as prose.
// The fix is CommonMark's own rule, not a bigger regex: a fence OPENS on a line
// that is a run of >=3 of one char plus an info string containing NO fence char,
// and CLOSES only on a run of the SAME char at least as long, with nothing after
// it. An info string is why "fence line and nothing else" would be wrong for the
// opener, and why the closer has to be stricter than the opener.
const FENCE_RE = /^\s*(?:>\s?)*(`{3,}|~{3,})([^`~]*)$/;

export function stripFencedBlocks(text) {
  const lines = text.split(/\r?\n/);
  let open = null; // { char, len } while inside a fence
  return lines.map((l) => {
    const m = FENCE_RE.exec(l);
    if (m) {
      const char = m[1][0];
      const len = m[1].length;
      if (open === null) {
        open = { char, len };
        return "";
      }
      // A closer takes no info string and must match the opener's char and
      // reach its length — otherwise it is content inside the block.
      if (char === open.char && len >= open.len && m[2].trim() === "") {
        open = null;
        return "";
      }
      return "";
    }
    return open !== null ? "" : l;
  });
}

// ★★ The number of lines a reader can actually CITE. `split("\n").length` is one
// MORE than that for a newline-terminated file — the trailing element is the
// empty string after the last newline, not a line. Counting it let a citation to
// exactly one past the end pass the range check, and made every failure message
// overstate the file by one ("file has 184 lines" for a 183-line file).
// ★ `check-file-sizes.mjs` deliberately counts the OTHER way; do not "align"
// them. That gate asks how big a file is, this one asks what line numbers exist.
export function countLines(text) {
  if (text === "") return 0; // an empty file has no line 1 to cite
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
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
// ★ A URL is not a citation. `https://github.com/x/y/blob/main/app.js:12` parsed
// as a cite to `github.com/x/y/blob/main/app.js`, which resolves to nothing and
// would FAIL the gate on a doc that merely links to code. The host always sits
// directly after `//`, so that is the whole test.
const isUrlPath = (line, index) => line.slice(Math.max(0, index - 2), index) === "//";

export function citesOnLine(line) {
  const out = [...line.matchAll(CITE_RE)]
    .filter((m) => !isUrlPath(line, m.index))
    .map((m) => ({
      citedPath: m[1],
      lineNo: m[2],
      index: m.index,
    }));
  // A URL host is not an anchor either, or a bare `:N` after a link would be
  // attributed to a "file" that is really github.com/....
  const mentions = [...line.matchAll(PATH_RE)].filter((m) => !isUrlPath(line, m.index));
  for (const b of line.matchAll(BARE_CITE_RE)) {
    const anchor = mentions.filter((f) => f.index < b.index).pop();
    if (anchor) out.push({ citedPath: anchor[0], lineNo: b[1], index: b.index });
  }
  return out.sort((a, b) => a.index - b.index);
}
