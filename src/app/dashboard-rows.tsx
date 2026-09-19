"use client";
/**
 * The Dashboard's fixed rows (spec C), presentational only: the panel owns
 * every value and passes each slot in. Extracted per AGENTS.md's panel-split
 * convention so `dashboard-panel.tsx` stays an orchestrator.
 *
 * ★ Density: gaps come from `dc.*`, never a literal class — a literal ignores
 * compact mode.
 */
import type { ReactNode } from "react";
import type { DensityClasses } from "./dashboard-density";

/**
 * Row 1 (decision 1): "since you last looked" takes the free width, the weekly
 * digest sits beside it at about a third, and the control stack stays on the
 * far right. The delta strip and the digest stack below `lg`; the control stack
 * stays right at every width, as it always has.
 *
 * ★★ THE DIGEST SLOT IS `empty:hidden`. `DigestCard` renders `null` until the
 * digest is enabled and generated, which leaves this slot with no children; CSS
 * then removes it and the delta strip's `flex-1` takes the whole row. No JS
 * decides it, so nothing here can disagree with the digest's own rule.
 */
export function DashboardTopRow({
  dc, delta, digest, controls,
}: {
  dc: DensityClasses;
  delta: ReactNode;
  digest: ReactNode;
  controls: ReactNode;
}) {
  return (
    // ★ `gap-2` here is MOVED, unchanged, from the row wrapper this replaces in
    // `dashboard-panel.tsx` — not a new literal (D7 binds new spacing to `dc.*`).
    <div data-testid="dashboard-row-top" className="flex items-start gap-2">
      <div className={`flex min-w-0 flex-1 flex-col lg:flex-row lg:items-start ${dc.kpiGap}`}>
        <div className="min-w-0 flex-1">{delta}</div>
        <div data-testid="dashboard-row-top-digest" className="min-w-0 empty:hidden lg:w-1/3 lg:shrink-0">
          {digest}
        </div>
      </div>
      {controls}
    </div>
  );
}

/**
 * Row 2 (decision 3): the Next-Actions hero on the left, Overall status on the
 * right, equal height; stacks below `lg`; with no hero, Overall status takes
 * the whole row.
 *
 * ★★ EQUAL HEIGHT IS STRETCH, NEVER A PIXEL HEIGHT (spec Accessibility): the
 * flex row stretches both columns to the taller one, and each column is a
 * one-cell GRID, whose child stretches to the cell — so a long hero grows the
 * row instead of clipping.
 */
export function DashboardStatusRow({
  dc, hero, status,
}: {
  dc: DensityClasses;
  hero: ReactNode;
  status: ReactNode;
}) {
  return (
    <div data-testid="dashboard-row-status" className={`flex flex-col lg:flex-row lg:items-stretch ${dc.sectionGap}`}>
      {hero ? (
        <div data-testid="dashboard-row-status-hero" className="grid min-w-0 lg:flex-1">{hero}</div>
      ) : null}
      <div data-testid="dashboard-row-status-overall" className="grid min-w-0 lg:flex-1">{status}</div>
    </div>
  );
}
