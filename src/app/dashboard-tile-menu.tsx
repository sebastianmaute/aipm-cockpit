"use client";
/**
 * The Dashboard's binding of the shared arrangement block menu.
 *
 * ★★ THIS FILE IS AN ADAPTER, NOT A MENU. Every landmine that used to live here
 * now lives in `arrangement-block-menu.tsx` — the two-independent-axes rule, the
 * `min === max` static line, why out-of-range values are not rendered at all
 * (`SegmentedControl` has no per-option `disabled`), the `optionAriaLabel` WCAG
 * 2.4.6 note, and the reminder that `PopoverPanel` owns the Escape/Tab dismissal
 * protocol. Read them there before changing anything here.
 *
 * ★ The exported names are UNCHANGED on purpose — `dashboard-panel.tsx` and the
 * Dashboard's own tests keep compiling and passing untouched. If a Dashboard
 * test needs editing to accommodate a change here, the change is wrong.
 */
import { ArrangementBlockMenu, AxisGroup } from "./arrangement-block-menu";
import { tileById, type DashboardTileId, type TileSpan } from "./dashboard-tiles";
import type { Lang } from "./i18n";

/* ★★★ THE CATALOGUE LOOKUP LIVES HERE NOW, AND THAT IS THE POINT OF THE TASK.
 * The generic menu takes its four bounds as props; only the surface that OWNS a
 * catalogue should be resolving an id against it. Keeping the lookup and its
 * `return null` at this boundary means the generic component can no longer
 * silently render nothing — a failure mode indistinguishable from a menu that
 * failed to open — while `dashboard-panel.tsx`'s call site stays byte-identical.
 * ★ The null branch is retained rather than dropped: `tileById` is a `find`, so
 * an id outside the catalogue really can miss, and this is where that is now a
 * Dashboard fact rather than everyone's. */
export function DashboardTileMenu({
  lang, tileId, title, w, h, index, count, onResize, onMove, onHide, onClose,
}: {
  lang: Lang;
  tileId: DashboardTileId;
  title: string;
  w: TileSpan;
  h: TileSpan;
  /** Position of this tile in the visible board, for the move commands. */
  index: number;
  count: number;
  onResize: (axis: "w" | "h", value: TileSpan) => void;
  onMove: (delta: -1 | 1 | "first") => void;
  onHide: () => void;
  onClose: () => void;
}) {
  const spec = tileById(tileId);
  if (!spec) return null;
  return (
    <ArrangementBlockMenu
      lang={lang}
      title={title}
      w={w}
      h={h}
      minW={spec.minW}
      maxW={spec.maxW}
      minH={spec.minH}
      maxH={spec.maxH}
      index={index}
      count={count}
      onResize={onResize}
      onMove={onMove}
      onHide={onHide}
      onClose={onClose}
    />
  );
}

/* ★ A WRAPPER, NOT A RE-EXPORT, and only because of ONE prop name. The generic
 * component speaks the engine's vocabulary (`blockTitle`), while this file's
 * public prop has always been `tileTitle` and `dashboard-grid.test.tsx` renders
 * it directly with that spelling. A bare `export { AxisGroup as TileAxisGroup }`
 * would rename the COMPONENT and not the PROP, so the Dashboard test would break
 * — which the Phase F rule forbids. Everything else passes straight through. */
export function TileAxisGroup({
  lang, axis, tileTitle, value, lo, hi, onPick,
}: {
  lang: Lang;
  axis: "w" | "h";
  tileTitle: string;
  value: TileSpan;
  lo: TileSpan;
  hi: TileSpan;
  onPick: (v: TileSpan) => void;
}) {
  return (
    <AxisGroup lang={lang} axis={axis} blockTitle={tileTitle} value={value} lo={lo} hi={hi} onPick={onPick} />
  );
}
