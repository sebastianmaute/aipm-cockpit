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
