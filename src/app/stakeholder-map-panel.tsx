"use client";

// Stakeholder Influence / Interest 2×2 grid panel.
// Groups stakeholders by quadrant (via quadrantFor) and renders each in the
// matching cell. Axis labels flank the grid. Wraps in VIEW_PANE_CLASS like
// sibling panels (StakeholdersPanel, RaciMatrixPanel).

import { useMemo, useState } from "react";
import type React from "react";
import { quadrantFor, applyQuadrantMove, type StakeholderQuadrant } from "./stakeholders";
import { type Lang, t } from "./i18n";
import type { Stakeholder } from "./types";
import { CENTERED_HALF_PANE_CLASS } from "./view-styles";
import { EmptyState } from "./empty-state";
import { TRANSITION, PRESS } from "./interaction-styles";
import { useResizable } from "./use-resizable";
import { PrintButton, ResetSizeButton } from "./task-manager-ui";

// --- Props ------------------------------------------------------------------

export interface StakeholderMapPanelProps {
  lang: Lang;
  stakeholders: readonly Stakeholder[];
  /** Click a plotted stakeholder → open its editor (deep-link). When omitted the
   *  chips are non-interactive text (e.g. read-only popout mirrors). */
  onOpenStakeholder?: (id: number) => void;
  /** Save an edited stakeholder (drag-to-move). Omit for read-only popouts —
   *  chips are then non-draggable and cells accept no drop. */
  onSaveStakeholder?: (s: Stakeholder) => void;
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

export function StakeholderMapPanel({ lang, stakeholders, onOpenStakeholder, onSaveStakeholder }: StakeholderMapPanelProps) {
  const { ref, reset } = useResizable("aipm-cockpit:stakeholder-map-size");

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

  const editable = !!onSaveStakeholder;
  const [dragOverQ, setDragOverQ] = useState<StakeholderQuadrant | null>(null);

  function onDropInto(q: StakeholderQuadrant, e: React.DragEvent) {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData("text/plain"));
    const s = stakeholders.find((x) => x.id === id);
    if (!s) return;
    const moved = applyQuadrantMove(s, q);
    if (moved) onSaveStakeholder?.(moved);
  }

  return (
    <div ref={ref} data-testid="stakeholder-map-pane" className={`print-root ${CENTERED_HALF_PANE_CLASS}`}>
      {/* Toolbar: title left, controls right */}
      <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2 print:hidden">
        <h2 className="text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
          {t(lang, "stakeholderMapTitle")}
        </h2>
        <div className="flex items-center gap-2">
          <PrintButton lang={lang} />
          <ResetSizeButton onClick={reset} lang={lang} />
        </div>
      </div>

      {stakeholders.length === 0 ? (
        <EmptyState compact title={t(lang, "stakeholderMapEmpty")} />
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
                  onDragOver={editable ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } : undefined}
                  onDragEnter={editable ? () => setDragOverQ(q.id) : undefined}
                  onDragLeave={editable ? (e) => { if (e.currentTarget === e.target) setDragOverQ(null); } : undefined}
                  onDrop={editable ? (e) => { onDropInto(q.id, e); setDragOverQ(null); } : undefined}
                  className={`flex flex-col gap-1.5 overflow-auto rounded-lg border border-line p-3 ${q.tintClass} ${dragOverQ === q.id ? "ring-2 ring-AIPM-green" : ""}`}
                >
                  <p className="text-xs font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
                    {t(lang, q.labelKey)}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {byQuadrant[q.id].map((s) =>
                      onOpenStakeholder ? (
                        <button
                          key={s.id}
                          type="button"
                          draggable={editable || undefined}
                          onDragStart={editable ? (e) => {
                            e.dataTransfer.setData("text/plain", String(s.id));
                            e.dataTransfer.effectAllowed = "move";
                          } : undefined}
                          onDragEnd={editable ? () => setDragOverQ(null) : undefined}
                          onClick={() => onOpenStakeholder(s.id)}
                          aria-label={`${t(lang, "edit")} – ${s.name}`}
                          className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium bg-surface text-foreground hover:bg-AIPM-green/15 focus:outline-none focus:ring-2 focus:ring-AIPM-green ${TRANSITION} ${PRESS}`}
                        >
                          {s.name}
                        </button>
                      ) : (
                        <span
                          key={s.id}
                          className="inline-block rounded px-1.5 py-0.5 text-xs font-medium bg-surface text-foreground"
                        >
                          {s.name}
                        </span>
                      ),
                    )}
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
