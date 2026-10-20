// src/app/xlsx-styles.ts — which cell styles of an xlsx show a TIME or DURATION (§716). Excel stores `8:00` as
// 0.333… (a fraction of a day) and only its number format says so, so a reader that ignores `styles.xml` hands an
// hours column over as fractions. Pure: `xlsx-extract.ts` asks it which `s` indexes to convert.
//
// ★ DATES ARE NOT CONVERTED. A date format (any `y` or `d`) keeps its serial, because the forecast import reads
// period cells as serials (`period-assign.ts`). Only a format with an hour or second and no date part counts.
// ★ A CLOCK format (`h:mm`) shows the time of day only, so a date-time serial under it (46327.5, shown as 12:00)
// reads as its fraction of a day, 12 h, as Excel displays it; an ELAPSED format (`[h]:mm`) shows the whole value
// (1.5 as 36:00), so it reads all of it.
// ★ Not covered: the locale-specific built-in ids (27–36, 50–58 for CJK, 59–81 for Thai). Which of them show a
// time depends on the workbook's locale, and a wrong guess would read a date column as hours, which is worse than
// reading an hours column as fractions. A workbook written by Excel stores such a format as a custom `numFmt`
// when it saves under another locale, which this reader classifies by its code.

import { decodeUtf8, unescapeXml } from "./office-xml";
import { forEachOpenTag } from "./tag-pair-walk";

/** How a time format shows its value: the time of day (`clock`) or the whole span (`elapsed`). */
export type TimeKind = "clock" | "elapsed";

/** The built-in number formats that show a time or duration (ECMA-376 Part 1, 18.8.30): h:mm AM/PM, h:mm:ss AM/PM,
 *  h:mm, h:mm:ss, mm:ss and mm:ss.0 show a time of day; 46, [h]:mm:ss, an elapsed span. 22 (m/d/yy h:mm) carries
 *  a date, so it stays a date. */
const BUILTIN_TIME_FORMATS: ReadonlyMap<number, TimeKind> = new Map([
  [18, "clock"], [19, "clock"], [20, "clock"], [21, "clock"], [45, "clock"], [46, "elapsed"], [47, "clock"],
]);

/** Whether a custom format code shows a time or duration with no date part, and which kind; null for any other
 *  format. Quoted text, `\x` escapes and bracketed colour or condition sections are dropped first; the elapsed
 *  tokens `[h]`, `[m]` and `[s]` are kept, and any of them makes the format elapsed. */
export function timeFormatKind(code: string): TimeKind | null {
  const bare = code
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[(?![hms]+\])[^\]]*\]/gi, "")
    .toLowerCase();
  if (!/[hs]|\[m+\]/.test(bare) || /[yd]/.test(bare)) return null;
  return /\[[hms]+\]/.test(bare) ? "elapsed" : "clock";
}

/** True when a custom format code shows a time or duration and no date part (`timeFormatKind` is not null). */
export function isDurationFormatCode(code: string): boolean {
  return timeFormatKind(code) !== null;
}

/** The text of the first top-level `<name …>…</name>` element in `xml`, "" when there is none. `styles.xml` holds
 *  `numFmts` and `cellXfs` once each, as direct children of `<styleSheet>`. */
function section(xml: string, name: string): string {
  const start = xml.search(new RegExp(`<${name}[\\s>]`));
  if (start === -1) return "";
  const end = xml.indexOf(`</${name}>`, start);
  return end === -1 ? "" : xml.slice(start, end);
}

/** The cell-style (`cellXfs`) indexes whose number format shows a time or duration, each with its kind. Empty
 *  when the workbook has no `styles.xml`. */
export function durationStyleIndexes(entries: Map<string, Uint8Array>): ReadonlyMap<number, TimeKind> {
  const b = entries.get("xl/styles.xml");
  if (!b) return new Map();
  const xml = decodeUtf8(b);
  const custom = new Map<number, string>();
  // Only the top-level `<numFmts>` defines the ids `cellXfs` refers to: a conditional format in `<dxfs>` carries a
  // `<numFmt>` of its own whose id can repeat one of them, and reading it too would let it win.
  forEachOpenTag(section(xml, "numFmts"), "<numFmt\\b", (tag) => {
    const id = /\bnumFmtId="(\d+)"/.exec(tag);
    const code = /\bformatCode="([^"]*)"/.exec(tag);
    if (id && code) custom.set(Number(id[1]), unescapeXml(code[1]));
    return true;
  });
  // Only `cellXfs` is indexed by a cell's `s`; `cellStyleXfs` holds `<xf>` tags too, so the walk is bounded to it.
  const out = new Map<number, TimeKind>();
  const cellXfs = section(xml, "cellXfs");
  if (cellXfs === "") return out;
  let index = 0;
  forEachOpenTag(cellXfs, "<xf\\b", (tag) => {
    const id = /\bnumFmtId="(\d+)"/.exec(tag);
    const fmt = id ? Number(id[1]) : 0;
    const code = custom.get(fmt);
    const kind = code !== undefined ? timeFormatKind(code) : BUILTIN_TIME_FORMATS.get(fmt) ?? null;
    if (kind !== null) out.set(index, kind);
    index += 1;
    return true;
  });
  return out;
}

/** A duration cell's stored value (days) as decimal hours, rounded to the second so 0.3333… reads 8. A `clock`
 *  format reads the fraction of the day only (a date-time 46327.5 under `h:mm` reads 12), as Excel shows it. A value
 *  that is not a number is returned unchanged. */
export function durationCellHours(raw: string, kind: TimeKind = "elapsed"): string {
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(value)) return raw;
  // `trunc`, not `floor`: a negative serial (-0.25, -6 h) keeps its sign instead of wrapping to 18 h.
  const days = kind === "clock" ? value - Math.trunc(value) : value;
  return String(Number((Math.round(days * 86_400) / 3_600).toFixed(4)));
}
