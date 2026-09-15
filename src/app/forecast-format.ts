/** Locale formatting for the budget forecast surfaces. Forecast money is EUR (engine unit). Dates are ISO days read in UTC. */
export function formatMoneyCompact(amount: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    notation: "compact",
    maximumSignificantDigits: 3,
  }).format(amount);
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
