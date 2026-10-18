"use client";

// The scenario editor's live comparison (§502 part 4, spec §3.4): As is against the draft being edited, through the
// SAME engine and tables as Scenarios mode (`computeScenarioColumn`, `ScenarioComparisonTable`,
// `ScenarioMilestoneTable`). A draft column costs one 10,000-trial run (about 50-70 ms), so it is computed off the
// typing path: once the rows have been still for DRAFT_RECOMPUTE_MS, in a timer (state is set from the callback,
// never in an effect body). Only a complete draft — at least one row, every row schedulable — gets a column; a
// figure is shown only while it belongs to the CURRENT rows, so no number from an earlier draft is ever on screen.

import { useEffect, useMemo, useState } from "react";
import { type Lang, t } from "./i18n";
import { computeScenarioColumn, type ScenarioColumn, type ScenarioRunInput } from "./forecast-scenario-compare";
import type { ScheduleContext } from "./forecast-added-people";
import type { ScenarioChange } from "./forecast-scenarios";
import type { TargetConfidence } from "./forecast-target";
import { ScenarioComparisonTable, ScenarioMilestoneTable, type ComparedColumn } from "./forecast-scenario-tables";

const DRAFT_RECOMPUTE_MS = 250;

export type DraftCompareInput = { input: ScenarioRunInput; asIs: ScenarioColumn; goal?: TargetConfidence };

export function ScenarioDraftCompare({ lang, compare, context, changes }: {
  lang: Lang;
  compare: DraftCompareInput;
  context: ScheduleContext;
  /** The draft's rows; null while the draft is incomplete (no Draft figures then). */
  changes: readonly ScenarioChange[] | null;
}) {
  const { input, asIs, goal } = compare;
  const [computed, setComputed] = useState<{
    input: ScenarioRunInput;
    context: ScheduleContext;
    changes: readonly ScenarioChange[];
    column: ScenarioColumn;
  } | null>(null);
  useEffect(() => {
    if (changes === null) return undefined;
    const timer = setTimeout(() => setComputed({ input, context, changes, column: computeScenarioColumn(input, changes, context) }), DRAFT_RECOMPUTE_MS);
    return () => clearTimeout(timer);
  }, [input, changes, context]);
  // Belongs to the CURRENT rows, input and context alike: a new As is must never sit beside an old-input Draft.
  const draft = computed !== null && computed.changes === changes && computed.input === input && computed.context === context
    ? computed.column
    : null;

  const columns = useMemo<ComparedColumn[]>(
    () => [
      { key: "as-is", name: t(lang, "forecastScenariosAsIs"), column: asIs },
      ...(draft === null ? [] : [{ key: "draft", name: t(lang, "forecastScenarioDraftColumn"), column: draft }]),
    ],
    [lang, asIs, draft],
  );
  return (
    <div data-draft-compare="" className="space-y-2">
      <ScenarioComparisonTable lang={lang} columns={columns} currency={input.directory.baseCurrency} noBudget={input.costOn && input.budgetFacts === null} />
      {draft === null && (
        <p className="text-xs text-muted-foreground">
          {t(lang, changes === null ? "forecastScenarioDraftIncomplete" : "forecastScenarioDraftCalculating")}
        </p>
      )}
      <ScenarioMilestoneTable lang={lang} milestones={input.milestones} columns={columns} goal={goal} />
    </div>
  );
}
