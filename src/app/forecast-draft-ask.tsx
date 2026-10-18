"use client";

// "Ask Claude to draft a proposal" (§502 part 4, spec §3.6): a button beside a below-target row's lever cell, and
// in the Reports section's empty-proposal line, that sends the user to the AI chat with the row's numbers already
// in the prompt. The parent decides whether it renders at all (AI on, simulation active, not a popout).

import { SparklesIcon } from "./icons";
import { Button } from "./button";
import { type Lang, t } from "./i18n";
import { localeFor } from "./date-format";
import { formatDayMonthYear } from "./forecast-format";
import { formatChance } from "./forecast-tables";
import { isValidIsoDate } from "./forecast/throughput";
import { rowLabel } from "./row-tokens";
import type { TargetConfidence } from "./forecast-target";
import { useWorkspaceTab } from "./workspace-tab-context";

/** `id` rides the prompt so Claude can address the milestone (`create_forecast_scenario` takes `milestoneId`)
 *  without matching on a name two milestones may share. */
export type DraftAskMilestone = { id: number; name: string; date: string; chance: number };
export type DraftAskPlan = { date: string; chance: number };

type Props = {
  lang: Lang;
  goal: TargetConfidence;
} & (
  | {
    milestone: DraftAskMilestone;
    plan?: undefined;
    /** The row's unique token (`useRowTokens`); the accessible name carries it so twin milestones stay apart. */
    rowName?: string;
  }
  | {
    milestone: null;
    plan: DraftAskPlan;
    /** The plan end's row token (the Reports section's pseudo row); named so it differs from every row's button. */
    rowName?: string;
  }
);

const dateText = (lang: Lang, iso: string) => (isValidIsoDate(iso) ? formatDayMonthYear(iso, localeFor(lang)) : iso);

export function ForecastDraftAsk({ lang, milestone, plan, goal, rowName }: Props) {
  const { requestChat } = useWorkspaceTab();
  const label = t(lang, "forecastDraftAskLabel");
  const goalText = t(lang, "forecastPercent", goal);
  const body = milestone === null
    ? t(lang, "forecastDraftAskBodyPlan", dateText(lang, plan.date), formatChance(plan.chance, lang), goalText)
    : t(lang, "forecastDraftAskBody", milestone.name, dateText(lang, milestone.date), formatChance(milestone.chance, lang), goalText, milestone.id);
  const target = milestone === null ? rowName : (rowName ?? milestone.name);
  return (
    <Button
      variant="secondary" size="xs"
      aria-label={target === undefined ? undefined : rowLabel(label, target)}
      onClick={() => requestChat(body, true)}
    >
      <SparklesIcon className="h-4 w-4" aria-hidden="true" /> {label}
    </Button>
  );
}
