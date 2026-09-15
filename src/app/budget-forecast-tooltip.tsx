"use client";

// Shared term + tooltip trigger for the forecast surfaces (§6.2): "What is X?"
// by default, or "What does X mean?" for a verb/adjective term (controller
// ruling 2 — Needs, Runs out, Extra working days, and the two card-method
// titles). Used by both `budget-forecast-facts.tsx` and
// `budget-forecast-cards.tsx` — extracted so the two files don't carry
// near-identical copies.
import { type Lang, t } from "./i18n";
import { InfoTooltip } from "./info-tooltip";

export function TermTooltip({
  lang, term, tip, means = false,
}: {
  lang: Lang; term: string; tip: string; means?: boolean;
}) {
  return (
    <span className="print:hidden ml-1">
      <InfoTooltip text={tip} label={t(lang, means ? "forecastWhatMeans" : "forecastWhatIs", term)} />
    </span>
  );
}
