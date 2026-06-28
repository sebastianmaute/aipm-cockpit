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
import { healthDot, healthColorName } from "./health";
import type { Health } from "./health";
import type { SubStatus } from "./dashboard";
import { usePortfolioHealth, PORTFOLIO_LOAD_FAILED } from "./use-portfolio-health";
import type { MilestoneHealthBucket } from "./portfolio-rollup";
import { EmptyState } from "./empty-state";
import { PanelSkeleton } from "./skeleton";
import { Tile, KpiGradientBar } from "./report-table";
import { PrintButton } from "./task-manager-ui";
import { VIEW_PANE_FILL_CLASS } from "./view-styles";
import { INTERACTIVE } from "./interaction-styles";

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
      <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-full ${healthDot[value]}`} />
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
    <div className={`print-root print-landscape ${VIEW_PANE_FILL_CLASS} overflow-y-auto pr-2`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-medium text-foreground">{t(lang, "navPortfolioHealth")}</h2>
        <PrintButton lang={lang} />
      </div>

      {/* Aggregate KPI strip */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label={t(lang, "portfolioKpiProjects")} value={aggregate.projectCount} />
        <Tile
          label={t(lang, "portfolioKpiAvgComplete")}
          value={`${aggregate.avgCompletionPercent}%`}
          bar={<KpiGradientBar percent={aggregate.avgCompletionPercent} label={t(lang, "portfolioKpiAvgComplete")} />}
        />
        <Tile label={t(lang, "portfolioKpiAtRisk")} value={aggregate.overallR + aggregate.overallA} />
        <Tile label={t(lang, "portfolioKpiOpenRaid")} value={aggregate.totalOpenRaid} />
      </div>

      {/* Per-project health table */}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-2 pr-3 font-medium">{t(lang, "portfolioColProject")}</th>
            <th className="py-2 pr-3 font-medium">{t(lang, "portfolioColOverall")}</th>
            <th className="py-2 pr-3 font-medium">{t(lang, "portfolioColSchedule")}</th>
            <th className="py-2 pr-3 font-medium">{t(lang, "portfolioColBudget")}</th>
            <th className="py-2 pr-3 font-medium">{t(lang, "portfolioColComplete")}</th>
            <th className="py-2 pr-3 font-medium">{t(lang, "portfolioColOpenRaid")}</th>
            <th className="py-2 pr-3 font-medium">{t(lang, "portfolioColMilestones")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-line">
              <td className="py-2 pr-3 font-medium text-foreground">
                {onSwitchProject ? (
                  <button
                    type="button"
                    onClick={() => onSwitchProject(row.id)}
                    aria-label={`${t(lang, "portfolioOpenProject")} – ${row.name}`}
                    className={`text-AIPM-dark-blue underline-offset-2 hover:underline dark:text-AIPM-light-grey ${INTERACTIVE}`}
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
              <td className="py-2 pr-3 tabular-nums">{row.completionPercent}%</td>
              <td className="py-2 pr-3 tabular-nums">{row.openRaidCount}</td>
              <td className="py-2 pr-3">{t(lang, MS_LABEL_KEYS[row.milestoneHealth])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
