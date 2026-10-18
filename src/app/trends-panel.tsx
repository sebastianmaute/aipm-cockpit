"use client";
import { useMemo, useState } from "react";
import { type Lang, t, tPlural, localeFor } from "./i18n";
import { buildRowTokens, rowLabel } from "./row-tokens";
import { VIEW_PANE_CLASS, INNER_TABLE_CLASS } from "./view-styles";
import { ViewCallout } from "./view-callout";
import { TextButton } from "./text-button";
import { DataTable } from "./data-table";
import { RagBadge } from "./rag-badge";
import { TrendChart, type TrendPoint } from "./trend-chart";
import { formatCurrency } from "./resource-cost";
import type { SnapshotRecord, VarianceRow } from "./snapshot";
import type { BudgetCurrency } from "./types";
import { VARIANCE_LABEL_KEYS, fmtVarianceCell, fmtVarianceDelta } from "./variance-format";
import { ReportCard } from "./report-table";
import { useResizable } from "./use-resizable";
import { useColumnResize } from "./use-column-resize";
import { ColumnResizeHandle } from "./task-manager-ui";
import { InfoTooltip } from "./info-tooltip";
import { useDisplayTimezone } from "./display-timezone-context";
import { formatDisplayTimestamp } from "./tz-display";
import { EmptyState } from "./empty-state";
import { Button } from "./button";
import { useConfirm } from "./confirm-dialog";
import { Checkbox } from "./form-controls";
import { ForecastP80Line } from "./forecast-p80-line";
import type { ForecastHistoryEntry } from "./forecast-history";

/** Entries a P80 line needs before it is a line (§502): one point is no trend. */
const MIN_P80_POINTS = 2;

const VARIANCE_COL_WIDTHS = {
  kpi: 200,
  baseline: 120,
  current: 120,
  delta: 140,
} as const;
type VarianceCol = keyof typeof VARIANCE_COL_WIDTHS;

const SNAPSHOT_COL_WIDTHS = {
  capturedAt: 160,
  trigger: 120,
  baseline: 100,
  actions: 180,
} as const;
type SnapshotCol = keyof typeof SNAPSHOT_COL_WIDTHS;

export interface TrendsPanelProps {
  lang: Lang;
  active: boolean;
  snapshots: SnapshotRecord[];
  baseline: SnapshotRecord | null;
  variance: VarianceRow[];
  gaps: string[];
  busy: boolean;
  captureNow: () => Promise<void>;
  setBaseline: (id: string) => Promise<void>;
  deleteSnapshot: (id: string) => Promise<void>;
  deleteSnapshots: (ids: readonly string[]) => Promise<void>;
  /** The project baseline (`plan.currency`, §476): the unit `remainingCost` is
   *  in, once `useSnapshots` has rebased every stored snapshot into it. */
  currency: BudgetCurrency;
  // Per-view Help callout (rendered inside the card, like Open Points). Wired
  // only from workspace-section; omitted in the standalone unit test.
  showHints?: boolean;
  isPopout?: boolean;
  onLearnMore?: (conceptId: string) => void;
  /** §502 part 4 — the recorded daily forecasts, passed only while the simulation is on; absent → no P80 chart. */
  forecastHistory?: readonly ForecastHistoryEntry[];
  /** The plan end, drawn as the P80 chart's reference line. */
  planEnd?: string;
}

function gapBetween(prev: SnapshotRecord, curr: SnapshotRecord, gaps: ReadonlySet<string>): boolean {
  for (const g of gaps) {
    if (g > prev.bucket && g < curr.bucket) return true;
  }
  return false;
}

function trendPoints(snaps: readonly SnapshotRecord[], gaps: ReadonlySet<string>, pick: (s: SnapshotRecord) => number | null): TrendPoint[] {
  return snaps
    .map((s) => ({ s, value: pick(s) }))
    .filter((x): x is { s: SnapshotRecord; value: number } => x.value !== null)
    .map((x, i, arr) => ({
      label: x.s.bucket,
      value: x.value,
      gapBefore: i > 0 && gaps.size > 0 ? gapBetween(arr[i - 1].s, x.s, gaps) : false,
    }));
}

export function TrendsPanel(props: TrendsPanelProps) {
  const { lang, active, snapshots, baseline, variance, gaps, busy, captureNow, setBaseline, deleteSnapshot, deleteSnapshots, currency, showHints, isPopout, onLearnMore, forecastHistory, planEnd } = props;
  const { displayTz } = useDisplayTimezone();
  const confirm = useConfirm();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const { ref, reset } = useResizable("aipm-cockpit:trends-size");
  const varianceResize = useColumnResize<VarianceCol>("trends-variance", VARIANCE_COL_WIDTHS);
  const snapshotResize = useColumnResize<SnapshotCol>("trends-snapshots", SNAPSHOT_COL_WIDTHS);
  const varianceStartResize = varianceResize.startColResize as (col: string, e: React.MouseEvent) => void;
  const snapshotStartResize = snapshotResize.startColResize as (col: string, e: React.MouseEvent) => void;

  // ★★ Rows render NEWEST-FIRST, so the token map is built over that reversed
  // sequence and not the raw array — the occurrence index has to follow what is
  // on screen. Both the list and the map are derived here, above the `!active`
  // early return, because hooks cannot sit below it.
  // ★★ The row's display name is a FORMATTED TIMESTAMP, and a timestamp
  // REPEATS: two snapshots captured in the same displayed minute render the
  // same string. That is why the select checkbox — which already interpolated
  // the timestamp — was no less of a WCAG 2.4.6 collision than the bare
  // "Set as baseline" / "Delete" buttons beside it, and why all three take the
  // same token.
  const renderedSnapshots = useMemo(() => [...snapshots].reverse(), [snapshots]);
  const rowTokens = useMemo(
    () =>
      buildRowTokens(
        renderedSnapshots.map((s) => ({ id: s.id, name: formatDisplayTimestamp(s.capturedAt, displayTz, lang) })),
      ),
    [renderedSnapshots, displayTz, lang],
  );

  if (!active) {
    return (
      <div className={VIEW_PANE_CLASS}>
        <p className="text-sm text-muted-foreground">{t(lang, "trendsRequireTurso")}</p>
      </div>
    );
  }

  const gapSet = new Set(gaps);
  const locale = localeFor(lang);
  // ★ `currency` is the project baseline. The only figure it labels is
  // `remainingCost`, which `buildSnapshot` takes from the engine's burn-down
  // series — in the baseline at capture time (§476). Snapshots carry no
  // currency of their own (§469); a snapshot captured before a baseline
  // switch is rebased into the current baseline by `useSnapshots`
  // (`rebaseSnapshots`) before it reaches this panel.
  const gapLabel = gaps.length > 0 ? tPlural(lang, "trendsGap", gaps.length, gaps.length) : undefined;
  // §502 — "P80 finish over time" on the history's OWN date axis (its dates are not the snapshot buckets), so
  // it is its own chart beside the snapshot ones and shows before the first snapshot. Two P80 entries make a
  // line; below that the chart is left out rather than shown as "too short" (Reports keeps that state).
  const p80Points = forecastHistory?.filter((e) => e.p80 !== null).length ?? 0;
  const p80Chart = forecastHistory && p80Points >= MIN_P80_POINTS
    ? <ForecastP80Line lang={lang} history={forecastHistory} planEnd={planEnd ?? ""} />
    : null;

  const captureButton = (
    <Button
      size="sm"
      onClick={() => { void captureNow(); }}
      disabled={busy}
    >
      {t(lang, "trendsCaptureNow")}
    </Button>
  );

  return (
    <ReportCard lang={lang} sizeRef={ref} onResetSize={reset} title={t(lang, "navTrends")} toolbarExtra={captureButton}>
      {onLearnMore && (
        <ViewCallout
          view="trends"
          lang={lang}
          showHints={showHints !== false}
          isPopout={!!isPopout}
          onLearnMore={onLearnMore}
        />
      )}
      {snapshots.length === 0 ? (
        <div className="space-y-4">
          <EmptyState compact title={t(lang, "trendsNoSnapshots")} />
          {p80Chart}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <h3 className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
              {t(lang, "trendsVarianceHeading")}
              {baseline ? ` · ${t(lang, "trendsBaselineLabel")}: ${baseline.bucket}` : ""}
            </h3>
            <div className={INNER_TABLE_CLASS}>
            <DataTable className="w-full text-left text-sm" head={<>
                <tr>
                  <th className="relative px-3 py-2 text-left" style={{ width: varianceResize.colWidths.kpi, minWidth: varianceResize.colWidths.kpi }}>
                    KPI
                    <ColumnResizeHandle col="kpi" onMouseDown={varianceStartResize} />
                  </th>
                  <th className="relative px-3 py-2 text-right" style={{ width: varianceResize.colWidths.baseline, minWidth: varianceResize.colWidths.baseline }}>
                    {t(lang, "trendsBaselineLabel")}
                    <InfoTooltip text={t(lang, "trendsBaselineLabelHint")} />
                    <ColumnResizeHandle col="baseline" onMouseDown={varianceStartResize} />
                  </th>
                  <th className="relative px-3 py-2 text-right" style={{ width: varianceResize.colWidths.current, minWidth: varianceResize.colWidths.current }}>
                    {t(lang, "trendsCurrentLabel")}
                    <ColumnResizeHandle col="current" onMouseDown={varianceStartResize} />
                  </th>
                  <th className="relative px-3 py-2 text-right" style={{ width: varianceResize.colWidths.delta, minWidth: varianceResize.colWidths.delta }}>
                    {t(lang, "trendsDeltaLabel")}
                    <InfoTooltip text={t(lang, "trendsDeltaLabelHint")} />
                    <ColumnResizeHandle col="delta" onMouseDown={varianceStartResize} />
                  </th>
                </tr>
              </>}>
                {variance.map((row) => (
                  <tr key={row.key}>
                    <td className="px-3 py-2 font-medium">{t(lang, VARIANCE_LABEL_KEYS[row.key])}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtVarianceCell(row, "baseline")}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtVarianceCell(row, "current")}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className="inline-flex items-center justify-end gap-1.5">
                        {fmtVarianceDelta(row, lang)}
                        {row.health ? <RagBadge value={row.health} lang={lang} /> : null}
                      </span>
                    </td>
                  </tr>
                ))}
            </DataTable>
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            <TrendChart caption={t(lang, "trendKpiRemainingHours")} gapCount={gaps.length} gapLabel={gapLabel}
              emptyLabel={t(lang, "trendsNotEnough")}
              points={trendPoints(snapshots, gapSet, (s) => s.remainingHours)}
              format={(v) => `${Math.round(v)}h`} />
            <TrendChart caption={t(lang, "trendKpiRemainingCost")} gapCount={gaps.length} gapLabel={gapLabel}
              emptyLabel={t(lang, "trendsNotEnough")}
              points={trendPoints(snapshots, gapSet, (s) => s.remainingCost)}
              format={(v) => formatCurrency(v, currency, locale)} />
            <TrendChart caption={t(lang, "trendKpiSpi")} gapCount={gaps.length} gapLabel={gapLabel}
              emptyLabel={t(lang, "trendsNotEnough")}
              points={trendPoints(snapshots, gapSet, (s) => s.spi)}
              format={(v) => v.toFixed(2)} />
            <TrendChart caption={t(lang, "trendKpiCpi")} gapCount={gaps.length} gapLabel={gapLabel}
              emptyLabel={t(lang, "trendsNotEnough")}
              points={trendPoints(snapshots, gapSet, (s) => s.cpi)}
              format={(v) => v.toFixed(2)} />
          </div>
          {p80Chart}

          <div>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-xs uppercase tracking-wide text-muted-foreground">{t(lang, "trendsSnapshotsHeading")}</h3>
              <Button
                disabled={selected.size === 0 || busy}
                onClick={async () => {
                  if (!(await confirm({ message: tPlural(lang, "snapshotDeleteSelectedConfirm", selected.size, selected.size) }))) return;
                  void deleteSnapshots([...selected]);
                  setSelected(new Set());
                }}
                // The shared `destructive` variant tints the BACKGROUND on hover
                // (`hover:bg-ui-pink/10`) and keeps the text opaque; an earlier
                // hand-rolled hover:opacity-80 faded the -strong token below AA.
                // ★ disabled:hover:bg-surface — the variant's own resting fill,
                // so a disabled button does not light up under the cursor,
                // advertising an action it will not perform.
                variant="destructive" size="xs" className="disabled:hover:bg-surface"
              >
                {t(lang, "snapshotDeleteSelected", selected.size)}
              </Button>
            </div>
            <div className={INNER_TABLE_CLASS}>
            <DataTable className="w-full text-left text-sm" head={<>
                <tr>
                  <th className="w-8 px-3 py-2" />
                  <th className="relative px-3 py-2 text-left" style={{ width: snapshotResize.colWidths.capturedAt, minWidth: snapshotResize.colWidths.capturedAt }}>
                    {t(lang, "trendsCapturedAt")}
                    <ColumnResizeHandle col="capturedAt" onMouseDown={snapshotStartResize} />
                  </th>
                  <th className="relative px-3 py-2 text-left" style={{ width: snapshotResize.colWidths.trigger, minWidth: snapshotResize.colWidths.trigger }}>
                    {t(lang, "trendsTrigger")}
                    <ColumnResizeHandle col="trigger" onMouseDown={snapshotStartResize} />
                  </th>
                  <th className="relative px-3 py-2 text-left" style={{ width: snapshotResize.colWidths.baseline, minWidth: snapshotResize.colWidths.baseline }}>
                    {t(lang, "trendsBaselineLabel")}
                    <ColumnResizeHandle col="baseline" onMouseDown={snapshotStartResize} />
                  </th>
                  <th className="relative px-3 py-2 text-right" style={{ width: snapshotResize.colWidths.actions, minWidth: snapshotResize.colWidths.actions }}>
                    {t(lang, "trendsActions")}
                    <ColumnResizeHandle col="actions" onMouseDown={snapshotStartResize} />
                  </th>
                </tr>
              </>}>
                {renderedSnapshots.map((s) => {
                  const token = rowTokens.get(s.id) ?? formatDisplayTimestamp(s.capturedAt, displayTz, lang);
                  return (
                  <tr key={s.id}>
                    <td className="px-3 py-2">
                      <Checkbox
                        checked={selected.has(s.id)}
                        onChange={(e) => {
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(s.id); else next.delete(s.id);
                            return next;
                          });
                        }}
                        aria-label={t(lang, "snapshotSelectRow", token)}
                      />
                    </td>
                    <td className="px-3 py-2 tabular-nums">{formatDisplayTimestamp(s.capturedAt, displayTz, lang)}</td>
                    <td className="px-3 py-2">{t(lang, s.trigger === "auto" ? "trendsTriggerAuto" : "trendsTriggerManual")}</td>
                    <td className="px-3 py-2">{s.isBaseline ? "★" : ""}</td>
                    <td className="px-3 py-2 text-right">
                      <span className="inline-flex gap-2">
                        {!s.isBaseline && (
                          <TextButton disabled={busy} onClick={() => { void setBaseline(s.id); }}
                            aria-label={rowLabel(t(lang, "trendsSetBaseline"), token)}
                            className="text-xs">
                            {t(lang, "trendsSetBaseline")}
                          </TextButton>
                        )}
                        <TextButton
                          tone="danger"
                          disabled={busy}
                          onClick={async () => {
                            if (!(await confirm({ message: t(lang, "snapshotDeleteConfirm") }))) return;
                            void deleteSnapshot(s.id);
                            setSelected((prev) => { const next = new Set(prev); next.delete(s.id); return next; });
                          }}
                          aria-label={rowLabel(t(lang, "snapshotDelete"), token)}
                          className="text-xs"
                        >
                          {t(lang, "snapshotDelete")}
                        </TextButton>
                      </span>
                    </td>
                  </tr>
                  );
                })}
            </DataTable>
            </div>
          </div>
        </div>
      )}
    </ReportCard>
  );
}
