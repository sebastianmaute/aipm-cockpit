// src/app/timezone.ts — pure timezone utilities (Intl-based; no deps, no React/Date-in-module).
// `now`/`iso` are always passed in so the date-math functions stay pure + testable.

declare const TIME_ZONE_BRAND: unique symbol;

/**
 * An IANA zone that came from `resolveTimezone` — the app's only authoritative
 * producer. Structurally a `string`, so it flows into any `tz: string` parameter
 * with no friction; the reverse does not, which is the whole point.
 *
 * ★★★ WHY IT EXISTS. The recap path takes `today` and `tz` as two adjacent
 * parameters and both were `string`, so transposing them COMPILED. Under the
 * swap `summarizeRecentActivity` computes `new Date("UTCT00:00:00Z")`, hits its
 * own NaN guard, returns null, and the model's activity recap is silently gone
 * on every turn — forever. Measured before the fix: `tsc --noEmit` exit 0 and
 * 337 tests across 5 suites green. Neither the compiler nor the suite could see
 * a defect that removes the whole feature.
 *
 * ★★★ EXPECT THE ERROR ON THE `tz` ARGUMENT, NEVER THE `today` ONE — a reader
 * who looks at the wrong argument concludes the brand is broken. `TimeZone` is
 * assignable to `string`, so a transposed tz slides into `today:` silently and
 * only the raw string arriving at `tz:` fails. The position therefore differs
 * per function: argument 4 for `summarizeForRecap`, argument 3 for
 * `summarizeRecentActivity`.
 *
 * ★★ WHAT IT DOES **NOT** BUY. It does not catch an INCONSISTENT PAIR — `today`
 * computed in Berlin handed over beside a `tz` naming America/New_York. That is
 * well-typed under every branding scheme (measured), because `today` is a pure
 * function of `tz` (`task-manager.tsx` derives it one line after resolving the
 * zone) and they travel as two values. Only collapsing them into one
 * factory-built object removes that class — `docs/open-followups.md` §153.
 * Do not read the brand as covering more than a transposition.
 */
export type TimeZone = string & { readonly [TIME_ZONE_BRAND]: true };

/** The ONLY production mint, deliberately NOT exported. A public `asTimeZone`
 *  would rebuild the bug one level up: `asTimeZone(today)` type-checks cleanly
 *  (measured), so a general-purpose brander lets a caller brand the wrong
 *  string. Binding the guarantee to the PRODUCER rather than to a call site is
 *  what makes the wrong call unexpressible instead of merely discouraged. */
const brandZone = (tz: string): TimeZone => tz as TimeZone;

/**
 * TEST ONLY — do NOT use in production code, and do not remove the suffix to
 * make a production call site compile. Snapshot/dispatcher fixtures need to
 * spell a literal zone (`asTimeZoneForTests("UTC")`); production values must
 * come from `resolveTimezone` so the brand keeps meaning "this came from the
 * authoritative producer". A production use is a review failure, and the name
 * is what makes that visible in a diff.
 */
export function asTimeZoneForTests(raw: string): TimeZone {
  return brandZone(raw);
}

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
 *  candidate must be a valid IANA zone to be chosen. Always returns a valid zone.
 *
 *  ★★ THE SOLE PRODUCER OF `TimeZone`, and the brand is minted here rather than
 *  at any call site precisely because every branch below has already proved the
 *  value is a real zone (`isValidTimeZone`, or `browserTimeZone`'s own "UTC"
 *  fallback). Its three production callers — task-manager, workspace-section,
 *  use-bulk-operations — get branded values for free. */
export function resolveTimezone(overrideTz: string | undefined, projectTz: string | undefined): TimeZone {
  if (overrideTz && isValidTimeZone(overrideTz)) return brandZone(overrideTz);
  if (projectTz && isValidTimeZone(projectTz)) return brandZone(projectTz);
  return brandZone(browserTimeZone());
}
