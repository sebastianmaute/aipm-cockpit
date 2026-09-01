"use client";

import { useMemo } from "react";
import { type Lang, t } from "../i18n";
import { ActionRow } from "../action-row";
import { buildRowTokens } from "../row-tokens";
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
  // ★★ This card is a SECOND list owner for `ActionRow` (the Next-actions panel
  //    is the other), so it mints its OWN token map over its OWN rendered list.
  //    A per-item component cannot disambiguate itself — it has no sibling
  //    visibility — and the two lists are separate mounts, so sharing a map
  //    across them would be wrong as well as impossible (§324).
  // ★ Declared BEFORE the early return: hooks cannot sit behind a conditional.
  const tokens = useMemo(
    () => buildRowTokens((topActions ?? []).map((a) => ({
      id: a.id,
      name: t(lang, a.title.key, ...(a.title.params ?? [])),
    }))),
    [topActions, lang],
  );
  if (!topActions?.length) return null;
  return (
    <div className={`flex flex-col ${dc.kpiGap}`}>
      {topActions.map((a) => (
        // ★ `?? ""` cannot fire — the map is keyed by `a.id` over this same array.
        <ActionRow key={a.id} lang={lang} action={a} rowToken={tokens.get(a.id) ?? ""}
          onOpen={onOpenAction ?? (() => {})} />
      ))}
    </div>
  );
}
