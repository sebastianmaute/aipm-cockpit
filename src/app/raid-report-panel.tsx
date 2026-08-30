"use client";

import { useCallback, useMemo, useState } from "react";
import { SegmentedControl } from "./segmented-control";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { type Lang, t, type TranslationKey } from "./i18n";
import { ColumnResizeHandle } from "./task-manager-ui";
import { useColumnResize } from "./use-column-resize";
import { useResizable } from "./use-resizable";
import {
  ReportCard,
  Section,
  Tile,
  TableFilter,
  SortResizeTh,
  useSortableFilter,
  useSortHeaderProps,
  type SortDir,
} from "./report-table";
import {
  UNASSIGNED_OWNER,
  computeRaidReport,
  type RaidReport,
} from "./raid-report";
import type { RaidItem, Resource } from "./types";
import { DataTable } from "./data-table";
import { EmptyState } from "./empty-state";

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

// Severity and Owner share this exact 6-key union and identical column widths,
// so they share the RaidCountHead / RaidCountRow presentational helpers below.
type RaidCountSortKey = "name" | "risks" | "assumptions" | "issues" | "dependencies" | "total";
type RaidCountCol = "label" | "risks" | "assumptions" | "issues" | "dependencies" | "total";

type SortState<K extends string> = { key: K; dir: SortDir };

// ---------------------------------------------------------------------------
// Props + component
// ---------------------------------------------------------------------------

interface Props {
  lang: Lang;
  items: readonly RaidItem[];
  today: string;
  /** Directory for resolving a linked owner's live name (stale-cache fix). */
  resourcesById?: ReadonlyMap<number, Resource>;
  embedded?: boolean;
}

type View = "summary" | "full";

export function RaidReportPanel({ lang, items, today, resourcesById, embedded = false }: Props) {
  const rep: RaidReport = useMemo(
    () => computeRaidReport(items, today, resourcesById),
    [items, today, resourcesById],
  );
  const [view, setView] = useState<View>("summary");

  // Resizable card
  const { ref, reset } = useResizable("aipm-cockpit:raid-report-size");

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
      <EmptyState title={t(lang, "raidReportEmpty")} />
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
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <CategoryTable lang={lang} rows={rep.byCategory} colResize={category} />
            <AgingTable lang={lang} rows={rep.byAging} colResize={aging} />
          </div>
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
          <RaidCountHead lang={lang} firstLabelKey="raidReportBySeverity" w={w} sort={sort} click={click} sr={sr} />
          <tbody className="divide-y divide-line">
            {sorted.map((row) => (
              <tr key={row.severity}>
                <RaidCountRow
                  firstCell={
                    row.severity === "Unrated" ? (
                      <span className="italic text-muted-foreground">{t(lang, "raidReportSeverityUnrated")}</span>
                    ) : (
                      row.severity
                    )
                  }
                  risks={row.risks}
                  assumptions={row.assumptions}
                  issues={row.issues}
                  dependencies={row.dependencies}
                  total={row.total}
                />
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
  const th = useSortHeaderProps(sort.key, sort.dir, click, sr);

  return (
    <Section title={t(lang, "raidReportByStatus")}>
      <div className="overflow-x-auto rounded-md border border-line">
        <DataTable className="min-w-full text-left text-sm" head={<>
            <tr>
              <SortResizeTh {...th} label={t(lang, "raidReportByStatus")} sortCol="name" resizeCol="label" width={w.label} />
              <SortResizeTh {...th} label={t(lang, "raidReportColOpen")} nameContext={t(lang, "raidReportByStatus")} sortCol="open" width={w.open} align="right" />
            </tr>
          </>} tbodyClassName="divide-y divide-line">
            {sorted.map((row) => (
              <tr key={row.status}>
                <td className="px-3 py-2 font-medium text-foreground">{row.status}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.count}</td>
              </tr>
            ))}
        </DataTable>
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
          <RaidCountHead lang={lang} firstLabelKey="raidReportByOwner" w={w} sort={sort} click={click} sr={sr} />
          <tbody className="divide-y divide-line">
            {sorted.map((row) => (
              <tr key={row.owner}>
                <RaidCountRow
                  firstCell={ownerCell(lang, row.owner)}
                  risks={row.openR}
                  assumptions={row.openA}
                  issues={row.openI}
                  dependencies={row.openD}
                  total={row.total}
                />
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
  const th = useSortHeaderProps(sort.key, sort.dir, click, sr);

  return (
    <Section title={t(lang, "raidReportTopOpen")}>
      <div className="overflow-x-auto rounded-md border border-line">
        <DataTable className="min-w-full text-left text-sm" head={<>
            <tr>
              <SortResizeTh {...th} label={t(lang, "id")} sortCol="id" width={w.id} />
              <SortResizeTh {...th} label={t(lang, "raidCategory")} sortCol="category" width={w.category} />
              <SortResizeTh {...th} label={t(lang, "raidTitle")} sortCol="name" resizeCol="title" width={w.title} />
              <SortResizeTh {...th} label={t(lang, "raidSeverity")} sortCol="severity" width={w.severity} hint={t(lang, "raidSeverityHint")} />
              <SortResizeTh {...th} label={t(lang, "raidOwner")} sortCol="owner" width={w.owner} />
              <SortResizeTh {...th} label={t(lang, "raidReportColAge")} sortCol="ageDays" resizeCol="age" width={w.age} align="right" hint={t(lang, "raidReportColAgeHint")} />
            </tr>
          </>} tbodyClassName="divide-y divide-line">
            {sorted.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2 text-muted-foreground tabular-nums">{row.id}</td>
                <td className="px-3 py-2">{row.category}</td>
                <td className="px-3 py-2 text-foreground">
                  <span className="block max-w-[40ch] truncate" title={row.title}>{row.title}</span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{row.severity ?? ""}</td>
                <td className="px-3 py-2">{ownerCell(lang, row.owner)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${row.overdue ? "text-[var(--rag-red-text)] font-medium" : "text-muted-foreground"}`}>
                  {row.ageDays}d
                </td>
              </tr>
            ))}
        </DataTable>
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
  const th = useSortHeaderProps(sort.key, sort.dir, click, sr);

  return (
    <Section title={t(lang, "raidReportByCategory")}>
      <div className="overflow-x-auto rounded-md border border-line">
        <DataTable className="min-w-full text-left text-sm" head={<>
            <tr>
              <SortResizeTh {...th} label={t(lang, "raidReportByCategory")} sortCol="name" resizeCol="label" width={w.label} />
              {/* Only "Open" collides — StatusTable's own Open column, in the
                  same summary view. "Closed"/"Overdue" share their label with
                  no other co-rendered header, so per AGENTS.md they stay bare:
                  a nameContext here would only add noise for every
                  screen-reader user. */}
              <SortResizeTh {...th} label={t(lang, "raidReportColOpen")} nameContext={t(lang, "raidReportByCategory")} sortCol="open" width={w.open} align="right" />
              <SortResizeTh {...th} label={t(lang, "raidReportColClosed")} sortCol="closed" width={w.closed} align="right" />
              <SortResizeTh {...th} label={t(lang, "raidReportColOverdue")} sortCol="overdue" width={w.overdue} align="right" />
            </tr>
          </>} tbodyClassName="divide-y divide-line">
            {sorted.map((row) => (
              <tr key={row.category}>
                <td className="px-3 py-2 font-medium text-foreground">{row.category}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.open}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{row.closed}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${row.overdue > 0 ? "text-[var(--rag-red-text)] font-medium" : "text-muted-foreground"}`}>{row.overdue}</td>
              </tr>
            ))}
        </DataTable>
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
        <DataTable className="min-w-full text-left text-sm" head={<>
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
          </>} tbodyClassName="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.bucket}>
                <td className="px-3 py-2 font-medium text-foreground">{agingLabel(lang, row.bucket)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.open}</td>
              </tr>
            ))}
        </DataTable>
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
  const th = useSortHeaderProps(sort.key, sort.dir, click, sr);

  return (
    <div>
      <TableFilter lang={lang} value={filter} onChange={setFilter} placeholderKey="raidReportFilterDetail" />
      <div className="overflow-x-auto rounded-md border border-line">
        <DataTable className="min-w-full text-left text-sm" head={<>
            <tr>
              <SortResizeTh {...th} label={t(lang, "id")} sortCol="id" width={w.id} />
              <SortResizeTh {...th} label={t(lang, "raidCategory")} sortCol="category" width={w.category} />
              <SortResizeTh {...th} label={t(lang, "raidTitle")} sortCol="name" resizeCol="title" width={w.title} />
              <SortResizeTh {...th} label={t(lang, "raidSeverity")} sortCol="severity" width={w.severity} hint={t(lang, "raidSeverityHint")} />
              <SortResizeTh {...th} label={t(lang, "raidStatus")} sortCol="status" width={w.status} />
              <SortResizeTh {...th} label={t(lang, "raidOwner")} sortCol="owner" width={w.owner} />
              <SortResizeTh {...th} label={t(lang, "raidReportColRaised")} sortCol="raisedDate" width={w.raisedDate} />
              <SortResizeTh {...th} label={t(lang, "raidReportColTarget")} sortCol="targetDate" width={w.targetDate} />
              <SortResizeTh {...th} label={t(lang, "raidReportColAge")} sortCol="ageDays" width={w.ageDays} align="right" hint={t(lang, "raidReportColAgeHint")} />
              <SortResizeTh {...th} label={t(lang, "raidReportColLinkedTasks")} sortCol="linkedTaskCount" width={w.linkedTaskCount} align="right" />
            </tr>
          </>} tbodyClassName="divide-y divide-line">
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
                <td className={`px-3 py-2 tabular-nums ${r.overdue ? "text-[var(--rag-red-text)] font-medium" : "text-muted-foreground"}`}>
                  {r.targetDate ?? "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{r.ageDays}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.linkedTaskCount}</td>
              </tr>
            ))}
        </DataTable>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

// Shared 6-column head (label + risk/assumption/issue/dependency/total counts)
// for the By Severity and By Owner tables — only the first column's label key
// differs.
function RaidCountHead({
  lang,
  firstLabelKey,
  w,
  sort,
  click,
  sr,
}: {
  lang: Lang;
  firstLabelKey: TranslationKey;
  w: Record<RaidCountCol, number>;
  sort: SortState<RaidCountSortKey>;
  click: (k: RaidCountSortKey) => void;
  sr: (col: string, e: React.MouseEvent) => void;
}) {
  const th = useSortHeaderProps(sort.key, sort.dir, click, sr);

  return (
    <thead className={TABLE_HEAD_CLASS}>
      <tr>
        <SortResizeTh {...th} label={t(lang, firstLabelKey)} sortCol="name" resizeCol="label" width={w.label} />
        <SortResizeTh {...th} label={t(lang, "raidCategoryRisk")} nameContext={t(lang, firstLabelKey)} sortCol="risks" width={w.risks} align="right" />
        <SortResizeTh {...th} label={t(lang, "raidCategoryAssumption")} nameContext={t(lang, firstLabelKey)} sortCol="assumptions" width={w.assumptions} align="right" />
        <SortResizeTh {...th} label={t(lang, "raidCategoryIssue")} nameContext={t(lang, firstLabelKey)} sortCol="issues" width={w.issues} align="right" />
        <SortResizeTh {...th} label={t(lang, "raidCategoryDependency")} nameContext={t(lang, firstLabelKey)} sortCol="dependencies" width={w.dependencies} align="right" />
        <SortResizeTh {...th} label={t(lang, "raidReportColTotal")} nameContext={t(lang, firstLabelKey)} sortCol="total" width={w.total} align="right" />
      </tr>
    </thead>
  );
}

// Shared 6-cell body row for the By Severity and By Owner tables; the first
// cell content varies (severity label vs. owner cell).
function RaidCountRow({
  firstCell,
  risks,
  assumptions,
  issues,
  dependencies,
  total,
}: {
  firstCell: React.ReactNode;
  risks: number;
  assumptions: number;
  issues: number;
  dependencies: number;
  total: number;
}) {
  return (
    <>
      <td className="px-3 py-2 font-medium text-foreground">{firstCell}</td>
      <td className="px-3 py-2 text-right tabular-nums">{risks}</td>
      <td className="px-3 py-2 text-right tabular-nums">{assumptions}</td>
      <td className="px-3 py-2 text-right tabular-nums">{issues}</td>
      <td className="px-3 py-2 text-right tabular-nums">{dependencies}</td>
      <td className="px-3 py-2 text-right tabular-nums font-medium">{total}</td>
    </>
  );
}

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
