"use client";

import { useCallback, useMemo, useState } from "react";
import { SegmentedControl } from "./segmented-control";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { type Lang, t } from "./i18n";
import { ColumnResizeHandle } from "./task-manager-ui";
import { useColumnResize } from "./use-column-resize";
import { useResizable } from "./use-resizable";
import {
  ReportCard,
  Section,
  Tile,
  TableFilter,
  SortHeaderButton,
  useSortableFilter,
  type SortDir,
} from "./report-table";
import {
  UNASSIGNED_OWNER,
  computeRaidReport,
  type RaidReport,
} from "./raid-report";
import type { RaidItem } from "./types";

// ---------------------------------------------------------------------------
// Column-width default maps
// ---------------------------------------------------------------------------

const SEVERITY_COL_WIDTHS = {
  label: 140,
  risks: 70,
  assumptions: 100,
  issues: 70,
  dependencies: 110,
  total: 70,
} as const;
type SeverityCol = keyof typeof SEVERITY_COL_WIDTHS;

const STATUS_COL_WIDTHS = {
  label: 160,
  open: 70,
} as const;
type StatusCol = keyof typeof STATUS_COL_WIDTHS;

const OWNER_COL_WIDTHS = {
  label: 160,
  risks: 70,
  assumptions: 100,
  issues: 70,
  dependencies: 110,
  total: 70,
} as const;
type OwnerCol = keyof typeof OWNER_COL_WIDTHS;

const TOP_OPEN_COL_WIDTHS = {
  id: 50,
  category: 80,
  title: 220,
  severity: 80,
  owner: 120,
  age: 70,
} as const;
type TopOpenCol = keyof typeof TOP_OPEN_COL_WIDTHS;

const CATEGORY_COL_WIDTHS = {
  label: 140,
  open: 70,
  closed: 80,
  overdue: 90,
} as const;
type CategoryCol = keyof typeof CATEGORY_COL_WIDTHS;

const AGING_COL_WIDTHS = {
  label: 160,
  open: 70,
} as const;
type AgingCol = keyof typeof AGING_COL_WIDTHS;

const DETAIL_COL_WIDTHS = {
  id: 50,
  category: 80,
  title: 220,
  severity: 80,
  status: 110,
  owner: 120,
  raisedDate: 90,
  targetDate: 90,
  ageDays: 70,
  linkedTaskCount: 70,
} as const;
type DetailCol = keyof typeof DETAIL_COL_WIDTHS;

// ---------------------------------------------------------------------------
// Sort-key types for each table
// ---------------------------------------------------------------------------

type SeveritySortKey = "name" | "risks" | "assumptions" | "issues" | "dependencies" | "total";
type StatusSortKey = "name" | "open";
type OwnerSortKey = "name" | "risks" | "assumptions" | "issues" | "dependencies" | "total";
type TopOpenSortKey = "name" | "id" | "category" | "severity" | "owner" | "ageDays";
type CategorySortKey = "name" | "open" | "closed" | "overdue";
type DetailSortKey = "name" | "id" | "category" | "severity" | "status" | "owner" | "raisedDate" | "targetDate" | "ageDays" | "linkedTaskCount";

type SortState<K extends string> = { key: K; dir: SortDir };

// ---------------------------------------------------------------------------
// Props + component
// ---------------------------------------------------------------------------

interface Props {
  lang: Lang;
  items: readonly RaidItem[];
  today: string;
  embedded?: boolean;
}

type View = "summary" | "full";

export function RaidReportPanel({ lang, items, today, embedded = false }: Props) {
  const rep: RaidReport = useMemo(() => computeRaidReport(items, today), [items, today]);
  const [view, setView] = useState<View>("summary");

  // Resizable card
  const { ref, reset } = useResizable("lop-app:raid-report-size");

  // Column-resize hooks — always called (hooks must not be conditional)
  const severity = useColumnResize<SeverityCol>("raidReportSeverity", SEVERITY_COL_WIDTHS);
  const status = useColumnResize<StatusCol>("raidReportStatus", STATUS_COL_WIDTHS);
  const owner = useColumnResize<OwnerCol>("raidReportOwner", OWNER_COL_WIDTHS);
  const topOpen = useColumnResize<TopOpenCol>("raidReportTopOpen", TOP_OPEN_COL_WIDTHS);
  const category = useColumnResize<CategoryCol>("raidReportCategory", CATEGORY_COL_WIDTHS);
  const aging = useColumnResize<AgingCol>("raidReportAging", AGING_COL_WIDTHS);
  const detail = useColumnResize<DetailCol>("raidReportDetail", DETAIL_COL_WIDTHS);

  const resetAllCols = useCallback(() => {
    severity.resetColWidths();
    status.resetColWidths();
    owner.resetColWidths();
    topOpen.resetColWidths();
    category.resetColWidths();
    aging.resetColWidths();
    detail.resetColWidths();
  }, [severity, status, owner, topOpen, category, aging, detail]);

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line p-10 text-center text-sm text-muted-foreground">
        {t(lang, "raidReportEmpty")}
      </div>
    );
  }

  const effectiveView: View = embedded ? "summary" : view;

  const content = (
    <>
      {effectiveView === "summary" && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label={t(lang, "raidReportOpenRisks")} value={String(rep.tiles.openR)} />
            <Tile label={t(lang, "raidReportOpenAssumptions")} value={String(rep.tiles.openA)} />
            <Tile label={t(lang, "raidReportOpenIssues")} value={String(rep.tiles.openI)} />
            <Tile label={t(lang, "raidReportOpenDependencies")} value={String(rep.tiles.openD)} />
          </div>

          <SeverityTable lang={lang} rows={rep.bySeverity} colResize={severity} />
          <StatusTable lang={lang} rows={rep.byStatus} colResize={status} />
          <OwnerTable lang={lang} rows={rep.byOwner} colResize={owner} />
          <TopOpenTable lang={lang} rows={rep.topOpen} colResize={topOpen} />
          <CategoryTable lang={lang} rows={rep.byCategory} colResize={category} />
          <AgingTable lang={lang} rows={rep.byAging} colResize={aging} />
        </>
      )}

      {effectiveView === "full" && (
        <DetailTable lang={lang} rows={rep.fullDetail} colResize={detail} />
      )}
    </>
  );

  if (embedded) return <div className="space-y-6">{content}</div>;

  const viewToggle = (
    <SegmentedControl<View>
      value={view}
      ariaLabel={t(lang, "raidReportTitle")}
      options={[
        { value: "summary", label: t(lang, "raidReportSummary") },
        { value: "full", label: t(lang, "raidReportFullDetail") },
      ]}
      onChange={(v) => setView(v)}
    />
  );

  return (
    <ReportCard
      lang={lang}
      sizeRef={ref}
      onResetSize={reset}
      onResetCols={resetAllCols}
      toolbarExtra={viewToggle}
      title={t(lang, "raidReportTitle")}
    >
      {content}
    </ReportCard>
  );
}

// ---------------------------------------------------------------------------
// By Severity
// ---------------------------------------------------------------------------

type SeverityResizable = ReturnType<typeof useColumnResize<SeverityCol>>;

function SeverityTable({ lang, rows, colResize }: { lang: Lang; rows: RaidReport["bySeverity"]; colResize: SeverityResizable }) {
  const [sort, setSort] = useState<SortState<SeveritySortKey>>({ key: "name", dir: "asc" });
  // Map: name = severity string (used by useSortableFilter for filtering/sorting)
  const mapped = useMemo(
    () => rows.map((r) => ({ ...r, name: r.severity as string })),
    [rows],
  );
  const getValue = useCallback((r: typeof mapped[number], k: SeveritySortKey): string | number => {
    if (k === "name") return r.severity;
    return r[k as Exclude<SeveritySortKey, "name">] ?? 0;
  }, []);
  const { sorted, click } = useSortableFilter(mapped, sort, setSort, "", getValue);
  const w = colResize.colWidths;
  const sr = colResize.startColResize as (col: string, e: React.MouseEvent) => void;

  return (
    <Section title={t(lang, "raidReportBySeverity")}>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="min-w-full text-left text-sm">
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              <th className="relative px-3 py-2 font-medium" style={{ width: w.label, minWidth: w.label }}>
                <SortHeaderButton label={t(lang, "raidReportBySeverity")} active={sort.key === "name" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("name")} />
                <ColumnResizeHandle col="label" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.risks, minWidth: w.risks }}>
                <SortHeaderButton label={t(lang, "raidCategoryRisk")} active={sort.key === "risks" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("risks")} />
                <ColumnResizeHandle col="risks" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.assumptions, minWidth: w.assumptions }}>
                <SortHeaderButton label={t(lang, "raidCategoryAssumption")} active={sort.key === "assumptions" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("assumptions")} />
                <ColumnResizeHandle col="assumptions" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.issues, minWidth: w.issues }}>
                <SortHeaderButton label={t(lang, "raidCategoryIssue")} active={sort.key === "issues" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("issues")} />
                <ColumnResizeHandle col="issues" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.dependencies, minWidth: w.dependencies }}>
                <SortHeaderButton label={t(lang, "raidCategoryDependency")} active={sort.key === "dependencies" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("dependencies")} />
                <ColumnResizeHandle col="dependencies" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.total, minWidth: w.total }}>
                <SortHeaderButton label={t(lang, "raidReportColTotal")} active={sort.key === "total" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("total")} />
                <ColumnResizeHandle col="total" onMouseDown={sr} />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.map((row) => (
              <tr key={row.severity}>
                <td className="px-3 py-2 font-medium text-foreground">
                  {row.severity === "Unrated" ? (
                    <span className="italic text-muted-foreground">{t(lang, "raidReportSeverityUnrated")}</span>
                  ) : (
                    row.severity
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{row.risks}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.assumptions}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.issues}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.dependencies}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">{row.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// By Status
// ---------------------------------------------------------------------------

type StatusResizable = ReturnType<typeof useColumnResize<StatusCol>>;

function StatusTable({ lang, rows, colResize }: { lang: Lang; rows: RaidReport["byStatus"]; colResize: StatusResizable }) {
  const [sort, setSort] = useState<SortState<StatusSortKey>>({ key: "name", dir: "asc" });
  const mapped = useMemo(() => rows.map((r) => ({ ...r, name: r.status })), [rows]);
  const getValue = useCallback((r: typeof mapped[number], k: StatusSortKey): string | number => {
    if (k === "name") return r.status;
    return r.count;
  }, []);
  const { sorted, click } = useSortableFilter(mapped, sort, setSort, "", getValue);
  const w = colResize.colWidths;
  const sr = colResize.startColResize as (col: string, e: React.MouseEvent) => void;

  return (
    <Section title={t(lang, "raidReportByStatus")}>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="min-w-full text-left text-sm">
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              <th className="relative px-3 py-2 font-medium" style={{ width: w.label, minWidth: w.label }}>
                <SortHeaderButton label={t(lang, "raidReportByStatus")} active={sort.key === "name" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("name")} />
                <ColumnResizeHandle col="label" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.open, minWidth: w.open }}>
                <SortHeaderButton label={t(lang, "raidReportColOpen")} active={sort.key === "open" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("open")} />
                <ColumnResizeHandle col="open" onMouseDown={sr} />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.map((row) => (
              <tr key={row.status}>
                <td className="px-3 py-2 font-medium text-foreground">{row.status}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// By Owner
// ---------------------------------------------------------------------------

type OwnerResizable = ReturnType<typeof useColumnResize<OwnerCol>>;

function OwnerTable({ lang, rows, colResize }: { lang: Lang; rows: RaidReport["byOwner"]; colResize: OwnerResizable }) {
  const [sort, setSort] = useState<SortState<OwnerSortKey>>({ key: "total", dir: "desc" });
  const [filter, setFilter] = useState("");
  const mapped = useMemo(() => rows.map((r) => ({ ...r, name: r.owner })), [rows]);
  const getValue = useCallback((r: typeof mapped[number], k: OwnerSortKey): string | number => {
    if (k === "name") return r.owner;
    if (k === "risks") return r.openR;
    if (k === "assumptions") return r.openA;
    if (k === "issues") return r.openI;
    if (k === "dependencies") return r.openD;
    return r.total;
  }, []);
  const { sorted, click } = useSortableFilter(mapped, sort, setSort, filter, getValue);
  const w = colResize.colWidths;
  const sr = colResize.startColResize as (col: string, e: React.MouseEvent) => void;

  return (
    <Section title={t(lang, "raidReportByOwner")}>
      <TableFilter lang={lang} value={filter} onChange={setFilter} placeholderKey="raidReportFilterOwner" />
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="min-w-full text-left text-sm">
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              <th className="relative px-3 py-2 font-medium" style={{ width: w.label, minWidth: w.label }}>
                <SortHeaderButton label={t(lang, "raidReportByOwner")} active={sort.key === "name" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("name")} />
                <ColumnResizeHandle col="label" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.risks, minWidth: w.risks }}>
                <SortHeaderButton label={t(lang, "raidCategoryRisk")} active={sort.key === "risks" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("risks")} />
                <ColumnResizeHandle col="risks" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.assumptions, minWidth: w.assumptions }}>
                <SortHeaderButton label={t(lang, "raidCategoryAssumption")} active={sort.key === "assumptions" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("assumptions")} />
                <ColumnResizeHandle col="assumptions" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.issues, minWidth: w.issues }}>
                <SortHeaderButton label={t(lang, "raidCategoryIssue")} active={sort.key === "issues" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("issues")} />
                <ColumnResizeHandle col="issues" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.dependencies, minWidth: w.dependencies }}>
                <SortHeaderButton label={t(lang, "raidCategoryDependency")} active={sort.key === "dependencies" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("dependencies")} />
                <ColumnResizeHandle col="dependencies" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.total, minWidth: w.total }}>
                <SortHeaderButton label={t(lang, "raidReportColTotal")} active={sort.key === "total" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("total")} />
                <ColumnResizeHandle col="total" onMouseDown={sr} />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.map((row) => (
              <tr key={row.owner}>
                <td className="px-3 py-2 font-medium text-foreground">{ownerCell(lang, row.owner)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.openR}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.openA}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.openI}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.openD}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">{row.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Top 10 Open
// ---------------------------------------------------------------------------

type TopOpenResizable = ReturnType<typeof useColumnResize<TopOpenCol>>;

function TopOpenTable({ lang, rows, colResize }: { lang: Lang; rows: RaidReport["topOpen"]; colResize: TopOpenResizable }) {
  const [sort, setSort] = useState<SortState<TopOpenSortKey>>({ key: "ageDays", dir: "desc" });
  const mapped = useMemo(() => rows.map((r) => ({ ...r, name: r.title })), [rows]);
  const getValue = useCallback((r: typeof mapped[number], k: TopOpenSortKey): string | number => {
    if (k === "name") return r.title;
    if (k === "id") return r.id;
    if (k === "category") return r.category;
    if (k === "severity") return r.severity ?? "";
    if (k === "owner") return r.owner;
    return r.ageDays;
  }, []);
  const { sorted, click } = useSortableFilter(mapped, sort, setSort, "", getValue);
  const w = colResize.colWidths;
  const sr = colResize.startColResize as (col: string, e: React.MouseEvent) => void;

  return (
    <Section title={t(lang, "raidReportTopOpen")}>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="min-w-full text-left text-sm">
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              <th className="relative px-3 py-2 font-medium" style={{ width: w.id, minWidth: w.id }}>
                <SortHeaderButton label={t(lang, "id")} active={sort.key === "id" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("id")} />
                <ColumnResizeHandle col="id" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 font-medium" style={{ width: w.category, minWidth: w.category }}>
                <SortHeaderButton label={t(lang, "raidCategory")} active={sort.key === "category" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("category")} />
                <ColumnResizeHandle col="category" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 font-medium" style={{ width: w.title, minWidth: w.title }}>
                <SortHeaderButton label={t(lang, "raidTitle")} active={sort.key === "name" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("name")} />
                <ColumnResizeHandle col="title" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 font-medium" style={{ width: w.severity, minWidth: w.severity }}>
                <SortHeaderButton label={t(lang, "raidSeverity")} hint={t(lang, "raidSeverityHint")} active={sort.key === "severity" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("severity")} />
                <ColumnResizeHandle col="severity" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 font-medium" style={{ width: w.owner, minWidth: w.owner }}>
                <SortHeaderButton label={t(lang, "raidOwner")} active={sort.key === "owner" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("owner")} />
                <ColumnResizeHandle col="owner" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.age, minWidth: w.age }}>
                <SortHeaderButton label={t(lang, "raidReportColAge")} hint={t(lang, "raidReportColAgeHint")} active={sort.key === "ageDays" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("ageDays")} />
                <ColumnResizeHandle col="age" onMouseDown={sr} />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2 text-muted-foreground tabular-nums">{row.id}</td>
                <td className="px-3 py-2">{row.category}</td>
                <td className="px-3 py-2 text-foreground">
                  <span className="block max-w-[40ch] truncate" title={row.title}>{row.title}</span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{row.severity ?? ""}</td>
                <td className="px-3 py-2">{ownerCell(lang, row.owner)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${row.overdue ? "text-AIPM-pink-strong font-medium" : "text-muted-foreground"}`}>
                  {row.ageDays}d
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// By Category
// ---------------------------------------------------------------------------

type CategoryResizable = ReturnType<typeof useColumnResize<CategoryCol>>;

function CategoryTable({ lang, rows, colResize }: { lang: Lang; rows: RaidReport["byCategory"]; colResize: CategoryResizable }) {
  const [sort, setSort] = useState<SortState<CategorySortKey>>({ key: "name", dir: "asc" });
  const mapped = useMemo(() => rows.map((r) => ({ ...r, name: r.category as string })), [rows]);
  const getValue = useCallback((r: typeof mapped[number], k: CategorySortKey): string | number => {
    if (k === "name") return r.category;
    return r[k as Exclude<CategorySortKey, "name">] ?? 0;
  }, []);
  const { sorted, click } = useSortableFilter(mapped, sort, setSort, "", getValue);
  const w = colResize.colWidths;
  const sr = colResize.startColResize as (col: string, e: React.MouseEvent) => void;

  return (
    <Section title={t(lang, "raidReportByCategory")}>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="min-w-full text-left text-sm">
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              <th className="relative px-3 py-2 font-medium" style={{ width: w.label, minWidth: w.label }}>
                <SortHeaderButton label={t(lang, "raidReportByCategory")} active={sort.key === "name" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("name")} />
                <ColumnResizeHandle col="label" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.open, minWidth: w.open }}>
                <SortHeaderButton label={t(lang, "raidReportColOpen")} active={sort.key === "open" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("open")} />
                <ColumnResizeHandle col="open" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.closed, minWidth: w.closed }}>
                <SortHeaderButton label={t(lang, "raidReportColClosed")} active={sort.key === "closed" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("closed")} />
                <ColumnResizeHandle col="closed" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.overdue, minWidth: w.overdue }}>
                <SortHeaderButton label={t(lang, "raidReportColOverdue")} active={sort.key === "overdue" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("overdue")} />
                <ColumnResizeHandle col="overdue" onMouseDown={sr} />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.map((row) => (
              <tr key={row.category}>
                <td className="px-3 py-2 font-medium text-foreground">{row.category}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.open}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{row.closed}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${row.overdue > 0 ? "text-AIPM-pink-strong font-medium" : "text-muted-foreground"}`}>{row.overdue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// By Aging — column-resize only (4 fixed ordered buckets; sort order is
// meaningful by definition and the list is never long enough to warrant a
// filter, so we leave sort/filter off per the task escalation clause).
// ---------------------------------------------------------------------------

type AgingResizable = ReturnType<typeof useColumnResize<AgingCol>>;

function AgingTable({ lang, rows, colResize }: { lang: Lang; rows: RaidReport["byAging"]; colResize: AgingResizable }) {
  const w = colResize.colWidths;
  const sr = colResize.startColResize as (col: string, e: React.MouseEvent) => void;

  return (
    <Section title={t(lang, "raidReportByAging")}>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="min-w-full text-left text-sm">
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              <th className="relative px-3 py-2 font-medium" style={{ width: w.label, minWidth: w.label }}>
                {t(lang, "raidReportByAging")}
                <ColumnResizeHandle col="label" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.open, minWidth: w.open }}>
                {t(lang, "raidReportColOpen")}
                <ColumnResizeHandle col="open" onMouseDown={sr} />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.bucket}>
                <td className="px-3 py-2 font-medium text-foreground">{agingLabel(lang, row.bucket)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.open}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Full Detail
// ---------------------------------------------------------------------------

type DetailResizable = ReturnType<typeof useColumnResize<DetailCol>>;

function DetailTable({ lang, rows, colResize }: { lang: Lang; rows: RaidReport["fullDetail"]; colResize: DetailResizable }) {
  const [sort, setSort] = useState<SortState<DetailSortKey>>({ key: "name", dir: "asc" });
  const [filter, setFilter] = useState("");
  const mapped = useMemo(() => rows.map((r) => ({ ...r, name: r.title })), [rows]);
  const getValue = useCallback((r: typeof mapped[number], k: DetailSortKey): string | number => {
    if (k === "name") return r.title;
    if (k === "id") return r.id;
    if (k === "category") return r.category;
    if (k === "severity") return r.severity ?? "";
    if (k === "status") return r.status;
    if (k === "owner") return r.owner;
    if (k === "raisedDate") return r.raisedDate;
    if (k === "targetDate") return r.targetDate ?? "";
    if (k === "ageDays") return r.ageDays;
    return r.linkedTaskCount;
  }, []);
  const { sorted, click } = useSortableFilter(mapped, sort, setSort, filter, getValue);
  const w = colResize.colWidths;
  const sr = colResize.startColResize as (col: string, e: React.MouseEvent) => void;

  return (
    <div>
      <TableFilter lang={lang} value={filter} onChange={setFilter} placeholderKey="raidReportFilterDetail" />
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="min-w-full text-left text-sm">
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              <th className="relative px-3 py-2 font-medium" style={{ width: w.id, minWidth: w.id }}>
                <SortHeaderButton label={t(lang, "id")} active={sort.key === "id" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("id")} />
                <ColumnResizeHandle col="id" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 font-medium" style={{ width: w.category, minWidth: w.category }}>
                <SortHeaderButton label={t(lang, "raidCategory")} active={sort.key === "category" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("category")} />
                <ColumnResizeHandle col="category" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 font-medium" style={{ width: w.title, minWidth: w.title }}>
                <SortHeaderButton label={t(lang, "raidTitle")} active={sort.key === "name" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("name")} />
                <ColumnResizeHandle col="title" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 font-medium" style={{ width: w.severity, minWidth: w.severity }}>
                <SortHeaderButton label={t(lang, "raidSeverity")} hint={t(lang, "raidSeverityHint")} active={sort.key === "severity" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("severity")} />
                <ColumnResizeHandle col="severity" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 font-medium" style={{ width: w.status, minWidth: w.status }}>
                <SortHeaderButton label={t(lang, "raidStatus")} active={sort.key === "status" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("status")} />
                <ColumnResizeHandle col="status" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 font-medium" style={{ width: w.owner, minWidth: w.owner }}>
                <SortHeaderButton label={t(lang, "raidOwner")} active={sort.key === "owner" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("owner")} />
                <ColumnResizeHandle col="owner" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 font-medium" style={{ width: w.raisedDate, minWidth: w.raisedDate }}>
                <SortHeaderButton label={t(lang, "raidReportColRaised")} active={sort.key === "raisedDate" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("raisedDate")} />
                <ColumnResizeHandle col="raisedDate" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 font-medium" style={{ width: w.targetDate, minWidth: w.targetDate }}>
                <SortHeaderButton label={t(lang, "raidReportColTarget")} active={sort.key === "targetDate" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("targetDate")} />
                <ColumnResizeHandle col="targetDate" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.ageDays, minWidth: w.ageDays }}>
                <SortHeaderButton label={t(lang, "raidReportColAge")} hint={t(lang, "raidReportColAgeHint")} active={sort.key === "ageDays" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("ageDays")} />
                <ColumnResizeHandle col="ageDays" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.linkedTaskCount, minWidth: w.linkedTaskCount }}>
                <SortHeaderButton label={t(lang, "raidReportColLinkedTasks")} active={sort.key === "linkedTaskCount" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("linkedTaskCount")} />
                <ColumnResizeHandle col="linkedTaskCount" onMouseDown={sr} />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2 text-muted-foreground tabular-nums">{r.id}</td>
                <td className="px-3 py-2">{r.category}</td>
                <td className="px-3 py-2 text-foreground">
                  <span className="block max-w-[60ch] truncate" title={r.title}>{r.title}</span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{r.severity ?? ""}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.status}</td>
                <td className="px-3 py-2">{ownerCell(lang, r.owner)}</td>
                <td className="px-3 py-2 text-muted-foreground tabular-nums">{r.raisedDate}</td>
                <td className={`px-3 py-2 tabular-nums ${r.overdue ? "text-AIPM-pink-strong font-medium" : "text-muted-foreground"}`}>
                  {r.targetDate ?? "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{r.ageDays}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.linkedTaskCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function ownerCell(lang: Lang, owner: string) {
  if (owner === UNASSIGNED_OWNER) {
    return <span className="italic text-muted-foreground">{t(lang, "raidReportUnassigned")}</span>;
  }
  return owner;
}

function agingLabel(lang: Lang, bucket: "le30" | "31_60" | "61_90" | "gt90"): string {
  switch (bucket) {
    case "le30": return t(lang, "raidReportAgingLE30");
    case "31_60": return t(lang, "raidReportAging31_60");
    case "61_90": return t(lang, "raidReportAging61_90");
    case "gt90": return t(lang, "raidReportAgingGT90");
  }
}

export { ownerCell };
