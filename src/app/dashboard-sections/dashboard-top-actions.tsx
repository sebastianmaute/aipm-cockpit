"use client";

import { type Lang, t } from "../i18n";
import { ActionRow } from "../action-row";
import type { SuggestedAction } from "../next-actions/types";
import type { DensityClasses } from "../dashboard-density";

export interface DashboardTopActionsProps {
  lang: Lang;
  topActions?: readonly SuggestedAction[];
  onOpenAction?: (a: SuggestedAction) => void;
  dc: DensityClasses;
}

/** Standalone top-actions queue card: ranked action rows.
 *  Extracted from DashboardHero so it can be a first-class masonry item. */
export function DashboardTopActions({ lang, topActions, onOpenAction, dc }: DashboardTopActionsProps) {
  if (!topActions?.length) return null;
  return (
    <div className={`rounded-lg border border-line bg-surface ${dc.cardPad} shadow-[var(--shadow-card)]`}>
      <h3 className="mb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{t(lang, "dashboardTopActions")}</h3>
      <div className={`flex flex-col ${dc.kpiGap}`}>
        {topActions.map((a) => (
          <ActionRow key={a.id} lang={lang} action={a} onOpen={onOpenAction ?? (() => {})} />
        ))}
      </div>
    </div>
  );
}
