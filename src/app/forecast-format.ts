/** Locale formatting for the budget forecast surfaces. Forecast money is EUR (engine unit). Dates are ISO days read in UTC. */
// Fix round 2: some locales (measured: de-DE) do not abbreviate compact
// currency below roughly EUR1M at maximumSignificantDigits:3 -- Intl just
// rounds to 3 significant digits and prints the full grouped number with no
// K/M-style suffix, which reads as an EXACT figure rather than a rounded
// one (261_150 -> "261.000 €"). en-US/en-GB always carry a compact suffix at
// every magnitude, so this only bites locales like de-DE. Detect the
// no-suffix case via `formatToParts`'s `type: "compact"` part and fall back
// to the ordinary (non-compact) currency format in that case, which prints
// the real, non-rounded figure instead.
export function formatMoneyCompact(amount: number, locale: string): string {
  const compactFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    notation: "compact",
    maximumSignificantDigits: 3,
  });
  const isCompacted = compactFormatter.formatToParts(amount).some((part) => part.type === "compact");
  if (!isCompacted) {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(amount);
  }
  return compactFormatter.format(amount);
}

export function formatSignedPercent(ratio: number, locale: string, fractionDigits: 0 | 1): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
    signDisplay: "exceptZero",
  }).format(ratio);
}

function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function formatDayMonthYear(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(utcDate(iso));
}

export function formatDayMonth(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(utcDate(iso));
}

/** Whole hours with a thin unit suffix, in the viewer's locale: "2,209 h". */
export function formatHours(hours: number, locale: string): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(hours)} h`;
}

/** A 0-1 share as a whole percent: "37%". */
export function formatShare(ratio: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(ratio);
}
