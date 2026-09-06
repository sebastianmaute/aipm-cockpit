"use client";
/**
 * The Dashboard's binding of the shared arrangement grid.
 *
 * ★★ THIS FILE IS AN ADAPTER, NOT A GRID. Every landmine that used to live here
 * now lives in `arrangement-grid.tsx` — the whole-literal span tables, the
 * order-is-the-placement-model note, the four-column assumption, and the
 * ★★★ renders-no-scroller-of-its-own block. Read them there before changing
 * anything here. What stays is the Dashboard-specific binding: its density
 * classes and its `data-testid`.
 *
 * ★ The exported names are UNCHANGED on purpose — `dashboard-panel.tsx`,
 * `dashboard-tile.tsx` and the Dashboard's own tests keep compiling and passing
 * untouched. If a Dashboard test needs editing to accommodate a change here, the
 * change is wrong.
 */
import type { ReactNode } from "react";
import { ArrangementGrid } from "./arrangement-grid";
import type { DensityClasses } from "./dashboard-density";

export { W_CLASS, H_CLASS } from "./arrangement-grid";

/* ★ THE ROW AND GAP CLASSES COME FROM THE DENSITY BAG, NEVER A LITERAL `gap-*`
 * — a literal would ignore compact mode. That is the Dashboard's whole reason
 * for the two injected class props; Reports has no density and passes fixed
 * strings. ★★ The two density field names are deliberately NOT spelt out in
 * this comment. `docs/AGENTS/dashboard.md` quotes a repo-wide grep for the gap
 * field as returning ONE hit; a comment naming it would silently make that two,
 * which is the self-matching-recipe trap this branch has already shipped once.
 * The names are on the JSX below, where they are code rather than prose. */
export function DashboardGrid({
  dc,
  children,
}: {
  dc: DensityClasses;
  children: ReactNode;
}) {
  return (
    <ArrangementGrid rowClass={dc.tileRow} gapClass={dc.sectionGap} testId="dashboard-grid">
      {children}
    </ArrangementGrid>
  );
}
