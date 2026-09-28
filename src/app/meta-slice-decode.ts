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

import type { DocTruncationDiag } from "./document-model";

/** True when a parsed JSON value carries anything a sanitizer could lose: a
 *  non-empty string, any number or boolean, or an array/object holding such a
 *  value at ANY depth. `null`, `""`, `[]`, `{}` and containers of only those
 *  carry nothing. Walks to ANY depth on purpose — a status of
 *  `{"narrative":""}` must not count as content.
 * ★ An explicit stack, not recursion: a stored value nested tens of
 *  thousands deep would otherwise overflow the call stack and fail the whole
 *  load instead of being reported. Items are pushed one at a time: spreading a
 *  very wide array into push() hits the engine's argument limit. */
export function hasDecodedContent(raw: unknown): boolean {
  const pending: unknown[] = [raw];
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === null || value === undefined) continue;
    if (typeof value === "string") {
      if (value !== "") return true;
    } else if (Array.isArray(value)) {
      for (const item of value as unknown[]) pending.push(item);
    } else if (typeof value === "object") {
      for (const item of Object.values(value)) pending.push(item);
    } else {
      return true;
    }
  }
  return false;
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

/** Only the accumulator field these helpers write. Structural, so both
 *  `DocTruncationDiag` and the codecs' `ImportDiag` satisfy it. */
export type DecodeFailureDiag = Pick<DocTruncationDiag, "decodeFailedSlices">;

/** Push `key` into the accumulator. A no-op without a `diag`. The one writer
 *  every decoder shares: both helpers below, and the THROW paths of
 *  `jsonToWorkspace`, the IndexedDB load and Turso's `rowsToWorkspace`. */
export function noteDecodeFailure(key: string, diag: DecodeFailureDiag | undefined): void {
  if (diag) (diag.decodeFailedSlices ??= []).push(key);
}

/** §630 — record `key` when `raw` had content and `sanitized` kept none. A
 *  no-op without a `diag`. The table-shaped CSV/Markdown slices (status,
 *  project) call this with the raw `field -> value` map as `raw`. */
export function noteIfSanitizedToNothing(
  key: string,
  raw: unknown,
  sanitized: unknown,
  diag: DecodeFailureDiag | undefined,
): void {
  // ★ The diag is checked FIRST: without one the content walk never runs, as
  // before §630 moved the JSON path onto this helper.
  if (diag && sanitizedToNothing(raw, sanitized)) noteDecodeFailure(key, diag);
}

/** §630 — decode ONE stored JSON meta slice, reporting what it could not keep.
 *
 * ★★★ THE CSV AND MARKDOWN CODECS SWALLOWED BOTH FAILURES. Each `csvTo*` /
 *  `markdownTo*` blob decoder wrapped `sanitize(JSON.parse(cell))` in a bare
 *  `catch { return undefined; }` and returned whatever the sanitizer gave, so
 *  an unreadable slice and a junk one both vanished with no report, and the
 *  next save rewrote the file without them — the loss §620 closed for JSON.
 *  This records `key` into the SAME accumulator `jsonToWorkspace` uses, under
 *  the same key names, so `lastDecodeFailures` pauses saving with no new
 *  mechanism.
 * ★★ ANY THROW COUNTS, not only `JSON.parse`'s: `sanitize` may run the
 *  DOM-dependent rich-field pass (documents), and a throw there loses the
 *  slice just the same. The return stays `undefined`, as it always was.
 * ★★ A BLANK TEXT IS SILENT, not a parse failure. An empty `config,` cell or
 *  an empty fenced block (a hand-edit; the encoder writes neither) carries
 *  nothing, so by the §617 rule it must not pause saving. It returns
 *  `undefined` — what the old `JSON.parse("")` throw returned — without a
 *  report.
 * ★ The result is returned UNFILTERED — callers keep their own "empty means
 *  absent" post-processing (`ins.length ? ins : undefined`, …). */
export function decodeMetaJson<T>(
  json: string,
  sanitize: (raw: unknown) => T,
  key: string,
  diag?: DecodeFailureDiag,
): T | undefined {
  if (json.trim() === "") return undefined;
  let raw: unknown;
  let sanitized: T;
  try {
    raw = JSON.parse(json);
    sanitized = sanitize(raw);
  } catch {
    noteDecodeFailure(key, diag);
    return undefined;
  }
  noteIfSanitizedToNothing(key, raw, sanitized, diag);
  return sanitized;
}
