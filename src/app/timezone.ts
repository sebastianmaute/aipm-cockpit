// src/app/timezone.ts — pure timezone utilities (Intl-based; no deps, no React/Date-in-module).
// `now`/`iso` are always passed in so the date-math functions stay pure + testable.

/** True if `tz` is a valid IANA zone. */
export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The host's detected IANA zone (client env read; "UTC" fallback). Not a module
 *  const so it stays SSR/test-safe and is re-read per call. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** The selectable IANA zone list for pickers. Uses `Intl.supportedValuesOf`
 *  where available; falls back to the host zone + UTC on older engines (never
 *  crash). Shared by the settings + project-form timezone pickers. */
export function tzZones(): string[] {
  return typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : [browserTimeZone(), "UTC"];
}

/** YYYY-MM-DD of `now` as seen in `tz`. Falls back to UTC if `tz` is rejected. */
export function todayInZone(now: Date, tz: string): string {
  const zone = isValidTimeZone(tz) ? tz : "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Format an ISO instant in `tz` for display. Falls back to UTC on a bad zone. */
export function formatInZone(
  iso: string, tz: string, opts: Intl.DateTimeFormatOptions, locale: string,
): string {
  const zone = isValidTimeZone(tz) ? tz : "UTC";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: zone }).format(d);
}

/** Effective zone: per-device override → per-project operating tz → browser. Each
 *  candidate must be a valid IANA zone to be chosen. Always returns a valid zone. */
export function resolveTimezone(overrideTz: string | undefined, projectTz: string | undefined): string {
  if (overrideTz && isValidTimeZone(overrideTz)) return overrideTz;
  if (projectTz && isValidTimeZone(projectTz)) return projectTz;
  return browserTimeZone();
}
