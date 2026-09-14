// src/app/sanitize-load-date.ts
//
// The LOAD-side reader for a REQUIRED date field. Since §539 `sanitizeIsoDate`
// returns "" for a date that is shape-valid but not a real calendar date
// ("2026-02-30"). On a write path that is the refusal it should be. On a load
// path a required date that reads as "" makes the entity sanitizer return null
// and the load funnel DROP THE WHOLE RECORD — so the load funnels read required
// dates through this instead: such a value is KEPT as its raw string (what every
// backend loaded before §539) and a diagnostic is logged. Optional date fields
// keep using `sanitizeIsoDate` and blank on load; write paths keep refusing.
import { logDiag } from "./diagnostics";
import { sanitizeIsoDate } from "./sanitize-core";

const ISO_DATE_SHAPE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

/** Which load funnel read the record. A stored template's seed milestone and a
 *  workspace milestone can share an id, so the diagnostic must say which. */
export type LoadDateSource = "workspace" | "templateSeed";

/** Keys already reported this session (module lifetime = page session). ★ A
 *  Turso re-read decodes every row again and settings hydration re-reads every
 *  stored template, so without this the SAME kept value re-logged on every load
 *  and crowded the capped diagnostics ring. The key carries the value, so a
 *  record whose field later holds a different non-calendar date logs again.
 *  Grows only with distinct affected records. */
const reported = new Set<string>();

/** A required date as a WORKSPACE load funnel reads it: a real calendar date
 *  verbatim; a `YYYY-MM-DD` value inside 1900..2100 that is NOT a real calendar
 *  date kept raw, with a `storage.nonCalendarDateKept` diagnostic naming only
 *  the source, entity kind, id and field (once per session per record, field
 *  and value); anything else "". Matches `RequiredDateReader`. */
export function requiredIsoDateOnLoad(value: unknown, entity: string, id: unknown, field: string): string {
  return readRequiredDate("workspace", value, entity, id, field);
}

/** `requiredIsoDateOnLoad` for a stored template's seed (settings hydration):
 *  identical rule, diagnostic attributed to `templateSeed`. */
export function requiredIsoDateOnTemplateLoad(value: unknown, entity: string, id: unknown, field: string): string {
  return readRequiredDate("templateSeed", value, entity, id, field);
}

function readRequiredDate(source: LoadDateSource, value: unknown, entity: string, id: unknown, field: string): string {
  const strict = sanitizeIsoDate(value);
  if (strict !== "" || typeof value !== "string" || !ISO_DATE_SHAPE_RE.test(value)) return strict;
  const year = Number(value.slice(0, 4));
  if (year < MIN_YEAR || year > MAX_YEAR) return "";
  const safeId = typeof id === "number" || typeof id === "string" ? id : "";
  const key = JSON.stringify([source, entity, safeId, field, value]);
  if (!reported.has(key)) {
    reported.add(key);
    logDiag("warn", "storage.nonCalendarDateKept", { source, entity, id: safeId, field });
  }
  return value;
}

/** Test-only: forget what this session already reported. */
export function __resetNonCalendarDateReportsForTests(): void {
  reported.clear();
}
