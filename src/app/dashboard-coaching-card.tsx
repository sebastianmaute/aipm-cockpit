"use client";

import { t, type Lang } from "./i18n";
import type { CoachingCta, SettingsSectionId } from "./dashboard-coaching";
import type { AppView } from "./nav-config";

interface DashboardCoachingCardProps {
  lang: Lang;
  ctas: readonly CoachingCta[];
  onNavigate: (view: AppView, section?: SettingsSectionId) => void;
}

export function DashboardCoachingCard({ lang, ctas, onNavigate }: DashboardCoachingCardProps) {
  if (ctas.length === 0) return null;
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <h3 className="text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{t(lang, "coachingTitle")}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">{t(lang, "coachingSubtitle")}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {ctas.map((cta) => (
          <button
            key={cta.key}
            type="button"
            onClick={() => onNavigate(cta.view, cta.section)}
            className="rounded-md border border-line bg-surface px-3 py-1 text-xs font-medium text-foreground hover:bg-surface-muted hover:border-AIPM-dark-blue"
          >
            {t(lang, cta.labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}
