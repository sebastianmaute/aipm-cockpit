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
 * only the raw string arriving at `tz:` fails. Today that is argument 3 of
 * `summarizeRecentActivity`.
 * ★★ `summarizeForRecap` USED to be the other example here — "argument 4" — and
 * that line was falsified by the same change set that wrote the paragraph three
 * lines below it: the signature collapsed to `(ai, entries, clock)`, so it takes
 * no bare `tz` at any position and the instruction was unexecutable for it.
 * Nothing gates a stale argument index, and the round that broke it edited the
 * adjacent hunk without re-reading this one. Re-derive rather than trust:
 *   grep -A5 "export function summarizeForRecap" src/app/activity-recap.ts
 *
 * ★★ WHAT IT DOES **NOT** BUY, AND WHAT NOW DOES. This brand does not catch an
 * INCONSISTENT PAIR — `today` computed in Berlin handed over beside a `tz`
 * naming America/New_York — because `today` is a pure function of `tz` and the
 * two travelled as separate values, which is well-typed under every branding
 * scheme (measured). `ProjectClock` below closed that class (§153) by deriving
 * the day from the zone inside one factory. Do not read THIS brand as covering
 * more than a transposition; the pair guarantee lives on the clock.
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

/** One day-formatter for one zone. ★ Building an `Intl.DateTimeFormat` is the
 *  expensive half of a day conversion — far more than formatting with it — and
 *  `isValidTimeZone` builds a SECOND one, so the naive per-call shape pays for
 *  two constructions per entry. */
function dayFormatter(tz: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: isValidTimeZone(tz) ? tz : "UTC",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
}

/** ★ The single formatting implementation every day conversion shares, so the
 *  batched and one-shot paths cannot drift on their output. */
function formatDay(fmt: Intl.DateTimeFormat, d: Date): string {
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** YYYY-MM-DD of `now` as seen in `tz`. Falls back to UTC if `tz` is rejected. */
export function todayInZone(now: Date, tz: string): string {
  return formatDay(dayFormatter(tz), now);
}

/**
 * `dayInZone` with the zone resolved and the formatter built ONCE, for callers
 * that convert many instants in the same zone.
 *
 * ★★ THIS IS A COST FIX ONLY — the returned function is byte-identical to
 * `dayInZone` for every input, because both route through the same
 * `dayFormatter` + `formatDay` pair. It must stay that way: the day a scan
 * classifies an instant under is a BEHAVIOURAL property, so a "faster" variant
 * that computes a different day is not an optimisation, it is a defect.
 * Mutation-proved: hardcoding the formatter's zone to UTC turns 7 tests red
 * across `timezone.test.ts`, `history-search.test.ts` and
 * `activity-recap.test.ts`.
 *
 * ★ Measured on the real module, 500 entries in Europe/Berlin: a per-entry
 *   `dayInZone` scan cost ~160 ms; hoisting the formatter took it to ~2 ms.
 *   That call sits inside `getSnapshot()`, i.e. on every chat send, every
 *   `get_app_state` and every inline AI edit — it was not a background cost.
 */
export function makeDayInZone(tz: string): (iso: string) => string | null {
  const fmt = dayFormatter(tz);
  return (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : formatDay(fmt, d);
  };
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
  return makeDayInZone(tz)(iso);
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

declare const PROJECT_CLOCK_BRAND: unique symbol;

/**
 * The project's day and the zone that day was computed in, as ONE value.
 *
 * ★★★ WHY A BAG AND NOT TWO PARAMETERS (`docs/open-followups.md` §153). The
 * `TimeZone` brand above makes a TRANSPOSITION unrepresentable but cannot see
 * an INCONSISTENT PAIR — a `today` computed in Berlin handed over beside a `tz`
 * naming America/New_York is well-typed under every branding scheme. They are
 * not two independent inputs; `today` is a pure function of `tz`. Only carrying
 * them as one factory-built object removes that class.
 *
 * ★★★ A PLAIN `{ today, tz }` OBJECT DOES NOT WORK, and it is the first fix
 * anyone reaches for. Measured: with both fields typed as strings,
 * `f({ today: tz, tz: today })` typechecks in silence. The bag has to carry a
 * brand the caller cannot forge, which is why the field below exists and why
 * `createProjectClock` is the only producer.
 */
export type ProjectClock = {
  /** YYYY-MM-DD in `tz`, derived by the factory — never supplied by a caller. */
  readonly today: string;
  readonly tz: TimeZone;
  readonly [PROJECT_CLOCK_BRAND]: true;
};

/**
 * The ONLY producer. Derives `today` from `tz` INTERNALLY.
 *
 * ★★★ THE DERIVATION MUST HAPPEN IN HERE. A factory that ACCEPTED both values
 * and packed them into the bag would rebuild the identical defect one level up
 * — the caller could still compute `today` in the wrong zone, and the brand
 * would then certify an inconsistent pair as authoritative, which is worse than
 * no brand at all.
 *
 * ★★ There is deliberately no test-only mint beside `asTimeZoneForTests`. Tests
 * pin the DAY by passing `now`, not by supplying `today` — so even a fixture
 * cannot express a disagreeing pair, and no `asProjectClockForTests({today, tz})`
 * escape hatch exists to let one back in.
 *
 * ★★ `now` is a PARAMETER, and that is not a hole in the guarantee: the caller
 * chooses the INSTANT, never the rendered day. The zone→day conversion stays in
 * here, which is the whole invariant. It also keeps this module to the rule its
 * own header states — "`now`/`iso` are always passed in so the date-math
 * functions stay pure + testable" — and lets the default cover the render-body
 * case, where React's purity rule bans a `new Date()` call (`task-manager.tsx`
 * relies on that default for the same reason its old `effectiveToday` was a
 * module-level function).
 */
// ★★ THE `new Date()` DEFAULT IS THE ONE LIVE CLOCK READ IN THIS MODULE, and it is
//    deliberate rather than an oversight in the module's pass-the-instant rule. This
//    is the FACTORY, the one place a clock is allowed to be born; every function it
//    feeds still takes its instant as an argument, so the date math stays pure and
//    testable. The parameter is what keeps it so: a test pins a date by passing one,
//    with no escape hatch that could forge a `today`/`tz` pair the type exists to
//    prevent. Do not add a second producer — see the note at `task-manager.tsx`'s
//    `createProjectClock` call for the one that already exists elsewhere.
export function createProjectClock(tz: TimeZone, now: Date = new Date()): ProjectClock {
  return { today: todayInZone(now, tz), tz } as ProjectClock;
}
