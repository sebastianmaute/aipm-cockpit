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
import { ViewCallout } from "./view-callout";

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
  /** Global "show tips" setting (Settings → Appearance) — gates the callout. */
  showHints?: boolean;
  /** Popouts are read-only — the callout self-hides. */
  isPopout?: boolean;
  /** Deep-link the matching Help concept (wired to `requestHelpConcept`).
   *  Omit → no callout (read-only popout mirror). */
  onLearnMore?: (conceptId: string) => void;
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
    tintClass: "bg-ui-green/10 dark:bg-ui-green/15",
  },
  {
    id: "manage-closely",
    testId: "quadrant-manage-closely",
    labelKey: "quadrantManageClosely",
    tintClass: "bg-ui-green/20 dark:bg-ui-green/25",
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

export function StakeholderMapPanel({ lang, stakeholders, onOpenStakeholder, onSaveStakeholder, showHints, isPopout, onLearnMore }: StakeholderMapPanelProps) {
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
      {onLearnMore && (
        <ViewCallout
          view="stakeholder-map"
          lang={lang}
          showHints={showHints !== false}
          isPopout={!!isPopout}
          onLearnMore={onLearnMore}
        />
      )}
      {/* Toolbar: title left, controls right */}
      <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2 print:hidden">
        <h2 className="text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
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
            {/* 2×2 grid. ★★ `grid-rows-2` is load-bearing, not decoration: without it
                the implicit rows are `auto` and size to their CONTENT, so the row
                holding the fewer/shorter chips collapses (measured 95px vs 71px on
                the sample workspace) and a sparse quadrant becomes a visibly smaller
                drop target than its siblings. A 2×2 influence/interest matrix must
                read as four equal quadrants. Each cell already carries `overflow-auto`,
                so a quadrant with more chips than fit scrolls instead of stretching
                its row. */}
            <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-2">
              {QUADRANTS.map((q) => (
                <div
                  key={q.id}
                  data-testid={q.testId}
                  onDragOver={editable ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } : undefined}
                  onDragEnter={editable ? () => setDragOverQ(q.id) : undefined}
                  // ★★ Only a leave for a target OUTSIDE this cell clears the highlight.
                  // `dragleave` mirrors `mouseout`, not `mouseleave`, so moving onto a
                  // CHILD (a chip, the label) fires it on the cell with
                  // `target === currentTarget` — indistinguishable by target alone from
                  // a real exit. Testing `target` alone dropped the ring over every chip,
                  // shrinking the region that LOOKS droppable to the cell minus its
                  // content. Same guard as `gantt-rows.tsx`'s row drop indicator.
                  onDragLeave={editable ? (e) => {
                    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
                    // ★★ FUNCTIONAL SETTER, and it is load-bearing: this leave runs LAST.
                    // `dragenter` on the new element precedes `dragleave` on the old, so a
                    // pointer jumping straight to the neighbouring quadrant — fast enough to
                    // skip the 8px `gap-2` — sets THAT quadrant and is then nulled by this
                    // one's leave. `onDragOver` never re-sets the state, so nothing recovers
                    // it. Clear only a highlight this cell still owns.
                    setDragOverQ((prev) => (prev === q.id ? null : prev));
                  } : undefined}
                  onDrop={editable ? (e) => { onDropInto(q.id, e); setDragOverQ(null); } : undefined}
                  className={`flex flex-col gap-1.5 overflow-auto rounded-lg border border-line p-3 ${q.tintClass} ${dragOverQ === q.id ? "ring-2 ring-ui-green" : ""}`}
                >
                  <p className="text-xs font-semibold text-ui-dark-blue dark:text-ui-light-grey">
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
                          className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium bg-surface text-foreground hover:bg-ui-green/15 focus:outline-none focus:ring-2 focus:ring-ui-green ${TRANSITION} ${PRESS}`}
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
