"use client";

import type React from "react";
import { useCallback, useMemo } from "react";
import { type Lang, t } from "./i18n";
import {
  PrintButton,
  ResetColWidthsButton,
  ResetSizeButton,
} from "./task-manager-ui";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { INTERACTIVE } from "./interaction-styles";
import { InfoTooltip } from "./info-tooltip";

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

export function SortHeaderButton({
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

export function Tile({
  label, value, rag, trend, onActivate, activateLabel,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  rag?: React.ReactNode;
  trend?: React.ReactNode;
  onActivate?: () => void;
  activateLabel?: string;
}) {
  const inner = (
    <>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center justify-between gap-1.5 text-xl font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey tabular-nums">
        <span>{value}</span>
        {rag}
      </div>
      {trend ? <div className="mt-1">{trend}</div> : null}
    </>
  );
  if (onActivate) {
    return (
      <button
        type="button"
        aria-label={activateLabel}
        onClick={onActivate}
        className={`w-full rounded-lg border border-line bg-surface p-3 text-left shadow-[var(--shadow-card)] hover:border-AIPM-dark-blue hover:bg-surface-muted ${INTERACTIVE}`}
      >
        {inner}
      </button>
    );
  }
  return <div className="rounded-lg border border-line bg-surface p-3 shadow-[var(--shadow-card)]">{inner}</div>;
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
    <div className="rounded-lg border border-line bg-surface p-4 shadow-[var(--shadow-card)]">{body}</div>
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
  title,
  children,
}: {
  lang: Lang;
  sizeRef: React.RefObject<HTMLDivElement | null>;
  onResetSize: () => void;
  onResetCols?: () => void;
  toolbarExtra?: React.ReactNode;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div ref={sizeRef} className={`print-root print-landscape ${VIEW_PANE_RESIZABLE_CLASS}`}>
      <div className={`mb-2 flex shrink-0 items-center gap-2 ${title ? "justify-between" : "justify-end"}`}>
        {title && <h2 className="text-lg font-medium text-foreground">{title}</h2>}
        <div className="flex items-center gap-2 print:hidden">
          {toolbarExtra}
          <PrintButton lang={lang} />
          {onResetCols && <ResetColWidthsButton onClick={onResetCols} lang={lang} />}
          <ResetSizeButton onClick={onResetSize} lang={lang} />
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-2">{children}</div>
    </div>
  );
}
