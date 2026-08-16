"use client";

import { type Lang } from "../i18n";
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
 *
 *  ★★ NO BOX AND NO HEADING OF ITS OWN. The arrangeable tile chrome
 *  (`dashboard-tile.tsx`) draws the border and renders the title from the
 *  catalogue's `dashboardTopActions` label key — the very key this card used to
 *  render itself. Restoring either stacks two identical `<h3>`s inside two
 *  nested borders and makes `getByText("Top actions")` ambiguous in
 *  `dashboard-panel.test.tsx`. */
export function DashboardTopActions({ lang, topActions, onOpenAction, dc }: DashboardTopActionsProps) {
  if (!topActions?.length) return null;
  return (
    <div className={`flex flex-col ${dc.kpiGap}`}>
      {topActions.map((a) => (
        <ActionRow key={a.id} lang={lang} action={a} onOpen={onOpenAction ?? (() => {})} />
      ))}
    </div>
  );
}
