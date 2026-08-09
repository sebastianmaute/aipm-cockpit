// Unit tests for the doc-claims ratchet's parsing layer.
//
// ★★★ THIS SUITE EXISTS BECAUSE EVERY DEFECT THE GATE SHIPPED WAS A REGEX
// DEFECT, and both were found by running it against the real docs rather than by
// reading it. A gate that reports a green branch as red is the expensive
// direction — it sends someone hunting for breakage that is not there — so the
// false-POSITIVE cases below matter at least as much as the true ones.
// Each `regression:` test names the defect it pins. Do not delete one without
// re-measuring the behaviour it describes against `docs/`.
//
// ★★★ MUTATION-PROVED — and an earlier version of THIS COMMENT was the most
// dangerous thing in the file. It said `SOURCE_EXT` ordering and PATH_RE's
// `(?!...)` lookahead were REDUNDANT guards, so "removing either ALONE is an
// equivalent mutant". That is true of the ORDER and FALSE of the LOOKAHEAD.
// Differential fuzz over 784 inputs, run by a cold reviewer and re-verified
// here: dropping the order changes 0 outputs; dropping the lookahead changes
// 336 — `` `foo.tsxx` `` yields a phantom anchor to `foo.tsx`, and
// `tsconfig.jsonc` to `tsconfig.json`. The mutant survived my harness only
// because no test fed it an extension-suffixed name. I had a TEST GAP and
// recorded it as proof the code was redundant, in a comment a future
// contributor would read as licence to delete a live guard. There is now a test
// (".tsxx is not .tsx"), and dropping the lookahead alone turns it red.
// ★★★ THE GENERAL RULE, which the first version got backwards: a surviving
// mutant is a QUESTION, not a verdict — and the two answers are "equivalent
// mutant" and "missing test", which look identical from the harness. Deciding
// between them requires an input the suite does not contain, so you must go
// LOOKING for one. Assuming equivalence is how a guard gets deleted later.
// ★ The order genuinely IS redundant (0 of 784), so it is belt to the
// lookahead's braces — that half of the original claim survived checking.
import { describe, expect, it } from "vitest";
import {
  citesOnLine,
  collectDocs,
  collectSources,
  countLines,
  resolveCandidates,
  stripFencedBlocks,
  THIRD_PARTY_RE,
} from "./doc-claims-lib.mjs";

describe("countLines", () => {
  it("regression: does not count the empty string after a trailing newline", () => {
    // `split("\n").length` says 3 here. There is no line 3 to cite, so a
    // citation to :3 used to pass the range check.
    expect(countLines("a\nb\n")).toBe(2);
  });

  it("counts a file with no trailing newline", () => {
    expect(countLines("a\nb")).toBe(2);
  });

  it("counts a single line", () => {
    expect(countLines("a")).toBe(1);
  });

  it("treats an empty file as zero lines", () => {
    expect(countLines("")).toBe(0);
  });

  it("counts a lone newline as one line", () => {
    expect(countLines("\n")).toBe(1);
  });
});

const paths = (line) => citesOnLine(line).map((c) => `${c.citedPath}:${c.lineNo}`);

describe("citesOnLine — explicit path:LINE cites", () => {
  it("finds a single citation", () => {
    expect(paths("see `foo.ts:12` for details")).toEqual(["foo.ts:12"]);
  });

  it("finds several, in document order", () => {
    expect(paths("`a.ts:1` then `b/c.tsx:22` then `d.mjs:333`")).toEqual([
      "a.ts:1",
      "b/c.tsx:22",
      "d.mjs:333",
    ]);
  });

  it("ignores a version number and a host:port", () => {
    expect(paths("released 0.227.0 against foo.io:80 on port 3000")).toEqual([]);
  });

  it("reads a nested path", () => {
    expect(paths("`src/app/api/jira/_helpers.ts:117` logs it")).toEqual([
      "src/app/api/jira/_helpers.ts:117",
    ]);
  });
});

describe("citesOnLine — continuation cites", () => {
  it("attributes a bare `:N` to the path before it", () => {
    expect(paths("`use-resource-planner.ts:710` and `:723`")).toEqual([
      "use-resource-planner.ts:710",
      "use-resource-planner.ts:723",
    ]);
  });

  it("attributes several bare cites to the same anchor", () => {
    expect(paths("`x.ts:1`, then `:2`, `:3` and `:4`")).toEqual([
      "x.ts:1",
      "x.ts:2",
      "x.ts:3",
      "x.ts:4",
    ]);
  });

  it("regression: the anchor is the nearest preceding file MENTION, not the nearest cite", () => {
    // Measured from tooltip-inventory row B10. `task-manager.tsx` carries NO
    // line number, so a nearest-CITE anchor skipped past it and hung `:821` on
    // `insights-card.tsx` — 152 CITABLE lines — inventing an out-of-range failure.
    // (153 by `split`; the range check uses `countLines`, so 152 is the number
    // that decides this case. Do not "correct" it back — the two conventions are
    // both right and `doc-claims-lib.mjs` states which belongs to which gate.)
    expect(paths("`insights-card.tsx:102` … (`task-manager.tsx` — grep it; `:821`)")).toEqual([
      "insights-card.tsx:102",
      "task-manager.tsx:821",
    ]);
  });

  it("regression: a bare cite with no file mention before it is IGNORED", () => {
    // AGENTS.md's own `:3000` is a PORT. Attributing it to a file on a previous
    // line would make the gate invent a citation, which is worse than missing
    // one. Bare cites are same-line-only, on purpose.
    expect(paths("will attach to a stale `:3000` whose Tailwind is stale")).toEqual([]);
  });

  it("does not reach across to a LATER mention", () => {
    expect(paths("`:99` appears before `later.ts:5`")).toEqual(["later.ts:5"]);
  });

  it("switches anchor when a second file is mentioned", () => {
    expect(paths("`a.ts:1` and `:2`, then `b.ts` at `:9`")).toEqual([
      "a.ts:1",
      "a.ts:2",
      "b.ts:9",
    ]);
  });
});

describe("citesOnLine — extension matching", () => {
  it("regression: does not truncate .tsx to .ts", () => {
    // The alternation once tried `ts` first with nothing forcing the token to
    // end, so the ANCHOR path came back as `notes-badge-button.ts` — a file that
    // does not exist — producing phantom unresolvable citations across 25
    // distinct truncated paths. Quote the 25, never a bare total: totals move
    // with the corpus (it was 47 on the tree that first measured it, 45 a commit
    // later), so a bare count is unreproducible a week after it is written.
    expect(paths("`notes-badge-button.tsx` at `:25`")).toEqual(["notes-badge-button.tsx:25"]);
  });

  it("regression: does not truncate .json to .js", () => {
    expect(paths("`package.json` at `:3`")).toEqual(["package.json:3"]);
  });

  // NOT a truncation regression, despite sitting with two that are: `yml` is not
  // a prefix of `yaml`, so no alternation order can truncate it. Kept as a plain
  // positive case and labelled honestly — a vacuous test filed under
  // "regression" is worse than no test, because it is counted as cover.
  it("matches a .yaml anchor", () => {
    expect(paths("`ci.yaml` at `:7`")).toEqual(["ci.yaml:7"]);
  });

  it("still matches a plain .ts anchor", () => {
    expect(paths("`sanitize.ts` at `:25`")).toEqual(["sanitize.ts:25"]);
  });

  it("does not treat an unknown extension as a source file", () => {
    expect(paths("`notes.txt:12` and `readme.md:3`")).toEqual([]);
  });
});

describe("citesOnLine — cold-review regressions (2026-08-09)", () => {
  it("regression: a scoped package keeps its @ and stays one token", () => {
    // Without `@` in the char classes this parsed as `tiptap/core/dist/index.js`
    // — the `@` split the token and took the `node_modules/` prefix with it, so
    // a legitimate dependency citation was counted as repo debt and FAILED the
    // gate on a good branch.
    expect(paths("crash in `node_modules/@tiptap/core/dist/index.js:88`")).toEqual([
      "node_modules/@tiptap/core/dist/index.js:88",
    ]);
  });

  it("regression: THIRD_PARTY_RE classifies what citesOnLine ACTUALLY produces", () => {
    // ★ The classifier's other tests feed it hand-written literals, so its
    // `@scope` branch read as live while nothing the parser emitted could ever
    // reach it. Assert on the composed pipeline, not on the regex in isolation.
    const [cite] = citesOnLine("see `@tiptap/core/dist/index.js:88`");
    expect(cite.citedPath).toBe("@tiptap/core/dist/index.js");
    expect(THIRD_PARTY_RE.test(cite.citedPath)).toBe(true);
  });

  it("regression: a bare RANGE continuation is caught, at its start line", () => {
    // The exact form AGENTS.md tells authors not to write was the one form the
    // gate could not see. Live in docs/security/threat-model.md.
    expect(paths("`secrets.ts` at `:113-116`, iters `:46`")).toEqual([
      "secrets.ts:113",
      "secrets.ts:46",
    ]);
  });

  it("regression: a scoped package survives on the MENTION path too", () => {
    // ★★ A SEPARATE CODE PATH from the cite above: the anchor comes from
    // PATH_RE, so dropping `@` from PATH_RE alone reproduces the shipped defect
    // on continuations while every other test stays green. Measured: without it
    // the anchor becomes `tiptap/core/dist/index.js`.
    expect(paths("crash in `node_modules/@tiptap/core/dist/index.js` at `:88`")).toEqual([
      "node_modules/@tiptap/core/dist/index.js:88",
    ]);
  });

  it("regression: the extension must END the token (.tsxx is not .tsx)", () => {
    // ★★★ PATH_RE's `(?!...)` lookahead is NOT redundant with the longest-first
    // extension order, and a comment here claimed it was. Differential fuzz
    // over 784 inputs: dropping the ORDER changes nothing (0 differ), dropping
    // the LOOKAHEAD changes 336. Without it `foo.tsxx` yields a phantom anchor
    // to `foo.tsx`. This test is the one that would have caught the mislabel.
    expect(paths("`foo.tsxx` at `:5`")).toEqual([]);
    expect(paths("`tsconfig.jsonc` at `:5`")).toEqual([]);
  });

  it("regression: a URL with a line anchor is not a citation", () => {
    expect(paths("See https://github.com/x/y/blob/main/app.js:12 for detail")).toEqual([]);
  });

  it("regression: the URL guard needs TWO slashes, not one", () => {
    // A one-character guard would silently DROP real citations — a false
    // negative nothing announces.
    expect(paths("see /foo.ts:12 there")).toEqual(["foo.ts:12"]);
    expect(paths("(/src/app/x.ts:9)")).toEqual(["src/app/x.ts:9"]);
  });

  it("accepts an en-dash range, not just a hyphen", () => {
    // `BARE_CITE_RE` writes `[-–]` deliberately. No en-dash range exists in the
    // corpus today, so this pins an arm that is otherwise unreachable.
    expect(paths("`secrets.ts` at `:113–116`")).toEqual(["secrets.ts:113"]);
  });

  it("parses a full dotfile citation", () => {
    // resolveCandidates' dotfile test assumes this exact string; nothing else
    // pins that the PARSER produces it.
    expect(paths("`.gitlab-ci.yml:99` sets it")).toEqual(["gitlab-ci.yml:99"]);
  });

  it("returns citations sorted by position, mixing bare and full", () => {
    // "in document order" is what the sort exists for; the all-full-cite case
    // passes with the sort deleted, because matchAll already yields in order.
    expect(paths("`a.ts:1` `:2` `b.ts:3`")).toEqual(["a.ts:1", "a.ts:2", "b.ts:3"]);
  });

  it("regression: a URL host cannot anchor a bare continuation", () => {
    expect(paths("See https://github.com/x/y/app.js then `:12`")).toEqual([]);
  });

  it("a real cite still wins when a URL is also on the line", () => {
    expect(paths("https://example.com/a.js:9 but `real.ts:4` is ours")).toEqual(["real.ts:4"]);
  });
});

describe("stripFencedBlocks", () => {
  it("blanks lines inside a fence but keeps line positions", () => {
    const out = stripFencedBlocks(["before", "```", "`a.ts:1`", "```", "after"].join("\n"));
    expect(out).toEqual(["before", "", "", "", "after"]);
  });

  it("keeps prose citations outside a fence", () => {
    const out = stripFencedBlocks(["`a.ts:1`", "```", "`b.ts:2`", "```"].join("\n"));
    expect(out.filter(Boolean)).toEqual(["`a.ts:1`"]);
  });

  it("handles an indented fence", () => {
    const out = stripFencedBlocks(["  ```", "`a.ts:1`", "  ```"].join("\n"));
    expect(out.filter(Boolean)).toEqual([]);
  });

  it("handles CRLF input", () => {
    const out = stripFencedBlocks("before\r\n```\r\n`a.ts:1`\r\n```\r\nafter");
    expect(out).toEqual(["before", "", "", "", "after"]);
  });

  it("keeps an opener's info string working", () => {
    // The opener MAY carry an info string (```bash), which is why "a fence line
    // and nothing else" is the wrong rule for OPENING — only for closing.
    const out = stripFencedBlocks(["```bash", "`a.ts:1`", "```", "after"].join("\n"));
    expect(out.filter(Boolean)).toEqual(["after"]);
  });

  it("regression: strips a BLOCKQUOTED fence", () => {
    // Live shape in README.md today, harmless only by luck of content.
    const out = stripFencedBlocks(
      ["> run:", "> ```bash", "> node x.mjs # see doc-claims-lib.mjs:9999", "> ```"].join("\n"),
    );
    expect(out.filter(Boolean)).toEqual(["> run:"]);
  });

  it("regression: strips a TILDE fence", () => {
    const out = stripFencedBlocks(["~~~js", "see a.ts:1", "~~~", "prose b.ts:2"].join("\n"));
    expect(out.filter(Boolean)).toEqual(["prose b.ts:2"]);
  });

  it("regression: an inline ``` span does not invert fence state", () => {
    // This silently swallowed every line from the span to the next fence line.
    const out = stripFencedBlocks(["```a.ts:1``` is inline-ish", "prose b.ts:2"].join("\n"));
    expect(out.filter(Boolean)).toEqual(["```a.ts:1``` is inline-ish", "prose b.ts:2"]);
  });

  it("regression: a NESTED fence does not close the outer block", () => {
    const out = stripFencedBlocks(
      ["````md", "```js", "see a.ts:1", "```", "````", "prose b.ts:2"].join("\n"),
    );
    expect(out.filter(Boolean)).toEqual(["prose b.ts:2"]);
  });

  it("a tilde run cannot close a backtick fence", () => {
    const out = stripFencedBlocks(["```", "a.ts:1", "~~~", "b.ts:2", "```", "after"].join("\n"));
    expect(out.filter(Boolean)).toEqual(["after"]);
  });

  it("regression: a closer carrying an info string does not close", () => {
    // ```js INSIDE a block is content — realistic in any doc showing fenced
    // markdown. Without this the block ends early and leaks prose.
    const out = stripFencedBlocks(["```", "a.ts:1", "```js", "prose b.ts:2"].join("\n"));
    expect(out.filter(Boolean)).toEqual([]);
  });

  it("regression: a run of fewer than three fence chars is NOT a fence", () => {
    // ★★ The `{3,}` quantifier is load-bearing on live data. AGENTS.md and ONE
    // docs/AGENTS file (`ai-assistant.md`) each carry a prose line that OPENS
    // with a single `~` (an approximate measurement — "~20px narrower…"). Under
    // a 1+ quantifier each opens a phantom fence and swallows everything to the
    // next fence line. ★ TWO lines in two files, measured by running `FENCE_RE`
    // with `{1,}` over `collectDocs()` — NOT the four a naive `^ *~` grep
    // returns. The other three are saved only by a second `~` later on the same
    // line, which the info-string group rejects; that is luck, not a guard.
    // ★★★ A first version of this test used a line starting with ONE BACKTICK
    // and was VACUOUS: an inline code span closes with a second backtick, and
    // the info-string group `[^`~]*$` rejects that, so such a line is not a
    // fence under EITHER quantifier. The mutant survived and said so. The
    // opener must have no further fence char on the line — which is exactly
    // what makes the `~` prose lines the dangerous shape.
    const out = stripFencedBlocks(["~20px narrower when off", "prose b.ts:2"].join("\n"));
    expect(out.filter(Boolean)).toEqual(["~20px narrower when off", "prose b.ts:2"]);
  });

  it("an unterminated fence blanks to end of file", () => {
    const out = stripFencedBlocks(["prose a.ts:1", "```js", "code b.ts:2", "more c.ts:3"].join("\n"));
    expect(out).toEqual(["prose a.ts:1", "", "", ""]);
  });
});

describe("resolveCandidates", () => {
  const sources = [
    "src/app/sanitize.ts",
    "src/app/api/jira/_helpers.ts",
    "src/app/api/timelog/_helpers.ts",
    "src/app/other-helpers.ts",
    ".gitlab-ci.yml",
    "vitest.config.ts",
  ];

  it("matches an exact path", () => {
    expect(resolveCandidates("vitest.config.ts", sources)).toEqual(["vitest.config.ts"]);
  });

  it("matches a partial path on a segment boundary", () => {
    expect(resolveCandidates("jira/_helpers.ts", sources)).toEqual(["src/app/api/jira/_helpers.ts"]);
  });

  it("matches a bare basename", () => {
    expect(resolveCandidates("sanitize.ts", sources)).toEqual(["src/app/sanitize.ts"]);
  });

  it("regression: a basename must not match a longer basename ending in it", () => {
    // `helpers.ts` must never resolve to `other-helpers.ts`; the suffix branch
    // only accepts a match preceded by a `.` (the dotfile case).
    expect(resolveCandidates("helpers.ts", sources)).toEqual([]);
  });

  it("resolves a dotfile cited without its leading dot", () => {
    expect(resolveCandidates("gitlab-ci.yml", sources)).toEqual([".gitlab-ci.yml"]);
  });

  it("returns every candidate when a basename is ambiguous", () => {
    expect(resolveCandidates("_helpers.ts", sources)).toEqual([
      "src/app/api/jira/_helpers.ts",
      "src/app/api/timelog/_helpers.ts",
    ]);
  });

  it("returns nothing for a file that does not exist", () => {
    expect(resolveCandidates("nope.ts", sources)).toEqual([]);
  });

  it("regression: the three branches are a PRECEDENCE, not a union", () => {
    // ★★ A needle can match both the segment branch and the dot branch — two do
    // in this repo today. Unioning them widens the candidate set, and the driver
    // only reports out-of-range when EVERY candidate is exceeded, so a wider set
    // silently SUPPRESSES violations.
    const both = ["src/app/secrets.test.ts", "src/app/other.secrets.test.ts"];
    expect(resolveCandidates("secrets.test.ts", both)).toEqual(["src/app/secrets.test.ts"]);
  });
});

describe("collectSources / collectDocs", () => {
  // These run against the real tree, which is the point: they pin the WALK, and
  // the walk is where the one shipped defect in this file lived.
  it("regression: indexes root-level config files", () => {
    // ★★ Omitting these made every `vitest.config.ts:24` / `.gitlab-ci.yml:99`
    // citation look DELETED on the gate's first run. The comment recorded that
    // defect; nothing tested it until now.
    const sources = collectSources();
    expect(sources).toContain("vitest.config.ts");
    expect(sources).toContain(".gitlab-ci.yml");
  });

  it("indexes nested sources under src/", () => {
    expect(collectSources()).toContain("src/app/sanitize.ts");
  });

  it("normalises separators to forward slashes", () => {
    // readdirSync(..., {recursive:true}) yields backslashes on Windows, which is
    // where this repo is developed — a regression here breaks every resolve on
    // the dev machine only, and would look fine in CI.
    expect(collectSources().every((s) => !s.includes("\\"))).toBe(true);
  });

  it("seeds the root docs and scans docs/", () => {
    const docs = collectDocs();
    expect(docs).toContain("AGENTS.md");
    expect(docs).toContain("CHANGELOG.md");
    expect(docs).toContain("docs/open-followups.md");
  });

  it("excludes the gitignored superpowers working material", () => {
    // Scanning it would gate files that are not in the repo at all.
    expect(collectDocs().some((d) => d.startsWith("docs/superpowers/"))).toBe(false);
  });

  it("returns docs sorted", () => {
    const docs = collectDocs();
    expect(docs).toEqual([...docs].sort());
  });
});

describe("THIRD_PARTY_RE", () => {
  it.each([
    "node_modules/dompurify/dist/purify.cjs.js",
    "vitest/dist/chunks/coverage.DM_a_rWm.js",
    "vitest/runner/dist/chunk-artifact.js",
    "prosemirror-view/dist/index.js",
    "eslint/lib/rules/foo.js",
    "purify.cjs.js",
    "minimatch.js",
    "version.js",
    "lib/util/eslint.js",
    "rules/forward-ref-uses-ref.js",
  ])("classifies %s as third-party", (p) => {
    expect(THIRD_PARTY_RE.test(p)).toBe(true);
  });

  it.each([
    "src/app/sanitize.ts",
    "scripts/check-doc-claims.mjs",
    "e2e/a11y.spec.ts",
    "vitest.config.ts",
    "document-links-field.tsx",
    "task-manager.tsx",
  ])("does not classify repo path %s as third-party", (p) => {
    expect(THIRD_PARTY_RE.test(p)).toBe(false);
  });

  it("regression: the bare dompurify/ branch is reachable on its own", () => {
    // Every other dompurify fixture also matches via `node_modules/`, so this
    // branch was never exercised alone. A doc can cite it without the prefix.
    expect(THIRD_PARTY_RE.test("dompurify/dist/purify.cjs.js")).toBe(true);
  });

  it("regression: the bare-filename branch is anchored at both ends", () => {
    // Without the trailing `$`, `version.json` — real repo debt — would be
    // exempted as a dependency. A false negative that hides a broken cite.
    expect(THIRD_PARTY_RE.test("version.json")).toBe(false);
    expect(THIRD_PARTY_RE.test("minimatch.json")).toBe(false);
    expect(THIRD_PARTY_RE.test("version.js")).toBe(true);
  });

  it("regression: a dependency NAME inside a repo path is not third-party", () => {
    // Without the leading `^`, any repo path containing `eslint/` or `vitest/`
    // would be exempted.
    expect(THIRD_PARTY_RE.test("src/app/eslint/foo.js")).toBe(false);
    expect(THIRD_PARTY_RE.test("e2e/vitest/helper.ts")).toBe(false);
  });
});
