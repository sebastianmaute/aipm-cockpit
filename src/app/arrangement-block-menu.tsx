"use client";
import { Button } from "./button";
import { SegmentedControl } from "./segmented-control";
import { t, type Lang } from "./i18n";
import type { BlockSpan } from "./arrangement-layout";

/**
 * The ⋮ menu's CONTENT: two independent size axes plus the keyboard move
 * commands and Hide. Shared by every surface that binds the arrangement engine.
 *
 * The caller wraps this in `PopoverPanel`, which owns the shared Escape/Tab
 * dismissal protocol (`use-dismissable.ts` → `dismissal-stack.ts`) — nothing
 * here improvises one, and nothing here portals. ★★ That split is load-bearing
 * and is documented in `docs/AGENTS/ui-shell.md`: the dismissal STACK decides
 * which layer Escape closes, in open order, so a menu that added its own
 * `keydown` listener would dismiss itself AND its parent. Do not add one here
 * when binding a new surface — wrap in `PopoverPanel` like the Dashboard does.
 *
 * ★★★ THE BOUNDS ARRIVE AS PROPS, NOT FROM A CATALOGUE LOOKUP, and that is the
 * one real design change in the extraction. This component used to call
 * `tileById(tileId)` at module scope and `return null` when it missed — a second
 * source of truth for something the CALLER already holds, and a branch that
 * silently rendered NOTHING. A menu that renders nothing looks identical to a
 * menu that failed to open. The lookup and its null branch now live in
 * `dashboard-tile-menu.tsx`, where the surface that owns the catalogue can do it
 * once; every other surface passes the four numbers it already has.
 *
 * ★★★ THE TWO AXES ARE INDEPENDENT CONTROLS, never one named-preset list. A
 * single preset list cannot express "taller, same width" at every width, which
 * is why that design was rejected.
 *
 * ★★ AN AXIS WHERE min === max RENDERS NO CHOOSER — a static "fixed at N" line
 * instead. A row of values with all but one disabled is indistinguishable from
 * a broken control, and was read as exactly that during design review.
 *
 * ★★ VALUES OUTSIDE THE BLOCK'S OWN LIMITS ARE NOT RENDERED AT ALL, and this
 * DEPARTS FROM THE PLAN, which asked for them disabled. The selection is a
 * `SegmentedControl` (the repo's radio-style primitive) and it has no per-option
 * `disabled` — only a whole-control one. Forking it to add one was not on the
 * table, and hand-rolling `aria-checked` buttons would lose the APG roving, the
 * sole-tab-stop and the non-colour selected state the primitive carries.
 *
 * ★ The menu's own name reuses `actionMoreActions` rather than a dedicated key,
 * matching the ⋮ trigger in `arrangement-tile.tsx` and `task-row.tsx`'s existing
 * convention. Same for the grip's `reorderHandle`.
 *
 * ★ The move commands are the surface's keyboard reorder path. The drag
 * primitive's own arrow-key option stays off here — a second keyboard path for
 * one action is redundant.
 */

/** `SegmentedControl` is generic over a STRING union, so spans cross as text. */
type SpanValue = "1" | "2" | "3" | "4";

function spansBetween(lo: BlockSpan, hi: BlockSpan): BlockSpan[] {
  const out: BlockSpan[] = [];
  for (let n = lo; n <= hi; n += 1) out.push(n as BlockSpan);
  return out;
}

/**
 * One axis. Exported for its own test: no block in the Dashboard catalogue pins
 * an axis today, so the `lo === hi` branch is unreachable through
 * `ArrangementBlockMenu` there and can only be exercised directly.
 */
export function AxisGroup({
  lang, axis, blockTitle, value, lo, hi, onPick,
}: {
  lang: Lang;
  axis: "w" | "h";
  blockTitle: string;
  value: BlockSpan;
  lo: BlockSpan;
  hi: BlockSpan;
  onPick: (v: BlockSpan) => void;
}) {
  const label = t(lang, axis === "w" ? "dashboardTileWidth" : "dashboardTileHeight");
  return (
    <div className="px-2 py-1">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      {lo === hi ? (
        <p className="text-xs text-muted-foreground">{t(lang, "dashboardTileFixedAt", lo)}</p>
      ) : (
        <SegmentedControl<SpanValue>
          value={String(value) as SpanValue}
          options={spansBetween(lo, hi).map((n) => ({ value: String(n) as SpanValue, label: String(n) }))}
          onChange={(v) => onPick(Number(v) as BlockSpan)}
          ariaLabel={`${label} – ${blockTitle}`}
          // ★★ Both axes offer a value labelled "2", so the visible label alone
          // is a WCAG 2.4.6 collision INSIDE one menu. The axis and the block
          // both have to be in the name. axe cannot see this in any view at any
          // seed size, so the unit test is the only detector.
          optionAriaLabel={(v) => `${label} ${v} – ${blockTitle}`}
        />
      )}
    </div>
  );
}

/**
 * ★★ NO `blockId` PROP, AND THAT IS A DELIBERATE DEPARTURE FROM THE PLAN, which
 * listed one. Once the catalogue lookup moved to the adapter, nothing in here
 * reads an id — the four bounds and the title are the whole input — and a
 * destructured prop nothing reads is FATAL at `--max-warnings=0` (this repo has
 * no `argsIgnorePattern`). `arrangement-shelf.tsx` records the identical
 * decision about the plan's unused `onHide`, so this is the family's existing
 * answer rather than a new one. The Dashboard adapter still takes `tileId`,
 * because IT needs one for the lookup, so no call site changed.
 */
export function ArrangementBlockMenu({
  lang, title, w, h, minW, maxW, minH, maxH,
  index, count, onResize, onMove, onHide, onClose,
}: {
  lang: Lang;
  title: string;
  w: BlockSpan;
  h: BlockSpan;
  /** The four bounds, from whoever owns the catalogue. See the ★★★ above. */
  minW: BlockSpan;
  maxW: BlockSpan;
  minH: BlockSpan;
  maxH: BlockSpan;
  /** Position of this block in the visible board, for the move commands. */
  index: number;
  count: number;
  onResize: (axis: "w" | "h", value: BlockSpan) => void;
  onMove: (delta: -1 | 1 | "first") => void;
  onHide: () => void;
  onClose: () => void;
}) {
  const command = "w-full justify-start text-left";
  return (
    // ★★ NO `aria-label` HERE. This div has no role, so it maps to `generic`,
    // on which ARIA PROHIBITS a name — and the name it carried was a duplicate
    // anyway: the panel passes the identical string to `PopoverPanel`'s
    // `ariaLabel`, which lands on the `role="dialog"` wrapping this content.
    // ★ No gate can see the prohibited attribute: axe 4.12.1's
    // `aria-prohibited-attr` is `wcag2a`, but a div WITH content lands in
    // `incomplete`, and `e2e/a11y.spec.ts` reads `results.violations` only.
    <div className="flex min-w-52 flex-col">
      <AxisGroup lang={lang} axis="w" blockTitle={title} value={w}
        lo={minW} hi={maxW} onPick={(v) => onResize("w", v)} />
      <AxisGroup lang={lang} axis="h" blockTitle={title} value={h}
        lo={minH} hi={maxH} onPick={(v) => onResize("h", v)} />
      <hr className="my-1 border-line" />
      <Button variant="ghost" size="xs" className={command} disabled={index === 0}
        onClick={() => { onMove(-1); onClose(); }}>{t(lang, "dashboardTileMoveEarlier")}</Button>
      <Button variant="ghost" size="xs" className={command} disabled={index >= count - 1}
        onClick={() => { onMove(1); onClose(); }}>{t(lang, "dashboardTileMoveLater")}</Button>
      <Button variant="ghost" size="xs" className={command} disabled={index === 0}
        onClick={() => { onMove("first"); onClose(); }}>{t(lang, "dashboardTileMoveFirst")}</Button>
      <hr className="my-1 border-line" />
      <Button variant="ghost" size="xs" className={command}
        onClick={() => { onHide(); onClose(); }}>{t(lang, "dashboardTileHide")}</Button>
    </div>
  );
}
