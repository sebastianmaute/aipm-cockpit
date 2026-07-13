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
});
