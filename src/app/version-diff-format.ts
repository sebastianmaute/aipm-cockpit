// src/app/version-diff-format.ts
// How one before/after value of a version compare reads on screen (§776). Pure,
// i18n-free, DOM-free. Rich text shows as its plain text, not its markup; a list
// as its items; a plain object as `key: value` pairs. Anything deeper falls back
// to JSON, and every value is capped, so one long note log cannot fill a row.
// ★★ A pair is capped around its FIRST DIFFERENCE (`formatDiffPair`): capping
// each side from its start would show two identical "…" strings for values that
// differ only past the cap — a long description edited near its end, or a note
// log with a later entry added.

import { isHtmlStart, RENDER_SINK } from "./html-start";
import { htmlPlainProjection } from "./rich-text-plain";

/** Visible characters of one value; the rest is cut with "…". */
export const DIFF_VALUE_MAX = 200;
/** Characters kept before the first difference when a pair is cut around it. */
const DIFF_CONTEXT = 40;
/** Nesting levels read as text before a value falls back to JSON. */
const READABLE_DEPTH = 2;
const EMPTY = "—";

export function formatDiffValue(v: unknown): string {
  return cut([...describe(v, 0)], 0);
}

/** Both sides of one field change. When either side is too long, both are cut
 *  from the same point, a little before the first character where they differ,
 *  so the change itself is always on screen. */
export function formatDiffPair(before: unknown, after: unknown): [string, string] {
  const b = [...describe(before, 0)];
  const a = [...describe(after, 0)];
  if (b.length <= DIFF_VALUE_MAX && a.length <= DIFF_VALUE_MAX) return [b.join(""), a.join("")];
  let i = 0;
  while (i < b.length && i < a.length && b[i] === a[i]) i += 1;
  const start = i < DIFF_VALUE_MAX - DIFF_CONTEXT ? 0 : i - DIFF_CONTEXT;
  return [cut(b, start), cut(a, start)];
}

/** Up to DIFF_VALUE_MAX code points from `start`, with "…" where text was cut.
 *  Code points, not UTF-16 units, so a cut never splits an emoji. */
function cut(chars: readonly string[], start: number): string {
  const s = Math.min(start, Math.max(0, chars.length - 1));
  const part = chars.slice(s, s + DIFF_VALUE_MAX).join("");
  return `${s > 0 ? "…" : ""}${part}${s + DIFF_VALUE_MAX < chars.length ? "…" : ""}`;
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function describe(v: unknown, depth: number): string {
  if (v === null || v === undefined || v === "") return EMPTY;
  // The render sink, not an allow-list one: htmlPlainProjection keeps the text
  // of ANY tag, so by the never-recognise-less rule (html-start.ts) a value
  // opening with any tag (a document's <div> or <table> included) is markup.
  if (typeof v === "string") return isHtmlStart(v, RENDER_SINK) ? htmlPlainProjection(v) || EMPTY : v;
  if (typeof v !== "object") return String(v);
  if (depth >= READABLE_DEPTH) return JSON.stringify(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return EMPTY;
    // Items that are objects carry ", " inside, so they are set apart with "; ".
    const sep = v.some((x) => typeof x === "object" && x !== null) ? "; " : ", ";
    return v.map((x) => describe(x, depth + 1)).join(sep);
  }
  const entries = Object.entries(v).filter(([, x]) => !isBlank(x));
  if (entries.length === 0) return EMPTY;
  return entries.map(([k, x]) => `${k}: ${describe(x, depth + 1)}`).join(", ");
}
