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

  it("returns empty string when there are no worksheets", () => {
    expect(extractXlsx(new Map())).toBe("");
  });
});
