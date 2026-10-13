import { describe, expect, it } from "vitest";
import { buildZip } from "../zip";
import { MAX_XLSX_SHEET_CELLS } from "../xlsx-extract";
import { excelSerialToIso, parseDelimited, readDelimited, readSheetFile } from "./sheet-grid";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

async function xlsxBytes(sheetXml: string): Promise<Uint8Array> {
  const workbook = `<workbook><sheets><sheet name="Forecast" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const rels = `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`;
  const blob = buildZip([
    { path: "xl/workbook.xml", data: workbook },
    { path: "xl/_rels/workbook.xml.rels", data: rels },
    { path: "xl/worksheets/sheet1.xml", data: sheetXml },
  ]);
  return new Uint8Array(await blob.arrayBuffer());
}

describe("parseDelimited", () => {
  it("reads a semicolon file with quoted comma and doubled quotes", () => {
    expect(parseDelimited('a;b\r\n"1,5";"x""y"\n')).toEqual([
      ["a", "b"],
      ["1,5", 'x"y'],
    ]);
  });

  it("defaults to comma and keeps the last row without a trailing newline", () => {
    expect(parseDelimited("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("strips a leading BOM", () => {
    expect(parseDelimited("\uFEFFa,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps a newline inside a quoted cell in one cell", () => {
    expect(parseDelimited('a,b\n"line1\nline2",x\n')).toEqual([
      ["a", "b"],
      ["line1\nline2", "x"],
    ]);
  });

  it("ignores a semicolon inside quotes when choosing the delimiter", () => {
    expect(parseDelimited('"a;b;c",d\n1,2\n')).toEqual([
      ["a;b;c", "d"],
      ["1", "2"],
    ]);
  });

  it("chooses the delimiter from the non-blank lines, skipping blank ones", () => {
    expect(parseDelimited("\n\nJan;Feb\n1,5;2\n")).toEqual([[""], [""], ["Jan", "Feb"], ["1,5", "2"]]);
  });

  // Final review M6: the first non-blank line alone decided, so a title line
  // without a delimiter made a `;` file one column, and tabs were never read.
  it("reads a ; sheet under a title line with no delimiter", () => {
    expect(parseDelimited("Forecast 2026\nName;Jan 2026;Feb 2026\nAnn;8;4\n")).toEqual([
      ["Forecast 2026"], ["Name", "Jan 2026", "Feb 2026"], ["Ann", "8", "4"],
    ]);
  });

  it("reads a tab-delimited sheet", () => {
    expect(parseDelimited("Name\tJan 2026\tFeb 2026\r\nAnn\t7,5\t4\r\n")).toEqual([["Name", "Jan 2026", "Feb 2026"], ["Ann", "7,5", "4"]]);
  });

  it("takes the delimiter most of the first five non-blank lines hold, not the first line's", () => {
    // A title line with a ; must not split a comma sheet.
    expect(parseDelimited("Stand; Version 3\nName,Jan 2026\nAnn,8\nBob,4\n")).toEqual([
      ["Stand; Version 3"], ["Name", "Jan 2026"], ["Ann", "8"], ["Bob", "4"],
    ]);
    // German decimal commas on some lines do not outvote the ; on every line.
    expect(parseDelimited("Name;Jan;Feb\nAnn;7,5;8\nBob;1,5;2,5\n")).toEqual([["Name", "Jan", "Feb"], ["Ann", "7,5", "8"], ["Bob", "1,5", "2,5"]]);
    // Lines past the fifth do not vote.
    const head = Array.from({ length: 5 }, (_, i) => `a${i};b`).join("\n");
    const tail = Array.from({ length: 7 }, (_, i) => `c${i},d`).join("\n");
    expect(parseDelimited(`${head}\n${tail}\n`)[0]).toEqual(["a0", "b"]);
  });

  it("breaks a tie on the first line, comma first, as before", () => {
    expect(parseDelimited("a;b\nc,d\n")).toEqual([["a", "b"], ["c,d"]]);
    expect(parseDelimited("a;b,c\nd\n")).toEqual([["a;b", "c"], ["d"]]);
  });

  it("keeps empty cells and drops only the trailing empty row", () => {
    expect(parseDelimited("a,,c\n,,\n\n")).toEqual([
      ["a", "", "c"],
      ["", "", ""],
    ]);
  });

  it("returns no rows for empty input", () => {
    expect(parseDelimited("")).toEqual([]);
    expect(parseDelimited("\uFEFF")).toEqual([]);
  });
});

describe("excelSerialToIso", () => {
  it("converts serials on the 1900 date system", () => {
    expect(excelSerialToIso(45658)).toBe("2025-01-01");
    expect(excelSerialToIso(61)).toBe("1900-03-01");
    expect(excelSerialToIso(59)).toBe("1900-02-28");
    expect(excelSerialToIso(1)).toBe("1900-01-01");
  });

  it("returns null for the non-existent 1900-02-29 (serial 60)", () => {
    expect(excelSerialToIso(60)).toBeNull();
    expect(excelSerialToIso(60.75)).toBeNull();
  });

  it("ignores the time-of-day fraction", () => {
    expect(excelSerialToIso(45658.9)).toBe("2025-01-01");
  });

  it("returns null below 1, non-finite, or past year 9999", () => {
    expect(excelSerialToIso(0)).toBeNull();
    expect(excelSerialToIso(-5)).toBeNull();
    expect(excelSerialToIso(0.5)).toBeNull();
    expect(excelSerialToIso(Number.NaN)).toBeNull();
    expect(excelSerialToIso(Number.POSITIVE_INFINITY)).toBeNull();
    expect(excelSerialToIso(2958466)).toBeNull();
    expect(excelSerialToIso(2958465)).toBe("9999-12-31");
  });
});

describe("readSheetFile", () => {
  it("reads an xlsx into one grid per sheet", async () => {
    const bytes = await xlsxBytes(
      `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1"><v>45658</v></c></row></sheetData></worksheet>`,
    );
    expect(await readSheetFile("Forecast.XLSX", bytes)).toEqual([
      { name: "Forecast", rows: [["Name", "45658"]], truncated: false, numbers: "dot" },
    ]);
    expect(await readSheetFile("macro.xlsm", bytes)).toHaveLength(1);
  });

  it("reads a csv into a single grid named after the file", async () => {
    const grid = await readSheetFile("plan.csv", enc("a;b\r\n1,5;2\r\n"));
    expect(grid).toEqual([{ name: "plan", rows: [["a", "b"], ["1,5", "2"]], truncated: false, numbers: "text" }]);
  });

  it("decodes a windows-1252 csv when the bytes are not valid UTF-8", async () => {
    // "Mär;Jän\n1;2" with the umlauts as single Latin-1 bytes.
    const bytes = Uint8Array.from([0x4d, 0xe4, 0x72, 0x3b, 0x4a, 0xe4, 0x6e, 0x0a, 0x31, 0x3b, 0x32]);
    const [sheet] = await readSheetFile("de.csv", bytes);
    expect(sheet.rows).toEqual([["Mär", "Jän"], ["1", "2"]]);
  });

  it("rejects anything else as unsupported", async () => {
    await expect(readSheetFile("old.xls", enc("x"))).rejects.toThrow("unsupported");
    await expect(readSheetFile("noext", enc("x"))).rejects.toThrow("unsupported");
  });
});

// §500 fix wave 2, round 2 (CR minor 6): a CSV is bounded like a workbook sheet.
describe("readDelimited — the cell cap", () => {
  it("stops before the row that would pass the cap and marks the grid as cut", () => {
    expect(readDelimited("a,b\nc,d\ne,f\n", 5)).toEqual({ rows: [["a", "b"], ["c", "d"]], truncated: true });
    expect(readDelimited("a,b\nc,d\ne,f\n", 6)).toEqual({ rows: [["a", "b"], ["c", "d"], ["e", "f"]], truncated: false });
  });

  it("reads a whole file without a cap, as parseDelimited does", () => {
    expect(readDelimited("a;b\n1;2\n").rows).toEqual(parseDelimited("a;b\n1;2\n"));
  });

  it("cuts a csv just over MAX_XLSX_SHEET_CELLS in readSheetFile", async () => {
    const rowsOfTwo = MAX_XLSX_SHEET_CELLS / 2;
    const fits = Array.from({ length: rowsOfTwo }, () => "1,2").join("\n");
    const [whole] = await readSheetFile("f.csv", enc(fits));
    expect(whole.truncated).toBe(false);
    expect(whole.rows).toHaveLength(rowsOfTwo);
    const [cut] = await readSheetFile("f.csv", enc(`${fits}\n3,4`));
    expect(cut.truncated).toBe(true);
    expect(cut.rows).toHaveLength(rowsOfTwo);
  });
});
