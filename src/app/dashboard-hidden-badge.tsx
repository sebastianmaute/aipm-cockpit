"use client";
/**
 * The Dashboard's hidden-tiles control (spec C decision 2): a count-only badge
 * in the control stack, directly under Reset size, that toggles the tray
 * rendered under row 1, and doubles as the drag-to-hide drop target.
 *
 * ★★ THE `IconButton` PRIMITIVE, `bordered`/`md`, NO `className` — so its box is
 * byte-for-byte `ResetSizeButton`'s (pinned). The count is its visible child;
 * the accessible name states the count in words and CONTAINS the digit
 * (WCAG 2.5.3). A paired key, so `tPlural`, never `t`.
 * ★★ A DISCLOSURE, NOT A TOGGLE BUTTON: `aria-expanded` + `aria-controls`
 * against the always-mounted tray, the repo's disclosure precedent. Never
 * `aria-pressed`.
 * ★ ABSENT AT A COUNT OF 0 — except while a tile is being dragged, because it
 * is the drop target and hiding the FIRST tile by drag needs somewhere to drop.
 * The popout guard (`arrangement.readOnly`) is at the panel's call site, like
 * every control in that stack.
 * ★ ONE DROP IMPLEMENTATION: `dropProps` is the very object the tray receives
 * (`shelfDropProps` in `dashboard-panel.tsx`); this spreads it, it does not
 * decode a drag itself.
 */
import type { Ref } from "react";
import { IconButton } from "./icon-button";
import { tPlural, type Lang } from "./i18n";
import type { TileDragProps } from "./dashboard-tile";

export interface DashboardHiddenBadgeProps {
  lang: Lang;
  /** Hidden tiles that could be restored (gated-off ones excluded by the panel). */
  count: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isDragging: boolean;
  dropProps: TileDragProps;
  /** The tray's id — `DASHBOARD_SHELF_TRAY_ID`. */
  trayId: string;
  /** Focus target after hide/restore (`dashboard-panel.tsx`'s focus request). */
  badgeRef?: Ref<HTMLButtonElement>;
}

export function DashboardHiddenBadge({
  lang, count, open, onOpenChange, isDragging, dropProps, trayId, badgeRef,
}: DashboardHiddenBadgeProps) {
  if (count === 0 && !isDragging) return null;
  const name = tPlural(lang, "dashboardHiddenTilesBadge", count, count);
  return (
    <IconButton
      ref={badgeRef}
      variant="bordered"
      size="md"
      label={name}
      title={name}
      aria-expanded={open}
      aria-controls={trayId}
      onClick={() => onOpenChange(!open)}
      // ★ Guarded on `isDragging`, so a stray dragEnter (a file dragged over
      // the window) cannot pop the tray open.
      onDragEnter={() => { if (isDragging) onOpenChange(true); }}
      {...dropProps}
    >
      <span className="inline-flex h-4 min-w-4 items-center justify-center text-xs font-semibold tabular-nums">
        {count}
      </span>
    </IconButton>
  );
}
