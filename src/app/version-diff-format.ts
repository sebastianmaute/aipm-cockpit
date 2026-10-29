// src/app/version-diff-format.ts
// How one before/after value of a version compare reads on screen (§776). Pure,
// i18n-free, DOM-free. Rich text shows as its plain text, not its markup; a list
// as its items; a plain object as `key: value` pairs. Anything deeper falls back
// to JSON, and every value is capped, so one long note log cannot fill a row.

import { isHtmlStart, RICH_SINK } from "./html-start";
import { htmlPlainProjection } from "./rich-text-plain";

/** Visible characters of one value; the rest is cut with "…". */
export const DIFF_VALUE_MAX = 200;
/** Nesting levels read as text before a value falls back to JSON. */
const READABLE_DEPTH = 2;
const EMPTY = "—";

export function formatDiffValue(v: unknown): string {
  const text = describe(v, 0);
  return text.length > DIFF_VALUE_MAX ? `${text.slice(0, DIFF_VALUE_MAX)}…` : text;
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function describe(v: unknown, depth: number): string {
  if (v === null || v === undefined || v === "") return EMPTY;
  if (typeof v === "string") return isHtmlStart(v, RICH_SINK) ? htmlPlainProjection(v) || EMPTY : v;
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
