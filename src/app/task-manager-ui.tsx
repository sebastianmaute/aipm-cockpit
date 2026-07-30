"use client";
import {
  ArrowsPointingInIcon,
  ArrowTopRightOnSquareIcon,
  BackspaceIcon,
  PrinterIcon as PrinterHeroIcon,
  ViewColumnsIcon,
} from "@heroicons/react/24/outline";
import type React from "react";
import { type Lang, type TranslationKey, t } from "./i18n";
import { FOCUS_RING, INTERACTIVE } from "./interaction-styles";
import { IconButton } from "./icon-button";
import { DragHandle } from "./drag-handle";

export function TabButton({
  active,
  onClick,
  controls,
  children,
  onPopout,
  popoutLabel,
}: {
  active: boolean;
  onClick: () => void;
  controls: string;
  children: React.ReactNode;
  onPopout?: () => void;
  popoutLabel?: string;
}) {
  // Active/hover colors are applied to the wrapping flex row so the active
  // border-b-2 indicator spans both the label and the popout icon.
  const colorClass = active
    ? "border-ui-green text-ui-dark-blue dark:border-ui-green dark:text-ui-light-grey"
    : "border-transparent text-muted-foreground hover:text-ui-dark-blue";
  return (
    <div
      className={`-mb-px inline-flex items-stretch rounded-t-md border-b-2 transition-colors ${colorClass}`}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        aria-controls={controls}
        // NOTE: intentionally NO roving tabindex here. This strip can render
        // while the app's active view is not one of its own tabs (classic
        // layout shows it for every view), so `active ? 0 : -1` would leave the
        // whole tablist with zero Tab-stops → keyboard-unreachable. Tabs stay
        // natively tabbable; arrow keys still rove via `useTablistRoving`.
        onClick={onClick}
        className={`py-2 pl-4 text-sm font-medium ${FOCUS_RING} ${onPopout ? "pr-1" : "pr-4"}`}
      >
        {children}
      </button>
      {onPopout && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPopout();
          }}
          aria-label={popoutLabel}
          title={popoutLabel}
          className={`rounded-tr-md px-1.5 py-2 opacity-50 transition-opacity hover:opacity-100 focus-visible:opacity-100 ${FOCUS_RING}`}
        >
          <ArrowTopRightOnSquareIcon aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function ResetSizeIcon() {
  return <ArrowsPointingInIcon aria-hidden="true" className="h-4 w-4" />;
}

export function ResetColWidthsIcon() {
  return <ViewColumnsIcon aria-hidden="true" className="h-4 w-4" />;
}

export function EraserIcon() {
  return <BackspaceIcon aria-hidden="true" className="h-4 w-4" />;
}

function PrinterIcon() {
  return <PrinterHeroIcon aria-hidden="true" className="h-4 w-4" />;
}

/** Drag handle on the right edge of a <th>. Host th MUST be `relative`.
 *  Always-visible ⋮ grip so the resize anchor is discoverable at rest; it
 *  brightens to the table-head accent on hover and during the drag. (CSS
 *  `:active` holds from mousedown to mouseup even after the pointer leaves
 *  the element, so the drag-time accent needs no React state.) Decorative —
 *  resize is a mouse enhancement; columns stay usable and ResetColWidths exists. */
export function ColumnResizeHandle({
  col,
  onMouseDown,
}: {
  col: string;
  onMouseDown: (col: string, e: React.MouseEvent) => void;
}) {
  return (
    <DragHandle
      onMouseDown={(e) => onMouseDown(col, e)}
      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize text-table-head-fg/40 hover:bg-table-head-accent/10 hover:text-table-head-accent active:text-table-head-accent"
    />
  );
}

export function Th({
  children,
  onResize,
}: {
  children: React.ReactNode;
  onResize?: (e: React.MouseEvent) => void;
}) {
  return (
    <th className="relative px-4 py-2 font-medium">
      {children}
      {onResize && (
        <ColumnResizeHandle col="" onMouseDown={(_col, e) => onResize(e)} />
      )}
    </th>
  );
}

export function ResetColWidthsButton({
  onClick,
  lang,
}: {
  onClick: () => void;
  lang: Lang;
}) {
  return (
    <IconButton
      variant="bordered"
      size="md"
      onClick={onClick}
      label={t(lang, "colResetWidthsHint")}
      title={t(lang, "colResetWidthsHint")}
    >
      <ResetColWidthsIcon />
    </IconButton>
  );
}

export function PrintButton({
  onClick,
  lang,
}: {
  onClick?: () => void;
  lang: Lang;
}) {
  return (
    <button
      type="button"
      onClick={onClick ?? (() => window.print())}
      aria-label={t(lang, "printHint")}
      title={t(lang, "printHint")}
      className={`inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-ui-dark-blue hover:bg-surface-muted print:hidden ${INTERACTIVE}`}
    >
      <PrinterIcon />
    </button>
  );
}

/** Icon button that resets a pane's user-dragged size back to the fill default. */
export function ResetSizeButton({
  onClick,
  lang,
  className,
  labelKey = "tableResetSizeHint",
}: {
  onClick: () => void;
  lang: Lang;
  className?: string;
  /** Override the accessible name. A FLOATING surface that can sit over a pane
   *  must not reuse the pane's own reset label — two buttons with an identical
   *  accessible name doing different things is a WCAG 2.4.6 failure that axe
   *  passes (a name exists). Mirrors `modal-header`'s `modalResetSize`. */
  labelKey?: TranslationKey;
}) {
  return (
    <IconButton
      variant="bordered"
      size="md"
      onClick={onClick}
      label={t(lang, labelKey)}
      title={t(lang, labelKey)}
      className={className}
    >
      <ResetSizeIcon />
    </IconButton>
  );
}
