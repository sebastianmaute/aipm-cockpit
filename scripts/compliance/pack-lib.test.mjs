import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BLOCK_NAMES,
  BRIEF_FILES,
  claimViolations,
  evidenceViolations,
  figuresViolations,
  gapViolations,
  linkViolations,
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
  it("lists nine files and eight block names", () => {
    expect(PACK_FILES).toHaveLength(9);
    expect(BLOCK_NAMES).toHaveLength(8);
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

describe("AI briefs", () => {
  const figures = () => JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "docs", "briefs", "figures.json"), "utf8"));

  it("figuresViolations accepts the committed figures.json", () => {
    expect(figuresViolations(figures())).toEqual([]);
  });

  it("figuresViolations rejects mixed commits", () => {
    const a = "a".repeat(40);
    const b = "b".repeat(40);
    expect(figuresViolations({ ...figures(), commit: `${a} ${b}` })).toHaveLength(1);
    expect(figuresViolations({ ...figures(), commit: [a, b] })).toHaveLength(1);
    expect(figuresViolations({ ...figures(), commit: "abc123" })).toHaveLength(1);
    const f = figures();
    f.paths[0].commit = b;
    expect(figuresViolations(f)).toEqual(['figures.paths[0]: key "commit" is not allowed']);
  });

  it("figuresViolations rejects a key outside the allowlist", () => {
    expect(figuresViolations({ ...figures(), note: "x" })).toEqual(['figures: key "note" is not allowed']);
    const f = figures();
    f.behaviour.extra = 1;
    f.rates["claude-sonnet-5"].discount = 1;
    f.relayKeyCheck.runs[0].secret = "x";
    expect(figuresViolations(f)).toHaveLength(3);
    expect(figuresViolations({ ...figures(), schema: 2 })).toHaveLength(1);
  });

  it("figuresViolations checks free keys against a pattern", () => {
    const f = figures();
    f.behaviour.inferenceGeo["not ok!"] = 1;
    f.rates["a b"] = { input: 1, output: 1, cacheWrite: 1, cacheRead: 1 };
    expect(figuresViolations(f)).toHaveLength(2);
  });

  const appendix = ["| Id | Claim | Label | Source |", "|---|---|", "| E1 | one | l | s |", "| E2 | two | l | s |"].join("\n");

  it("evidenceViolations reports a missing id and a language mismatch", () => {
    const ok = { "en/ceo.md": "See E1 and E2.", "de/ceo.md": "Siehe E2 und E1." };
    expect(evidenceViolations(ok, appendix)).toEqual([]);
    const missing = { "en/ceo.md": "See E3.", "de/ceo.md": "Siehe E3." };
    expect(evidenceViolations(missing, appendix)).toHaveLength(2);
    const mismatch = { "en/cio.md": "See E1.", "de/cio.md": "Siehe E1 und E2." };
    expect(evidenceViolations(mismatch, appendix)).toEqual(["cio.md: evidence ids differ (en [E1]; de [E1, E2])"]);
  });

  it("evidenceViolations does not read E-numbers inside words or generated blocks", () => {
    const pages = { "en/x.md": ["RE12 and E9X", B("figures"), "E77", E("figures")].join("\n"), "de/x.md": "" };
    expect(evidenceViolations(pages, appendix)).toEqual([]);
  });

  it("claimViolations flags each brief deny phrase in en and de", () => {
    const en = [
      "It is GDPR-compliant.", "It is AI-Act-compliant.", "The service is EU-hosted.", "Data never leaves the EU.",
      "A sovereign setup.", "A human is always in the loop.", "It is fully auditable.", "Access is instantly revoked.",
      "Per-feature cost control exists.", "The savings are measured.", "It is secure.", "The gateway is proven.",
      "Anthropic guarantees deletion.",
    ];
    for (const line of en) expect(claimViolations(line, "en"), line).not.toHaveLength(0);
    const de = [
      "Das ist DSGVO-konform.", "Das ist KI-VO-konform.", "Das System ist in der EU gehostet.", "Das verlässt nie die EU.",
      "Eine souveräne Lösung.", "Es ist immer ein Mensch beteiligt.", "Es ist vollständig nachvollziehbar.",
      "Es ist vollständig auditierbar.", "Zugriff wird sofort widerrufen.", "Kostenkontrolle je Funktion ist da.",
      "Die Einsparungen sind gemessen.", "Das System ist sicher.", "Das Gateway ist belegt.", "Anthropic garantiert die Löschung.",
    ];
    for (const line of de) expect(claimViolations(line, "de"), line).not.toHaveLength(0);
  });

  it("brief deny phrases leave honest negations and neutral wording alone", () => {
    expect(claimViolations("We make no claim that this is GDPR \"compliant\".", "en")).toEqual([]);
    expect(claimViolations("Savings are not measured; see the open gap.", "en")).toEqual([]);
    expect(claimViolations("Access can be revoked, but not instantly.", "en")).toEqual([]);
    expect(claimViolations("Die Einsparung ist nicht gemessen.", "de")).toEqual([]);
    expect(claimViolations("Der Zugriff lässt sich widerrufen, nicht sofort.", "de")).toEqual([]);
  });

  it("brief gap citations must be open and listed", () => {
    const register = ["## 811. Open", "## 812. Done — CLOSED 2026-11-06"].join("\n");
    expect(proseGapViolations("Gap §811.", [811], register)).toEqual([]);
    expect(proseGapViolations("Gap §811.", [], register)).toHaveLength(1);
    expect(proseGapViolations("Gap §812.", [812], register)).toHaveLength(1);
  });

  it("the brief file list is exactly BRIEF_FILES", () => {
    const expected = ["ceo", "cio", "ciso", "caio", "coo", "dpo", "pm", "appendix"].map((n) => `${n}.md`);
    expect([...BRIEF_FILES]).toEqual(expected);
    for (const lang of ["en", "de"]) {
      const dir = join(import.meta.dirname, "..", "..", "docs", "briefs", lang);
      expect(readdirSync(dir).filter((n) => n.endsWith(".md")).sort()).toEqual([...expected].sort());
    }
  });
});

describe("AI briefs, fix round 1", () => {
  const figures = () => JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "docs", "briefs", "figures.json"), "utf8"));
  const mutate = (fn) => {
    const f = figures();
    fn(f);
    return figuresViolations(f);
  };

  it("figuresViolations rejects every wrong shape", () => {
    const cases = {
      "paths as an object": (f) => { f.paths = { a: 1 }; },
      "a path that is a string": (f) => { f.paths[0] = "x"; },
      "behaviour as an array": (f) => { f.behaviour = []; },
      "inferenceGeo value an object": (f) => { f.behaviour.inferenceGeo.global = { apiKey: "k" }; },
      "requests value a string": (f) => { f.behaviour.requests.off = "47"; },
      "documentedExceptionHitsOn value NaN": (f) => { f.behaviour.documentedExceptionHitsOn["project-proposal"] = NaN; },
      "hiddenWhenProtected an object": (f) => { f.hiddenWhenProtected = {}; },
      "hiddenWhenProtected holds an object": (f) => { f.hiddenWhenProtected = [{ id: "x" }]; },
      "hiddenWhenProtected holds a bad id": (f) => { f.hiddenWhenProtected = ["not ok!"]; },
      "fetchedAt an object": (f) => { f.rates.fetchedAt = { a: 1 }; },
      "fetchedAt not a date": (f) => { f.rates.fetchedAt = "yesterday"; },
      "runDate not a date": (f) => { f.runDate = "14.11.2026"; },
      "a rate that is a string": (f) => { f.rates["claude-sonnet-5"] = "cheap"; },
      "a rate field that is a string": (f) => { f.rates["claude-sonnet-5"].input = "2"; },
      "rates as an array": (f) => { f.rates = []; },
      "relayKeyCheck as an array": (f) => { f.relayKeyCheck = []; },
      "relayKeyCheck.runs as an object": (f) => { f.relayKeyCheck.runs = {}; },
      "a run that is a string": (f) => { f.relayKeyCheck.runs = ["text"]; },
      "a run with a string coldExtraMs": (f) => { f.relayKeyCheck.runs[0].coldExtraMs = "724"; },
      "warmExtraMs a string": (f) => { f.relayKeyCheck.warmExtraMs = "x"; },
      "a path number as a string": (f) => { f.paths[0].calls = "6"; },
      "a path number Infinity": (f) => { f.paths[0].usdPerCall = Infinity; },
      "a path id that is a number": (f) => { f.paths[0].id = 3; },
      "a behaviour number as a string": (f) => { f.behaviour.emailHitsOn = "0"; },
    };
    for (const [name, fn] of Object.entries(cases)) expect(mutate(fn), name).not.toHaveLength(0);
  });

  it("figuresViolations accepts a null warmExtraMs", () => {
    expect(mutate((f) => { f.relayKeyCheck.warmExtraMs = null; })).toEqual([]);
  });

  it("claimViolations flags the human-in-the-loop paraphrases", () => {
    for (const l of ["A person is always a human in the loop.", "There is always a human in the loop.", "Always a human in the loop."]) {
      expect(claimViolations(l, "en"), l).not.toHaveLength(0);
    }
    for (const l of ["Der Mensch ist immer beteiligt.", "Ein Mensch ist immer beteiligt.", "Es ist immer eine Person dabei, ein Mensch bleibt immer eingebunden."]) {
      expect(claimViolations(l, "de"), l).not.toHaveLength(0);
    }
  });

  const appendixOf = (ids, extra = "") =>
    ["| Id | Claim | Label | Source |", "|---|---|", ...ids.map((n) => `| E${n} | row |`), extra].join("\n");

  it("evidenceViolations counts appendix rows only outside generated blocks and fences", () => {
    const hidden = [appendixOf([1]), B("figures"), "| E2 | generated |", E("figures"), "```", "| E3 | fenced |", "```"].join("\n");
    const pages = { "en/a.md": "E2", "de/a.md": "E2" };
    expect(evidenceViolations(pages, hidden)).toHaveLength(2);
    expect(evidenceViolations({ "en/a.md": "E3", "de/a.md": "E3" }, hidden)).toHaveLength(2);
    expect(evidenceViolations({ "en/a.md": "E1", "de/a.md": "E1" }, hidden)).toEqual([]);
  });

  it("evidenceViolations requires equal EN and DE appendix row ids and checks DE pages against the DE appendix", () => {
    const pages = { "en/a.md": "E1", "de/a.md": "E1" };
    expect(evidenceViolations(pages, appendixOf([1, 2]), appendixOf([1, 2]))).toEqual([]);
    const unequal = evidenceViolations(pages, appendixOf([1, 2]), appendixOf([1]));
    expect(unequal).toEqual(["appendix: evidence row ids differ (en [E1, E2]; de [E1])"]);
    expect(evidenceViolations(pages, appendixOf([1]), appendixOf([2]))).toHaveLength(2);
  });

  it("linkViolations reports every unlinked page", () => {
    const files = ["ceo.md", "appendix.md"];
    const all = "[a](en/ceo.md) [b](en/appendix.md) [c](de/ceo.md) [d](de/appendix.md)";
    expect(linkViolations(all, files)).toEqual([]);
    expect(linkViolations(all.replace("[d](de/appendix.md)", ""), files)).toEqual(["README.md: no link to de/appendix.md"]);
    expect(linkViolations("", files)).toHaveLength(4);
  });

  it("the committed briefs README links to all sixteen pages and holds no deny-listed claim in either language", () => {
    const readme = readFileSync(join(import.meta.dirname, "..", "..", "docs", "briefs", "README.md"), "utf8");
    expect(linkViolations(readme, BRIEF_FILES)).toEqual([]);
    expect(claimViolations(readme, "en")).toEqual([]);
    expect(claimViolations(readme, "de")).toEqual([]);
  });
});

describe("AI briefs, tooling review", () => {
  const figures = () => JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "docs", "briefs", "figures.json"), "utf8"));
  const mutate = (fn) => {
    const f = figures();
    fn(f);
    return figuresViolations(f);
  };

  it("I1: the German deny list catches compounds ending in a denied stem", () => {
    for (const l of ["Datensouveränität ist gegeben.", "Digitale Souveränität.", "Eine datensouveräne Lösung."]) {
      expect(claimViolations(l, "de"), l).not.toHaveLength(0);
    }
  });

  it("I2: a protection state outside off/on/relay is rejected", () => {
    expect(mutate((f) => { f.paths[0].protection = "ON"; })).not.toHaveLength(0);
    expect(mutate((f) => { f.paths[0].protection = "maybe"; })).not.toHaveLength(0);
  });

  it("I3: usdPerCall must follow from the tokens at the listed rates, and the model must have rates", () => {
    expect(mutate((f) => { f.paths[0].usdPerCall = f.paths[0].usdPerCall + 0.01; })).not.toHaveLength(0);
    expect(mutate((f) => { f.model = "claude-unknown-9"; })).not.toHaveLength(0);
    expect(mutate((f) => { delete f.rates["claude-sonnet-5"]; })).not.toHaveLength(0);
    expect(mutate((f) => { f.paths[0].usdPerCall = f.paths[0].usdPerCall + 0.00004; })).toEqual([]);
  });

  it("M4: more paraphrases of the denied claims are caught", () => {
    for (const l of ["It's secure.", "The savings have been measured.", "Humans always stay in the loop.", "Savings were measured."]) {
      expect(claimViolations(l, "en"), l).not.toHaveLength(0);
    }
    for (const l of [
      "Die Einsparungen wurden gemessen.", "Die Zeitersparnis wurde belegt.", "Anthropics Bedingungen garantieren die Löschung.",
      "Ein Mensch ist stets beteiligt.", "Der Mensch bleibt stets eingebunden.",
    ]) {
      expect(claimViolations(l, "de"), l).not.toHaveLength(0);
    }
  });

  it("M5: counts, duplicates and ids are checked for plausibility", () => {
    expect(mutate((f) => { f.paths[0].calls = -1; })).not.toHaveLength(0);
    expect(mutate((f) => { f.paths[0].protectionUnverifiedCalls = f.paths[0].calls + 1; })).not.toHaveLength(0);
    expect(mutate((f) => { f.paths.push({ ...f.paths[0] }); })).not.toHaveLength(0);
    expect(mutate((f) => { f.hiddenWhenProtected = ["chat"]; })).not.toHaveLength(0);
    expect(mutate((f) => { f.paths[0].id = "not ok!"; })).not.toHaveLength(0);
  });

  const table = (ids) => ["| Id | Claim | Label | Source |", "|---|---|---|---|", ...ids.map((n) => `| E${n} | c | l | s |`)].join("\n");

  it("M9: ids cited in the appendix's own prose must be rows, and only the Id table's rows count", () => {
    const pages = { "en/a.md": "E1", "de/a.md": "E1" };
    expect(evidenceViolations(pages, `Intro cites E1.\n\n${table([1])}`, `Intro zitiert E1.\n\n${table([1])}`)).toEqual([]);
    const bad = evidenceViolations(pages, `Intro cites E9.\n\n${table([1])}`, `Intro.\n\n${table([1])}`);
    expect(bad).toEqual(["en/appendix.md: cites E9, which is not a row of the appendix evidence table"]);
    const other = `| Name | x |\n|---|---|\n| E2 | other table |\n\n${table([1])}`;
    expect(evidenceViolations({ "en/a.md": "E2", "de/a.md": "E2" }, other, other)).toHaveLength(2);
  });
});

describe("AI briefs, last open paths", () => {
  const figures = () => JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "docs", "briefs", "figures.json"), "utf8"));
  const table = (ids) => ["| Id | Claim | Label | Source |", "|---|---|---|---|", ...ids.map((n) => `| E${n} | c | l | s |`)].join("\n");

  it("N1: a table row id on a brief page is a citation, not a definition", () => {
    const pages = { "en/ceo.md": "| E99 | x |", "de/ceo.md": "| E99 | x |" };
    expect(evidenceViolations(pages, table([1]), table([1]))).toEqual([
      "en/ceo.md: cites E99, which is not a row of the appendix evidence table",
      "de/ceo.md: cites E99, which is not a row of the appendix evidence table",
    ]);
    expect(evidenceViolations({ "en/ceo.md": "| E1 | x |", "de/ceo.md": "| E1 | x |" }, table([1]), table([1]))).toEqual([]);
  });

  it("N1: the appendix's own row id cells still define rows rather than cite them", () => {
    expect(evidenceViolations({}, table([1, 2]), table([1, 2]))).toEqual([]);
  });

  it("N4: only it's / that's / is / are forms flag 'secure'", () => {
    expect(claimViolations("It's secure.", "en")).not.toHaveLength(0);
    expect(claimViolations("That's secure.", "en")).not.toHaveLength(0);
    expect(claimViolations("The service is secure.", "en")).not.toHaveLength(0);
    expect(claimViolations("Let's secure the key.", "en")).toEqual([]);
    expect(claimViolations("The team's secure channel is separate.", "en")).toEqual([]);
  });

  it("N5: every path needs at least one call", () => {
    const f = figures();
    f.paths[0].calls = 0;
    f.paths[0].protectionUnverifiedCalls = 0;
    expect(figuresViolations(f)).toEqual(["figures.paths[0].calls: must be at least 1"]);
  });
});
