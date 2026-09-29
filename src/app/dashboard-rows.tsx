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
 * Row 1 (decision 1): at `lg`, "since you last looked" is exactly as wide as
 * row 2's hero column (`dc.topRowSplit`), the weekly digest takes the rest up to
 * the control stack, and so starts where Overall status starts. The delta strip
 * and the digest stack below `lg`; the control stack stays right at every
 * width, as it always has.
 *
 * ★ At `lg` the inner wrapper is `display: contents`, so the delta strip's
 * percentage width resolves against the WHOLE row — control stack included —
 * the same width row 2 splits in half.
 *
 * ★★ THE DIGEST SLOT IS `empty:hidden`. `DigestCard` renders `null` until the
 * digest is enabled and generated, which leaves this slot with no children; CSS
 * then removes it, the split's `:has(+ :not(:empty))` stops matching, and the
 * delta strip's `flex-1` takes the whole row. No JS decides it, so nothing here
 * can disagree with the digest's own rule.
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
      <div className={`flex min-w-0 flex-1 flex-col lg:contents ${dc.kpiGap}`}>
        <div data-testid="dashboard-row-top-delta" className={`min-w-0 flex-1 ${dc.topRowSplit}`}>{delta}</div>
        <div data-testid="dashboard-row-top-digest" className="min-w-0 flex-1 empty:hidden">
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
