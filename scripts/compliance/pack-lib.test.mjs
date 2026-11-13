import { describe, expect, it } from "vitest";
import {
  BLOCK_NAMES,
  claimViolations,
  gapViolations,
  PACK_FILES,
  parityViolations,
  parseBlocks,
  replaceBlocks,
  reviewLineViolations,
  structureOf,
} from "./pack-lib.mjs";

const B = (name) => `<!-- PACK:${name}:BEGIN -->`;
const E = (name) => `<!-- PACK:${name}:END -->`;

describe("constants", () => {
  it("lists nine files and six block names", () => {
    expect(PACK_FILES).toHaveLength(9);
    expect(BLOCK_NAMES).toHaveLength(6);
  });
});

describe("parseBlocks", () => {
  it("reads a block body between its markers", () => {
    const src = ["# T", B("ai-paths"), "| a |", "| b |", E("ai-paths"), ""].join("\n");
    expect(parseBlocks(src)).toEqual({ blocks: [{ name: "ai-paths", body: "| a |\n| b |" }], errors: [] });
  });

  it("ignores markers inside a fenced code block", () => {
    const src = ["```", B("ai-paths"), "```", ""].join("\n");
    expect(parseBlocks(src)).toEqual({ blocks: [], errors: [] });
  });

  it("parses a CRLF file to the same blocks as its LF twin", () => {
    const lf = ["# T", B("open-gaps"), "x", E("open-gaps"), ""].join("\n");
    expect(parseBlocks(lf.replace(/\n/g, "\r\n"))).toEqual(parseBlocks(lf));
  });

  it("reports a marker that shares a line with prose, and ignores one in a fence", () => {
    expect(parseBlocks("text <!-- PACK:ai-paths:BEGIN -->").errors).toHaveLength(1);
    expect(parseBlocks("```\ntext <!-- PACK:ai-paths:BEGIN -->\n```").errors).toEqual([]);
    // 4 leading spaces: not a fence, so the marker below it is live (and unpaired)
    expect(parseBlocks("    ```\n<!-- PACK:ai-paths:BEGIN -->").errors).toHaveLength(1);
  });

  it("reports an unpaired BEGIN, a stray END, nesting, an unknown name and a repeated name", () => {
    expect(parseBlocks(B("ai-paths")).errors).toHaveLength(1);
    expect(parseBlocks(E("ai-paths")).errors).toHaveLength(1);
    expect(parseBlocks([B("ai-paths"), B("open-gaps"), E("open-gaps"), E("ai-paths")].join("\n")).errors.length).toBeGreaterThan(0);
    expect(parseBlocks([B("nope"), E("nope")].join("\n")).errors).toHaveLength(2);
    const twice = [B("ai-paths"), E("ai-paths"), B("ai-paths"), E("ai-paths")].join("\n");
    expect(parseBlocks(twice).errors.join(" ")).toContain("used twice");
  });
});

describe("replaceBlocks", () => {
  const lf = ["# T", B("ai-paths"), "old", E("ai-paths"), "tail", ""].join("\n");

  it("replaces only the named body", () => {
    expect(replaceBlocks(lf, { "ai-paths": "new1\nnew2\n" })).toBe(
      ["# T", B("ai-paths"), "new1", "new2", E("ai-paths"), "tail", ""].join("\n"),
    );
  });

  it("keeps CRLF line endings", () => {
    const crlf = lf.replace(/\n/g, "\r\n");
    const out = replaceBlocks(crlf, { "ai-paths": "new1\nnew2" });
    expect(out).toBe(out.replace(/\r?\n/g, "\r\n"));
    expect(out).toContain("new1\r\nnew2\r\n");
    expect(out.match(/(?<!\r)\n/g)).toBeNull();
  });

  it("leaves a block alone when it is not in the rendered map", () => {
    expect(replaceBlocks(lf, {})).toBe(lf);
  });

  it("refuses a file with malformed markers", () => {
    expect(() => replaceBlocks(B("ai-paths"), { "ai-paths": "x" })).toThrow();
  });
});

describe("structureOf", () => {
  it("returns heading runs and block names in order, skipping fences", () => {
    const src = ["# A", "## B", "```", "### no", "```", B("open-gaps"), E("open-gaps"), "### C"].join("\n");
    expect(structureOf(src)).toEqual({ headings: ["#", "##", "###"], blocks: ["open-gaps"] });
  });
});

describe("parityViolations", () => {
  const doc = ["# A", "## B", B("ai-paths"), E("ai-paths"), ""].join("\n");

  it("accepts equal structure with different prose", () => {
    expect(parityViolations({ "a.md": doc }, { "a.md": doc.replace("B", "Bee") })).toEqual([]);
  });

  it("flags a swapped heading level, naming the file", () => {
    const v = parityViolations({ "a.md": doc }, { "a.md": doc.replace("## B", "### B") });
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("a.md");
  });

  it("flags a block missing in DE, naming the file", () => {
    const v = parityViolations({ "a.md": doc }, { "a.md": "# A\n## B\n" });
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("a.md");
  });

  it("flags a file only in EN, naming the file", () => {
    const v = parityViolations({ "a.md": doc, "b.md": doc }, { "a.md": doc });
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("b.md");
  });

  it("flags a file only in DE, naming the file", () => {
    const v = parityViolations({ "a.md": doc }, { "a.md": doc, "c.md": doc });
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("c.md");
  });
});

describe("claimViolations", () => {
  it("flags DSGVO-konforme (hyphen compound with an adjective ending)", () => {
    expect(claimViolations("Eine DSGVO-konforme Lösung.", "de")).toHaveLength(1);
  });

  it("does not flag the quoted German claim", () => {
    expect(claimViolations("Wir sagen nicht „DSGVO-konform“.", "de")).toEqual([]);
  });

  it("flags every German ending form and the bare word", () => {
    for (const w of ["konform", "konforme", "konformer", "konformes", "konformen", "DSGVO-konform", "Konform"]) {
      expect(claimViolations(`Das ist ${w} so.`, "de"), w).toHaveLength(1);
    }
  });

  it("does not flag Konformität or Konformitätsbewertung", () => {
    expect(claimViolations("Die Konformitätsbewertung und Konformität.", "de")).toEqual([]);
  });

  it("flags compliant and non-compliant, not compliance", () => {
    expect(claimViolations("It is compliant.", "en")).toHaveLength(1);
    expect(claimViolations("It is non-compliant.", "en")).toHaveLength(1);
    expect(claimViolations("Compliance pack for compliance teams.", "en")).toEqual([]);
  });

  it("matches multi-word phrases case-insensitively with flexible spacing", () => {
    expect(claimViolations("Data NEVER  leaves the device.", "en")).toHaveLength(1);
    expect(claimViolations("Es ist Kein Hochrisiko.", "de")).toHaveLength(1);
  });

  it("does not match inside a longer word", () => {
    expect(claimViolations("Uncompliantly worded.", "en")).toEqual([]);
  });

  it("exempts fenced code, inline code and short quoted spans", () => {
    const src = [
      "```",
      "compliant",
      "```",
      "Use `compliant` here.",
      'He said "compliant".',
      "She said “compliant”.",
      "The app is \"compliant\"",
      "Fine.",
    ].join("\n");
    expect(claimViolations(src, "en")).toEqual([]);
  });

  it("flags a claim inside a quotation longer than 40 characters", () => {
    const long = '"The whole product is fully compliant with every rule there is"';
    expect(claimViolations(long, "en")).toHaveLength(1);
    expect(claimViolations("„Das ganze Produkt ist vollständig und überall DSGVO-konform ohne Ausnahme“", "de").length).toBeGreaterThan(0);
  });

  it("flags a claim on a blockquote line", () => {
    expect(claimViolations("> The app is compliant.", "en")).toHaveLength(1);
    expect(claimViolations("> Die App ist konform.", "de")).toHaveLength(1);
  });

  it("does not treat a 4-space-indented triple backtick as a fence", () => {
    expect(claimViolations("    ```\nIt is compliant.\n    ```", "en")).toHaveLength(1);
    expect(claimViolations("   ```\nIt is compliant.\n   ```", "en")).toEqual([]);
  });

  it.each([
    ["en", "never leave the device"],
    ["en", "no data leaves the device"],
    ["en", "it is never sent"],
    ["en", "data stays in the EU"],
    ["en", "the app complies with the GDPR"],
    ["en", "in compliance with the GDPR"],
    ["en", "EU hosted"],
    ["en", "hosted in Germany"],
    ["en", "not a high-risk system"],
    ["en", "access is instantly revoked"],
    ["de", "datenschutzkonform"],
    ["de", "Datenschutzkonform"],
    ["de", "verlässt niemals das Gerät"],
    ["de", "verlassen niemals das Gerät"],
    ["de", "verlässt die EU nie"],
    ["de", "ein DSGVO-Konformität garantiert"],
    ["de", "EU-gehostet"],
    ["de", "nicht hochriskant"],
    ["de", "Zugriff ist sofort widerrufbar"],
  ])("flags %s evasion form: %s", (lang, text) => {
    expect(claimViolations(text, lang), text).toHaveLength(1);
  });

  it.each([
    ["de", "Konformität"],
    ["de", "Konformitätsbewertung"],
    ["de", "Konformitätserklärung"],
    ["de", "Compliance-Paket"],
    ["en", "compliance"],
    ["en", "Compliance-Paket"],
    ["en", "the compliance pack"],
  ])("does not flag %s: %s", (lang, text) => {
    expect(claimViolations(text, lang), text).toEqual([]);
  });

  it("names the line", () => {
    expect(claimViolations("ok\nbad compliant\n", "en")[0]).toContain("line 2");
  });

  it("rejects an unknown language", () => {
    expect(() => claimViolations("x", "fr")).toThrow();
  });
});

describe("gapViolations", () => {
  const register = [
    "# Register",
    "## 1. Open one",
    "## 2. Done thing — CLOSED 2026-11-06",
    "## 3. Superseded — CLOSED 2026-11-06 (superseded by §800)",
    "## 4. Another open",
    "Some prose",
    "## Decided — do not re-litigate",
    "```",
    "## 9. fenced sample",
    "```",
  ].join("\n");

  it("accepts open entries", () => {
    expect(gapViolations([1, 4], register)).toEqual([]);
  });

  it("flags a closed entry, including one with text after the date", () => {
    expect(gapViolations([2, 3], register)).toHaveLength(2);
  });

  it("flags a number that is not in the register, fenced samples included", () => {
    expect(gapViolations([7, 9], register)).toHaveLength(2);
  });
});

describe("reviewLineViolations", () => {
  const en = (v, d) => `# R\n\nText last reviewed for version ${v} on ${d}.\n`;
  const de = (v, d) => `# R\n\nText zuletzt geprüft für Version ${v} am ${d}.\n`;

  it("accepts matching lines at or below the app version", () => {
    expect(reviewLineViolations(en("1.20.1", "2026-11-12"), de("1.20.1", "2026-11-12"), "1.20.1")).toEqual([]);
    expect(reviewLineViolations(en("1.9.0", "2026-11-12"), de("1.9.0", "2026-11-12"), "1.20.1")).toEqual([]);
  });

  it("flags differing dates", () => {
    expect(reviewLineViolations(en("1.20.1", "2026-11-12"), de("1.20.1", "2026-11-11"), "1.20.1")).toHaveLength(1);
  });

  it("flags differing versions", () => {
    expect(reviewLineViolations(en("1.20.0", "2026-11-12"), de("1.20.1", "2026-11-12"), "1.20.1")).toHaveLength(1);
  });

  it("flags a version above the app version, comparing numerically", () => {
    expect(reviewLineViolations(en("1.21.0", "2026-11-12"), de("1.21.0", "2026-11-12"), "1.20.1")).toHaveLength(2);
    expect(reviewLineViolations(en("1.100.0", "2026-11-12"), de("1.100.0", "2026-11-12"), "1.20.1")).toHaveLength(2);
  });

  it("flags a missing review line in either README", () => {
    expect(reviewLineViolations("# R\n", de("1.0.0", "2026-11-12"), "1.20.1")).toHaveLength(1);
    expect(reviewLineViolations(en("1.0.0", "2026-11-12"), "# R\n", "1.20.1")).toHaveLength(1);
    expect(reviewLineViolations("", "", "1.20.1")).toHaveLength(2);
  });

  it("reads a CRLF README", () => {
    const crlf = en("1.0.0", "2026-11-12").replace(/\n/g, "\r\n");
    expect(reviewLineViolations(crlf, de("1.0.0", "2026-11-12"), "1.20.1")).toEqual([]);
  });
});
