import { describe, expect, it } from "vitest";
import {
  BLOCK_NAMES,
  claimViolations,
  gapViolations,
  PACK_FILES,
  parityViolations,
  parseBlocks,
  proseGapCitations,
  proseGapViolations,
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
    ["en", "your data never leaves the network"],
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
    ["en", "Never sent: e-mail addresses, note logs and a person's phone number."],
  ])("does not flag %s: %s", (lang, text) => {
    expect(claimViolations(text, lang), text).toEqual([]);
  });

  it("names the line", () => {
    expect(claimViolations("ok\nbad compliant\n", "en")[0]).toContain("line 2");
  });

  it("rejects an unknown language", () => {
    expect(() => claimViolations("x", "fr")).toThrow();
  });

  it.each([
    ["en", "Your data never\nleaves the device.", "line 3", "never leaves"],
    ["en", "The app complies\nwith the GDPR.", "line 3", "complies with"],
    ["en", "It is not\nhigh-risk.", "line 3", "not high-risk"],
    ["de", "Die App ist kein\nHochrisiko-System.", "line 3", "kein Hochrisiko"],
  ])("flags a %s phrase split across a hard wrap, naming its first line: %j", (lang, para, line, label) => {
    const out = claimViolations(`# Title\n\n${para}\n`, lang);
    expect(out).toEqual([`${line}: denied phrase "${label}"`]);
  });

  it("follows a hard wrap inside a blockquote and a list item", () => {
    expect(claimViolations("> Data never\n> leaves the device.", "en")).toEqual(['line 1: denied phrase "never leaves"']);
    expect(claimViolations("- Data never\n  leaves the device.", "en")).toEqual(['line 1: denied phrase "never leaves"']);
  });

  it("does not join across a blank line, a heading, a list item or a table row", () => {
    expect(claimViolations("Data never\n\nleaves.", "en")).toEqual([]);
    expect(claimViolations("Data never\n## leaves", "en")).toEqual([]);
    expect(claimViolations("- data never\n- leaves", "en")).toEqual([]);
    expect(claimViolations("Data never\n| leaves | x |", "en")).toEqual([]);
  });

  it("checks table rows one row at a time, as before", () => {
    expect(claimViolations("| a | b |\n|---|---|\n| never | x |\n| leaves | y |", "en")).toEqual([]);
    expect(claimViolations("| a | b |\n|---|---|\n| x | it is compliant |", "en")).toEqual(['line 3: denied phrase "compliant"']);
  });

  it("still exempts fenced code across lines", () => {
    expect(claimViolations("Text\n```\nnever\nleaves\n```\n", "en")).toEqual([]);
  });

  it("keeps the quote exemption on wrapped text: short spans pass, long ones are checked", () => {
    expect(claimViolations('We never say "data never\nleaves" here.', "en")).toEqual([]);
    const long = '"The whole product is fully and in every\nrespect compliant with every rule there is"';
    expect(claimViolations(long, "en")).toEqual(['line 2: denied phrase "compliant"']);
  });

  it("reports a phrase on a later line of a paragraph at that line", () => {
    expect(claimViolations("First line is fine.\nSecond line is compliant.", "en")).toEqual(['line 2: denied phrase "compliant"']);
  });
});

describe("proseGapCitations", () => {
  it("collects register citations with their lines, outside generated blocks and fences", () => {
    const src = [
      "See §794 and §805.", // 1
      "<!-- PACK:open-gaps:BEGIN -->", // 2
      "| §999 | generated |", // 3
      "<!-- PACK:open-gaps:END -->", // 4
      "```", // 5
      "§888", // 6
      "```", // 7
      "Also §810.", // 8
    ].join("\n");
    expect(proseGapCitations(src)).toEqual([
      { n: 794, line: 1 },
      { n: 805, line: 1 },
      { n: 810, line: 8 },
    ]);
  });

  it.each([
    "the co-determination right (§87(1) No. 6)",
    "§ 87 Abs. 1 Nr. 6 BetrVG",
    "BetrVG §90",
    "§§ 87, 90 und 80 BetrVG",
    "§ 80 Abs. 3 BetrVG",
    "§90(2)",
    "§ 412 BGB",
    "BDSG §426",
    "§450 Abs. 2",
    "§401 SGB",
    "§§ 412, 413",
    "§ 87 BetrVG",
    "BetrVG §87",
    "§611a BGB",
    "§§ 87, 90 und 80",
    "§ 810 BetrVG",
    "§450 Satz 2",
    "KI-VO §450",
    "§412 DSGVO",
    "§412 DS-GVO",
    "GDPR §412",
    "TDDDG §425",
    "§412 TTDSG",
    "ArbVG §496",
    "HGB §438",
    "§412 UWG",
    "SGB IX §412",
  ])("ignores a statute section: %s", (text) => {
    expect(proseGapCitations(text)).toEqual([]);
  });

  it.each([
    ["§400", [400]],
    ["(register §794)", [794]],
    ["§801, §802", [801, 802]],
    ["[vendor statement; register §810]", [810]],
    ["Register §562 und §487.", [562, 487]],
    ["AI §805", [805]],
    ["KI §801", [801]],
    ["EU §801", [801]],
    ["§810 KI-Funktionen", [810]],
    ["§794 RACI", [794]],
    ["the GDPR text and §810", [810]],
  ])("takes a register citation: %s", (text, numbers) => {
    expect(proseGapCitations(text).map((c) => c.n)).toEqual(numbers);
  });
});

describe("proseGapViolations", () => {
  const register = [
    "## 401. Open one",
    "## 402. Done — CLOSED 2026-11-06",
    "## 403. Open but uncited",
  ].join("\n");

  it("accepts an open, cited entry and ignores statute sections", () => {
    expect(proseGapViolations("Gap §401. See §87(1) and § 90 BetrVG.", [401], register)).toEqual([]);
  });

  it("treats a capitalised word that is not a statute abbreviation as prose, not a statute", () => {
    const reg = ["## 805. Open AI one", "## 801. Open KI one", "## 810. Open", "## 794. Open"].join("\n");
    const text = ["AI §805", "KI §801", "EU §801", "§810 KI-Funktionen", "§794 RACI"].join("\n");
    expect(proseGapViolations(text, [794, 801, 805, 810], reg)).toEqual([]);
    expect(proseGapViolations(text, [], reg)).toEqual([
      "line 1: §805 is cited but is not in CITED_GAPS (pack-config.mjs)",
      "line 2: §801 is cited but is not in CITED_GAPS (pack-config.mjs)",
      "line 3: §801 is cited but is not in CITED_GAPS (pack-config.mjs)",
      "line 4: §810 is cited but is not in CITED_GAPS (pack-config.mjs)",
      "line 5: §794 is cited but is not in CITED_GAPS (pack-config.mjs)",
    ]);
    expect(proseGapViolations("AI §806", [], reg)).toEqual(["line 1: §806 is cited but is not in the register"]);
  });

  it("flags a closed entry, a missing entry and an open entry left out of CITED_GAPS, with lines", () => {
    expect(proseGapViolations("ok\n§402 and §499\n§403", [401, 402, 403], register)).toEqual([
      "line 2: §402 is cited but is closed",
      "line 2: §499 is cited but is not in the register",
    ]);
    expect(proseGapViolations("§403", [401], register)).toEqual([
      "line 1: §403 is cited but is not in CITED_GAPS (pack-config.mjs)",
    ]);
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
