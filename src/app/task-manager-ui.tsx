"use client";
import type React from "react";
import { type SortDir, type SortKey } from "./filters-context";
import { type Lang, t } from "./i18n";

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
    ? "border-AIPM-green text-AIPM-dark-blue dark:border-AIPM-green dark:text-AIPM-light-grey"
    : "border-transparent text-muted-foreground hover:text-AIPM-dark-blue";
  return (
    <div
      className={`-mb-px inline-flex items-stretch rounded-t-md border-b-2 transition-colors ${colorClass}`}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        aria-controls={controls}
        onClick={onClick}
        className={`py-2 pl-4 text-sm font-medium ${onPopout ? "pr-1" : "pr-4"}`}
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
          className="rounded-tr-md px-1.5 py-2 opacity-50 hover:opacity-100 focus-visible:opacity-100"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-3.5 w-3.5"
          >
            <path d="M9.5 2.5h4v4" />
            <path d="m13.5 2.5-5.5 5.5" />
            <path d="M11 9v2.5A1.5 1.5 0 0 1 9.5 13H4A1.5 1.5 0 0 1 2.5 11.5V6A1.5 1.5 0 0 1 4 4.5h2.5" />
          </svg>
        </button>
      )}
    </div>
  );
}

export function ResetSizeIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-4 w-4"
    >
      {/* center square */}
      <rect x="8.5" y="8.5" width="3" height="3" fill="currentColor" stroke="none" />
      {/* top arrow — shaft + head pointing down toward center */}
      <line x1="10" y1="2" x2="10" y2="6.5" />
      <polyline points="8,4.5 10,6.5 12,4.5" />
      {/* bottom arrow — shaft + head pointing up toward center */}
      <line x1="10" y1="18" x2="10" y2="13.5" />
      <polyline points="8,15.5 10,13.5 12,15.5" />
      {/* left arrow — shaft + head pointing right toward center */}
      <line x1="2" y1="10" x2="6.5" y2="10" />
      <polyline points="4.5,8 6.5,10 4.5,12" />
      {/* right arrow — shaft + head pointing left toward center */}
      <line x1="18" y1="10" x2="13.5" y2="10" />
      <polyline points="15.5,8 13.5,10 15.5,12" />
    </svg>
  );
}

export function ResetColWidthsIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-4 w-4"
    >
      {/* column fill between the two guide lines */}
      <rect x="7" y="3" width="6" height="14" fill="currentColor" fillOpacity="0.15" stroke="none" />
      {/* left vertical guide line */}
      <line x1="7" y1="3" x2="7" y2="17" />
      {/* right vertical guide line */}
      <line x1="13" y1="3" x2="13" y2="17" />
      {/* left arrow — shaft + head pointing right toward left guide line */}
      <line x1="1.5" y1="10" x2="5.5" y2="10" />
      <polyline points="5.5,8.5 7,10 5.5,11.5" />
      {/* right arrow — shaft + head pointing left toward right guide line */}
      <line x1="18.5" y1="10" x2="14.5" y2="10" />
      <polyline points="14.5,8.5 13,10 14.5,11.5" />
    </svg>
  );
}

export function EraserIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-4 w-4"
    >
      <g transform="rotate(-30, 10, 10)">
        {/* tip — left portion with rounded left corners, filled */}
        <path
          d="M2 9.5 Q2 7 4 7 L7.5 7 L7.5 13 L4 13 Q2 13 2 10.5 Z"
          fill="currentColor"
          fillOpacity="0.35"
          stroke="none"
        />
        {/* eraser body outline */}
        <rect x="2" y="7" width="16" height="6" rx="2" />
        {/* dividing band between tip and body */}
        <line x1="7.5" y1="7" x2="7.5" y2="13" />
      </g>
    </svg>
  );
}

function PrinterIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-4 w-4"
    >
      <rect x="5" y="2.5" width="10" height="5" />
      <rect x="3" y="7.5" width="14" height="7" rx="1" />
      <rect x="5" y="11" width="10" height="6.5" />
      <line x1="5" y1="13" x2="15" y2="13" />
    </svg>
  );
}

/** Drag handle on the right edge of a <th>. Host th MUST be `relative`. */
export function ColumnResizeHandle({
  col,
  onMouseDown,
}: {
  col: string;
  onMouseDown: (col: string, e: React.MouseEvent) => void;
}) {
  return (
    <div
      aria-hidden="true"
      onMouseDown={(e) => onMouseDown(col, e)}
      className="absolute right-0 top-0 h-full w-1 cursor-col-resize select-none hover:bg-white/30 print:hidden"
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

export function SortableTh({
  label,
  sortKey,
  currentKey,
  dir,
  onClick,
  onResize,
  lang,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  onResize?: (e: React.MouseEvent) => void;
  lang: Lang;
}) {
  const isActive = currentKey === sortKey;
  const indicator = isActive ? (dir === "asc" ? "↑" : "↓") : "";
  return (
    <th className="relative px-4 py-2 font-medium">
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        title={t(lang, "sortBy", label)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-AIPM-green-strong ${isActive ? "text-AIPM-green-strong" : ""}`}
      >
        {label}
        <span aria-hidden className="text-[0.65rem]">
          {indicator}
        </span>
      </button>
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
    <button
      type="button"
      onClick={onClick}
      aria-label={t(lang, "colResetWidthsHint")}
      title={t(lang, "colResetWidthsHint")}
      className="rounded-md border border-line bg-surface p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
    >
      <ResetColWidthsIcon />
    </button>
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
      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted print:hidden"
    >
      <PrinterIcon />
      {t(lang, "print")}
    </button>
  );
}

/** Inert bottom-right corner glyph hinting the pane is drag-resizable. The real
 *  resize is the native CSS `resize` handle; this is a visual cue only. */
export function ResizeCornerHint({ lang }: { lang: Lang }) {
  return (
    <span
      aria-hidden={true}
      title={t(lang, "tableResizeHint")}
      className="pointer-events-none absolute bottom-1 right-1 select-none text-muted-foreground"
    >
      ⠿
    </span>
  );
}

/** Icon button that resets a pane's user-dragged size back to the fill default. */
export function ResetSizeButton({
  onClick,
  lang,
  className,
}: {
  onClick: () => void;
  lang: Lang;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t(lang, "tableResetSizeHint")}
      title={t(lang, "tableResetSizeHint")}
      className={`rounded-md border border-line bg-surface p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground ${className ?? ""}`}
    >
      <ResetSizeIcon />
    </button>
  );
}
