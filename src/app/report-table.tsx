"use client";

import type React from "react";
import { useCallback, useMemo } from "react";
import { type Lang, t } from "./i18n";
import {
  PrintButton,
  ResetColWidthsButton,
  ResetSizeButton,
  ResizeCornerHint,
} from "./task-manager-ui";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";

export type SortDir = "asc" | "desc" | "off";

/** Compare two values for sort: numeric diff for numbers, localeCompare for strings. */
export function compareStrOrNum(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""));
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
      setSort({
        key: sort.key,
        dir: sort.dir === "asc" ? "desc" : sort.dir === "desc" ? "off" : "asc",
      });
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
  placeholderKey: "reportsFilterAssignee" | "reportsFilterGroup" | "reportsFilterLabel" | "raidReportFilterOwner" | "raidReportFilterDetail" | "budgetReportFilterBucket";
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
          className="rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-muted-foreground hover:bg-surface-muted hover:text-foreground"
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
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  const indicator = active ? (dir === "asc" ? " ↑" : " ↓") : "";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 ${active ? "text-AIPM-green" : ""} hover:text-AIPM-green`}
    >
      {label}
      {indicator}
    </button>
  );
}

export function Tile({ label, value, rag }: { label: string; value: string; rag?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 flex items-center justify-between gap-1.5 text-xl font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey tabular-nums">
        <span>{value}</span>
        {rag}
      </p>
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
    <div className="rounded-lg border border-line bg-surface p-4">{body}</div>
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
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto">{children}</div>
      <ResizeCornerHint lang={lang} />
    </div>
  );
}
