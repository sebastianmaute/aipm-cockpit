"use client";
/**
 * The Dashboard's binding of the shared arrangement shelf.
 *
 * ★★ THIS FILE IS AN ADAPTER, NOT A SHELF. Every landmine that used to live here
 * now lives in `arrangement-shelf.tsx` — the restore-button-is-the-keyboard-path
 * rule, the always-mounted `hidden`-toggled tray behind `aria-controls`, the
 * `isDragging` guard on the drag-to-open, why the disclosure renders at zero
 * hidden blocks, the absent `onHide`, and the `toggleRef` focus-landing
 * contract. Read them there before changing anything here.
 *
 * ★ The exported name and props are UNCHANGED on purpose — `dashboard-panel.tsx`
 * and the Dashboard's own tests keep compiling and passing untouched. If a
 * Dashboard test needs editing to accommodate a change here, the change is
 * wrong.
 */
import type { RefObject } from "react";
import { ArrangementShelf } from "./arrangement-shelf";
import type { Lang } from "./i18n";
import type { TileDragProps } from "./dashboard-tile";
import type { DashboardTileId } from "./dashboard-tiles";

/** ★ UNCHANGED VALUE, now passed in rather than read from module scope. The
 *  generic shelf takes its tray id as a prop so two surfaces cannot mint the
 *  same DOM id; this literal is what keeps the Dashboard's rendered
 *  `aria-controls` byte-identical. */
const TRAY_ID = "dashboard-shelf-tray";

/* ★★ THE `onRestore` LAMBDA IS THE ADAPTER'S JOB AND IS DELIBERATELY VISIBLE.
 * The generic shelf hands back a `string`, because it cannot know a surface's id
 * union; the Dashboard's handler wants a `DashboardTileId`, and under
 * `strictFunctionTypes` a `(id: DashboardTileId) => void` is NOT assignable to a
 * `(id: string) => void` parameter. The cast is safe for the reason the store's
 * equivalent one is: every id the shelf can hand back came out of the `hidden`
 * array THIS component was given, so it is a `DashboardTileId` by construction.
 * Do not push the narrowing into the generic component as an id parameter — it
 * would then be invisible at every call site instead of stated once here. */
export function DashboardShelf({
  lang, hidden, onRestore, dropProps, isDragging, toggleRef,
}: {
  lang: Lang;
  hidden: { id: DashboardTileId; title: string }[];
  onRestore: (id: DashboardTileId) => void;
  /** The grid's own drop handlers — the shelf never decodes the drag itself. */
  dropProps: TileDragProps;
  isDragging: boolean;
  /** The stable focus target after a hide or restore — see the generic
   *  component's own docstring for why the chip list is the wrong one. */
  toggleRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <ArrangementShelf
      lang={lang}
      hidden={hidden}
      onRestore={(id) => onRestore(id as DashboardTileId)}
      dropProps={dropProps}
      isDragging={isDragging}
      toggleRef={toggleRef}
      trayId={TRAY_ID}
    />
  );
}
