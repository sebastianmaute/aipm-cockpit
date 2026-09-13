"use client";

// Projects-list key-fact meter + current-project banner (spec §5.4). Purely
// presentational; the panel decides live vs cached vs unknown.
//
// ★★ Projects is NOT in axe A11Y_VIEWS (spec §5.5), so unit tests are the only
// coverage. The bar is aria-hidden decoration and the visible count text carries
// the state, so colour is never the sole cue. The *unknown* state is the bare
// muted track with NO fill child — told apart by its "— of 11" text and the
// question glyph, never by a hatch or pattern (the palette bans gradients).
// ★ Fill tokens are written as three concrete class strings on purpose — never
// one arbitrary-value bracket with a pipe or wildcard (Tailwind v4 scans every
// file and an invalid bracket breaks globals.css).
// ★ The banner renders on the current project row only, so its action needs no
// row token. Extending it to every row would need buildRowTokens: a repeated
// "Complete them" is a WCAG 2.4.6 failure no gate in this repo can detect.

import { Banner } from "./banner";
import { Button } from "./button";
import { t, tPlural, type Lang, type TranslationKey } from "./i18n";
import { QuestionMarkCircleIcon } from "./icons";
import { ProgressTrack } from "./progress-track";
import type { KeyFactId } from "./project-key-facts";

export type KeyFactsRowState =
  | { kind: "measured"; filled: number; total: number; missing: readonly KeyFactId[] }
  | { kind: "unknown"; total: number };

/** Filled count at which the meter turns amber (below: red; all: green). */
export const KEY_FACTS_AMBER_MIN = 8;

const FACT_LABEL: Readonly<Record<KeyFactId, TranslationKey>> = {
  name: "projectName",
  code: "projectCode",
  projectManager: "projectManager",
  customer: "projectCustomer",
  products: "projectProducts",
  profitCenter: "projectProfitCenter",
  naceSection: "projectNaceSection",
  deployment: "projectDeployment",
  contactPersons: "projectContactPersons",
  regulatory: "projectRegulatory",
  startDate: "projectStartDate",
};

function fillClass(filled: number, total: number): string {
  if (filled >= total) return "bg-[var(--rag-green)]";
  if (filled >= KEY_FACTS_AMBER_MIN) return "bg-[var(--rag-amber)]";
  return "bg-[var(--rag-red)]";
}

export function KeyFactsMeter({ lang, state }: { lang: Lang; state: KeyFactsRowState }) {
  const measured = state.kind === "measured";
  const missingCount = measured ? state.missing.length : 0;
  const sentence = !measured
    ? t(lang, "projectKeyFactsUnknown")
    : missingCount === 0
      ? t(lang, "projectKeyFactsComplete")
      : tPlural(lang, "projectKeyFactsMissing", missingCount, missingCount);
  const count = measured
    ? t(lang, "projectKeyFactsCount", state.filled, state.total)
    : t(lang, "projectKeyFactsCountUnknown", state.total);

  return (
    <div className="flex flex-col gap-1" data-key-facts={state.kind}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1 text-foreground">
          {!measured && (
            <QuestionMarkCircleIcon
              data-key-facts-unknown-glyph=""
              aria-hidden="true"
              className="h-3.5 w-3.5 text-muted-foreground"
            />
          )}
          {sentence}
        </span>
        <span className="font-mono text-muted-foreground">{count}</span>
      </div>
      <ProgressTrack height="h-1.5" aria-hidden="true" data-key-facts-track="">
        {measured && (
          <div
            data-key-facts-fill=""
            className={`h-full ${fillClass(state.filled, state.total)}`}
            style={{ width: `${Math.round((state.filled / state.total) * 100)}%` }}
          />
        )}
      </ProgressTrack>
    </div>
  );
}

export function KeyFactsBanner({
  lang,
  missing,
  onComplete,
}: {
  lang: Lang;
  missing: readonly KeyFactId[];
  onComplete: () => void;
}) {
  if (missing.length === 0) {
    return <Banner severity="success">{t(lang, "projectKeyFactsBannerComplete")}</Banner>;
  }
  const list = missing.map((id) => t(lang, FACT_LABEL[id])).join(", ");
  return (
    <Banner severity="warn" className="flex flex-wrap items-center justify-between gap-2">
      <span>{t(lang, "projectKeyFactsBannerMissing", list)}</span>
      <Button variant="secondary" size="sm" onClick={onComplete}>
        {t(lang, "projectKeyFactsCompleteAction")}
      </Button>
    </Banner>
  );
}
