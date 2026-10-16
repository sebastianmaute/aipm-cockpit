// src/app/action-text.ts
//
// The ONE renderer for a next-action's `I18nText` (title / why). The engine is
// i18n-free and cannot format a date — it has no `Lang` — so it emits an
// `I18nDateParam` and every surface renders through here, which formats it with
// the Forecast surfaces' own `formatDayMonthYear` (UTC, so a day never shifts).
import { localeFor } from "./date-format";
import { formatDayMonthYear } from "./forecast-format";
import { type Lang, t } from "./i18n";
import type { I18nText } from "./next-actions/types";

export function actionText(lang: Lang, text: I18nText): string {
  const params = (text.params ?? []).map((p) =>
    typeof p === "object" ? formatDayMonthYear(p.date, localeFor(lang)) : p,
  );
  return t(lang, text.key, ...params);
}
