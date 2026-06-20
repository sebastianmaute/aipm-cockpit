// src/app/tz-display.ts — localized instant + zone label, in a display zone.
// Reuses TZ-1's formatInZone (Intl-based, no dep). Used by the timestamp panels.
import { formatInZone } from "./timezone";
import { localeFor } from "./date-format";
import type { Lang } from "./i18n";

const TS_OPTS: Intl.DateTimeFormatOptions = {
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", timeZoneName: "short",
};

/** Format an ISO instant in `tz` for display, with the zone label. Bad iso/zone
 *  falls back via formatInZone (returns the raw iso on an unparseable date). */
export function formatDisplayTimestamp(iso: string, tz: string, lang: Lang): string {
  return formatInZone(iso, tz, TS_OPTS, localeFor(lang));
}
