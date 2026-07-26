// Shared date-range invariant. Pure, i18n-free, no clock.
//
// ISO dates compare correctly as strings, so no Date parsing is needed — and
// none is wanted: an empty or half-typed value must pass through untouched so
// a mid-edit input is never rewritten under the user's cursor.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The end of a range, clamped so it can never precede the start.
 * Returns `end` unchanged unless both values are complete ISO dates AND
 * `end < start`, in which case it returns `start` (a single-day range).
 */
export function clampRangeEnd(start: string, end: string): string {
  if (!ISO_DATE.test(start) || !ISO_DATE.test(end)) return end;
  return end < start ? start : end;
}
