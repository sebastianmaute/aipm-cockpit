// src/app/absence-clash-notice.ts — the user-facing sentence for an absence clash (§773).
import { shortDateRangeIso } from "./date-format";
import { type Lang, t } from "./i18n";
import type { AbsenceClash } from "./absence-clash";

/** "Maya Patel is absent on the date (Nov 03–Nov 07)." / "Maya Patel is away for most of this task's
 *  working days (Nov 03–Nov 07, Nov 20)." Ranges are the absences concerned, in the app's short dates. */
export function formatAbsenceClash(c: AbsenceClash, lang: Lang): string {
  const ranges = c.ranges.map((r) => shortDateRangeIso(r.start, r.end, lang)).join(", ");
  const key = c.reason === "date-on-absence" ? "absenceClashOnDate" : "absenceClashMostOfSpan";
  return t(lang, key, c.person, ranges);
}
