"use client";

// The Reports Forecast section's milestones table (§502 part 4, spec §3.2 item 4): worst first, a RAG dot against
// the project's target, and "what it would take" (`ForecastLeverCell`) on each below-target row. On-target rows say
// "On target"; an overdue milestone or one with nothing linked says so, with no chance and no lever (Ruling A).
// Presentational: the section runs the forecast and the lever search, orders the rows and mints their tokens (with
// the plan end as a pseudo row, so no milestone's Explore name can equal the plan end's).

import { type Lang, t } from "./i18n";
import { localeFor } from "./date-format";
import { formatDayMonthYear } from "./forecast-format";
import { formatChance } from "./forecast-tables";
import { ForecastLeverCell, alternativeLever } from "./forecast-lever-cell";
import type { LeverKind, LeverTarget } from "./forecast-levers";
import { leverKey, type LeverValue } from "./use-lever-search";
import { chanceRagLevel, chanceSeverity, type TargetConfidence } from "./forecast-target";
import { chanceRagLabel } from "./forecast-rag-label";
import type { ChanceRow, MilestoneRow } from "./forecast-milestone-rows";
import { isValidIsoDate } from "./forecast/throughput";
import type { ForecastDraftRequest } from "./workspace-tab-context";
import { RagDot } from "./rag-dot";
import { Section } from "./report-table";
import { TABLE_HEAD_CLASS } from "./table-styles";

const CELL = "px-3 py-2";

/** Explore for one target, built as the Forecast view builds its own: the row's primary lever, and the other
 *  reaching lever as the draft's alternative. Undefined while the search runs or when nothing can open a draft. */
export function exploreFor(
  target: LeverTarget, value: LeverValue | undefined, onExplore: ((req: ForecastDraftRequest) => void) | undefined,
): ((kind: LeverKind, n: number) => void) | undefined {
  if (onExplore === undefined || value === undefined || value === "pending") return undefined;
  return (kind, n) => onExplore({ target, kind, n, alt: alternativeLever(value, kind) });
}

function LeverCell({ lang, row, token, goal, levers, onExplore, askClaude }: {
  lang: Lang; row: ChanceRow; token: string; goal: TargetConfidence;
  levers: ReadonlyMap<string, LeverValue>; onExplore?: (req: ForecastDraftRequest) => void; askClaude: boolean;
}) {
  if (chanceSeverity(row.asIs.chance, goal) === "green") {
    return <span className="text-xs text-muted-foreground">{t(lang, "forecastLeverOnTarget")}</span>;
  }
  const target: LeverTarget = { kind: "milestone", id: row.id };
  // A target the search left out (its `whatItTakesSync` is null) has no lever — no cell, as in the Forecast view.
  const value = levers.get(leverKey(target));
  if (value === undefined) return null;
  return (
    <ForecastLeverCell
      lang={lang} milestoneName={token} result={value} goal={goal}
      onExplore={exploreFor(target, value, onExplore)} exploreLabel={t(lang, "forecastReportExplore")}
      askClaude={askClaude ? { name: row.name, date: row.date, chance: row.asIs.chance } : undefined}
    />
  );
}

export function ForecastReportMilestones({ lang, rows, tokens, goal, levers, onExplore, askClaude = false }: {
  lang: Lang;
  /** Worst first (`milestoneRowsWorstFirst`). */
  rows: readonly MilestoneRow[];
  /** Row-unique names, minted over the rows AND the plan-end pseudo row. */
  tokens: ReadonlyMap<number, string>;
  goal: TargetConfidence;
  levers: ReadonlyMap<string, LeverValue>;
  /** Absent (a popout, or the Forecast view switched off): no Explore buttons. */
  onExplore?: (req: ForecastDraftRequest) => void;
  /** AI on and not a popout: each below-target row offers "Ask Claude to draft a proposal". */
  askClaude?: boolean;
}) {
  const locale = localeFor(lang);
  return (
    <Section title={t(lang, "forecastReportMilestonesTitle")}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(lang, "forecastNoMilestones")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="min-w-full text-left text-sm">
            <thead className={TABLE_HEAD_CLASS}>
              <tr>
                <th scope="col" className={`${CELL} font-medium`}>{t(lang, "forecastColMilestone")}</th>
                <th scope="col" className={`${CELL} font-medium`}>{t(lang, "due")}</th>
                <th scope="col" className={`${CELL} text-right font-medium`}>{t(lang, "forecastColChance")}</th>
                <th scope="col" className={`${CELL} text-right font-medium`}>{t(lang, "forecastColChancePrioritised")}</th>
                <th scope="col" className={`${CELL} font-medium`}>{t(lang, "forecastColWhatItTakes", t(lang, "forecastPercent", goal))}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => {
                // The token can't miss: the section minted one for every row.
                const token = tokens.get(row.id) ?? row.name;
                const { asIs } = row;
                const rag = asIs.state === "chance" ? chanceRagLevel(asIs.chance, goal) : undefined;
                return (
                  <tr key={row.id} data-milestone-row={row.id}>
                    <th scope="row" aria-label={rag ? `${token}, ${chanceRagLabel(lang, rag)}` : token} className={`${CELL} font-medium text-foreground`}>
                      {rag && <RagDot level={rag} label={chanceRagLabel(lang, rag)} className="mr-1.5" />}
                      {row.name}
                    </th>
                    <td className={`${CELL} tabular-nums text-muted-foreground`}>{isValidIsoDate(row.date) ? formatDayMonthYear(row.date, locale) : ""}</td>
                    {asIs.state === "chance" ? (
                      <>
                        <td className={`${CELL} text-right tabular-nums`}>{formatChance(asIs.chance, lang)}</td>
                        <td className={`${CELL} text-right tabular-nums`}>{formatChance(asIs.chancePrioritised, lang)}</td>
                        <td className={`${CELL} align-top`}>
                          <LeverCell lang={lang} row={{ ...row, asIs }} token={token} goal={goal} levers={levers} onExplore={onExplore} askClaude={askClaude} />
                        </td>
                      </>
                    ) : (
                      <td colSpan={3} className={`${CELL} text-muted-foreground`}>
                        {t(lang, asIs.state === "overdue" ? "forecastOverdue" : "forecastNoLinkedTasks")}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
