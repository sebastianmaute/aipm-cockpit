"use client";

import type { Dispatch, SetStateAction } from "react";
import { type Lang, t } from "../i18n";
import { healthColorName, healthText, type Health } from "../health";
import { RagBadge } from "../rag-badge";
import { TRANSITION, FOCUS_RING } from "../interaction-styles";
import type { DashboardModel } from "../dashboard";
import type { ProjectStatus } from "../types";
import type { DensityClasses } from "../dashboard-density";

function OverrideSelect({
  lang, label, value, computed, effective, onChange,
}: {
  lang: Lang;
  label: string;
  value: "R" | "A" | "G" | undefined;
  computed: Health | null;
  effective: Health | null;
  onChange: (v: "R" | "A" | "G" | undefined) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-sm">
      <RagBadge value={effective} lang={lang} title={`${label}: ${effective ? healthColorName(effective, lang) : "—"}`} />
      <span className="font-medium">{label}</span>
      <select
        className={`rounded border border-line bg-surface px-1.5 py-0.5 text-sm print:hidden ${TRANSITION} ${FOCUS_RING}`}
        value={value ?? ""}
        onChange={(e) => onChange((e.target.value || undefined) as "R" | "A" | "G" | undefined)}
      >
        <option value="">{computed ? t(lang, "dashboardComputedHint", healthColorName(computed, lang)) : t(lang, "dashboardScopeUnset")}</option>
        <option value="R">{healthColorName("R", lang)}</option>
        <option value="A">{healthColorName("A", lang)}</option>
        <option value="G">{healthColorName("G", lang)}</option>
      </select>
      <span className="hidden text-muted-foreground print:inline">
        {effective ? healthColorName(effective, lang) : "—"}
      </span>
    </label>
  );
}

export interface DashboardHeroProps {
  lang: Lang;
  today: string;
  model: DashboardModel;
  status: ProjectStatus;
  setStatus: Dispatch<SetStateAction<ProjectStatus>>;
  showBudget?: boolean;
  showChanges?: boolean;
  dc: DensityClasses;
}

export function DashboardHero(props: DashboardHeroProps) {
  const { lang, today, model, status, setStatus, showBudget, showChanges, dc } = props;
  return (
    <div className={dc.outer}>
      {/* Overall band */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-2 text-2xl font-bold">
          <RagBadge value={model.overall.effective} lang={lang} />
          {t(lang, "dashboardOverall")}:{" "}
          <span className={model.overall.effective ? healthText[model.overall.effective] : ""}>
            {healthColorName(model.overall.effective, lang)}
          </span>
        </div>
        <span className="ml-auto text-sm text-muted-foreground">{t(lang, "dashboardReportDate", today)}</span>
        <details className="basis-full print:hidden">
          <summary className={`cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground ${TRANSITION} ${FOCUS_RING}`}>
            {t(lang, "dashboardAdjustHealth")}
          </summary>
          <div className="mt-2 flex flex-wrap items-center gap-4">
            <OverrideSelect lang={lang} label={t(lang, "dashboardOverall")} value={status.ragOverride} computed={model.overall.computed} effective={model.overall.effective} onChange={(v) => setStatus((s) => ({ ...s, ragOverride: v }))} />
            <OverrideSelect lang={lang} label={t(lang, "dashboardSubSchedule")} value={status.scheduleOverride} computed={model.schedule.computed} effective={model.schedule.effective} onChange={(v) => setStatus((s) => ({ ...s, scheduleOverride: v }))} />
            {showBudget && (
              <OverrideSelect lang={lang} label={t(lang, "dashboardSubBudget")} value={status.budgetOverride} computed={model.budget.computed} effective={model.budget.effective} onChange={(v) => setStatus((s) => ({ ...s, budgetOverride: v }))} />
            )}
            {showChanges && (
              <OverrideSelect lang={lang} label={t(lang, "dashboardSubScope")} value={status.scopeOverride} computed={null} effective={model.scope.effective} onChange={(v) => setStatus((s) => ({ ...s, scopeOverride: v }))} />
            )}
          </div>
        </details>
        <p className="basis-full text-xs text-muted-foreground">{t(lang, "dashboardRagThresholds")}</p>
      </div>

    </div>
  );
}
