import { describe, expect, it } from "vitest";
import { extractXlsx } from "./xlsx-extract";

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

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

  it("does not blow up on repetitive unclosed markup", () => {
    // 80k unclosed <c opens inside one row - same shape as
    // docx-extract.test.ts's fixture, sized up from its 40k so the margin
    // over the ceiling has real headroom on a loaded machine (measured
    // ~11.5s old vs <5ms new here, a >1000x margin). With the former
    // `<c\b[^>]*\/>|<c\b[\s\S]*?<\/c>` lazy pair regex this is quadratic
    // (every open re-scans to end of input); forEachXmlElement
    // (xlsx-extract.ts) is linear. The ceiling is deliberately loose - it
    // fails on the pattern class, not on a machine's speed.
    const sheet =
      "<worksheet><sheetData><row>" + "<c ".repeat(80_000) + "</row></sheetData></worksheet>";
    const entries = new Map<string, Uint8Array>([["xl/worksheets/sheet1.xml", enc(sheet)]]);
    const start = performance.now();
    extractXlsx(entries);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
