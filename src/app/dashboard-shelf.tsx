"use client";
import { useState, type RefObject } from "react";
import { Button } from "./button";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";
import { t, type Lang } from "./i18n";
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
 * ★★ THE SHELF TAKES NO `onHide`. The plan had one, unused, to be wired later —
 * but a destructured prop nothing reads is FATAL at `--max-warnings=0` (no
 * `argsIgnorePattern` in this repo). The grid owns the drop instead and passes
 * its handlers as `dropProps`, mirroring `TileDragProps` on `dashboard-tile.tsx`;
 * the shelf never decodes a drag itself.
 */
const TRAY_ID = "dashboard-shelf-tray";

export function DashboardShelf({
  lang, hidden, onRestore, dropProps, isDragging, toggleRef,
}: {
  lang: Lang;
  hidden: { id: DashboardTileId; title: string }[];
  onRestore: (id: DashboardTileId) => void;
  /** The grid's own drop handlers — the shelf never decodes the drag itself. */
  dropProps: TileDragProps;
  isDragging: boolean;
  /** ★★ THE ONE NODE IN THIS SUBTREE THAT NEVER UNMOUNTS, exposed so the panel
   *  can land focus on it after hide/restore. Both of those actions destroy the
   *  control the user just pressed — the ⋮ menu's Hide button goes with the tile,
   *  a chip's Restore button goes with the chip — and with nothing focused the
   *  browser drops to `<body>`, stranding the keyboard user mid-task. The chip
   *  list is the wrong target because its length changes underneath them; the
   *  disclosure is stable in both directions. Optional, so the component still
   *  renders standalone in its own tests. */
  toggleRef?: RefObject<HTMLButtonElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const restore = t(lang, "dashboardTileRestore");
  return (
    <div className="mt-2 flex flex-col items-end print:hidden">
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls={TRAY_ID}
        onClick={() => setOpen((o) => !o)}
        onDragEnter={() => { if (isDragging) setOpen(true); }}
        {...dropProps}
        className={`rounded-md border border-line bg-surface px-2 py-1 text-xs text-muted-foreground hover:text-foreground ${FOCUS_RING} ${TRANSITION}`}
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span> {t(lang, "dashboardShelfCount", hidden.length)}
      </button>
      <div
        id={TRAY_ID}
        hidden={!open}
        {...dropProps}
        className="mt-1 w-full rounded-md border border-dashed border-line bg-surface-muted p-2"
      >
        {hidden.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">{t(lang, "dashboardShelfEmpty")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {hidden.map((h) => (
              <li key={h.id} className="flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-xs">
                <span>{h.title}</span>
                {/* ★★ The tile title is in the accessible name because N chips
                    render at once and N identical "Restore" buttons is a WCAG
                    2.4.6 failure the axe gate cannot see, in any view, at any
                    seed size.
                    ★ WCAG 2.5.3 holds by CONTAINMENT: the visible label
                    "Restore" is contained in "Restore – <tile>". */}
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label={`${restore} – ${h.title}`}
                  onClick={() => onRestore(h.id)}
                  className="rounded-full border border-line"
                >
                  {restore}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
