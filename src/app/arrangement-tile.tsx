"use client";
import type { DragEvent, KeyboardEvent, ReactNode } from "react";
import { W_CLASS, H_CLASS } from "./arrangement-grid";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";
import { DragHandle } from "./drag-handle";
import { t, type Lang } from "./i18n";
import type { BlockSpan } from "./arrangement-layout";

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

export interface ArrangementTileProps {
  id: string;
  title: string;
  w: BlockSpan;
  h: BlockSpan;
  lang: Lang;
  readOnly: boolean;
  dragProps: TileDragProps;
  handleProps: TileHandleProps;
  /**
   * Prefixes this tile's `data-testid`, as `` `${testIdPrefix}-${id}` ``.
   *
   * ★ A PREFIX RATHER THAN A WHOLE TEST ID, so a surface cannot accidentally
   * give two blocks the same handle: the id half is always the block's own.
   * The Dashboard passes `"tile"`, which is why every existing
   * `data-testid="tile-raid"` assertion still resolves after the extraction.
   */
  testIdPrefix: string;
  /** Receives the trigger itself, so the caller can anchor its popover on it. */
  onOpenMenu: (anchor: HTMLElement) => void;
  /** ★★ Registers the ⋮ trigger against this tile's ID, so the caller can find
   *  it again LATER — after a move has closed the popover and re-rendered the
   *  board. `onOpenMenu` cannot serve that: it hands over a node captured
   *  before the reorder, and focusing a node the commit has replaced or
   *  detached is a silent no-op. Called with `null` on unmount, so the caller's
   *  map cannot accumulate detached nodes. */
  menuButtonRef?: (el: HTMLButtonElement | null) => void;
  children: ReactNode;
}

/**
 * Chrome around one arrangeable block: the drag grip, the title, and the ⋮
 * button. Shared by every surface that binds the arrangement engine.
 *
 * ★★ EVERY CONTROL'S NAME IS QUALIFIED WITH THE TILE TITLE. N identically named
 * "Drag or use arrow keys to reorder" buttons is a WCAG 2.4.6 failure, and the
 * axe gate cannot see it at any seed size — no rule under the four tags
 * `e2e/a11y.spec.ts` requests flags duplicate accessible names, and the only
 * adjacent rule (`identical-links-same-purpose`) is links-only and `wcag2aaa`.
 * The qualifier has to be written HERE, and the unit test rendering TWO tiles
 * is the only possible detector, in either layer — a one-tile fixture cannot
 * express a collision at any assertion count.
 * ★★★ THAT NOW COVERS EVERY SURFACE AT ONCE, which cuts both ways. One
 * qualifier serves the Dashboard and Reports, so neither can regress
 * independently — but a surface passing a NON-UNIQUE `title` defeats it from
 * outside this file, and nothing here can see that. Whoever renders the LIST
 * owns title uniqueness; this component cannot disambiguate itself, having no
 * sibling visibility.
 *
 * ★ WCAG 2.5.3 (label-in-name) does not apply to either control: both are
 * glyph-only, so neither has a VISIBLE label for the accessible name to
 * contain. Containing the tile title is a 2.4.6 disambiguator, not 2.5.3
 * conformance. (The plan's docstring claimed 2.5.3; it does not bind here.)
 *
 * ★★ THE GRIP IS THE SHARED `DragHandle` PRIMITIVE, and this paragraph used to
 * say the opposite: it recorded that `DragHandle` forwarded `draggable`/
 * `onDragStart`/`onMouseDown` ONLY, so it could carry neither `onDragEnd` nor
 * `onKeyDown` — both supplied by `useListReorderDnd` and both load-bearing (drag
 * cleanup; the arrow-key reorder path, the ONLY one that works without a mouse).
 * The primitive forwards all four now, so the grip spreads `handleProps` straight
 * onto it. ★ The visible glyph therefore changed from `⠿` to the primitive's ⋮,
 * and the element from a `<button>` to a `div role="button"` — the accessible
 * name, the tab stop and the focus-visible ring are unchanged.
 */
export function ArrangementTile({
  id, title, w, h, lang, readOnly, dragProps, handleProps,
  testIdPrefix, onOpenMenu, menuButtonRef, children,
}: ArrangementTileProps) {
  const moveLabel = `${t(lang, "reorderHandle")} – ${title}`;
  const menuLabel = `${t(lang, "actionMoreActions")} – ${title}`;
  return (
    <section
      data-testid={`${testIdPrefix}-${id}`}
      aria-label={title}
      className={`flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface ${W_CLASS[w]} ${H_CLASS[h]}`}
      {...(readOnly ? {} : dragProps)}
    >
      <div className="flex items-center gap-1 border-b border-line px-1 py-1">
        {!readOnly && (
          <DragHandle
            {...handleProps}
            ariaLabel={moveLabel}
            title={t(lang, "reorderHandle")}
            // The tab stop, `select-none`, `print:hidden` and the focus-visible
            // ring (deliberately not `FOCUS_RING` — a grip is held for the whole
            // gesture, so a `focus:` ring would paint throughout it) are all the
            // primitive's base. Only size/colour/cursor stay here.
            className="cursor-grab touch-none rounded px-1 py-0.5 text-muted-foreground hover:text-foreground"
          />
        )}
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
          {title}
        </h3>
        {!readOnly && (
          <button
            ref={menuButtonRef}
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
