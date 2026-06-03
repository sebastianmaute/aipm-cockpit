"use client";
import { type Lang, t, localeFor } from "./i18n";
import { VIEW_PANE_CLASS, INNER_TABLE_CLASS } from "./view-styles";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { RagBadge } from "./rag-badge";
import { healthText } from "./health";
import { TrendChart, type TrendPoint } from "./trend-chart";
import { formatCurrency } from "./resource-cost";
import type { SnapshotRecord, VarianceKey, VarianceRow } from "./snapshot";

export interface TrendsPanelProps {
  lang: Lang;
  active: boolean;
  snapshots: SnapshotRecord[];
  baseline: SnapshotRecord | null;
  latest: SnapshotRecord | null;
  variance: VarianceRow[];
  gaps: string[];
  busy: boolean;
  captureNow: () => Promise<void>;
  setBaseline: (id: string) => Promise<void>;
  deleteSnapshot: (id: string) => Promise<void>;
}

const VARIANCE_LABEL_KEYS: Record<VarianceKey, Parameters<typeof t>[1]> = {
  remainingHours: "trendKpiRemainingHours",
  remainingCost: "trendKpiRemainingCost",
  pctComplete: "trendKpiPctComplete",
  forecastEndDate: "trendKpiForecastSlip",
  spi: "trendKpiSpi",
  cpi: "trendKpiCpi",
};

function fmtCell(row: VarianceRow, which: "baseline" | "current"): string {
  if (row.key === "forecastEndDate") return "—";
  const v = row[which];
  if (v === null) return "—";
  if (row.key === "pctComplete") return `${v}%`;
  return String(Math.round(v * 100) / 100);
}

function fmtDelta(row: VarianceRow, lang: Lang): string {
  if (row.key === "forecastEndDate") {
    if (row.deltaDays == null) return "—";
    const d = row.deltaDays;
    return d === 0 ? t(lang, "trendsNoSlip") : t(lang, d > 0 ? "trendsSlipDays" : "trendsAheadDays", Math.abs(d));
  }
  if (row.delta === null) return "—";
  const sign = row.delta > 0 ? "+" : "";
  if (row.key === "pctComplete") return `${sign}${row.delta}%`;
  return `${sign}${Math.round(row.delta * 100) / 100}`;
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
  const { lang, active, snapshots, baseline, variance, gaps, busy, captureNow, setBaseline, deleteSnapshot } = props;

  if (!active) {
    return (
      <div className={VIEW_PANE_CLASS}>
        <p className="text-sm text-muted-foreground">{t(lang, "trendsRequireTurso")}</p>
      </div>
    );
  }

  const gapSet = new Set(gaps);
  const locale = localeFor(lang);
  const currency = props.latest?.currency || "EUR";

  return (
    <div className={VIEW_PANE_CLASS}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{t(lang, "navTrends")}</h2>
        <button
          type="button"
          onClick={() => { void captureNow(); }}
          disabled={busy}
          className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t(lang, "trendsCaptureNow")}
        </button>
      </div>

      {snapshots.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(lang, "trendsNoSnapshots")}</p>
      ) : (
        <div className="space-y-4">
          <div>
            <h3 className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
              {t(lang, "trendsVarianceHeading")}
              {baseline ? ` · ${t(lang, "trendsBaselineLabel")}: ${baseline.bucket}` : ""}
            </h3>
            <table className={INNER_TABLE_CLASS}>
              <thead className={TABLE_HEAD_CLASS}>
                <tr>
                  <th className="px-3 py-2 text-left">KPI</th>
                  <th className="px-3 py-2 text-right">{t(lang, "trendsBaselineLabel")}</th>
                  <th className="px-3 py-2 text-right">{t(lang, "trendsCurrentLabel")}</th>
                  <th className="px-3 py-2 text-right">{t(lang, "trendsDeltaLabel")}</th>
                </tr>
              </thead>
              <tbody>
                {variance.map((row) => (
                  <tr key={row.key}>
                    <td className="px-3 py-2 font-medium">{t(lang, VARIANCE_LABEL_KEYS[row.key])}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtCell(row, "baseline")}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtCell(row, "current")}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${row.health ? healthText[row.health] : ""}`}>
                      <span className="inline-flex items-center justify-end gap-1.5">
                        {fmtDelta(row, lang)}
                        {row.health ? <RagBadge value={row.health} lang={lang} /> : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-4">
            <TrendChart caption={t(lang, "trendKpiRemainingHours")} gapCount={gaps.length}
              emptyLabel={t(lang, "trendsNotEnough")}
              points={trendPoints(snapshots, gapSet, (s) => s.remainingHours)}
              format={(v) => `${Math.round(v)}h`} />
            <TrendChart caption={t(lang, "trendKpiRemainingCost")} gapCount={gaps.length}
              emptyLabel={t(lang, "trendsNotEnough")}
              points={trendPoints(snapshots, gapSet, (s) => s.remainingCost)}
              format={(v) => formatCurrency(v, currency, locale)} />
            <TrendChart caption={t(lang, "trendKpiSpi")} gapCount={gaps.length}
              emptyLabel={t(lang, "trendsNotEnough")}
              points={trendPoints(snapshots, gapSet, (s) => s.spi)}
              format={(v) => v.toFixed(2)} />
            <TrendChart caption={t(lang, "trendKpiCpi")} gapCount={gaps.length}
              emptyLabel={t(lang, "trendsNotEnough")}
              points={trendPoints(snapshots, gapSet, (s) => s.cpi)}
              format={(v) => v.toFixed(2)} />
          </div>

          <div>
            <h3 className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{t(lang, "trendsSnapshotsHeading")}</h3>
            <table className={INNER_TABLE_CLASS}>
              <thead className={TABLE_HEAD_CLASS}>
                <tr>
                  <th className="px-3 py-2 text-left">{t(lang, "trendsCapturedAt")}</th>
                  <th className="px-3 py-2 text-left">{t(lang, "trendsTrigger")}</th>
                  <th className="px-3 py-2 text-left">{t(lang, "trendsBaselineLabel")}</th>
                  <th className="px-3 py-2 text-right">{t(lang, "trendsActions")}</th>
                </tr>
              </thead>
              <tbody>
                {[...snapshots].reverse().map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2 tabular-nums">{s.capturedAt.slice(0, 16).replace("T", " ")}</td>
                    <td className="px-3 py-2">{t(lang, s.trigger === "auto" ? "trendsTriggerAuto" : "trendsTriggerManual")}</td>
                    <td className="px-3 py-2">{s.isBaseline ? "★" : ""}</td>
                    <td className="px-3 py-2 text-right">
                      <span className="inline-flex gap-2">
                        {!s.isBaseline && (
                          <button type="button" disabled={busy} onClick={() => { void setBaseline(s.id); }}
                            className="text-xs text-AIPM-dark-blue underline hover:opacity-80 disabled:opacity-50">
                            {t(lang, "trendsSetBaseline")}
                          </button>
                        )}
                        <button type="button" disabled={busy} onClick={() => { void deleteSnapshot(s.id); }}
                          className="text-xs text-AIPM-pink underline hover:opacity-80 disabled:opacity-50">
                          {t(lang, "trendsDeleteSnapshot")}
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
