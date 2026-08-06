"use client";

// Portfolio health — Turso-only cross-project rollup. For each portfolio
// project it loads that project's Workspace (read-only) and runs the pure
// computeDashboard engine, then shows aggregate KPIs + a per-project health
// table. Gated in the sidebar via TURSO_ONLY_VIEWS; this panel additionally
// guards at runtime (needs-Turso empty state when no live config). Read-only —
// safe in popouts.

import { type Lang, t } from "./i18n";
import { getTursoConfig } from "./turso-config";
import { type Settings } from "./settings-types";
import type { ProjectRegistryEntry } from "./projects-registry";
import { healthColorName } from "./health";
import type { Health } from "./health";
import { RagDot } from "./rag-dot";
import type { SubStatus } from "./dashboard";
import { usePortfolioHealth, PORTFOLIO_LOAD_FAILED } from "./use-portfolio-health";
import type { MilestoneHealthBucket } from "./portfolio-rollup";
import { EmptyState } from "./empty-state";
import { DataTable } from "./data-table";
import { PanelSkeleton } from "./skeleton";
import { Tile, KpiGradientBar } from "./report-table";
import { PrintButton, ResetSizeButton } from "./task-manager-ui";
import { useResizable } from "./use-resizable";
import { VIEW_PANE_FILL_CLASS, VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { INTERACTIVE } from "./interaction-styles";
import { PaneHeader } from "./pane-header";

export interface PortfolioHealthPanelProps {
  lang: Lang;
  settings: Settings;
  projects: readonly ProjectRegistryEntry[];
  today: string;
  holidaySet: ReadonlySet<string>;
  workdayHours: number;
  /** Switch the active project (row click). Omitted in popouts. */
  onSwitchProject?: (id: string) => void;
}

// RAG cell — reuses health.ts `healthDot` (role-token bg class) + `healthColorName`
// (translated label) so the dot reflows under Mockup and the text label carries
// the meaning (colour never the sole signal). null SubStatus → "—".
function RagCell({ lang, value }: { lang: Lang; value: SubStatus }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <RagDot level={value} size="md" />
      <span>{healthColorName(value, lang)}</span>
    </span>
  );
}

const MS_LABEL_KEYS: Record<MilestoneHealthBucket, Parameters<typeof t>[1]> = {
  overdue: "portfolioMsOverdue",
  at_risk: "portfolioMsAtRisk",
  due_soon: "portfolioMsDueSoon",
  on_track: "portfolioMsOnTrack",
  no_milestones: "portfolioMsNone",
};

export function PortfolioHealthPanel({
  lang,
  settings,
  projects,
  today,
  holidaySet,
  workdayHours,
  onSwitchProject,
}: PortfolioHealthPanelProps) {
  const tursoConfig = getTursoConfig(
    settings.integrations?.turso?.databaseUrl,
    settings.integrations?.turso?.authToken,
  );
  const { rows, aggregate, loading, error } = usePortfolioHealth(
    tursoConfig,
    projects,
    today,
    holidaySet,
    workdayHours,
  );
  const { ref: paneRef, reset: resetSize } = useResizable("aipm-cockpit:portfolio-health-size");

  if (!tursoConfig) {
    return (
      <div className={VIEW_PANE_FILL_CLASS}>
        <EmptyState title={t(lang, "portfolioNeedsTursoTitle")} description={t(lang, "portfolioNeedsTursoDesc")} />
      </div>
    );
  }
  if (loading) return <PanelSkeleton lang={lang} />;
  if (error) {
    const description = error === PORTFOLIO_LOAD_FAILED ? t(lang, "portfolioLoadErrorDesc") : error;
    return (
      <div className={VIEW_PANE_FILL_CLASS}>
        <EmptyState title={t(lang, "portfolioLoadErrorTitle")} description={description} />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className={VIEW_PANE_FILL_CLASS}>
        <EmptyState title={t(lang, "portfolioEmptyTitle")} description={t(lang, "portfolioEmptyDesc")} />
      </div>
    );
  }

  return (
    <div ref={paneRef} className={`print-root print-landscape ${VIEW_PANE_RESIZABLE_CLASS}`}>
      <PaneHeader
        title={t(lang, "navPortfolioHealth")}
        actions={
          <>
            <PrintButton lang={lang} />
            <ResetSizeButton onClick={resetSize} lang={lang} />
          </>
        }
      />

      <div className="min-h-[240px] flex-1 overflow-auto rounded-xl border border-line p-3 pr-2 print:max-h-none print:overflow-visible">
      {/* Aggregate KPI strip */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label={t(lang, "portfolioKpiProjects")} value={aggregate.projectCount} />
        {/* ★ Same treatment as the row cells: no project contributed a figure,
            so there is nothing to average. A "0%" tile above a table of "—"
            rows is §64's misreading reappearing at the aggregate, and the
            gradient bar would draw an empty progress track to match. */}
        <Tile
          label={t(lang, "portfolioKpiAvgComplete")}
          value={
            aggregate.avgCompletionPercent === null
              ? t(lang, "dashboardNoActiveScope")
              : `${aggregate.avgCompletionPercent}%`
          }
          bar={
            aggregate.avgCompletionPercent === null ? undefined : (
              <KpiGradientBar percent={aggregate.avgCompletionPercent} label={t(lang, "portfolioKpiAvgComplete")} />
            )
          }
        />
        <Tile label={t(lang, "portfolioKpiAtRisk")} value={aggregate.overallR + aggregate.overallA} />
        <Tile label={t(lang, "portfolioKpiOpenRaid")} value={aggregate.totalOpenRaid} />
      </div>

      {/* Per-project health table */}
      <DataTable className="w-full text-left text-sm" head={
        <tr>
          <th className="py-2 pr-3 font-medium">{t(lang, "portfolioColProject")}</th>
          <th className="py-2 pr-3 font-medium">{t(lang, "portfolioColOverall")}</th>
          <th className="py-2 pr-3 font-medium">{t(lang, "portfolioColSchedule")}</th>
          <th className="py-2 pr-3 font-medium">{t(lang, "portfolioColBudget")}</th>
          <th className="py-2 pr-3 font-medium">{t(lang, "portfolioColComplete")}</th>
          <th className="py-2 pr-3 font-medium">{t(lang, "portfolioColOpenRaid")}</th>
          <th className="py-2 pr-3 font-medium">{t(lang, "portfolioColMilestones")}</th>
        </tr>
      }>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-line">
              <td className="py-2 pr-3 font-medium text-foreground">
                {onSwitchProject ? (
                  <button
                    type="button"
                    onClick={() => onSwitchProject(row.id)}
                    aria-label={`${t(lang, "portfolioOpenProject")} – ${row.name}`}
                    className={`text-ui-dark-blue underline-offset-2 hover:underline dark:text-ui-light-grey ${INTERACTIVE}`}
                  >
                    {row.name}
                  </button>
                ) : (
                  row.name
                )}
              </td>
              <td className="py-2 pr-3"><RagCell lang={lang} value={row.overall as Health} /></td>
              <td className="py-2 pr-3"><RagCell lang={lang} value={row.schedule as Health} /></td>
              <td className="py-2 pr-3"><RagCell lang={lang} value={row.budget} /></td>
              {/* ★ The sr-only text is the real disclosure, not the title:
                  `title` is hover-only — no keyboard focus, unreachable on
                  touch — so a bare em dash would be no value at all to AT. */}
              <td className="py-2 pr-3 tabular-nums">
                {row.completionPercent === null ? (
                  <span title={t(lang, "dashboardNoActiveScope")}>
                    <span aria-hidden="true">—</span>
                    <span className="sr-only">{t(lang, "dashboardNoActiveScope")}</span>
                  </span>
                ) : (
                  `${row.completionPercent}%`
                )}
              </td>
              <td className="py-2 pr-3 tabular-nums">{row.openRaidCount}</td>
              <td className="py-2 pr-3">{t(lang, MS_LABEL_KEYS[row.milestoneHealth])}</td>
            </tr>
          ))}
      </DataTable>
      </div>
    </div>
  );
}
