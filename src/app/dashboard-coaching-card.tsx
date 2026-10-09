"use client";

import { t, type Lang } from "./i18n";
import type { CoachingCta, SettingsSectionId } from "./dashboard-coaching";
import type { AppView } from "./nav-config";
import { Button } from "./button";

interface DashboardCoachingCardProps {
  lang: Lang;
  ctas: readonly CoachingCta[];
  onNavigate: (view: AppView, section?: SettingsSectionId) => void;
}

export function DashboardCoachingCard({ lang, ctas, onNavigate }: DashboardCoachingCardProps) {
  if (ctas.length === 0) return null;
  return (
    <div className="rounded-lg border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
      <h3 className="text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">{t(lang, "coachingTitle")}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">{t(lang, "coachingSubtitle")}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {ctas.map((cta) => (
          <Button
            key={cta.key}
            onClick={() => onNavigate(cta.view, cta.section)}
            variant="secondary" size="xs"
          >
            {t(lang, cta.labelKey)}
          </Button>
        ))}
      </div>
    </div>
  );
}
