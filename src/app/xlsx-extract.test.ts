import { describe, expect, it } from "vitest";
import { extractXlsx } from "./xlsx-extract";
import { expectLinearScaling } from "../test/scaling";

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

// Fixed-size sentinels for the scaling guards: a fixture whose scaled part
// renders nothing would pass its output check even if a large input bailed
// early, so each guard also renders this one cell.
const SENTINEL_ROW = '<row r="2"><c r="A2"><v>7</v></c></row>';
const SENTINEL_SHEET = `<worksheet><sheetData>${SENTINEL_ROW}</sheetData></worksheet>`;
const SENTINEL_OUT = "## Sheet: Sheet1\n\n| 7 |\n| --- |";

describe("extractXlsx", () => {
  it("renders each sheet as a named Markdown table, resolving shared strings", () => {
    const workbook = `<workbook><sheets>
      <sheet name="Risks" sheetId="1" r:id="rId1"/>
    </sheets></workbook>`;
    const shared = `<sst><si><t>ID</t></si><si><t>Risk</t></si><si><t>Late &amp; over</t></si></sst>`;
    const sheet = `<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
      <row r="2"><c r="A2"><v>1</v></c><c r="B2" t="s"><v>2</v></c></row>
    </sheetData></worksheet>`;
    const entries = new Map<string, Uint8Array>([
      ["xl/workbook.xml", enc(workbook)],
      ["xl/sharedStrings.xml", enc(shared)],
      ["xl/worksheets/sheet1.xml", enc(sheet)],
    ]);
    expect(extractXlsx(entries)).toBe(
      "## Sheet: Risks\n\n| ID | Risk |\n| --- | --- |\n| 1 | Late & over |",
    );
  });

  it("fills gaps from cell references so columns stay aligned", () => {
    const sheet = `<worksheet><sheetData>
      <row r="1"><c r="A1"><v>1</v></c><c r="C1"><v>3</v></c></row>
    </sheetData></worksheet>`;
    const entries = new Map<string, Uint8Array>([
      ["xl/worksheets/sheet1.xml", enc(sheet)],
    ]);
    expect(extractXlsx(entries)).toContain("| 1 |  | 3 |");
  });

  it("maps sheet names to content via workbook rels (reordered workbook)", () => {
    const workbook = `<workbook><sheets>
      <sheet name="Summary" sheetId="1" r:id="rId1"/>
      <sheet name="Details" sheetId="2" r:id="rId2"/>
    </sheets></workbook>`;
    const rels = `<Relationships>
      <Relationship Id="rId1" Target="worksheets/sheet2.xml"/>
      <Relationship Id="rId2" Target="worksheets/sheet1.xml"/>
    </Relationships>`;
    const sheet1 = `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>fromFile1</t></is></c></row></sheetData></worksheet>`;
    const sheet2 = `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>fromFile2</t></is></c></row></sheetData></worksheet>`;
    const entries = new Map<string, Uint8Array>([
      ["xl/workbook.xml", enc(workbook)],
      ["xl/_rels/workbook.xml.rels", enc(rels)],
      ["xl/worksheets/sheet1.xml", enc(sheet1)],
      ["xl/worksheets/sheet2.xml", enc(sheet2)],
    ]);
    const out = extractXlsx(entries);
    // Summary → rId1 → sheet2.xml (fromFile2); Details → rId2 → sheet1.xml (fromFile1)
    expect(out).toBe(
      "## Sheet: Summary\n\n| fromFile2 |\n| --- |\n\n## Sheet: Details\n\n| fromFile1 |\n| --- |",
    );
  });

  it("returns empty string when there are no worksheets", () => {
    expect(extractXlsx(new Map())).toBe("");
  });

  it("does not swallow surrounding rows around a self-closing row", () => {
    // Excel emits a self-closing <row/> for an empty row - forEachXmlElement
    // (xlsx-extract.ts) must not let that swallow the rows either side of it.
    //
    // NOT MUTATION-PROVED, documented intent rather than a pinned guard:
    // disabling the self-closing branch entirely still passes this test.
    // extractXlsx resolves cells by their own `r` reference regardless of
    // which <row> wrapper claims them, so a row wrongly merged forward still
    // yields row 3's cell unchanged; and renderRows drops any row whose cell
    // array is empty either way, which a genuinely self-closed row's array
    // always is. So "3 raw rows, 1 filtered" and "2 raw rows (one already
    // merged), 0 filtered" render byte-identical Markdown - the swallow-
    // forward is real but unobservable at this output boundary for "row".
    // The cell-level tests below exercise the SAME shared branch (this is
    // one function called for both "row" and "c") and are the actual guard.
    const sheet = `<worksheet><sheetData>
      <row r="1"><c r="A1"><v>1</v></c></row>
      <row r="2"/>
      <row r="3"><c r="A3"><v>3</v></c></row>
    </sheetData></worksheet>`;
    const entries = new Map<string, Uint8Array>([["xl/worksheets/sheet1.xml", enc(sheet)]]);
    expect(extractXlsx(entries)).toBe("## Sheet: Sheet1\n\n| 1 |\n| --- |\n| 3 |");
  });

  it("keeps column positions aligned across a self-closing empty cell", () => {
    // Excel emits a self-closing <c/> for an empty cell. Mishandling it must
    // not shift the columns after it - this is the case that matters most,
    // since a shift corrupts the sheet silently rather than failing loudly.
    const sheet = `<worksheet><sheetData>
      <row r="1"><c r="A1"><v>1</v></c><c r="B1"/><c r="C1"><v>3</v></c></row>
    </sheetData></worksheet>`;
    const entries = new Map<string, Uint8Array>([["xl/worksheets/sheet1.xml", enc(sheet)]]);
    expect(extractXlsx(entries)).toContain("| 1 |  | 3 |");
  });

  it("detects a self-closing cell even with attributes before the slash", () => {
    // The self-close check is `xml[gt - 1] === "/"` at the tag's own closing
    // ">" - confirm it still finds that "/" with a real attribute list in
    // between, not just the bare `<c/>` shape used above.
    const sheet = `<worksheet><sheetData>
      <row r="1"><c r="A1"><v>1</v></c><c r="B1" s="1" t="n"/><c r="C1"><v>3</v></c></row>
    </sheetData></worksheet>`;
    const entries = new Map<string, Uint8Array>([["xl/worksheets/sheet1.xml", enc(sheet)]]);
    expect(extractXlsx(entries)).toContain("| 1 |  | 3 |");
  });

  it("advances correctly across two adjacent self-closing cells", () => {
    // Exercises `openRe.lastIndex = end` firing twice in a row on the
    // self-close branch before the next real (paired) cell is reached.
    const sheet = `<worksheet><sheetData>
      <row r="1"><c r="A1"/><c r="B1"/><c r="C1"><v>3</v></c></row>
    </sheetData></worksheet>`;
    const entries = new Map<string, Uint8Array>([["xl/worksheets/sheet1.xml", enc(sheet)]]);
    expect(extractXlsx(entries)).toContain("|  |  | 3 |");
  });

  it("does not let a <cols> block interfere with cell extraction", () => {
    // Real worksheets carry <cols><col .../></cols> immediately before
    // <sheetData>. This placement can't actually reach forEachXmlElement's
    // "c" scan (see the adversarial test below for why), but it pins the
    // realistic shape end-to-end as a regression check regardless.
    //
    // NOT MUTATION-PROVED: this stays green even with `\b` removed from the
    // "c" open pattern. `<col>` can only ever be a child of `<cols>`, itself
    // a sibling of <sheetData> per the OOXML schema - it can never nest
    // inside a <row> - so forEachXmlElement("c", ...), which only ever runs
    // on text already sliced out of a matched <row>...</row>, structurally
    // never sees "<col" text in any placement a real spreadsheet could
    // produce. The decoy test below is the one that actually pins the `\b`
    // guard.
    const sheet = `<worksheet><cols><col min="1" max="1" width="9"/></cols><sheetData>
      <row r="1"><c r="A1"><v>1</v></c></row>
    </sheetData></worksheet>`;
    const entries = new Map<string, Uint8Array>([["xl/worksheets/sheet1.xml", enc(sheet)]]);
    expect(extractXlsx(entries)).toBe("## Sheet: Sheet1\n\n| 1 |\n| --- |");
  });

  it("does not let a decoy <col...> tag inside a row corrupt cell extraction", () => {
    // The realistic <cols> placement above can never reach the "c" scan:
    // forEachXmlElement("c", ...) only ever runs on text already sliced out
    // of a matched <row>...</row>, and real xlsx never nests <col> inside a
    // <row>, so that test can't exercise the `<c\b` guard at the point it
    // actually runs. This fixture does, with an adversarial decoy where a
    // real xlsx would never put one. Without the `\b` boundary, "<c" bare
    // matches the start of "<col...>" too; that phantom match's own close
    // search then skips straight past "</col>" (it doesn't match `</c\s*>`
    // either) to the next real "</c>" - swallowing the real C1 cell into a
    // bogus merged match keyed off the decoy's own r="B1", corrupting both
    // the value and its column position.
    const sheet = `<worksheet><sheetData>
      <row r="1"><c r="A1"><v>1</v></c><col r="B1">HIDDEN</col><c r="C1"><v>3</v></c></row>
    </sheetData></worksheet>`;
    const entries = new Map<string, Uint8Array>([["xl/worksheets/sheet1.xml", enc(sheet)]]);
    expect(extractXlsx(entries)).toContain("| 1 |  | 3 |");
  });

  // Hang backstop, not the guard: vitest cannot interrupt a synchronous test (see src/test/scaling.ts).
  it("does not blow up on repetitive unclosed markup", { timeout: 120_000 }, () => {
    // Unclosed <c opens inside one row. Guards TWO different mutants, not
    // just the lazy-regex one this was originally written against:
    //  - the former `<c\b[^>]*\/>|<c\b[\s\S]*?<\/c>` lazy pair regex;
    //  - forEachXmlElement's `gt` CACHE specifically. Forcing a fresh
    //    `indexOf(">", ...)` on every iteration (instead of reusing `gt`
    //    while `innerStart <= gt`) is still linear in the LAZY-REGEX sense
    //    (no backtracking), but every open now re-scans forward to this
    //    row's one distant closing ">", which is its own O(n^2).
    // n is 20,000, not today's 320,000 / 4: at 80,000 and at 40,000 the
    // lazy-regex mutant ran past the 120 s kill (it costs ~8 s at 80,000 here).
    // Measured 2026-09-19 (ratio large / small, limit 8): 3.96–4.0 green,
    // 16.5 with the lazy regex restored in forEachXmlElement, 15.8 with the
    // `gt` cache disabled.
    expectLinearScaling({
      label: "unclosed <c opens in one row",
      build: (n) =>
        new Map<string, Uint8Array>([
          [
            "xl/worksheets/sheet1.xml",
            enc(
              "<worksheet><sheetData><row>" +
                "<c ".repeat(n) +
                `</row>${SENTINEL_ROW}</sheetData></worksheet>`,
            ),
          ],
        ]),
      run: extractXlsx,
      // No open finds its </c>, so that row is empty; the sentinel row after
      // it proves the walk went on past the soup.
      check: (out) => expect(out).toBe(SENTINEL_OUT),
      n: 20_000,
    });
  });

  // §558 remainder. Each fixture below measured ~4x slower per doubling of
  // its repeat count against the read it replaces (before 2026-09-19).
  // Hang backstop, not the guard: vitest cannot interrupt a synchronous test (see src/test/scaling.ts).
  it("does not blow up on unclosed <sheet opens in workbook.xml", { timeout: 120_000 }, () => {
    // sheetNames' `<sheet\b[^>]*\bname="..."` ran `[^>]*` to the one ">" at
    // the end from every open and backtracked all the way.
    // Measured 2026-09-19 (ratio large / small, limit 8): 3.9–4.0 green,
    // 17.5 with that regex restored in sheetNames.
    expectLinearScaling({
      label: "unclosed <sheet opens in workbook.xml",
      build: (n) =>
        new Map<string, Uint8Array>([
          ["xl/workbook.xml", enc("<workbook><sheets>" + "<sheet ".repeat(n) + "</sheets></workbook>")],
          ["xl/worksheets/sheet1.xml", enc(SENTINEL_SHEET)],
        ]),
      run: extractXlsx,
      // No open carries a name, so the one sheet falls back to "Sheet1".
      check: (out) => expect(out).toBe(SENTINEL_OUT),
      n: 20_000,
    });
  });

  // Hang backstop, not the guard: vitest cannot interrupt a synchronous test (see src/test/scaling.ts).
  it("does not blow up on unclosed <sheet and <Relationship opens with no '>' at all", { timeout: 120_000 }, () => {
    // The rels mapping's `<sheet\b[^>]*\/?>` and `<Relationship\b[^>]*\/?>`
    // match fine once a ">" follows, but with none anywhere every open scans
    // to end of input and fails — as does sheetNames' read. Both files scale
    // together.
    // Measured 2026-09-19 (ratio large / small, limit 8): 4.2–4.4 green;
    // with one read at a time restored to its regex, 16.8 (Relationship),
    // 16.1 (the rels-mapping <sheet read), 16.0 (sheetNames).
    expectLinearScaling({
      label: "unclosed <sheet and <Relationship opens, no '>'",
      build: (n) =>
        new Map<string, Uint8Array>([
          ["xl/workbook.xml", enc("<sheet ".repeat(n))],
          ["xl/_rels/workbook.xml.rels", enc("<Relationship ".repeat(n))],
          ["xl/worksheets/sheet1.xml", enc(SENTINEL_SHEET)],
        ]),
      run: extractXlsx,
      // Nothing maps and no name is read, so the one sheet falls back to "Sheet1".
      check: (out) => expect(out).toBe(SENTINEL_OUT),
      n: 10_000,
    });
  });

  // Hang backstop, not the guard: vitest cannot interrupt a synchronous test (see src/test/scaling.ts).
  it("does not blow up on many unclosed <v> inside one cell", { timeout: 120_000 }, () => {
    // cellValue's `<v>([\s\S]*?)<\/v>` rescanned to the cell's end from every
    // <v>. One <c> can hold the whole sheet, so "a cell's own short content"
    // was never a bound.
    // Measured 2026-09-19 (ratio large / small, limit 8): 4.0 green, 16.0
    // with that lazy regex restored in cellValue.
    expectLinearScaling({
      label: "unclosed <v> inside one cell",
      build: (n) =>
        new Map<string, Uint8Array>([
          [
            "xl/worksheets/sheet1.xml",
            enc(
              "<worksheet><sheetData><row><c>" +
                "<v>".repeat(n) +
                `</c></row>${SENTINEL_ROW}</sheetData></worksheet>`,
            ),
          ],
        ]),
      run: extractXlsx,
      // The first <v> has no </v>, so that cell is empty; the sentinel row
      // after it proves the walk went on past the soup.
      check: (out) => expect(out).toBe(SENTINEL_OUT),
      n: 40_000,
    });
  });

  it("drops a cell whose column is past Excel's last (XFD) instead of padding out to it", () => {
    // colIndex("ZZZZZZZ") is ~8e9; padding the row out to it exhausted memory.
    // XFE is the first column past XFD. Not a timing test: the fixture has no
    // size axis, and the exact output is the guard.
    // Mutation-proved 2026-09-19: with `idx >= MAX_XLSX_COLUMNS` loosened to
    // `>`, XFE1 is padded out to and kept, and this assertion fails at once;
    // with the check deleted, padding toward ZZZZZZZ1 throws "RangeError:
    // Invalid array length" within ~2 s.
    const sheet = `<worksheet><sheetData>
      <row r="1"><c r="A1"><v>1</v></c><c r="ZZZZZZZ1"><v>9</v></c><c r="B1"><v>2</v></c><c r="XFE1"><v>8</v></c></row>
    </sheetData></worksheet>`;
    const entries = new Map<string, Uint8Array>([["xl/worksheets/sheet1.xml", enc(sheet)]]);
    const out = extractXlsx(entries);
    expect(out).toBe("## Sheet: Sheet1\n\n| 1 | 2 |\n| --- | --- |");
  });

  it("keeps a cell in Excel's last column (XFD)", () => {
    const sheet = `<worksheet><sheetData><row r="1"><c r="XFD1"><v>7</v></c></row></sheetData></worksheet>`;
    const entries = new Map<string, Uint8Array>([["xl/worksheets/sheet1.xml", enc(sheet)]]);
    const row = extractXlsx(entries).split("\n")[2];
    expect(row.split("|").length - 2).toBe(16_384);
    expect(row.endsWith("| 7 |")).toBe(true);
  });

  it("reads the first <v> of a cell", () => {
    const sheet = `<worksheet><sheetData>
      <row r="1"><c r="A1"><v>first</v><v>second</v></c><c r="B1"><v>a &amp; b</v></c><c r="C1"><v>open</c></row>
    </sheetData></worksheet>`;
    const entries = new Map<string, Uint8Array>([["xl/worksheets/sheet1.xml", enc(sheet)]]);
    expect(extractXlsx(entries)).toBe("## Sheet: Sheet1\n\n| first | a & b |  |\n| --- | --- | --- |");
  });

  const namesOnly = (workbook: string, sheets: number): string[] => {
    const files: [string, Uint8Array][] = Array.from({ length: sheets }, (_, i) => [
      `xl/worksheets/sheet${i + 1}.xml`,
      enc(`<worksheet><sheetData><row r="1"><c r="A1"><v>${i + 1}</v></c></row></sheetData></worksheet>`),
    ]);
    const out = extractXlsx(new Map([["xl/workbook.xml", enc(workbook)], ...files]));
    return [...out.matchAll(/^## Sheet: (.*)$/gm)].map((m) => m[1]);
  };

  it("keeps a '>' inside a quoted sheet name (the fallback reader)", () => {
    // Legal XML: ">" need not be escaped in an attribute value, and the former
    // `<sheet\b[^>]*\bname="([^"]*)"` let the value run past it.
    const workbook = `<workbook><sheets><sheet name="a>b"/><sheet name="c"/></sheets></workbook>`;
    expect(namesOnly(workbook, 2)).toEqual(["a>b", "c"]);
  });

  it("takes the rightmost name= in a tag, as docx's headingDigit does", () => {
    const workbook = `<workbook><sheets><sheet name="left" x:name="right"/></sheets></workbook>`;
    expect(namesOnly(workbook, 1)).toEqual(["right"]);
  });

  // Three shapes where a name read that resumes short of what it already
  // scanned rescans out to the one ">" at the end from every open. One row
  // per test, so a mutant run can select a row with -t.
  // n is 5,000, not today's 80,000 / 4: at 20,000 every row's mutant ran past
  // the 120 s kill, because the rescan is a per-character quote-aware walk.
  // Measured 2026-09-19 (ratio large / small, limit 8): 3.9–4.5 green. Red:
  // "quoted names" 16.1 with the LEFTMOST name= taken; "unclosed quotes" 17.2
  // with an unclosed quote resuming at the open instead of stopping; "opens
  // inside one tag" 18.7 with a nameless tag resuming at the open instead of
  // past its real end.
  // One sheet file, so the name read is observable: the rightmost name= wins,
  // and a tag with no readable name falls back to "Sheet1".
  // Hang backstop, not the guard: vitest cannot interrupt a synchronous test (see src/test/scaling.ts).
  it.each<[string, (n: number) => string, string[]]>([
    ["quoted names", (n) => '<sheet name="v" '.repeat(n) + ">", ["v"]],
    ["unclosed quotes", (n) => '<sheet name="'.repeat(n) + ">", ["Sheet1"]],
    ["opens inside one tag", (n) => '<sheet name="v"' + " <sheet".repeat(n) + ">", ["v"]],
  ])("stays linear on quoted names, unclosed quotes and opens inside one tag: %s", { timeout: 120_000 }, (row, build, names) => {
    expectLinearScaling({
      label: `sheet-name read: ${row}`,
      build,
      run: (workbook) => namesOnly(workbook, 1),
      check: (out) => expect(out).toEqual(names),
      n: 5_000,
    });
  });

  it("resolves a sheet name containing '>' to the right rels target (M-7)", () => {
    // final-release-review.md M-7: forEachOpenTag hands the visitor the
    // <sheet ...> tag text only up to the first ">", so a name containing
    // one — legal XML; only "<", "&" and the quote character itself must be
    // escaped in an AttValue — truncated the tag before r:id was ever read
    // (real Excel writes name before r:id), and the sheet silently dropped
    // out of `mapped` entirely. With a SECOND, unaffected sheet also present,
    // `mapped.length > 0` is still true, so sheetEntries returned early
    // rather than falling back to sheetNames — the '>'-named sheet vanished
    // from the output altogether rather than merely mis-titled.
    const workbook = `<workbook><sheets>
      <sheet name="D>E" sheetId="1" r:id="rId1"/>
      <sheet name="Plain" sheetId="2" r:id="rId2"/>
    </sheets></workbook>`;
    const rels = `<Relationships>
      <Relationship Id="rId1" Target="worksheets/sheet2.xml"/>
      <Relationship Id="rId2" Target="worksheets/sheet1.xml"/>
    </Relationships>`;
    const sheet1 = `<worksheet><sheetData><row r="1"><c r="A1"><v>fromPlain</v></c></row></sheetData></worksheet>`;
    const sheet2 = `<worksheet><sheetData><row r="1"><c r="A1"><v>fromDE</v></c></row></sheetData></worksheet>`;
    const entries = new Map<string, Uint8Array>([
      ["xl/workbook.xml", enc(workbook)],
      ["xl/_rels/workbook.xml.rels", enc(rels)],
      ["xl/worksheets/sheet1.xml", enc(sheet1)],
      ["xl/worksheets/sheet2.xml", enc(sheet2)],
    ]);
    expect(extractXlsx(entries)).toBe(
      "## Sheet: D>E\n\n| fromDE |\n| --- |\n\n## Sheet: Plain\n\n| fromPlain |\n| --- |",
    );
  });

  it("keeps sheet names in declaration order whatever the attribute order", () => {
    // Both workbook readers — the rels mapping and the positional fallback.
    const workbook = `<workbook><sheets>
      <sheet name="One" sheetId="1" r:id="rId1"/>
      <sheet r:id="rId2" sheetId="2" name="Two &amp; more"/>
      <sheet sheetId="3" name="Three" r:id="rId3"></sheet>
    </sheets></workbook>`;
    const sheet = (v: string) =>
      enc(`<worksheet><sheetData><row r="1"><c r="A1"><v>${v}</v></c></row></sheetData></worksheet>`);
    const files: [string, Uint8Array][] = [
      ["xl/worksheets/sheet1.xml", sheet("1")],
      ["xl/worksheets/sheet2.xml", sheet("2")],
      ["xl/worksheets/sheet3.xml", sheet("3")],
    ];
    const expected =
      "## Sheet: One\n\n| 1 |\n| --- |\n\n## Sheet: Two & more\n\n| 2 |\n| --- |\n\n## Sheet: Three\n\n| 3 |\n| --- |";
    const fallback = new Map<string, Uint8Array>([["xl/workbook.xml", enc(workbook)], ...files]);
    expect(extractXlsx(fallback)).toBe(expected);
    const rels = `<Relationships>
      <Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
      <Relationship Target="/xl/worksheets/sheet2.xml" Id="rId2"/>
      <Relationship Id="rId3" Target="worksheets/sheet3.xml"></Relationship>
    </Relationships>`;
    const mapped = new Map<string, Uint8Array>([...fallback, ["xl/_rels/workbook.xml.rels", enc(rels)]]);
    expect(extractXlsx(mapped)).toBe(expected);
  });
});
