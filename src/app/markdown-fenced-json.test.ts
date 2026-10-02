import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { readFencedJsonSection } from "./markdown-fenced-json";
import { expectLinearScaling } from "../test/scaling";

// The pre-§578 reader, kept verbatim (one of its eleven copies) as the oracle.
const oldInsights = (md: string) => /## Insights\s*\n+```json\s*\n([\s\S]*?)\n```/.exec(md)?.[1];

describe("readFencedJsonSection", () => {
  it("reads the block the codecs write", () => {
    const md = ["# Project", "", "## Insights", "", "```json", '[{"id":1}]', "```", ""].join("\n");
    expect(readFencedJsonSection(md, "Insights")).toBe('[{"id":1}]');
  });

  it("matches the old regex on hand-picked edge cases", () => {
    const cases = [
      "## Insights\n```json\n```",
      "## Insights\n```json\n\n```",
      "## Insights\n```json\n \n```",
      "## Insights\n```json \n\t\n```x\n```",
      "## Insights\r\n\r\n```json\r\n{}\r\n```",
      "## Insights  ```json\n{}\n```",
      "## Insights\n ```json\n{}\n```",
      "## Insights\n```json{}\n```",
      "## Insights\n```jsonx\n{}\n```",
      "## Insights\n```json\n{}",
      "## Insights\n```json\n{}\n``",
      "## Insightsx\n```json\n{}\n```",
      "## Insights\nnope\n## Insights\n```json\n[2]\n```",
      "## Insights\n```json\n[1]\n```\n## Insights\n```json\n[2]\n```",
      "## Insights\n```json\n[1]\n````",
      "## Insights \n```json \n[1]\n```",
      "## Insights\n```json\n\n\n```",
      "## Insights\n```json\n \n\n```",
      "",
      "## Insights",
    ];
    for (const md of cases) expect(readFencedJsonSection(md, "Insights"), JSON.stringify(md)).toBe(oldInsights(md));
  });

  it("matches the old regex on random section soup", () => {
    const token = fc.constantFrom(
      "## Insights", "## Insight", "## Documents", "```json", "```", "`", "json",
      "\n", "\r\n", "\n\n", " ", "\t", " ", "x", "[]", "{}",
    );
    fc.assert(
      fc.property(fc.array(token, { maxLength: 30 }), (parts) => {
        const md = parts.join("");
        expect(readFencedJsonSection(md, "Insights")).toBe(oldInsights(md));
      }),
      { seed: 578, numRuns: 5000 },
    );
  });

  // Hang backstop, not the guard: vitest cannot interrupt a synchronous test (see src/test/scaling.ts).
  it("stays linear on a long blank run after a heading with no fence", { timeout: 120_000 }, () => {
    // `\s*` and `\n+` both match "\n", so the old regex tried every split of the
    // run before ```json failed (§578: 32 / 125 / 501 ms at 10k / 20k / 40k
    // newlines, per heading). The second heading gives `check` a real block to
    // pin, read only after the first heading has failed. A ratio guard
    // (src/test/scaling.ts): linear ≈ 4, quadratic ≈ 16, limit 8 — a ms ceiling
    // fails a correct build on a loaded runner (§592, §612).
    expectLinearScaling({
      label: "readFencedJsonSection on a blank run",
      build: (n) => "## Insights" + "\n".repeat(n) + "x\n## Insights\n```json\n[]\n```\n",
      run: (md) => readFencedJsonSection(md, "Insights"),
      check: (out) => expect(out).toBe("[]"),
      n: 10_000,
    });
  });
});
