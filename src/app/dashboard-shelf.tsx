"use client";
import { useState } from "react";
import { Button } from "./button";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";
import type { TileDragProps } from "./dashboard-tile";
import type { DashboardTileId } from "./dashboard-tiles";

/**
 * Where hidden tiles live: a collapsed "N hidden" disclosure over a tray of
 * chips, and the drop target that hiding a tile by drag aims at.
 *
 * ★★ THE RESTORE BUTTON IS THE KEYBOARD PATH. Dragging a chip back out is the
 * mouse shortcut, not the only route — without a button a keyboard user who hid
 * a tile could never retrieve it.
 *
 * ★★ THE TRAY IS ALWAYS MOUNTED AND `hidden`-TOGGLED, never conditionally
 * rendered: `aria-controls` must point at a node that exists. Same shape as
 * `action-reasons.tsx`, which is the repo's disclosure precedent — there is no
 * shared Disclosure primitive to reach for (`aria-expanded` is hand-rolled in
 * a dozen surfaces), so this follows the existing family rather than inventing
 * a thirteenth shape.
 *
 * ★ Dragging over the COLLAPSED button opens the tray, so the user never has to
 * open it before picking a tile up — a sequence that cannot be discovered
 * mid-drag. It is guarded on `isDragging` so a stray `dragEnter` (a file
 * dragged over the window, say) cannot pop the tray open.
 *
 * ★ The disclosure renders even at zero hidden tiles, because that is exactly
 * when the drop target has to exist: hiding the FIRST tile by drag needs
 * somewhere to drop it.
 *
 * ★★★ THE THREE STRINGS ARE PROPS, NOT `t(lang, …)` CALLS, and there is no
 * `lang` prop at all. `dashboardShelfCount`, `dashboardShelfEmpty` and
 * `dashboardTileRestore` are all ABSENT from `i18n.ts`; `t()`'s `key` is typed
 * from the EN dict, so naming one is a tsc error and renders `undefined`. A
 * later task owns the additions. `lang` is not carried in the meantime because
 * a destructured prop that nothing reads is FATAL at `--max-warnings=0`.
 */
export interface ShelfLabels {
  hiddenCount: (n: number) => string;
  empty: string;
  restore: string;
}

const TRAY_ID = "dashboard-shelf-tray";

export function DashboardShelf({
  hidden, labels, onRestore, dropProps, isDragging,
}: {
  hidden: { id: DashboardTileId; title: string }[];
  labels: ShelfLabels;
  onRestore: (id: DashboardTileId) => void;
  /** The grid's own drop handlers — the shelf never decodes the drag itself. */
  dropProps: TileDragProps;
  isDragging: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 flex flex-col items-end print:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={TRAY_ID}
        onClick={() => setOpen((o) => !o)}
        onDragEnter={() => { if (isDragging) setOpen(true); }}
        {...dropProps}
        className={`rounded-md border border-line bg-surface px-2 py-1 text-xs text-muted-foreground hover:text-foreground ${FOCUS_RING} ${TRANSITION}`}
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span> {labels.hiddenCount(hidden.length)}
      </button>
      <div
        id={TRAY_ID}
        hidden={!open}
        {...dropProps}
        className="mt-1 w-full rounded-md border border-dashed border-line bg-surface-muted p-2"
      >
        {hidden.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">{labels.empty}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {hidden.map((h) => (
              <li key={h.id} className="flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-xs">
                <span>{h.title}</span>
                {/* ★★ The tile title is in the accessible name because N chips
                    render at once and N identical "Restore" buttons is a WCAG
                    2.4.6 failure the axe gate cannot see, in any view, at any
                    seed size. */}
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label={`${labels.restore} – ${h.title}`}
                  onClick={() => onRestore(h.id)}
                  className="rounded-full border border-line"
                >
                  {labels.restore}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
