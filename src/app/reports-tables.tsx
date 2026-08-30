// src/app/reports-tables.tsx — presentational table + tile sub-components for
// the Reports view, plus the shared column-width constants and sort-key types
// the panel threads in. GanttPanel-style split: ReportsPanel owns the data,
// sort state, and column-resize state; these render it.
import { useCallback } from "react";
import {
  useSortableFilter,
  TableFilter,
  SortResizeTh,
  useSortHeaderProps,
  type SortDir,
} from "./report-table";
import { type Lang, t } from "./i18n";
import { DataTable } from "./data-table";
import { EmptyState } from "./empty-state";
import { ProgressTrack } from "./progress-track";
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
  cancelled: 90,
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
  cancelled: 90,
  overdue: 90,
  inquiries: 90,
} as const;
export type ReportsByXCol = keyof typeof REPORTS_BY_X_COL_WIDTHS;

export type AssigneeSortKey = "assignee" | "total" | "open" | "cancelled" | "overdue" | "onTime" | "late" | "inquiries";
export type AssigneeSort = { key: AssigneeSortKey; dir: SortDir };

export type GroupOrLabelSortKey = "name" | "total" | "open" | "completed" | "cancelled" | "overdue" | "inquiries";
export type GroupOrLabelSort = { key: GroupOrLabelSortKey; dir: SortDir };

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

// Right-aligned numeric header columns per report table (own key list + i18n
// label). Rendered through the shared SortResizeTh (design-system dedup — the
// former local SortTh clone + NumericSortThs helper were removed).
const GROUP_NUMERIC_COLS: readonly { key: GroupOrLabelSortKey; labelKey: Parameters<typeof t>[1] }[] = [
  { key: "total", labelKey: "reportsTotal" },
  { key: "open", labelKey: "reportsOpen" },
  { key: "completed", labelKey: "reportsCompleted" },
  { key: "cancelled", labelKey: "reportsCancelled" },
  { key: "overdue", labelKey: "reportsOverdue" },
  { key: "inquiries", labelKey: "reportsInquiriesCol" },
];

const ASSIGNEE_NUMERIC_COLS: readonly { key: AssigneeSortKey; labelKey: Parameters<typeof t>[1] }[] = [
  { key: "total", labelKey: "reportsTotal" },
  { key: "open", labelKey: "reportsOpen" },
  { key: "cancelled", labelKey: "reportsCancelled" },
  { key: "overdue", labelKey: "reportsOverdue" },
  { key: "onTime", labelKey: "reportsCompletedOnTime" },
  { key: "late", labelKey: "reportsCompletedLate" },
  { key: "inquiries", labelKey: "reportsInquiriesCol" },
];

export function GroupOrLabelTable({
  rows,
  lang,
  nameContext,
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
  /** The table's own visible heading, appended to each sortable header's
   *  accessible name by `SortResizeTh` (which joins it as
   *  `` `${label} – ${nameContext}` `` — pass the CONTEXT alone, never a
   *  pre-joined string).
   *
   *  ★★ REQUIRED rather than optional so `tsc` is the completeness check.
   *  `reports.tsx` renders this component twice and `AssigneeTable` once, all
   *  three as siblings reusing the SAME generic column labels ("Open",
   *  "Total", "Overdue"…) — so a call site that forgot to pass a context IS
   *  the §246 defect, and the axe gate cannot see it: no axe rule under any
   *  tag `e2e/a11y.spec.ts` requests flags two controls sharing an accessible
   *  name. Optional here would leave that call site silently un-updated. */
  nameContext: string;
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
  const th = useSortHeaderProps(sort.key, sort.dir, click, onStartResize);

  if (rows.length === 0) {
    return <EmptyState compact title={t(lang, emptyKey)} />;
  }

  return (
    <div>
      <TableFilter lang={lang} value={filter} onChange={setFilter} placeholderKey={filterPlaceholderKey} />
      <div className="overflow-x-auto rounded-md border border-line">
        <DataTable
          className="min-w-full text-left text-xs"
          head={
            <tr>
              <SortResizeTh
                {...th}
                label={t(lang, headerKey)}
                nameContext={nameContext}
                sortCol="name"
                resizeCol="label"
                width={colWidths.label}
              />
              {GROUP_NUMERIC_COLS.map(({ key, labelKey }) => (
                <SortResizeTh
                  {...th}
                  key={key}
                  label={t(lang, labelKey)}
                  nameContext={nameContext}
                  sortCol={key}
                  width={colWidths[key]}
                  align="right"
                />
              ))}
            </tr>
          }
          tbodyClassName="divide-y divide-line"
        >
            {sorted.length === 0 && filter !== "" ? (
              <NoMatchesRow lang={lang} colSpan={7} />
            ) : (
              sorted.map((row) => (
                <tr key={row.name}>
                  <td className="px-3 py-2 font-medium text-ui-dark-blue dark:text-ui-light-grey">{row.name}</td>
                  <td className="px-3 py-2 text-right">{row.total}</td>
                  <td className="px-3 py-2 text-right">{row.open}</td>
                  <td className="px-3 py-2 text-right text-[var(--rag-green-text)]">{row.completed}</td>
                  {/* Muted, not a RAG token: cancelled is neither good nor bad news. */}
                  <td className="px-3 py-2 text-right text-muted-foreground">{row.cancelled}</td>
                  <td className={`px-3 py-2 text-right ${row.overdue > 0 ? "text-[var(--rag-red-text)] font-semibold" : ""}`}>{row.overdue}</td>
                  <td className="px-3 py-2 text-right">{row.inquiries}</td>
                </tr>
              ))
            )}
        </DataTable>
      </div>
    </div>
  );
}

export function AssigneeTable({
  rows,
  lang,
  nameContext,
  colWidths,
  onStartResize,
  sort,
  setSort,
  filter,
  setFilter,
}: {
  rows: Stats["byAssignee"];
  lang: Lang;
  /** The table's own visible heading. REQUIRED — see the prop of the same name
   *  on `GroupOrLabelTable` above for why, and for the join the primitive does. */
  nameContext: string;
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
  const th = useSortHeaderProps(sort.key, sort.dir, click, onStartResize);

  return (
    <div>
      {rows.length > 0 && (
        <TableFilter lang={lang} value={filter} onChange={setFilter} placeholderKey="reportsFilterAssignee" />
      )}
      <div className="overflow-x-auto rounded-md border border-line">
        <DataTable
          className="min-w-full text-left text-xs"
          head={
            <tr>
              <SortResizeTh
                {...th}
                label={t(lang, "assignee")}
                nameContext={nameContext}
                sortCol="assignee"
                width={colWidths.assignee}
              />
              {ASSIGNEE_NUMERIC_COLS.map(({ key, labelKey }) => (
                <SortResizeTh
                  {...th}
                  key={key}
                  label={t(lang, labelKey)}
                  nameContext={nameContext}
                  sortCol={key}
                  width={colWidths[key]}
                  align="right"
                />
              ))}
            </tr>
          }
          tbodyClassName="divide-y divide-line"
        >
            {sorted.length === 0 && filter !== "" ? (
              <NoMatchesRow lang={lang} colSpan={8} />
            ) : (
              sorted.map((row) => (
                <tr key={row.name}>
                  <td className="px-3 py-2 font-medium text-ui-dark-blue dark:text-ui-light-grey">{row.name}</td>
                  <td className="px-3 py-2 text-right">{row.total}</td>
                  <td className="px-3 py-2 text-right">{row.open}</td>
                  {/* Muted, not a RAG token: cancelled is neither good nor bad news. */}
                  <td className="px-3 py-2 text-right text-muted-foreground">{row.cancelled}</td>
                  <td className={`px-3 py-2 text-right ${row.overdue > 0 ? "text-[var(--rag-red-text)] font-semibold" : ""}`}>{row.overdue}</td>
                  <td className="px-3 py-2 text-right text-[var(--rag-green-text)]">{row.onTime}</td>
                  <td className="px-3 py-2 text-right text-[var(--rag-red-text)]">{row.late}</td>
                  <td className="px-3 py-2 text-right">{row.inquiries}</td>
                </tr>
              ))
            )}
        </DataTable>
      </div>
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
      <ProgressTrack height="h-3" className="flex">
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
      </ProgressTrack>
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
