"use client";
/**
 * The Dashboard's binding of the shared arrangement shelf's TRAY (spec C split
 * the toggle out to `DashboardHiddenBadge`, which owns the disclosure).
 *
 * ★★ THIS FILE IS AN ADAPTER, NOT A TRAY. Every landmine that used to live here
 * now lives in `arrangement-shelf.tsx` — the restore-button-is-the-keyboard-path
 * rule, the always-mounted `hidden`-toggled tray behind `aria-controls`, and the
 * absent `onHide`. Since spec C, the disclosure itself (`aria-expanded`, the
 * `isDragging` drag-to-open guard, why it is absent at a count of 0 except while
 * dragging, and the post-hide/restore focus-landing contract) lives in
 * `dashboard-hidden-badge.tsx` — read them there before changing anything here.
 *
 * ★ SPEC C CHANGED THIS ADAPTER'S PROPS: the toggle, `isDragging` and the
 * focus ref left for `DashboardHiddenBadge`, and its tests moved to
 * `dashboard-hidden-badge.test.tsx`, which exercises the badge and this tray
 * together exactly as the panel wires them.
 */
import { ArrangementShelfTray } from "./arrangement-shelf";
import type { Lang } from "./i18n";
import type { TileDragProps } from "./dashboard-tile";
import type { DashboardTileId } from "./dashboard-tiles";

/** ★ UNCHANGED VALUE, exported since spec C: the badge's `aria-controls`
 *  (`dashboard-hidden-badge.tsx`) must name this same id. */
export const DASHBOARD_SHELF_TRAY_ID = "dashboard-shelf-tray";

/* ★★ SINCE SPEC C THIS BINDS THE TRAY ONLY. The toggle is the Dashboard's own
 * `DashboardHiddenBadge` in the control stack, and the panel owns the one `open`
 * state both read; Reports keeps the combined `ArrangementShelf`. The `onRestore`
 * cast is the adapter's job for the reason below. */
/* ★★ THE `onRestore` LAMBDA IS THE ADAPTER'S JOB AND IS DELIBERATELY VISIBLE.
 * The generic tray hands back a `string`, because it cannot know a surface's id
 * union; the Dashboard's handler wants a `DashboardTileId`, and under
 * `strictFunctionTypes` a `(id: DashboardTileId) => void` is NOT assignable to a
 * `(id: string) => void` parameter. The cast is safe: every id the tray can hand
 * back came out of the `hidden` array THIS component was given. */
export function DashboardShelf({
  lang, hidden, onRestore, dropProps, open,
}: {
  lang: Lang;
  hidden: { id: DashboardTileId; title: string }[];
  onRestore: (id: DashboardTileId) => void;
  /** The grid's own drop handlers — the tray never decodes the drag itself. */
  dropProps: TileDragProps;
  /** Controlled by the panel, which also drives the badge's `aria-expanded`. */
  open: boolean;
}) {
  return (
    <ArrangementShelfTray
      lang={lang}
      hidden={hidden}
      onRestore={(id) => onRestore(id as DashboardTileId)}
      dropProps={dropProps}
      open={open}
      trayId={DASHBOARD_SHELF_TRAY_ID}
    />
  );
}
