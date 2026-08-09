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
// ★★★ MUTATION-PROVED, and the result changed what this file says. Six injected
// defects: four died immediately (anchor-on-cite, first-mention-not-nearest,
// dropping resolveCandidates' dot boundary, disabling fence stripping). TWO
// SURVIVED — and investigating them showed the tests were right and the harness
// naive. `SOURCE_EXT` ordering and PATH_RE's `(?!...)` lookahead are REDUNDANT
// guards against the same truncation bug, so removing either ALONE is an
// equivalent mutant: the survivor still holds the line. Removing BOTH reproduces
// the shipped defect exactly (`.tsx`→`.ts`, `.json`→`.js`) and turns three tests
// red. ★★ The lesson is not "the guards are belt-and-braces", which the lib
// already said — it is that a surviving mutant is a QUESTION, not a verdict. Two
// of six here meant the harness was wrong; reading them as "vacuous tests" would
// have led to rewriting tests that were already correct.
import { describe, expect, it } from "vitest";
import {
  citesOnLine,
  resolveCandidates,
  stripFencedBlocks,
  THIRD_PARTY_RE,
} from "./doc-claims-lib.mjs";

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
    // `insights-card.tsx` — a 153-line file — inventing an out-of-range failure.
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
    // does not exist — producing 47 phantom unresolvable citations.
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
});
