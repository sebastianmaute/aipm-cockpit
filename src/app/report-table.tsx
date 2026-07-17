"use client";

import type React from "react";
import { useCallback, useMemo } from "react";
import { type Lang, t } from "./i18n";
import {
  ColumnResizeHandle,
  PrintButton,
  ResetColWidthsButton,
  ResetSizeButton,
} from "./task-manager-ui";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { INTERACTIVE } from "./interaction-styles";
import { InfoTooltip } from "./info-tooltip";
import { Card } from "./card";

export type SortDir = "asc" | "desc" | "off";

/** Compare two values for sort: numeric diff for numbers, localeCompare for strings. */
export function compareStrOrNum(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""));
}

/** Cycle a sort direction on repeated header clicks: asc -> desc -> off -> asc. */
export function nextSortDir(dir: SortDir): SortDir {
  return dir === "asc" ? "desc" : dir === "desc" ? "off" : "asc";
}

/**
 * Shared filter + sort + sort-cycle logic for the report tables. The only thing
 * that differs between tables is how a row + sort key map to a comparable value,
 * which the caller supplies via a (memoized) `getValue`.
 */
export function useSortableFilter<Row extends { name: string }, Key extends string>(
  rows: readonly Row[],
  sort: { key: Key; dir: SortDir },
  setSort: (s: { key: Key; dir: SortDir }) => void,
  filter: string,
  getValue: (row: Row, key: Key) => string | number,
) {
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, filter]);

  const sorted = useMemo(() => {
    if (sort.dir === "off") return filtered;
    const arr = filtered.slice().sort((a, b) => {
      const c = compareStrOrNum(getValue(a, sort.key), getValue(b, sort.key));
      return c !== 0 ? c : a.name.localeCompare(b.name);
    });
    if (sort.dir === "desc") arr.reverse();
    return arr;
  }, [filtered, sort, getValue]);

  const click = useCallback(
    (k: Key) => {
      if (k !== sort.key) {
        setSort({ key: k, dir: "asc" });
        return;
      }
      setSort({ key: sort.key, dir: nextSortDir(sort.dir) });
    },
    [sort.key, sort.dir, setSort],
  );

  return { sorted, click };
}

export function TableFilter({
  lang,
  value,
  onChange,
  placeholderKey,
}: {
  lang: Lang;
  value: string;
  onChange: (v: string) => void;
  placeholderKey: "reportsFilterAssignee" | "reportsFilterGroup" | "reportsFilterLabel" | "raidReportFilterOwner" | "raidReportFilterDetail" | "budgetReportFilterBucket" | "planningFilterResource" | "budgetRoleFilter";
}) {
  return (
    <div className="mb-2 flex items-center gap-2 print:hidden">
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t(lang, placeholderKey)}
        aria-label={t(lang, placeholderKey)}
        className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-AIPM-dark-blue focus:outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={t(lang, "clear")}
          title={t(lang, "clear")}
          className={`rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-muted-foreground hover:bg-surface-muted hover:text-foreground ${INTERACTIVE}`}
        >
          ×
        </button>
      )}
    </div>
  );
}

// Internal to SortResizeTh — the sort button + ↑↓ indicator (+ optional hint
// tooltip). Not exported: every panel now composes SortResizeTh, and SortableTh
// (task-manager-ui, the tasks table) deliberately keeps its own styled button.
function SortHeaderButton({
  label,
  active,
  dir,
  onClick,
  hint,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  /** Optional one-line explanation shown as an InfoTooltip beside the label. */
  hint?: string;
}) {
  const indicator = active ? (dir === "asc" ? " ↑" : " ↓") : "";
  const button = (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 ${active ? "text-[var(--table-head-accent)]" : ""} hover:text-[var(--table-head-accent)] ${INTERACTIVE}`}
    >
      {label}
      {indicator}
    </button>
  );
  if (!hint) return button;
  // InfoTooltip is a SIBLING of the sort button (not nested), so opening the
  // tooltip never triggers the column sort.
  return (
    <span className="inline-flex items-center gap-1">
      {button}
      <InfoTooltip text={hint} />
    </span>
  );
}

/**
 * A sortable + resizable data-table header cell: the
 * `<th>` + `SortHeaderButton` + `ColumnResizeHandle` trio that every report
 * panel repeated per column (the top cross-file jscpd clones, TD-6).
 *
 * `sortCol` drives the sort button (active/click); `resizeCol` (defaults to
 * `sortCol`) drives the resize handle + is the width key — they diverge on the
 * name/label column where the sort key differs from the stored width key.
 *
 * Header-cell abstractions, by domain: this `SortResizeTh` = generic REPORT
 * tables (own sort-state union per panel); `SortableTh` (task-manager-ui) = the
 * TASKS table (bound to its `SortKey`, takes `lang`); `Th` (task-manager-ui) =
 * a bare resizable cell with no sort button.
 */
export function SortResizeTh<K extends string>({
  label,
  sortCol,
  resizeCol,
  width,
  sortKey,
  sortDir,
  onSort,
  onResize,
  align = "left",
  hint,
}: {
  label: string;
  sortCol: K;
  /** Resize/width key; defaults to `sortCol`. */
  resizeCol?: string;
  width: number;
  /** The table's active sort key — also fixes `K` so `sortCol` must be valid. */
  sortKey: K;
  sortDir: SortDir;
  onSort: (col: K) => void;
  onResize: (col: string, e: React.MouseEvent) => void;
  align?: "left" | "right";
  hint?: string;
}) {
  return (
    <th
      className={
        align === "right"
          ? "relative px-3 py-2 text-right font-medium"
          : "relative px-3 py-2 font-medium"
      }
      style={{ width, minWidth: width }}
    >
      <SortHeaderButton
        label={label}
        active={sortKey === sortCol && sortDir !== "off"}
        dir={sortDir}
        onClick={() => onSort(sortCol)}
        hint={hint}
      />
      <ColumnResizeHandle col={resizeCol ?? sortCol} onMouseDown={onResize} />
    </th>
  );
}

/**
 * Canonical metric tile — the SINGLE Tile shared across the dashboard, reports,
 * resources report, portfolio + timelog panels (design-system Phase 1c dedup of
 * three near-identical local copies). Divergence between the old copies is
 * preserved via props, not by forcing one look:
 *  - `size`   → value font size (`"xl"` default; the reports summary tiles use
 *    `"2xl"`).
 *  - `danger` → red value text for a "bad" metric (the reports overdue tile).
 *  - `flat`   → suppress the elevation shadow (the plain report/resource tiles
 *    are intentionally un-elevated; the dashboard tiles are raised).
 */
export function Tile({
  label, value, rag, trend, bar, onActivate, activateLabel, hint,
  danger = false, size = "xl", flat = false,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  rag?: React.ReactNode;
  trend?: React.ReactNode;
  bar?: React.ReactNode;
  onActivate?: () => void;
  activateLabel?: string;
  /** Optional explanation shown as an InfoTooltip in the tile's corner. Rendered
   *  as a SIBLING of the (possibly clickable) tile, never nested inside the
   *  button — a tooltip trigger inside a button is a nested-interactive axe fail. */
  hint?: string;
  /** Red value text for a "bad" metric (e.g. an overdue count). */
  danger?: boolean;
  /** Value font size. Default `"xl"`; reports summary tiles use `"2xl"`. */
  size?: "xl" | "2xl";
  /** Suppress the elevation shadow (plain report/resource tiles have none). */
  flat?: boolean;
}) {
  const valueColor = danger
    ? "text-[var(--rag-red-text)]"
    : "text-AIPM-dark-blue dark:text-AIPM-light-grey";
  const sizeClass = size === "2xl" ? "text-2xl" : "text-xl";
  const inner = (
    <>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className={`mt-1 flex items-center justify-between gap-1.5 ${sizeClass} font-semibold ${valueColor} tabular-nums`}>
        <span>{value}</span>
        {rag}
      </div>
      {bar ? <div className="mt-1.5">{bar}</div> : null}
      {trend ? <div className="mt-1">{trend}</div> : null}
    </>
  );
  const tile = onActivate ? (
    <button
      type="button"
      aria-label={activateLabel}
      onClick={onActivate}
      className={`w-full rounded-lg border border-line bg-surface p-3 text-left${flat ? "" : " shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)]"} hover:border-AIPM-dark-blue hover:bg-surface-muted ${INTERACTIVE}`}
    >
      {inner}
    </button>
  ) : (
    <Card boxed={!flat} className="p-3">{inner}</Card>
  );
  if (!hint) return tile;
  return (
    <div className="relative h-full w-full">
      {tile}
      <span className="absolute right-2 top-2 z-10 print:hidden">
        <InfoTooltip text={hint} />
      </span>
    </div>
  );
}

/** Slim "more=better" completion gauge. Fill width tracks `percent` (0–100);
 *  the fill background is the `--gradient-kpi` role token (solid brand green under
 *  AIPM, red→amber→green gradient under mockup). The gradient token can only be
 *  applied via inline style — raw gradient utilities are palette-guard-banned. */
export function KpiGradientBar({ percent, label }: { percent: number; label: string }) {
  // Guard NaN before clamping: Math.round(NaN) === NaN survives Math.min/max and
  // would emit width:"NaN%" (invalid → fill collapses to 0). The `number` contract
  // admits NaN/±Infinity; ±Infinity clamp fine, NaN must fall back to 0.
  const safe = Number.isFinite(percent) ? percent : 0;
  const pct = Math.max(0, Math.min(100, Math.round(safe)));
  return (
    <div
      role="img"
      aria-label={`${label}: ${pct}%`}
      className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"
    >
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--gradient-kpi)" }} />
    </div>
  );
}

export function Section({
  title, children, boxed = false,
}: {
  title: string;
  children: React.ReactNode;
  boxed?: boolean;
}) {
  const body = (
    <>
      <h3 className="mb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{title}</h3>
      {children}
    </>
  );
  return boxed ? (
    <Card boxed padded>{body}</Card>
  ) : (
    <div>{body}</div>
  );
}

export function ReportCard({
  lang,
  sizeRef,
  onResetSize,
  onResetCols,
  toolbarExtra,
  leading,
  title,
  hideToolbar = false,
  children,
}: {
  lang: Lang;
  sizeRef: React.RefObject<HTMLDivElement | null>;
  onResetSize: () => void;
  onResetCols?: () => void;
  toolbarExtra?: React.ReactNode;
  /** Controls pinned to the LEFT of the toolbar (e.g. add/remove report). */
  leading?: React.ReactNode;
  title?: string;
  /** Suppress the whole top toolbar row — the caller renders its own
   *  Print/Reset controls inside the body (e.g. the Dashboard). */
  hideToolbar?: boolean;
  children: React.ReactNode;
}) {
  const hasLeft = !!title || !!leading;
  return (
    <div ref={sizeRef} className={`print-root print-landscape ${VIEW_PANE_RESIZABLE_CLASS}`}>
      {!hideToolbar && (
        <div className={`mb-2 flex shrink-0 items-center gap-2 ${hasLeft ? "justify-between" : "justify-end"}`}>
          {hasLeft && (
            <div className="flex items-center gap-2">
              {title && <h2 className="text-lg font-medium text-foreground">{title}</h2>}
              {leading && <div className="flex items-center gap-2 print:hidden">{leading}</div>}
            </div>
          )}
          <div className="flex items-center gap-2 print:hidden">
            {toolbarExtra}
            <PrintButton lang={lang} />
            {onResetCols && <ResetColWidthsButton onClick={onResetCols} lang={lang} />}
            <ResetSizeButton onClick={onResetSize} lang={lang} />
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-2">{children}</div>
    </div>
  );
}
