// §716 — an xlsx hours cell shown as a time or duration is stored as a fraction of a day. The reader now resolves
// the cell's style and reads it as hours; a date keeps its serial, and every other cell is read as before.
import { describe, expect, it } from "vitest";
import { durationCellHours, durationStyleIndexes, isDurationFormatCode } from "./xlsx-styles";
import { extractXlsxGrid } from "./xlsx-extract";

const enc = (s: string) => new TextEncoder().encode(s);

// cellXfs: 0 General · 1 built-in 46 ([h]:mm:ss) · 2 custom 164 [h]:mm · 3 custom 165 dd.mm.yyyy · 4 built-in 14 (a
// date) · 5 built-in 20 (h:mm). cellStyleXfs holds a time format too, and must not shift or join the indexes.
const STYLES = `<styleSheet>
  <numFmts count="2"><numFmt numFmtId="164" formatCode="[h]:mm"/><numFmt numFmtId="165" formatCode="dd.mm.yyyy"/></numFmts>
  <cellStyleXfs count="1"><xf numFmtId="46"/></cellStyleXfs>
  <cellXfs count="6"><xf numFmtId="0"/><xf numFmtId="46"/><xf numFmtId="164"/><xf numFmtId="165"/><xf numFmtId="14"/><xf numFmtId="20"/></cellXfs>
</styleSheet>`;

describe("isDurationFormatCode", () => {
  it.each([
    ["[h]:mm", true], ["h:mm", true], ["hh:mm:ss", true], ["mm:ss", true], ["[mm]", true], ["h:mm AM/PM", true],
    ["[Red][h]:mm", true],
    ["dd.mm.yyyy", false], ["m/d/yy h:mm", false], ["0.00", false], ["General", false], ['"hours" 0', false],
    ["mm", false], ["#,##0 \\h", false],
  ])("%s → %s", (code, expected) => {
    expect(isDurationFormatCode(code)).toBe(expected);
  });
});

describe("durationStyleIndexes", () => {
  it("lists the cellXfs indexes whose format is a time or duration, built-in or custom, and no date", () => {
    expect([...durationStyleIndexes(new Map([["xl/styles.xml", enc(STYLES)]]))].sort()).toEqual([1, 2, 5]);
  });

  it("is empty without a styles part", () => {
    expect(durationStyleIndexes(new Map()).size).toBe(0);
  });
});

describe("durationCellHours", () => {
  it.each([
    ["0.33333333333333331", "8"], ["0.3125", "7.5"], ["1.5", "36"], ["0", "0"], ["0.000694444", "0.0167"],
    ["", ""], ["x", "x"],
  ])("%s days → %s h", (raw, hours) => {
    expect(durationCellHours(raw)).toBe(hours);
  });
});

describe("extractXlsxGrid reads a duration cell as hours (§716)", () => {
  const sheet = `<worksheet><sheetData><row r="1">
    <c r="A1" s="2"><v>0.33333333333333331</v></c>
    <c r="B1" s="1" t="n"><v>1.5</v></c>
    <c r="C1" s="3"><v>46327</v></c>
    <c r="D1" s="4"><v>46327</v></c>
    <c r="E1"><v>0.25</v></c>
    <c r="F1" s="0"><v>0.25</v></c>
    <c r="G1" s="2" t="s"><v>0</v></c>
    <c r="H1" s="5"><v>0.3125</v></c>
  </row></sheetData></worksheet>`;
  const grid = (withStyles: boolean) => extractXlsxGrid(new Map([
    ["xl/worksheets/sheet1.xml", enc(sheet)],
    ["xl/sharedStrings.xml", enc("<sst><si><t>8:00</t></si></sst>")],
    ...(withStyles ? [["xl/styles.xml", enc(STYLES)] as [string, Uint8Array]] : []),
  ]))[0].rows[0];

  it("converts the duration cells and leaves dates, unstyled numbers and text as stored", () => {
    expect(grid(true)).toEqual(["8", "36", "46327", "46327", "0.25", "0.25", "8:00", "7.5"]);
  });

  it("reads every cell as stored when the workbook has no styles part", () => {
    expect(grid(false)).toEqual(["0.33333333333333331", "1.5", "46327", "46327", "0.25", "0.25", "8:00", "0.3125"]);
  });
});
