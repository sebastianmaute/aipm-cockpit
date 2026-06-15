"use client";

// Stakeholder Influence / Interest 2×2 grid panel.
// Groups stakeholders by quadrant (via quadrantFor) and renders each in the
// matching cell. Axis labels flank the grid. Wraps in VIEW_PANE_CLASS like
// sibling panels (StakeholdersPanel, RaciMatrixPanel).

import { useMemo } from "react";
import { quadrantFor, type StakeholderQuadrant } from "./stakeholders";
import { type Lang, t } from "./i18n";
import type { Stakeholder } from "./types";
import { CENTERED_HALF_PANE_CLASS } from "./view-styles";

// --- Props ------------------------------------------------------------------

export interface StakeholderMapPanelProps {
  lang: Lang;
  stakeholders: readonly Stakeholder[];
}

// --- Quadrant cell config ---------------------------------------------------

interface QuadrantConfig {
  id: StakeholderQuadrant;
  testId: string;
  labelKey:
    | "quadrantManageClosely"
    | "quadrantKeepSatisfied"
    | "quadrantKeepInformed"
    | "quadrantMonitor";
  /** Subtle tint using existing brand tokens. */
  tintClass: string;
}

// Layout: 2×2, interest increases left→right, influence increases bottom→top.
// Top-left = High influence + Low interest (keep-satisfied)
// Top-right = High influence + High interest (manage-closely)
// Bottom-left = Low influence + Low interest (monitor)
// Bottom-right = Low influence + High interest (keep-informed)
const QUADRANTS: QuadrantConfig[] = [
  {
    id: "keep-satisfied",
    testId: "quadrant-keep-satisfied",
    labelKey: "quadrantKeepSatisfied",
    tintClass: "bg-AIPM-green/10 dark:bg-AIPM-green/15",
  },
  {
    id: "manage-closely",
    testId: "quadrant-manage-closely",
    labelKey: "quadrantManageClosely",
    tintClass: "bg-AIPM-green/20 dark:bg-AIPM-green/25",
  },
  {
    id: "monitor",
    testId: "quadrant-monitor",
    labelKey: "quadrantMonitor",
    tintClass: "bg-surface-muted",
  },
  {
    id: "keep-informed",
    testId: "quadrant-keep-informed",
    labelKey: "quadrantKeepInformed",
    tintClass: "bg-surface-muted/20",
  },
];

// --- Component --------------------------------------------------------------

export function StakeholderMapPanel({ lang, stakeholders }: StakeholderMapPanelProps) {
  // Group stakeholders by quadrant once.
  const byQuadrant = useMemo(() => {
    const map: Record<StakeholderQuadrant, Stakeholder[]> = {
      "manage-closely": [],
      "keep-satisfied": [],
      "keep-informed": [],
      monitor: [],
    };
    for (const s of stakeholders) {
      map[quadrantFor(s)].push(s);
    }
    return map;
  }, [stakeholders]);

  return (
    <div data-testid="stakeholder-map-pane" className={CENTERED_HALF_PANE_CLASS}>
      {/* Toolbar: title */}
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-AIPM-dark-blue">
          {t(lang, "stakeholderMapTitle")}
        </h2>
      </div>

      {stakeholders.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {t(lang, "stakeholderMapEmpty")}
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 gap-2">
          {/* Vertical axis label (Influence) */}
          <div className="flex shrink-0 items-center justify-center">
            <span
              className="origin-center -rotate-90 whitespace-nowrap text-xs font-medium text-muted-foreground"
              style={{ writingMode: "horizontal-tb" }}
            >
              {t(lang, "quadrantAxisInfluence")} ↑
            </span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2">
            {/* 2×2 grid */}
            <div className="grid min-h-0 flex-1 grid-cols-2 gap-2">
              {QUADRANTS.map((q) => (
                <div
                  key={q.id}
                  data-testid={q.testId}
                  className={`flex flex-col gap-1.5 overflow-auto rounded-lg border border-line p-3 ${q.tintClass}`}
                >
                  <p className="text-xs font-semibold text-AIPM-dark-blue">
                    {t(lang, q.labelKey)}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {byQuadrant[q.id].map((s) => (
                      <span
                        key={s.id}
                        className="inline-block rounded px-1.5 py-0.5 text-xs font-medium bg-surface-muted text-AIPM-dark-blue dark:text-foreground"
                      >
                        {s.name}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Horizontal axis label (Interest) */}
            <div className="shrink-0 text-center text-xs font-medium text-muted-foreground">
              {t(lang, "quadrantAxisInterest")} →
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
