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

/** A required date as a load funnel reads it: a real calendar date verbatim; a
 *  `YYYY-MM-DD` value inside 1900..2100 that is NOT a real calendar date kept
 *  raw, with a `storage.nonCalendarDateKept` diagnostic naming only the entity
 *  kind, id and field; anything else "". Matches `RequiredDateReader`. */
export function requiredIsoDateOnLoad(value: unknown, entity: string, id: unknown, field: string): string {
  const strict = sanitizeIsoDate(value);
  if (strict !== "" || typeof value !== "string" || !ISO_DATE_SHAPE_RE.test(value)) return strict;
  const year = Number(value.slice(0, 4));
  if (year < MIN_YEAR || year > MAX_YEAR) return "";
  logDiag("warn", "storage.nonCalendarDateKept", {
    entity,
    id: typeof id === "number" || typeof id === "string" ? id : "",
    field,
  });
  return value;
}
