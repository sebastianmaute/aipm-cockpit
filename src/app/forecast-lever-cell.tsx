"use client";

// What it would take (§502 part 4): one target's levers as badges — "On target", or "Working it out…" while the
// search runs. Presentational: the Forecast view's milestone table and the Reports Forecast section
// (`forecast-report-section.tsx`) each render it from their own search (`useLeverSearch`). Reaching levers lead (prioritising, then people, then tasks — the later
// ones read "or …"); what does not reach follows. Explore shows only when people or tasks reach: a prioritise-only
// row has no draft to open. The wording itself is `leverTexts` (`forecast-lever-text.ts`), shared with the export rows.

import { type Lang, t } from "./i18n";
import { Badge } from "./badge";
import { Button } from "./button";
import { rowLabel } from "./row-tokens";
import { ForecastDraftAsk, type DraftAskMilestone } from "./forecast-draft-ask";
import { leverTexts } from "./forecast-lever-text";
import type { TargetConfidence } from "./forecast-target";
import type { LeverKind, LeverOutcome, WhatItTakes } from "./forecast-levers";

export type ForecastLeverCellProps = {
  lang: Lang;
  /** The row's unique token (`useRowTokens`), so two rows' Explore buttons never share a name. */
  milestoneName: string;
  result: WhatItTakes | "pending";
  goal: TargetConfidence;
  onExplore?: (kind: LeverKind, n: number) => void;
  /** The Explore button's visible label: "Explore" in the Forecast view, "Explore in Forecast" on Reports (spec §3.4). */
  exploreLabel?: string;
  /** The row's milestone, when "Ask Claude to draft a proposal" is offered (below target with a chance, AI on, simulation
   *  active, no popout); absent = no button. Shown while the search is still working too. */
  askClaude?: DraftAskMilestone;
};

const BADGE_CLASS = "border border-line bg-surface text-foreground";

type Lever = { kind: LeverKind; n: number };
const reached = (kind: LeverKind, o: LeverOutcome): Lever | null => (o.state === "reaches" ? { kind, n: o.n } : null);

/** The lever Explore opens: people first, then tasks; null when neither reaches. */
export function primaryLever(r: WhatItTakes): Lever | null {
  return reached("people", r.people) ?? reached("tasks", r.tasks);
}

/** The other reaching lever, offered in the draft as "Or use … instead"; null when there is none. */
export function alternativeLever(r: WhatItTakes, kind: LeverKind): Lever | null {
  return kind === "people" ? reached("tasks", r.tasks) : reached("people", r.people);
}

export function ForecastLeverCell({ lang, milestoneName, result, goal, onExplore, exploreLabel = t(lang, "forecastExplore"), askClaude }: ForecastLeverCellProps) {
  // The Ask-Claude button needs nothing from the search, so it does not wait for it: the caller passes `askClaude`
  // only for a below-target row with a chance.
  const ask = askClaude && <ForecastDraftAsk lang={lang} milestone={askClaude} rowName={milestoneName} goal={goal} />;
  if (result === "pending") {
    const working = <span className="text-xs text-muted-foreground">{t(lang, "forecastLeverWorking")}</span>;
    return ask ? <div className="flex flex-col items-start gap-1">{working}{ask}</div> : working;
  }
  if (result.people.state === "on-target" && result.tasks.state === "on-target") {
    return <span className="text-xs text-muted-foreground">{t(lang, "forecastLeverOnTarget")}</span>;
  }
  const { texts, anyReaches } = leverTexts(lang, result, goal);
  const explore = primaryLever(result);
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap gap-1">
        {texts.map((text) => (
          <Badge key={text} data-lever-badge="" className={BADGE_CLASS}>{text}</Badge>
        ))}
      </div>
      {!anyReaches && (
        <p className="text-xs text-muted-foreground">{t(lang, "forecastLeverNone", t(lang, "forecastPercent", goal))}</p>
      )}
      {explore !== null && onExplore && (
        <Button variant="secondary" size="xs" aria-label={rowLabel(exploreLabel, milestoneName)}
          onClick={() => onExplore(explore.kind, explore.n)}>
          {exploreLabel} <span aria-hidden="true">→</span>
        </Button>
      )}
      {ask}
    </div>
  );
}
