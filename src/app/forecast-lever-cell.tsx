"use client";

// What it would take (§502 part 4): one target's levers as badges — "On target", or "Working it out…" while the
// search runs. Presentational: the Forecast view's milestone table and the Reports Forecast section render it, each
// with its own search (`useLeverSearch`). Reaching levers lead (prioritising, then people, then tasks — the later
// ones read "or …"); what does not reach follows. Explore shows only when people or tasks reach: a prioritise-only
// row has no draft to open.

import { type Lang, t, tPlural } from "./i18n";
import { Badge } from "./badge";
import { Button } from "./button";
import { rowLabel } from "./row-tokens";
import { formatChance } from "./forecast-tables";
import { chanceSeverity, type TargetConfidence } from "./forecast-target";
import type { LeverKind, LeverOutcome, WhatItTakes } from "./forecast-levers";
import type { Health } from "./health";

export type ForecastLeverCellProps = {
  lang: Lang;
  /** The row's unique token (`useRowTokens`), so two rows' Explore buttons never share a name. */
  milestoneName: string;
  result: WhatItTakes | "pending";
  goal: TargetConfidence;
  onExplore?: (kind: LeverKind, n: number) => void;
  /** Reserved for the Ask-Claude draft button (a later step); nothing renders for it yet. */
  onAskClaude?: () => void;
};

const PERCENT = 100;
const BADGE_CLASS = "border border-line bg-surface text-foreground";
const SEVERITY_HEALTH: Record<ReturnType<typeof chanceSeverity>, Health> = { red: "R", amber: "A", green: "G" };

/** The RAG level of a part-4 chance dot: `chanceSeverity` against the project's target. */
export function chanceRagLevel(chance: number, goal: TargetConfidence): Health {
  return SEVERITY_HEALTH[chanceSeverity(chance, goal)];
}

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

/** The badge texts in order, and whether any lever reaches the goal. */
function leverTexts(lang: Lang, r: WhatItTakes, goal: TargetConfidence): { texts: string[]; anyReaches: boolean } {
  const reach: string[] = [];
  const notes: string[] = [];
  if (r.prioritised !== null && r.prioritised >= goal / PERCENT) {
    reach.push(t(lang, "forecastLeverPrioritise", formatChance(r.prioritised, lang)));
  }
  if (r.people.state === "reaches") reach.push(tPlural(lang, "forecastLeverPeople", r.people.n, r.people.n));
  else if (r.people.state === "out-of-reach") notes.push(t(lang, "forecastLeverPeopleOutOfReach"));
  else if (r.people.state === "inert" && r.people.reason === "needs-booked-hours") notes.push(t(lang, "forecastLeverNeedsHours"));
  if (r.tasks.state === "reaches") reach.push(tPlural(lang, "forecastLeverTasks", r.tasks.n, r.tasks.n));
  else if (r.tasks.state === "out-of-reach") notes.push(t(lang, "forecastLeverTasksOutOfReach"));
  if (r.prioritised !== null && r.prioritised < goal / PERCENT) notes.push(t(lang, "forecastLeverPrioritiseShort"));
  const texts = [...reach.map((s, i) => (i === 0 ? s : t(lang, "forecastLeverOr", s))), ...notes];
  return { texts, anyReaches: reach.length > 0 };
}

export function ForecastLeverCell({ lang, milestoneName, result, goal, onExplore }: ForecastLeverCellProps) {
  if (result === "pending") return <span className="text-xs text-muted-foreground">{t(lang, "forecastLeverWorking")}</span>;
  if (chanceSeverity(result.chance, goal) === "green") {
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
        <Button variant="secondary" size="xs" aria-label={rowLabel(t(lang, "forecastExplore"), milestoneName)}
          onClick={() => onExplore(explore.kind, explore.n)}>
          {t(lang, "forecastExplore")} <span aria-hidden="true">→</span>
        </Button>
      )}
    </div>
  );
}
