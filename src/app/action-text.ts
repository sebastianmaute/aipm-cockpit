// src/app/action-text.ts
//
// The ONE renderer for a next-action's `I18nText` (title / why). The engine is
// i18n-free and cannot format a date — it has no `Lang` — so it emits an
// `I18nDateParam` and every surface renders through here, which formats it with
// the Forecast surfaces' own `formatDayMonthYear` (UTC, so a day never shifts).
import { localeFor } from "./date-format";
import { formatDayMonthYear } from "./forecast-format";
import { isValidIsoDate } from "./forecast/throughput";
import { type Lang, t } from "./i18n";
import type { I18nText } from "./next-actions/types";

export function actionText(lang: Lang, text: I18nText): string {
  // A date that is not a valid ISO day is shown as it is: `Intl` would throw on it, and this renders
  // released surfaces (Next actions, the Dashboard), so a bad value must never take a row down.
  const params = (text.params ?? []).map((p) =>
    typeof p !== "object" ? p : isValidIsoDate(p.date) ? formatDayMonthYear(p.date, localeFor(lang)) : p.date,
  );
  return t(lang, text.key, ...params);
}
