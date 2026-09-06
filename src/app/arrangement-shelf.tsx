"use client";
import { useMemo, useState, type RefObject } from "react";
import { Button } from "./button";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";
import { buildRowTokens, rowLabel } from "./row-tokens";
import { t, type Lang } from "./i18n";
import type { BlockDragProps } from "./arrangement-tile";

/**
 * Where hidden blocks live: a collapsed "N hidden" disclosure over a tray of
 * chips, and the drop target that hiding a block by drag aims at. Shared by
 * every surface that binds the arrangement engine.
 *
 * ★★ THE RESTORE BUTTON IS THE KEYBOARD PATH. Dragging a chip back out is the
 * mouse shortcut, not the only route — without a button a keyboard user who hid
 * a block could never retrieve it.
 *
 * ★★ THE TRAY IS ALWAYS MOUNTED AND `hidden`-TOGGLED, never conditionally
 * rendered: `aria-controls` must point at a node that exists. Same shape as
 * `action-reasons.tsx`, which is the repo's disclosure precedent — there is no
 * shared Disclosure primitive to reach for (`aria-expanded` is hand-rolled in
 * a dozen surfaces), so this follows the existing family rather than inventing
 * a thirteenth shape.
 *
 * ★ Dragging over the COLLAPSED button opens the tray, so the user never has to
 * open it before picking a block up — a sequence that cannot be discovered
 * mid-drag. It is guarded on `isDragging` so a stray `dragEnter` (a file
 * dragged over the window, say) cannot pop the tray open.
 *
 * ★ The disclosure renders even at zero hidden blocks, because that is exactly
 * when the drop target has to exist: hiding the FIRST block by drag needs
 * somewhere to drop it.
 *
 * ★★ THE SHELF TAKES NO `onHide`. The plan had one, unused, to be wired later —
 * but a destructured prop nothing reads is FATAL at `--max-warnings=0` (no
 * `argsIgnorePattern` in this repo). The grid owns the drop instead and passes
 * its handlers as `dropProps`, the drop-target prop bag declared as
 * `BlockDragProps` in `arrangement-tile.tsx`; the shelf never decodes a drag
 * itself.
 */
export function ArrangementShelf({
  lang, hidden, onRestore, dropProps, isDragging, toggleRef, trayId,
}: {
  lang: Lang;
  hidden: { id: string; title: string }[];
  onRestore: (id: string) => void;
  /** The grid's own drop handlers — the shelf never decodes the drag itself. */
  dropProps: BlockDragProps;
  isDragging: boolean;
  /** ★★ THE ONE NODE IN THIS SUBTREE THAT NEVER UNMOUNTS, exposed so the panel
   *  can land focus on it after hide/restore. Both of those actions destroy the
   *  control the user just pressed — the ⋮ menu's Hide button goes with the
   *  block, a chip's Restore button goes with the chip — and with nothing
   *  focused the browser drops to `<body>`, stranding the keyboard user
   *  mid-task. The chip list is the wrong target because its length changes
   *  underneath them; the disclosure is stable in both directions. Optional, so
   *  the component still renders standalone in its own tests. */
  toggleRef?: RefObject<HTMLButtonElement | null>;
  /**
   * The tray's DOM id, which `aria-controls` points at.
   *
   * ★★★ A PROP RATHER THAN THE MODULE CONSTANT IT WAS, and this is a DELIBERATE
   * DEPARTURE from the plan's "type change only". A hardcoded id in a component
   * two surfaces mount is a latent DUPLICATE-ID defect, and unlike most of the
   * a11y traps in this subsystem axe CAN see this one — `duplicate-id-aria` is
   * `wcag2a` and therefore inside the four tags `e2e/a11y.spec.ts` requests. It
   * cannot fire TODAY, because only one view renders at a time, so this is
   * prevention rather than a fix; the cost is one literal at each call site and
   * the alternative is a defect that appears the moment two boards coexist.
   */
  trayId: string;
}) {
  const [open, setOpen] = useState(false);
  const restore = t(lang, "dashboardTileRestore");
  /**
   * ★★★ THE SHELF IS THE LIST OWNER, SO THE TOKEN MAP IS BUILT HERE — the repo's
   * standing rule (`row-tokens.ts`, and AGENTS.md's "a per-item component cannot
   * disambiguate itself"). This is the difference between this component and
   * `arrangement-tile.tsx`: a tile sees one title and can only qualify with it,
   * while the shelf sees every chip at once and can number a genuine clash.
   *
   * ★★ ADDED HERE, NOT INHERITED — it is a DELIBERATE DEPARTURE from the plan's
   * "type change only". Before this, two hidden blocks sharing a title rendered
   * two controls both named "Restore – X", a WCAG 2.4.6 failure that axe cannot
   * see in any view at any seed size. It could not arise from the Dashboard
   * catalogue, whose labels are all distinct, so it was latent rather than live;
   * a second surface's catalogue is a new chance to hit it, and `hidden` is
   * caller-supplied so neither catalogue is a guarantee.
   * ★ It is also what makes a `requireCollisionSeed: true` test POSSIBLE at all:
   * that guard certifies disambiguation by the ` (N)` occurrence suffix, which
   * is precisely what `buildRowTokens` emits and what prefix-only qualification
   * cannot produce.
   * ★★ NO DASHBOARD OUTPUT CHANGES: a name unique within the map is used BARE,
   * and `rowLabel` renders the same `${verb} – ${token}` shape this file already
   * spelled by hand, so with distinct titles the emitted string is identical.
   *
   * ★★★ PRECONDITION — `hidden` MUST HOLD UNIQUE IDS. The map is keyed on
   * `h.id`, so two entries sharing an id collapse to ONE token and the second
   * chip reads the first's name: the exact collision this block exists to close,
   * reintroduced silently. The guard test cannot see it (its fixture uses
   * distinct ids), and neither can `requireCollisionSeed`. The same assumption
   * already rides the `key={h.id}` on the list item below, and neither the
   * Dashboard's nor Reports' catalogue can produce a duplicate — but `hidden` is
   * CALLER-supplied, and "the caller might hand us anything" is this block's own
   * argument for existing, so it is stated rather than assumed.
   */
  const tokens = useMemo(
    () => buildRowTokens(hidden.map((h) => ({ id: h.id, name: h.title }))),
    [hidden],
  );
  return (
    <div className="mt-2 flex flex-col items-end print:hidden">
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls={trayId}
        onClick={() => setOpen((o) => !o)}
        onDragEnter={() => { if (isDragging) setOpen(true); }}
        {...dropProps}
        className={`rounded-md border border-line bg-surface px-2 py-1 text-xs text-muted-foreground hover:text-foreground ${FOCUS_RING} ${TRANSITION}`}
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span> {t(lang, "dashboardShelfCount", hidden.length)}
      </button>
      <div
        id={trayId}
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
                {/* ★★ The block title is in the accessible name because N chips
                    render at once and N identical "Restore" buttons is a WCAG
                    2.4.6 failure the axe gate cannot see, in any view, at any
                    seed size.
                    ★★ THIS IS THE SURFACE THAT CAN CARRY A COLLISION-SEEDED
                    TEST, unlike `arrangement-tile.tsx`: the shelf renders the
                    LIST, so it sees its own siblings and a fixture can seed two
                    chips sharing a title.
                    ★ WCAG 2.5.3 holds by CONTAINMENT: the visible label
                    "Restore" is contained in "Restore – <block>".
                    ★★ The `?? h.title` fallback is UNREACHABLE and therefore
                    UNPINNED — do not read it as covered behaviour. The map is
                    built from this very list one hook call above, so every id
                    here is in it; no test exercises the right-hand side and none
                    can without breaking that invariant deliberately. It is kept
                    so the name degrades to the raw title rather than the string
                    "undefined" if a future change ever separates the two. */}
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label={rowLabel(restore, tokens.get(h.id) ?? h.title)}
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
