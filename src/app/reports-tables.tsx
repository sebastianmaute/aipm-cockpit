// src/app/reports-tables.tsx — presentational table + tile sub-components for
// the Reports view, plus the shared column-width constants and sort-key types
// the panel threads in. GanttPanel-style split: ReportsPanel owns the data,
// sort state, and column-resize state; these render it.
import { useCallback } from "react";
import {
  useSortableFilter,
  TableFilter,
  SortHeaderButton,
  type SortDir,
} from "./report-table";
import { ColumnResizeHandle } from "./task-manager-ui";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { type Lang, t } from "./i18n";
import { EmptyState } from "./empty-state";
import { type GroupOrLabelRow, type Stats } from "./reports-stats";

export const REPORTS_INQUIRY_COL_WIDTHS = {
  id: 60,
  task: 260,
  count: 90,
} as const;
export type ReportsInquiryCol = keyof typeof REPORTS_INQUIRY_COL_WIDTHS;

export const REPORTS_ASSIGNEE_COL_WIDTHS = {
  assignee: 160,
  total: 90,
  open: 90,
  overdue: 90,
  onTime: 90,
  late: 90,
  inquiries: 90,
} as const;
export type ReportsAssigneeCol = keyof typeof REPORTS_ASSIGNEE_COL_WIDTHS;

export const REPORTS_BY_X_COL_WIDTHS = {
  label: 180,
  total: 90,
  open: 90,
  completed: 90,
  overdue: 90,
  inquiries: 90,
} as const;
export type ReportsByXCol = keyof typeof REPORTS_BY_X_COL_WIDTHS;

export type AssigneeSortKey = "assignee" | "total" | "open" | "overdue" | "onTime" | "late" | "inquiries";
export type AssigneeSort = { key: AssigneeSortKey; dir: SortDir };

export type GroupOrLabelSortKey = "name" | "total" | "open" | "completed" | "overdue" | "inquiries";
export type GroupOrLabelSort = { key: GroupOrLabelSortKey; dir: SortDir };

// Sortable/resizable header cell shared by both report tables below. The name
// column omits `align`; numeric columns pass `align="right"`.
function SortTh({
  col,
  label,
  align,
  width,
  active,
  dir,
  onClick,
  onStartResize,
}: {
  col: string;
  label: string;
  align?: "right";
  width: number;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  onStartResize: (col: string, e: React.MouseEvent) => void;
}) {
  return (
    <th
      className={align === "right" ? "relative px-3 py-2 text-right" : "relative px-3 py-2"}
      style={{ width, minWidth: width }}
    >
      <SortHeaderButton label={label} active={active} dir={dir} onClick={onClick} />
      <ColumnResizeHandle col={col} onMouseDown={onStartResize} />
    </th>
  );
}

// The "no rows match the filter" body row shared by both report tables.
function NoMatchesRow({ lang, colSpan }: { lang: Lang; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-3 text-center text-xs text-muted-foreground">
        {t(lang, "reportsNoMatches")}
      </td>
    </tr>
  );
}

export function GroupOrLabelTable({
  rows,
  lang,
  headerKey,
  emptyKey,
  colWidths,
  onStartResize,
  sort,
  setSort,
  filter,
  setFilter,
  filterPlaceholderKey,
}: {
  rows: GroupOrLabelRow[];
  lang: Lang;
  headerKey: "group" | "labels";
  emptyKey: "reportsNoGroups" | "reportsNoLabels";
  colWidths: Record<string, number>;
  onStartResize: (col: string, e: React.MouseEvent) => void;
  sort: GroupOrLabelSort;
  setSort: (s: GroupOrLabelSort) => void;
  filter: string;
  setFilter: (v: string) => void;
  filterPlaceholderKey: "reportsFilterGroup" | "reportsFilterLabel";
}) {
  const getValue = useCallback(
    (r: GroupOrLabelRow, k: GroupOrLabelSortKey): string | number =>
      k === "name" ? r.name : (r[k as Exclude<GroupOrLabelSortKey, "name">] ?? 0),
    [],
  );
  const { sorted, click } = useSortableFilter(rows, sort, setSort, filter, getValue);

  if (rows.length === 0) {
    return <EmptyState compact title={t(lang, emptyKey)} />;
  }

  return (
    <div>
      <TableFilter lang={lang} value={filter} onChange={setFilter} placeholderKey={filterPlaceholderKey} />
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="min-w-full text-left text-xs">
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              <SortTh
                col="label"
                label={t(lang, headerKey)}
                width={colWidths.label}
                active={sort.key === "name" && sort.dir !== "off"}
                dir={sort.dir}
                onClick={() => click("name")}
                onStartResize={onStartResize}
              />
              {(["total", "open", "completed", "overdue", "inquiries"] as const).map((k) => {
                const labelKey = {
                  total: "reportsTotal",
                  open: "reportsOpen",
                  completed: "reportsCompleted",
                  overdue: "reportsOverdue",
                  inquiries: "reportsInquiriesCol",
                } as const;
                return (
                  <SortTh
                    key={k}
                    col={k}
                    align="right"
                    label={t(lang, labelKey[k])}
                    width={colWidths[k]}
                    active={sort.key === k && sort.dir !== "off"}
                    dir={sort.dir}
                    onClick={() => click(k)}
                    onStartResize={onStartResize}
                  />
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.length === 0 && filter !== "" ? (
              <NoMatchesRow lang={lang} colSpan={6} />
            ) : (
              sorted.map((row) => (
                <tr key={row.name}>
                  <td className="px-3 py-2 font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey">{row.name}</td>
                  <td className="px-3 py-2 text-right">{row.total}</td>
                  <td className="px-3 py-2 text-right">{row.open}</td>
                  <td className="px-3 py-2 text-right text-[var(--rag-green-text)]">{row.completed}</td>
                  <td className={`px-3 py-2 text-right ${row.overdue > 0 ? "text-[var(--rag-red-text)] font-semibold" : ""}`}>{row.overdue}</td>
                  <td className="px-3 py-2 text-right">{row.inquiries}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AssigneeTable({
  rows,
  lang,
  colWidths,
  onStartResize,
  sort,
  setSort,
  filter,
  setFilter,
}: {
  rows: Stats["byAssignee"];
  lang: Lang;
  colWidths: Record<ReportsAssigneeCol, number>;
  onStartResize: (col: string, e: React.MouseEvent) => void;
  sort: AssigneeSort;
  setSort: (s: AssigneeSort) => void;
  filter: string;
  setFilter: (v: string) => void;
}) {
  const getValue = useCallback(
    (r: Stats["byAssignee"][number], k: AssigneeSortKey): string | number =>
      k === "assignee" ? r.name : (r[k as Exclude<AssigneeSortKey, "assignee">] ?? 0),
    [],
  );
  const { sorted, click } = useSortableFilter(rows, sort, setSort, filter, getValue);

  return (
    <div>
      {rows.length > 0 && (
        <TableFilter lang={lang} value={filter} onChange={setFilter} placeholderKey="reportsFilterAssignee" />
      )}
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="min-w-full text-left text-xs">
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              <SortTh
                col="assignee"
                label={t(lang, "assignee")}
                width={colWidths.assignee}
                active={sort.key === "assignee" && sort.dir !== "off"}
                dir={sort.dir}
                onClick={() => click("assignee")}
                onStartResize={onStartResize}
              />
              {(["total", "open", "overdue", "onTime", "late", "inquiries"] as const).map((k) => {
                const labelKey = {
                  total: "reportsTotal",
                  open: "reportsOpen",
                  overdue: "reportsOverdue",
                  onTime: "reportsCompletedOnTime",
                  late: "reportsCompletedLate",
                  inquiries: "reportsInquiriesCol",
                } as const;
                return (
                  <SortTh
                    key={k}
                    col={k}
                    align="right"
                    label={t(lang, labelKey[k])}
                    width={colWidths[k]}
                    active={sort.key === k && sort.dir !== "off"}
                    dir={sort.dir}
                    onClick={() => click(k)}
                    onStartResize={onStartResize}
                  />
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.length === 0 && filter !== "" ? (
              <NoMatchesRow lang={lang} colSpan={7} />
            ) : (
              sorted.map((row) => (
                <tr key={row.name}>
                  <td className="px-3 py-2 font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey">{row.name}</td>
                  <td className="px-3 py-2 text-right">{row.total}</td>
                  <td className="px-3 py-2 text-right">{row.open}</td>
                  <td className={`px-3 py-2 text-right ${row.overdue > 0 ? "text-[var(--rag-red-text)] font-semibold" : ""}`}>{row.overdue}</td>
                  <td className="px-3 py-2 text-right text-[var(--rag-green-text)]">{row.onTime}</td>
                  <td className="px-3 py-2 text-right text-[var(--rag-red-text)]">{row.late}</td>
                  <td className="px-3 py-2 text-right">{row.inquiries}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Tile({
  label,
  value,
  danger,
}: {
  label: string;
  value: number | string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-semibold ${danger ? "text-[var(--rag-red-text)]" : "text-AIPM-dark-blue dark:text-AIPM-light-grey"}`}
      >
        {value}
      </p>
    </div>
  );
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
        {title}
      </h3>
      {children}
    </div>
  );
}

export function StackedBar({
  segments,
  total,
  emptyText,
}: {
  segments: Array<{ value: number; color: string; label: string }>;
  total: number;
  emptyText?: string;
}) {
  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {emptyText ?? "—"}
      </p>
    );
  }
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-muted">
        {segments.map((s, i) =>
          s.value > 0 ? (
            <div
              key={i}
              className={`${s.color} h-full`}
              style={{ width: `${(s.value / total) * 100}%` }}
              title={`${s.label}: ${s.value}`}
            />
          ) : null,
        )}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {segments.map((s, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={`inline-block h-2 w-2 rounded-full ${s.color}`}
            />
            {s.label}: <span className="font-medium">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
