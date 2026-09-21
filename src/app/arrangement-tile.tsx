"use client";
import type { DragEvent, KeyboardEvent, ReactNode } from "react";
import { W_CLASS, H_CLASS } from "./arrangement-grid";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";
import { DragHandle } from "./drag-handle";
import { InfoTooltip } from "./info-tooltip";
import { t, type Lang } from "./i18n";
import type { BlockHeight, BlockWidth } from "./arrangement-layout";

/** Spread onto the DROP TARGET — `useListReorderDnd(...).itemProps(id)`. */
export interface BlockDragProps {
  onDragOver?: (e: DragEvent<HTMLElement>) => void;
  onDrop?: (e: DragEvent<HTMLElement>) => void;
}
/** Spread onto the DRAG GRIP — `useListReorderDnd(...).handleProps(id)`. */
export interface BlockHandleProps {
  draggable?: boolean;
  onDragStart?: (e: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
}

export interface ArrangementTileProps {
  id: string;
  title: string;
  w: BlockWidth;
  h: BlockHeight;
  lang: Lang;
  readOnly: boolean;
  dragProps: BlockDragProps;
  handleProps: BlockHandleProps;
  /**
   * Prefixes this block's `data-testid`, as `` `${testIdPrefix}-${id}` ``.
   *
   * ★ A PREFIX RATHER THAN A WHOLE TEST ID, so a surface cannot accidentally
   * give two blocks the same handle: the id half is always the block's own.
   * The Dashboard passes `"tile"`, which is why every existing
   * `data-testid="tile-raid"` assertion still resolves after the extraction.
   */
  testIdPrefix: string;
  /**
   * Whether the grip's `handleProps` actually carry an arrow-key reorder, i.e.
   * whether the surface left `useListReorderDnd`'s `keyboard` at its default.
   * It selects the grip's NAME and nothing else — `false` names it
   * `reorderHandleDragOnly` ("Drag to reorder") instead of `reorderHandle`
   * ("Drag or use arrow keys to reorder").
   *
   * ★★★ THE NAME MUST MATCH THE CAPABILITY (WCAG 4.1.2). A surface passing
   * `keyboard: false` gets `handleProps.onKeyDown === undefined`, so a keyboard
   * user who tabs to a grip promising arrow keys presses one and gets nothing —
   * no move, no announcement, an empty live region. HTML5 drag is not
   * keyboard-operable, so that grip is then a focus stop with no keyboard action
   * at all, wearing a name that says otherwise.
   *
   * ★★★ REQUIRED, AND DELIBERATELY SO — THERE IS NO DEFAULT TO INHERIT. It
   * briefly defaulted to `true`, which was the wrong way round: a caller who
   * forgot it OVERSTATED what its grip does, which is precisely the defect this
   * prop exists to prevent. That default was never an endorsement — it only
   * preserved `dashboard-panel.tsx`, which was under a branch rule forbidding
   * edits to it. §425 lifted that rule and closed the Dashboard half, and with
   * both consumers now passing the prop explicitly the default had no consumer
   * left to protect, so it is gone. Making it required is what takes the whole
   * CLASS out of reach: a new surface cannot acquire an arrow-key promise by
   * saying nothing, and the compiler asks the one question that matters.
   *
   * ★ Pass it from the SAME file that configures `useListReorderDnd`, so the
   * capability and its label cannot drift apart. Both consumers do:
   * `dashboard-panel.tsx` sets `keyboard: false` and passes
   * `keyboardReorder={false}` a few hundred lines below it; `reports.tsx` does
   * the same pair. Threading it from some third file would rebuild this defect
   * with extra steps.
   */
  keyboardReorder: boolean;
  /** Receives the trigger itself, so the caller can anchor its popover on it. */
  onOpenMenu: (anchor: HTMLElement) => void;
  /** ★★ Registers the ⋮ trigger against this block's ID, so the caller can find
   *  it again LATER — after a move has closed the popover and re-rendered the
   *  board. `onOpenMenu` cannot serve that: it hands over a node captured
   *  before the reorder, and focusing a node the commit has replaced or
   *  detached is a silent no-op. Called with `null` on unmount, so the caller's
   *  map cannot accumulate detached nodes. */
  menuButtonRef?: (el: HTMLButtonElement | null) => void;
  /** Optional explanation of what the block shows, as an info tooltip right
   *  after the title. ★ In the HEADER, never the body: a body is often one big
   *  button (the Dashboard's `ActivateBody`), and a tooltip trigger nested in a
   *  button is an axe nested-interactive failure. */
  hint?: string;
  children: ReactNode;
}

/**
 * Chrome around one arrangeable block: the drag grip, the title, and the ⋮
 * button. Shared by every surface that binds the arrangement engine.
 *
 * ★★ EVERY CONTROL'S NAME IS QUALIFIED WITH THE BLOCK TITLE. N identically named
 * "Drag or use arrow keys to reorder" buttons is a WCAG 2.4.6 failure, and the
 * axe gate cannot see it at any seed size — no rule under the four tags
 * `e2e/a11y.spec.ts` requests flags duplicate accessible names, and the only
 * adjacent rule (`identical-links-same-purpose`) is links-only and `wcag2aaa`.
 * The qualifier has to be written HERE, and the unit test rendering TWO blocks
 * is the only possible detector, in either layer — a one-block fixture cannot
 * express a name clash at any assertion count.
 * ★★★ THAT NOW COVERS EVERY SURFACE AT ONCE, which cuts both ways. One
 * qualifier serves the Dashboard and Reports, so neither can regress
 * independently — but a surface passing a NON-UNIQUE `title` defeats it from
 * outside this file, and nothing here can see that. Whoever renders the LIST
 * owns title uniqueness; this component cannot disambiguate itself, having no
 * sibling visibility.
 *
 * ★ WCAG 2.5.3 (label-in-name) does not apply to either control: both are
 * glyph-only, so neither has a VISIBLE label for the accessible name to
 * contain. Containing the block title is a 2.4.6 disambiguator, not 2.5.3
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
  testIdPrefix, keyboardReorder, onOpenMenu, menuButtonRef, hint, children,
}: ArrangementTileProps) {
  const moveKey = keyboardReorder ? "reorderHandle" : "reorderHandleDragOnly";
  const moveLabel = `${t(lang, moveKey)} – ${title}`;
  const menuLabel = `${t(lang, "actionMoreActions")} – ${title}`;
  return (
    <section
      data-testid={`${testIdPrefix}-${id}`}
      data-arrangement-section=""
      data-tile-id={id}
      aria-label={title}
      className={`flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface ${W_CLASS[w]} ${H_CLASS[h]}`}
      {...(readOnly ? {} : dragProps)}
    >
      <div className="flex items-center gap-1 border-b border-line px-1 py-1">
        {!readOnly && (
          <DragHandle
            {...handleProps}
            ariaLabel={moveLabel}
            title={t(lang, moveKey)}
            // The tab stop, `select-none`, `print:hidden` and the focus-visible
            // ring (deliberately not `FOCUS_RING` — a grip is held for the whole
            // gesture, so a `focus:` ring would paint throughout it) are all the
            // primitive's base. Only size/colour/cursor stay here.
            className="cursor-grab touch-none rounded px-1 py-0.5 text-muted-foreground hover:text-foreground"
          />
        )}
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <h3 className="min-w-0 truncate text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
            {title}
          </h3>
          {hint ? (
            <span className="shrink-0 print:hidden">
              <InfoTooltip text={hint} />
            </span>
          ) : null}
        </div>
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
      <div data-arrangement-body="" className="min-h-0 flex-1 overflow-auto p-2">{children}</div>
    </section>
  );
}
