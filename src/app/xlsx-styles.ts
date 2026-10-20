// src/app/xlsx-styles.ts — which cell styles of an xlsx show a TIME or DURATION (§716). Excel stores `8:00` as
// 0.333… (a fraction of a day) and only its number format says so, so a reader that ignores `styles.xml` hands an
// hours column over as fractions. Pure: `xlsx-extract.ts` asks it which `s` indexes to convert.
//
// ★ DATES ARE NOT CONVERTED. A date format (any `y` or `d`) keeps its serial, because the forecast import reads
// period cells as serials (`period-assign.ts`). Only a format with an hour or second and no date part counts.

import { decodeUtf8, unescapeXml } from "./office-xml";
import { forEachOpenTag } from "./tag-pair-walk";

/** The built-in number formats that show a time or duration: h:mm AM/PM, h:mm:ss AM/PM, h:mm, h:mm:ss, mm:ss,
 *  [h]:mm:ss, mm:ss.0 (ECMA-376 Part 1, 18.8.30). 22 (m/d/yy h:mm) carries a date, so it stays a date. */
const BUILTIN_TIME_FORMATS: ReadonlySet<number> = new Set([18, 19, 20, 21, 45, 46, 47]);

/** True when a custom format code shows a time or duration and no date part. Quoted text, `\x` escapes and
 *  bracketed colour or condition sections are dropped first; the elapsed tokens `[h]`, `[m]` and `[s]` are kept. */
export function isDurationFormatCode(code: string): boolean {
  const bare = code
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[(?![hms]+\])[^\]]*\]/gi, "")
    .toLowerCase();
  return /[hs]|\[m+\]/.test(bare) && !/[yd]/.test(bare);
}

/** The cell-style (`cellXfs`) indexes whose number format shows a time or duration. Empty when the workbook has
 *  no `styles.xml`. */
export function durationStyleIndexes(entries: Map<string, Uint8Array>): ReadonlySet<number> {
  const b = entries.get("xl/styles.xml");
  if (!b) return new Set();
  const xml = decodeUtf8(b);
  const custom = new Map<number, string>();
  forEachOpenTag(xml, "<numFmt\\b", (tag) => {
    const id = /\bnumFmtId="(\d+)"/.exec(tag);
    const code = /\bformatCode="([^"]*)"/.exec(tag);
    if (id && code) custom.set(Number(id[1]), unescapeXml(code[1]));
    return true;
  });
  // Only `cellXfs` is indexed by a cell's `s`; `cellStyleXfs` holds `<xf>` tags too, so the walk is bounded to it.
  const start = xml.indexOf("<cellXfs");
  const end = start === -1 ? -1 : xml.indexOf("</cellXfs>", start);
  const out = new Set<number>();
  if (end === -1) return out;
  let index = 0;
  forEachOpenTag(xml.slice(start, end), "<xf\\b", (tag) => {
    const id = /\bnumFmtId="(\d+)"/.exec(tag);
    const fmt = id ? Number(id[1]) : 0;
    const code = custom.get(fmt);
    if (code !== undefined ? isDurationFormatCode(code) : BUILTIN_TIME_FORMATS.has(fmt)) out.add(index);
    index += 1;
    return true;
  });
  return out;
}

/** A duration cell's stored value (days) as decimal hours, rounded to the second so 0.3333… reads 8. A value that
 *  is not a number is returned unchanged. */
export function durationCellHours(raw: string): string {
  const days = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(days)) return raw;
  return String(Number((Math.round(days * 86_400) / 3_600).toFixed(4)));
}
