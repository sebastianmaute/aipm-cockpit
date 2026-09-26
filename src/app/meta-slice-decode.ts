// src/app/meta-slice-decode.ts — §617: "parsed, but sanitized to nothing".
//
// ★★★ A SANITIZER THAT RETURNS NOTHING WAS INDISTINGUISHABLE FROM AN EMPTY
//  SLICE. `rowsToWorkspace` reported a meta row only when `JSON.parse` or the
//  sanitizer THREW; a sanitizer that returned null / undefined / [] / {} took
//  neither branch, so the slice was dropped with no report — and for
//  `project_meta` the next meta-dirty save deleted the row for good.
// ★★ Reporting on "empty result" alone would be worse than the defect: a stored
//  `[]`, `{}` or a record of blank strings sanitizes to nothing too, and each
//  report pauses saving. So the rule compares the INPUT with the output: only
//  a value that carried something, and lost all of it, is reported.

/** True when a parsed JSON value carries anything a sanitizer could lose: a
 *  non-empty string, any number or boolean, or an array/object holding such a
 *  value at ANY depth. `null`, `""`, `[]`, `{}` and containers of only those
 *  carry nothing. Recursive on purpose — a status of `{"narrative":""}` must
 *  not count as content. */
export function hasDecodedContent(raw: unknown): boolean {
  if (raw === null || raw === undefined) return false;
  if (typeof raw === "string") return raw !== "";
  if (Array.isArray(raw)) return raw.some(hasDecodedContent);
  if (typeof raw === "object") return Object.values(raw).some(hasDecodedContent);
  return true;
}

/** True when a sanitizer's result holds nothing: null/undefined, an empty
 *  array, or an object with no own keys. */
export function isEmptyDecoded(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/** §617 — the stored value had content and the sanitizer kept none of it. */
export function sanitizedToNothing(raw: unknown, sanitized: unknown): boolean {
  return hasDecodedContent(raw) && isEmptyDecoded(sanitized);
}
