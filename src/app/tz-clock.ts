// src/app/tz-clock.ts — current time + short date of an instant in a zone, for the
// Calendar multi-timezone strip (TZ-3). Reuses TZ-1 formatInZone. Pure (takes iso).
import { formatInZone } from "./timezone";
import { localeFor } from "./date-format";
import type { Lang } from "./i18n";

const CLOCK_OPTS: Intl.DateTimeFormatOptions = {
  weekday: "short", day: "2-digit", month: "short",
  hour: "2-digit", minute: "2-digit",
};

/** "08:30, Sat 20 Jun"-style current time + short date for `iso` in `tz`. The date
 *  is included because it can differ across the date line. Bad iso/zone falls back
 *  via formatInZone (returns the raw iso on an unparseable date). */
export function formatZoneClock(iso: string, tz: string, lang: Lang): string {
  return formatInZone(iso, tz, CLOCK_OPTS, localeFor(lang));
}
