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

/** YYYY-MM-DD of the ISO instant `iso` as seen in `tz` — the calendar day a
 *  person in that zone files it under, which is what a "what changed today"
 *  filter has to compare against. Null when `iso` is unparseable, so a caller
 *  must decide what an undated record means rather than getting a bogus day. */
export function dayInZone(iso: string, tz: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return todayInZone(d, tz);
}

const OFFSET_OPTS: Intl.DateTimeFormatOptions = {
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hourCycle: "h23", timeZoneName: "longOffset",
};

/** `iso` re-expressed as an offset-bearing instant in `tz`, e.g.
 *  "2026-08-17T00:30:00+02:00". Same instant, still unambiguous, but showing
 *  the wall clock the user's own screens show.
 *
 *  ★★ The offset is resolved AT that instant, never looked up per zone — a
 *  fixed "+02:00" for Europe/Berlin is wrong for half the year. `longOffset`
 *  gives the DST-correct value for the date being formatted.
 *
 *  ★ A zero offset is spelled "+00:00" rather than "Z": one code path, and the
 *  frame is then stated explicitly in every zone instead of only the ones that
 *  are not UTC. ICU spells UTC's longOffset "GMT" on some engines and
 *  "GMT+00:00" on others, so anything that is not a signed HH:MM is read as
 *  zero. Unparseable `iso` comes back verbatim, mirroring `formatInZone`. */
export function isoInZone(iso: string, tz: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const zone = isValidTimeZone(tz) ? tz : "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", { ...OFFSET_OPTS, timeZone: zone })
    .formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const raw = get("timeZoneName").replace("GMT", "");
  const offset = /^[+-]\d{2}:\d{2}$/.test(raw) ? raw : "+00:00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}${offset}`;
}

/** Effective zone: per-device override → per-project operating tz → browser. Each
 *  candidate must be a valid IANA zone to be chosen. Always returns a valid zone. */
export function resolveTimezone(overrideTz: string | undefined, projectTz: string | undefined): string {
  if (overrideTz && isValidTimeZone(overrideTz)) return overrideTz;
  if (projectTz && isValidTimeZone(projectTz)) return projectTz;
  return browserTimeZone();
}
