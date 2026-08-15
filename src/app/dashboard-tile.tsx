"use client";
import type { DragEvent, KeyboardEvent, ReactNode } from "react";
import { W_CLASS, H_CLASS } from "./dashboard-grid";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";
import { t, type Lang } from "./i18n";
import type { DashboardTileId, TileSpan } from "./dashboard-tiles";

/** Spread onto the DROP TARGET — `useListReorderDnd(...).itemProps(id)`. */
export interface TileDragProps {
  onDragOver?: (e: DragEvent<HTMLElement>) => void;
  onDrop?: (e: DragEvent<HTMLElement>) => void;
}
/** Spread onto the DRAG GRIP — `useListReorderDnd(...).handleProps(id)`. */
export interface TileHandleProps {
  draggable?: boolean;
  onDragStart?: (e: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
}

/**
 * Chrome around one dashboard card: the drag grip, the title, and the ⋮ button.
 *
 * ★★ EVERY CONTROL'S NAME IS QUALIFIED WITH THE TILE TITLE. N identically named
 * "Drag or use arrow keys to reorder" buttons is a WCAG 2.4.6 failure, and the
 * axe gate cannot see it at any seed size — no rule under the four tags
 * `e2e/a11y.spec.ts` requests flags duplicate accessible names, and the only
 * adjacent rule (`identical-links-same-purpose`) is links-only and `wcag2aaa`.
 * The qualifier has to be written HERE, and the unit test rendering TWO tiles
 * is the only possible detector, in either layer — a one-tile fixture cannot
 * express a collision at any assertion count.
 *
 * ★ WCAG 2.5.3 (label-in-name) does not apply to either control: both are
 * glyph-only, so neither has a VISIBLE label for the accessible name to
 * contain. Containing the tile title is a 2.4.6 disambiguator, not 2.5.3
 * conformance. (The plan's docstring claimed 2.5.3; it does not bind here.)
 *
 * ★★ THE GRIP IS HAND-ROLLED ON PURPOSE — see `docs/handrolled-ui-inventory.md`.
 * `DragHandle` (`drag-handle.tsx`) forwards `draggable`/`onDragStart`/
 * `onMouseDown` ONLY, so it can carry neither `onDragEnd` nor `onKeyDown`, both
 * of which `useListReorderDnd` supplies and both of which are load-bearing
 * (drag cleanup; the arrow-key reorder path, which is the ONLY path that works
 * without a mouse). This matches the grips Phase A shipped in `reports.tsx` and
 * `budget-panel.tsx` rather than inventing a third shape.
 */
export function DashboardTile({
  id, title, w, h, lang, readOnly, dragProps, handleProps, onOpenMenu, children,
}: {
  id: DashboardTileId;
  title: string;
  w: TileSpan;
  h: TileSpan;
  lang: Lang;
  readOnly: boolean;
  dragProps: TileDragProps;
  handleProps: TileHandleProps;
  /** Receives the trigger itself, so the caller can anchor its popover on it. */
  onOpenMenu: (anchor: HTMLElement) => void;
  children: ReactNode;
}) {
  const moveLabel = `${t(lang, "reorderHandle")} – ${title}`;
  const menuLabel = `${t(lang, "actionMoreActions")} – ${title}`;
  return (
    <section
      data-testid={`tile-${id}`}
      aria-label={title}
      className={`flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface ${W_CLASS[w]} ${H_CLASS[h]}`}
      {...(readOnly ? {} : dragProps)}
    >
      <div className="flex items-center gap-1 border-b border-line px-1 py-1">
        {!readOnly && (
          <button
            type="button"
            tabIndex={0}
            {...handleProps}
            aria-label={moveLabel}
            title={t(lang, "reorderHandle")}
            // ★ `focus-visible`, not the `FOCUS_RING` primitive: a grip is
            // PRESSED and held for the whole gesture, so a `focus:` ring would
            // paint for the drag's entire duration. Same spelling as the Phase A
            // grips this matches.
            className="cursor-grab touch-none select-none rounded px-1 py-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-green print:hidden"
          >
            ⠿
          </button>
        )}
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
          {title}
        </h3>
        {!readOnly && (
          <button
            type="button"
            aria-haspopup="menu"
            aria-label={menuLabel}
            title={t(lang, "actionMoreActions")}
            onClick={(e) => onOpenMenu(e.currentTarget)}
            className={`rounded px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground print:hidden ${FOCUS_RING} ${TRANSITION}`}
          >
            ⋮
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">{children}</div>
    </section>
  );
}
