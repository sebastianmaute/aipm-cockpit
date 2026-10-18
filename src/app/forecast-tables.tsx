"use client";

// Schedule forecast tables (§502): the P50/P80/P95 When + How-many table, the
// cost-at-finish card and the milestone chance table. Presentational — the panel owns the engine call.

import { useId, useMemo, useState, type ReactNode } from "react";
import { type Lang, t, tPlural } from "./i18n";
import { localeFor } from "./date-format";
import { formatDayMonthYear, formatHours } from "./forecast-format";
import type { CostAtFinish } from "./forecast/cost";
import { costRangeRows, costUnavailableText } from "./budget-sim-text";
import { formatCurrency } from "./resource-cost";
import { SimValue } from "./sim-value";
import type { ScheduleForecast } from "./forecast";
import type { MilestoneChance } from "./forecast/milestones";
import type { ForecastUnit } from "./forecast/constants";
import { isValidIsoDate } from "./forecast/throughput";
import type { BudgetCurrency, Milestone } from "./types";
import { DataTable } from "./data-table";
import { Input } from "./form-controls";
import { Section, SortResizeTh, useSortableFilter, useSortHeaderProps, type SortDir } from "./report-table";
import { sortValueGetter } from "./sort-value-getter";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { useRowTokens } from "./use-row-tokens";
import { flashOutlineClass } from "./use-deeplink-row-flash";
import { RagDot } from "./rag-dot";
import type { Health } from "./health";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Whole percent; a chance short of certain that rounds to 100 reads "≥ 99 %". */
export function formatChance(chance: number, lang: Lang): string {
  const pct = Math.round(chance * 100);
  if (chance < 1 && pct >= 100) return t(lang, "forecastNearlyCertain");
  return t(lang, "forecastPercent", pct);
}

/** A When date, or "> 5 y" when the percentile ran past the horizon. */
export function formatWhen(date: string | null, lang: Lang): string {
  return date === null ? t(lang, "forecastBeyond") : formatDayMonthYear(date, localeFor(lang));
}

/** Tasks as a count with its unit word ("1 task", "5 tasks"); effort (minutes) as whole hours ("12 h"). */
export function formatAmount(amount: number, unit: ForecastUnit, lang: Lang): string {
  const locale = localeFor(lang);
  if (unit === "effort") return formatHours(amount / 60, locale);
  const whole = Math.round(amount);
  return tPlural(lang, "forecastAmountTasks", whole, new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(whole));
}

const CELL = "px-3 py-2";

export function PercentileTable({
  lang,
  forecast,
  target,
  today,
  maxTarget,
  onTargetChange,
}: {
  lang: Lang;
  forecast: ScheduleForecast;
  target: string;
  today: string;
  /** Last accepted target, the forecast horizon (R15). */
  maxTarget: string;
  onTargetChange: (iso: string) => void;
}) {
  const [invalid, setInvalid] = useState(false);
  // Typing and arrow-stepping edit a draft; only blur or Enter commits it, so the forecast reruns once
  // per accepted date, as the What-if fields do. `base` is the target the draft was started from.
  const [draft, setDraft] = useState<{ base: string; text: string } | null>(null);
  // Render-time reconcile: a target changed from outside (midnight re-clamp) drops a draft begun against the old one.
  if (draft !== null && draft.base !== target) setDraft(null);
  const messageId = useId();
  const hintId = useId();
  const pending = draft !== null;
  const describedBy = [invalid ? messageId : null, pending ? hintId : null].filter((id) => id !== null).join(" ") || undefined;
  const targetText = formatDayMonthYear(target, localeFor(lang));
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    const iso = draft.text;
    if (!ISO_DATE.test(iso)) return;
    // A target before today counts no working days, and one past the horizon is capped (R15):
    // refuse both like an invalid What-if value.
    const accepted = iso >= today && iso <= maxTarget;
    setInvalid(!accepted);
    if (accepted) onTargetChange(iso);
  };
  return (
    <Section title={t(lang, "forecastPercentilesTitle")}>
      <div className="mb-1 flex flex-wrap items-center gap-4 text-sm">
        <span className="text-muted-foreground">{t(lang, "forecastBacklog", formatAmount(forecast.backlog, forecast.unit, lang))}</span>
        <label className="flex items-center gap-2 text-muted-foreground">
          {t(lang, "forecastTargetDate")}
          <Input
            type="date"
            size="xs"
            value={draft?.text ?? target}
            min={today}
            max={maxTarget}
            invalid={invalid}
            aria-describedby={describedBy}
            onChange={(e) => setDraft({ base: target, text: e.target.value })}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
            }}
          />
        </label>
        {invalid && (
          <span id={messageId} className="text-xs font-medium text-ui-pink-strong">
            {t(lang, "forecastInputInvalid")}
          </span>
        )}
      </div>
      {/* Always mounted with one line reserved, so the hint appears without moving the table. A date
          picked from the native calendar also waits for blur or Enter, which is what this says. */}
      <p className="mb-2 min-h-4 text-xs text-muted-foreground">
        {pending && <span id={hintId}>{t(lang, "forecastTargetDateHint")}</span>}
      </p>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="min-w-full text-left text-sm">
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              <th scope="col" className={`${CELL} font-medium`}>{t(lang, "forecastColConfidence")}</th>
              <th scope="col" className={`${CELL} font-medium`}>{t(lang, "forecastColWhen")}</th>
              <th scope="col" className={`${CELL} text-right font-medium`}>{t(lang, "forecastColHowMany", targetText)}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {forecast.when.map((w, i) => (
              <tr key={w.p}>
                <th scope="row" className={`${CELL} font-medium text-foreground`}>{`P${w.p}`}</th>
                <td className={`${CELL} tabular-nums`}>{formatWhen(w.date, lang)}</td>
                <td className={`${CELL} text-right tabular-nums`}>{formatAmount(forecast.howMany[i].amount, forecast.unit, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

type MilestoneRow = { id: number; name: string; date: string; result: MilestoneChance };
type MilestoneSortKey = "name" | "date" | "chance" | "prioritised" | "gap";

const nameOfRow = (r: MilestoneRow) => r.name;

const chanceOf = (r: MilestoneRow): number => (r.result.state === "chance" ? r.result.chance : 0);
const prioritisedOf = (r: MilestoneRow): number => (r.result.state === "chance" ? r.result.chancePrioritised : 0);
/** How much prioritising the milestone's tasks would add, in percentage points. */
const gapOf = (r: MilestoneRow): number => Math.round(prioritisedOf(r) * 100) - Math.round(chanceOf(r) * 100);

const getValue = sortValueGetter<MilestoneRow, MilestoneSortKey>({
  name: (r) => r.name,
  date: (r) => r.date,
  chance: chanceOf,
  prioritised: prioritisedOf,
  gap: gapOf,
});
// Overdue and no-linked-tasks rows have no percent: unknown, not zero, so they sort last both ways.
const isUnknown = (r: MilestoneRow, k: MilestoneSortKey): boolean =>
  r.result.state !== "chance" && (k === "chance" || k === "prioritised" || k === "gap");

function stateText(result: MilestoneChance, lang: Lang): string | null {
  if (result.state === "overdue") return t(lang, "forecastOverdue");
  if (result.state === "no-linked-tasks") return t(lang, "forecastNoLinkedTasks");
  return null;
}

function formatGap(points: number, lang: Lang): string {
  const signed = points > 0 ? `+${points}` : String(points);
  // The magnitude selects the form: tPlural reads any negative as plural, and "-1 pt" is singular too.
  return tPlural(lang, "forecastGapPoints", Math.abs(points), signed);
}

/** §502 part 4: the "what it would take" column. `cell` renders a row WITH a chance (its row token names its
 *  controls); a row without one (overdue, nothing linked) gets an empty cell — it has no lever (Ruling A). */
export type MilestoneLeverColumn = {
  header: string;
  /** The RAG level of a chance against the project's target (`chanceRagLevel`). */
  rag: (chance: number) => Health;
  cell: (milestoneId: number, token: string) => ReactNode;
};

export function MilestoneTable({
  lang,
  milestones,
  chances,
  whatIf,
  flashId = null,
  levers,
}: {
  lang: Lang;
  milestones: readonly Milestone[];
  chances: readonly MilestoneChance[];
  whatIf: boolean;
  /** The milestone a deep-link just opened (`useDeepLinkRowFlash`): its row carries the flash outline. */
  flashId?: number | null;
  /** Absent = the table as it was, with no dots and no lever column. */
  levers?: MilestoneLeverColumn;
}) {
  const [sort, setSort] = useState<{ key: MilestoneSortKey; dir: SortDir }>({ key: "date", dir: "asc" });
  const rows = useMemo(() => {
    const byId = new Map(milestones.map((m) => [m.id, m]));
    return chances.flatMap((c): MilestoneRow[] => {
      const m = byId.get(c.id);
      return m ? [{ id: m.id, name: m.name, date: m.date, result: c }] : [];
    });
  }, [milestones, chances]);
  const { sorted, click } = useSortableFilter(rows, sort, setSort, "", getValue, isUnknown);
  const tokens = useRowTokens(sorted, nameOfRow);
  const th = useSortHeaderProps(sort.key, sort.dir, click);
  const locale = localeFor(lang);

  return (
    <Section title={t(lang, "forecastMilestonesTitle")}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(lang, "forecastNoMilestones")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line">
          <DataTable
            className="min-w-full text-left text-sm"
            head={
              <tr>
                <SortResizeTh {...th} label={t(lang, "forecastColMilestone")} sortCol="name" />
                <SortResizeTh {...th} label={t(lang, "forecastColDate")} sortCol="date" />
                <SortResizeTh {...th} label={t(lang, "forecastColChance")} sortCol="chance" align="right" />
                <SortResizeTh {...th} label={t(lang, "forecastColChancePrioritised")} sortCol="prioritised" align="right" />
                <SortResizeTh {...th} label={t(lang, "forecastColGap")} sortCol="gap" align="right" />
                {levers && <th scope="col" className={`${CELL} font-medium`}>{levers.header}</th>}
              </tr>
            }
            tbodyClassName="divide-y divide-line"
          >
            {sorted.map((row) => {
              const text = stateText(row.result, lang);
              // The token can't miss: every rendered row went through useRowTokens above.
              const token = tokens.get(row.id) ?? row.name;
              return (
                <tr key={row.id} data-deeplink-row={row.id} className={flashOutlineClass(flashId === row.id) || undefined}>
                  <th scope="row" aria-label={token} className={`${CELL} font-medium text-foreground`}>
                    {levers && row.result.state === "chance" && <RagDot level={levers.rag(row.result.chance)} className="mr-1.5" />}
                    {row.name}
                  </th>
                  <td className={`${CELL} tabular-nums text-muted-foreground`}>{isValidIsoDate(row.date) ? formatDayMonthYear(row.date, locale) : ""}</td>
                  {text === null ? (
                    <>
                      <td className={`${CELL} text-right tabular-nums`}>{formatChance(chanceOf(row), lang)}</td>
                      <td className={`${CELL} text-right tabular-nums`}>{formatChance(prioritisedOf(row), lang)}</td>
                      <td className={`${CELL} text-right tabular-nums`}>{formatGap(gapOf(row), lang)}</td>
                    </>
                  ) : (
                    <td colSpan={3} className={`${CELL} text-right text-muted-foreground`}>{text}</td>
                  )}
                  {levers && <td className={`${CELL} align-top`}>{row.result.state === "chance" ? levers.cell(row.id, token) : null}</td>}
                </tr>
              );
            })}
          </DataTable>
        </div>
      )}
      {whatIf && <p className="mt-2 text-xs text-muted-foreground">{t(lang, "forecastWhatIfMilestoneNote")}</p>}
    </Section>
  );
}

/**
 * The Forecast view's "Cost at finish" card (§502 part 3): P50/P80/P95 and the chance over budget from the
 * view's own run, each figure a `SimValue`. `cost` null (no budget facts at all: no buckets) reads as no
 * budget. A budget of 0 still shows the range, without the chance row (`costRangeRows` drops it, as the pace
 * card and the tile do). Below the schedule or spend floor, one line names the missing input. Money in the
 * baseline currency.
 */
export function CostTable({ lang, cost, currency }: { lang: Lang; cost: CostAtFinish | null; currency: BudgetCurrency }) {
  const locale = localeFor(lang);
  const heading = t(lang, "budgetSimCostAtFinish");
  let body: React.ReactNode;
  if (cost === null) {
    body = <p className="text-sm text-muted-foreground">{t(lang, "budgetSimAddBudget")}</p>;
  } else if (cost.kind === "unavailable") {
    body = <p className="text-sm text-muted-foreground">{costUnavailableText(lang, cost)}</p>;
  } else {
    const rows = costRangeRows(lang, cost, (v) => formatCurrency(v, currency, locale));
    body = (
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="min-w-full text-left text-sm">
          <tbody className="divide-y divide-line">
            {rows.map(([term, value]) => (
              <tr key={term}>
                <th scope="row" className={`${CELL} font-medium text-foreground`}>{term}</th>
                <td className={`${CELL} text-right tabular-nums`}>
                  <SimValue lang={lang} label={term} value={value} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div role="group" aria-label={t(lang, "simValueSr", heading)} data-sim="true">
      <h3 className="mb-2 text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">{heading}</h3>
      {body}
    </div>
  );
}
