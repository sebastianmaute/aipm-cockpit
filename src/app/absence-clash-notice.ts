// src/app/absence-clash-notice.ts — the user-facing sentence for an absence clash (§773).
import { shortDateRangeIso } from "./date-format";
import { type Lang, t } from "./i18n";
import type { AbsenceClash, ClashDate } from "./absence-clash";

const DATE_KEY = {
  due: "absenceClashOnDue",
  start: "absenceClashOnStart",
  milestone: "absenceClashOnMilestone",
} as const satisfies Record<ClashDate, string>;

/** "Maya Patel is absent on the due date, Nov 05 (Nov 03–Nov 07)." (or start / milestone date) /
 *  "Maya Patel is away for most of this task's working days (Nov 03–Nov 07, Nov 20)." Ranges are the
 *  absences concerned, in the app's short dates. */
export function formatAbsenceClash(c: AbsenceClash, lang: Lang): string {
  const ranges = c.ranges.map((r) => shortDateRangeIso(r.start, r.end, lang)).join(", ");
  if (c.reason === "absent-most-of-span") return t(lang, "absenceClashMostOfSpan", c.person, ranges);
  const date = c.date ? shortDateRangeIso(c.date, c.date, lang) : "";
  return t(lang, DATE_KEY[c.which ?? "due"], c.person, date, ranges);
}
