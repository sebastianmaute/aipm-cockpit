"use client";
import { Button } from "./button";
import { SegmentedControl } from "./segmented-control";
import { tileById, type DashboardTileId, type TileSpan } from "./dashboard-tiles";
import { t, type Lang } from "./i18n";

/**
 * The ⋮ menu's CONTENT: two independent size axes plus the keyboard move
 * commands and Hide. The caller wraps this in `PopoverPanel`, which owns the
 * shared Escape/Tab dismissal protocol (`use-dismissable.ts` →
 * `dismissal-stack.ts`) — nothing here improvises one, and nothing here
 * portals.
 *
 * ★★★ THE TWO AXES ARE INDEPENDENT CONTROLS, never one named-preset list. A
 * single preset list cannot express "taller, same width" at every width, which
 * is why that design was rejected.
 *
 * ★★ AN AXIS WHERE min === max RENDERS NO CHOOSER — a static "fixed at N" line
 * instead. A row of values with all but one disabled is indistinguishable from
 * a broken control, and was read as exactly that during design review.
 *
 * ★★ VALUES OUTSIDE THE TILE'S OWN LIMITS ARE NOT RENDERED AT ALL, and this
 * DEPARTS FROM THE PLAN, which asked for them disabled. The selection is a
 * `SegmentedControl` (the repo's radio-style primitive) and it has no per-option
 * `disabled` — only a whole-control one. Forking it to add one was not on the
 * table, and hand-rolling `aria-checked` buttons would lose the APG roving,
 * the sole-tab-stop and the non-colour selected state the primitive carries.
 *
 * ★★★ THE STRINGS ARE PROPS, NOT `t(lang, …)` CALLS. Every key the plan named
 * for this menu — `dashboardTileWidth`, `dashboardTileHeight`,
 * `dashboardTileFixedAt`, `dashboardTileMoveEarlier`/`MoveLater`/`MoveFirst`,
 * `dashboardTileHide` — is ABSENT from `i18n.ts`, and `t()`'s `key` is typed
 * from the EN dict, so naming one is a tsc error AND renders `undefined`. A
 * later task owns the additions; the call site passes them in until then.
 * `lang` is still real: the menu's own accessible name reuses
 * `actionMoreActions`, matching the ⋮ trigger in `dashboard-tile.tsx`.
 *
 * ★ The move commands are the Dashboard's keyboard reorder path. The drag
 * primitive's own arrow-key option stays off here — a second keyboard path for
 * one action is redundant.
 */
export interface TileMenuLabels {
  width: string;
  height: string;
  fixedAt: (n: TileSpan) => string;
  moveEarlier: string;
  moveLater: string;
  moveFirst: string;
  hide: string;
}

/** `SegmentedControl` is generic over a STRING union, so spans cross as text. */
type SpanValue = "1" | "2" | "3" | "4";

function spansBetween(lo: TileSpan, hi: TileSpan): TileSpan[] {
  const out: TileSpan[] = [];
  for (let n = lo; n <= hi; n += 1) out.push(n as TileSpan);
  return out;
}

/**
 * One axis. Exported for its own test: no tile in the catalogue pins an axis
 * today, so the `lo === hi` branch is unreachable through `DashboardTileMenu`
 * and can only be exercised here.
 */
export function TileAxisGroup({
  label, tileTitle, fixedLabel, value, lo, hi, onPick,
}: {
  label: string;
  tileTitle: string;
  /** Rendered INSTEAD of the chooser when the axis cannot be changed. */
  fixedLabel: string;
  value: TileSpan;
  lo: TileSpan;
  hi: TileSpan;
  onPick: (v: TileSpan) => void;
}) {
  return (
    <div className="px-2 py-1">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      {lo === hi ? (
        <p className="text-xs text-muted-foreground">{fixedLabel}</p>
      ) : (
        <SegmentedControl<SpanValue>
          value={String(value) as SpanValue}
          options={spansBetween(lo, hi).map((n) => ({ value: String(n) as SpanValue, label: String(n) }))}
          onChange={(v) => onPick(Number(v) as TileSpan)}
          ariaLabel={`${label} – ${tileTitle}`}
          // ★★ Both axes offer a value labelled "2", so the visible label alone
          // is a WCAG 2.4.6 collision INSIDE one menu. The axis and the tile
          // both have to be in the name.
          optionAriaLabel={(v) => `${label} ${v} – ${tileTitle}`}
        />
      )}
    </div>
  );
}

export function DashboardTileMenu({
  lang, tileId, title, w, h, index, count, labels, onResize, onMove, onHide, onClose,
}: {
  lang: Lang;
  tileId: DashboardTileId;
  title: string;
  w: TileSpan;
  h: TileSpan;
  /** Position of this tile in the visible board, for the move commands. */
  index: number;
  count: number;
  labels: TileMenuLabels;
  onResize: (axis: "w" | "h", value: TileSpan) => void;
  onMove: (delta: -1 | 1 | "first") => void;
  onHide: () => void;
  onClose: () => void;
}) {
  const spec = tileById(tileId);
  if (!spec) return null;
  const command = "w-full justify-start text-left";
  return (
    <div aria-label={`${t(lang, "actionMoreActions")} – ${title}`} className="flex min-w-52 flex-col">
      <TileAxisGroup
        label={labels.width} tileTitle={title} fixedLabel={labels.fixedAt(spec.minW)}
        value={w} lo={spec.minW} hi={spec.maxW} onPick={(v) => onResize("w", v)}
      />
      <TileAxisGroup
        label={labels.height} tileTitle={title} fixedLabel={labels.fixedAt(spec.minH)}
        value={h} lo={spec.minH} hi={spec.maxH} onPick={(v) => onResize("h", v)}
      />
      <hr className="my-1 border-line" />
      <Button variant="ghost" size="xs" className={command} disabled={index === 0}
        onClick={() => { onMove(-1); onClose(); }}>{labels.moveEarlier}</Button>
      <Button variant="ghost" size="xs" className={command} disabled={index >= count - 1}
        onClick={() => { onMove(1); onClose(); }}>{labels.moveLater}</Button>
      <Button variant="ghost" size="xs" className={command} disabled={index === 0}
        onClick={() => { onMove("first"); onClose(); }}>{labels.moveFirst}</Button>
      <hr className="my-1 border-line" />
      <Button variant="ghost" size="xs" className={command}
        onClick={() => { onHide(); onClose(); }}>{labels.hide}</Button>
    </div>
  );
}
