import type { Lang } from "./i18n";
import type { Absence } from "./types";

/** Maps the app language to a BCP-47 locale for Intl date formatting. */
export function localeFor(lang: Lang): string {
  if (lang === "de") return "de-DE";
  if (lang === "en-GB") return "en-GB";
  return "en-US";
}

/** Compact absence date range, e.g. "Jun 10–Jun 12" (single date when same-day). */
export function shortDateRange(a: Absence, lang: Lang): string {
  const loc = localeFor(lang);
  const start = new Date(a.startDate);
  const end = new Date(a.endDate);
  const sameDay = a.startDate === a.endDate;
  const fmt: Intl.DateTimeFormatOptions = { month: "short", day: "2-digit" };
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) {
    return sameDay ? a.startDate : `${a.startDate}–${a.endDate}`;
  }
  if (sameDay) return start.toLocaleDateString(loc, fmt);
  return `${start.toLocaleDateString(loc, fmt)}–${end.toLocaleDateString(loc, fmt)}`;
}

/** Compact range string for two ISO date strings, e.g. "Jun 10–Jun 16". */
export function shortDateRangeIso(startIso: string, endIso: string, lang: Lang): string {
  const loc = localeFor(lang);
  const fmt: Intl.DateTimeFormatOptions = { month: "short", day: "2-digit", timeZone: "UTC" };
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) return `${startIso}–${endIso}`;
  if (startIso === endIso) return start.toLocaleDateString(loc, fmt);
  return `${start.toLocaleDateString(loc, fmt)}–${end.toLocaleDateString(loc, fmt)}`;
}

/**
 * Formats a full ISO TIMESTAMP (e.g. a cache's `fetchedAt`) for display in the
 * active language; returns the input unchanged if unparseable.
 *
 * ★ Separate from `formatExpiryDate` because that one takes a DATE-ONLY
 * "YYYY-MM-DD" and appends `T12:00:00` to dodge the timezone-rollover trap.
 * Doing that to a value which already carries a time yields an invalid Date, so
 * the two cannot share an implementation.
 *
 * ★ Shows the time as well as the day: this exists to answer "how stale is
 * this?", and on the day of a fetch a date alone answers nothing.
 */
export function formatFetchedAt(iso: string, lang: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return iso;
  return d.toLocaleString(localeFor(lang), {
    year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

/** Formats a "YYYY-MM-DD" date for display in the active language; returns the input if unparseable. */
export function formatExpiryDate(isoDate: string, lang: Lang): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.valueOf())) return isoDate;
  return d.toLocaleDateString(localeFor(lang), { year: "numeric", month: "short", day: "2-digit" });
}
