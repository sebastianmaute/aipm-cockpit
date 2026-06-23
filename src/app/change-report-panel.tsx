"use client";

import { useCallback, useMemo, useState } from "react";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { type Lang, t, type TranslationKey } from "./i18n";
import { ColumnResizeHandle } from "./task-manager-ui";
import { useColumnResize } from "./use-column-resize";
import { useResizable } from "./use-resizable";
import { healthDot } from "./health";
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
  changeImpactRag,
  countByStatus,
  countByType,
  isPendingChange,
  selectTopChanges,
} from "./change-log";
import {
  CHANGE_STATUSES,
  CHANGE_TYPES,
  RAID_SEVERITIES,
  type ChangeImpact,
  type ChangeItem,
} from "./types";

// ---------------------------------------------------------------------------
// Label maps (reuse existing RAID severity + change i18n keys)
// ---------------------------------------------------------------------------

const TYPE_KEY: Record<(typeof CHANGE_TYPES)[number], TranslationKey> = {
  Scope: "changeTypeScope",
  Schedule: "changeTypeSchedule",
  Cost: "changeTypeCost",
  Quality: "changeTypeQuality",
  Other: "changeTypeOther",
};

const STATUS_KEY: Record<(typeof CHANGE_STATUSES)[number], TranslationKey> = {
  Proposed: "changeStatusProposed",
  "Under Review": "changeStatusUnderReview",
  Approved: "changeStatusApproved",
  Rejected: "changeStatusRejected",
  Implemented: "changeStatusImplemented",
  Deferred: "changeStatusDeferred",
};

const IMPACT_KEY: Record<ChangeImpact, TranslationKey> = {
  Low: "raidSeverityLow",
  Medium: "raidSeverityMedium",
  High: "raidSeverityHigh",
  Critical: "raidSeverityCritical",
};

// ---------------------------------------------------------------------------
// Column-width default maps
// ---------------------------------------------------------------------------

const TYPE_COL_WIDTHS = { label: 180, count: 80 } as const;
type TypeCol = keyof typeof TYPE_COL_WIDTHS;

const STATUS_COL_WIDTHS = { label: 180, count: 80 } as const;
type StatusCol = keyof typeof STATUS_COL_WIDTHS;

const IMPACT_COL_WIDTHS = { label: 180, count: 80 } as const;
type ImpactCol = keyof typeof IMPACT_COL_WIDTHS;

const REQUESTOR_COL_WIDTHS = { label: 220, count: 80 } as const;
type RequestorCol = keyof typeof REQUESTOR_COL_WIDTHS;

const TOP_PENDING_COL_WIDTHS = {
  id: 50,
  title: 240,
  impact: 100,
  raised: 110,
} as const;
type TopPendingCol = keyof typeof TOP_PENDING_COL_WIDTHS;

// ---------------------------------------------------------------------------
// Sort-key types
// ---------------------------------------------------------------------------

type CountSortKey = "name" | "count";
type TopPendingSortKey = "name" | "id" | "impact" | "raised";

type SortState<K extends string> = { key: K; dir: SortDir };

const TOP_PENDING_LIMIT = 10;

// ---------------------------------------------------------------------------
// Props + component
// ---------------------------------------------------------------------------

interface Props {
  lang: Lang;
  items: readonly ChangeItem[];
  today: string;
  embedded?: boolean;
}

export function ChangeReportPanel({ lang, items, embedded = false }: Props) {
  const byType = useMemo(() => countByType(items), [items]);
  const byStatus = useMemo(() => countByStatus(items), [items]);
  const pending = useMemo(() => items.filter((c) => isPendingChange(c.status)).length, [items]);

  // Resizable card
  const { ref, reset } = useResizable("lop-app:change-report-size");

  // Column-resize hooks — always called (hooks must not be conditional)
  const typeCols = useColumnResize<TypeCol>("changeReportType", TYPE_COL_WIDTHS);
  const statusCols = useColumnResize<StatusCol>("changeReportStatus", STATUS_COL_WIDTHS);
  const impactCols = useColumnResize<ImpactCol>("changeReportImpact", IMPACT_COL_WIDTHS);
  const requestorCols = useColumnResize<RequestorCol>("changeReportRequestor", REQUESTOR_COL_WIDTHS);
  const topPendingCols = useColumnResize<TopPendingCol>("changeReportTopPending", TOP_PENDING_COL_WIDTHS);

  const resetAllCols = useCallback(() => {
    typeCols.resetColWidths();
    statusCols.resetColWidths();
    impactCols.resetColWidths();
    requestorCols.resetColWidths();
    topPendingCols.resetColWidths();
  }, [typeCols, statusCols, impactCols, requestorCols, topPendingCols]);

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line p-10 text-center text-sm text-muted-foreground">
        {t(lang, "changeEmpty")}
      </div>
    );
  }

  const content = (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Tile label={t(lang, "changeReportTotal")} value={String(items.length)} />
        <Tile
          label={t(lang, "changeReportPending")}
          value={String(pending)}
          rag={pending > 0 ? <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${healthDot.A}`} aria-hidden /> : undefined}
        />
        <Tile label={t(lang, "changeReportApproved")} value={String(byStatus.Approved)} />
        <Tile label={t(lang, "changeReportImplemented")} value={String(byStatus.Implemented)} />
        <Tile label={t(lang, "changeReportRejected")} value={String(byStatus.Rejected)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TypeTable lang={lang} counts={byType} colResize={typeCols} />
        <StatusTable lang={lang} counts={byStatus} colResize={statusCols} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ImpactTable lang={lang} items={items} colResize={impactCols} />
        <RequestorTable lang={lang} items={items} colResize={requestorCols} />
      </div>
      <TopPendingTable lang={lang} items={items} colResize={topPendingCols} />
    </>
  );

  if (embedded) return <div className="space-y-6">{content}</div>;

  return (
    <ReportCard
      lang={lang}
      sizeRef={ref}
      onResetSize={reset}
      onResetCols={resetAllCols}
      title={t(lang, "changeReportTitle")}
    >
      {content}
    </ReportCard>
  );
}

// ---------------------------------------------------------------------------
// Shared count-table head (label + count column, sortable)
// ---------------------------------------------------------------------------

type CountResizable = ReturnType<typeof useColumnResize<"label" | "count">>;

function CountHead({
  lang,
  labelKey,
  sort,
  click,
  w,
  sr,
}: {
  lang: Lang;
  labelKey: TranslationKey;
  sort: SortState<CountSortKey>;
  click: (k: CountSortKey) => void;
  w: { label: number; count: number };
  sr: (col: string, e: React.MouseEvent) => void;
}) {
  return (
    <thead className={TABLE_HEAD_CLASS}>
      <tr>
        <th className="relative px-3 py-2 font-medium" style={{ width: w.label, minWidth: w.label }}>
          <SortHeaderButton label={t(lang, labelKey)} active={sort.key === "name" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("name")} />
          <ColumnResizeHandle col="label" onMouseDown={sr} />
        </th>
        <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.count, minWidth: w.count }}>
          <SortHeaderButton label={t(lang, "changeReportCount")} active={sort.key === "count" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("count")} />
          <ColumnResizeHandle col="count" onMouseDown={sr} />
        </th>
      </tr>
    </thead>
  );
}

// ---------------------------------------------------------------------------
// By Type
// ---------------------------------------------------------------------------

function TypeTable({ lang, counts, colResize }: { lang: Lang; counts: Record<(typeof CHANGE_TYPES)[number], number>; colResize: CountResizable }) {
  const [sort, setSort] = useState<SortState<CountSortKey>>({ key: "name", dir: "asc" });
  const mapped = useMemo(
    () => CHANGE_TYPES.map((type) => ({ name: t(lang, TYPE_KEY[type]), key: type, count: counts[type] })),
    [counts, lang],
  );
  const getValue = useCallback((r: typeof mapped[number], k: CountSortKey): string | number => (k === "name" ? r.name : r.count), []);
  const { sorted, click } = useSortableFilter(mapped, sort, setSort, "", getValue);
  const w = colResize.colWidths;
  const sr = colResize.startColResize as (col: string, e: React.MouseEvent) => void;

  return (
    <Section title={t(lang, "changeReportByType")}>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="min-w-full text-left text-sm">
          <CountHead lang={lang} labelKey="changeFieldType" sort={sort} click={click} w={w} sr={sr} />
          <tbody className="divide-y divide-line">
            {sorted.map((row) => (
              <tr key={row.key}>
                <td className="px-3 py-2 font-medium text-foreground">{row.name}</td>
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
// By Status
// ---------------------------------------------------------------------------

function StatusTable({ lang, counts, colResize }: { lang: Lang; counts: Record<(typeof CHANGE_STATUSES)[number], number>; colResize: CountResizable }) {
  const [sort, setSort] = useState<SortState<CountSortKey>>({ key: "name", dir: "asc" });
  const mapped = useMemo(
    () => CHANGE_STATUSES.map((status) => ({ name: t(lang, STATUS_KEY[status]), key: status, count: counts[status] })),
    [counts, lang],
  );
  const getValue = useCallback((r: typeof mapped[number], k: CountSortKey): string | number => (k === "name" ? r.name : r.count), []);
  const { sorted, click } = useSortableFilter(mapped, sort, setSort, "", getValue);
  const w = colResize.colWidths;
  const sr = colResize.startColResize as (col: string, e: React.MouseEvent) => void;

  return (
    <Section title={t(lang, "changeReportByStatus")}>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="min-w-full text-left text-sm">
          <CountHead lang={lang} labelKey="changeFieldStatus" sort={sort} click={click} w={w} sr={sr} />
          <tbody className="divide-y divide-line">
            {sorted.map((row) => (
              <tr key={row.key}>
                <td className="px-3 py-2 font-medium text-foreground">{row.name}</td>
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
// By Impact — count per rating; impact RAG dot.
// ---------------------------------------------------------------------------

function ImpactTable({ lang, items, colResize }: { lang: Lang; items: readonly ChangeItem[]; colResize: CountResizable }) {
  const [sort, setSort] = useState<SortState<CountSortKey>>({ key: "name", dir: "asc" });
  const mapped = useMemo(() => {
    const counts = Object.fromEntries(RAID_SEVERITIES.map((s) => [s, 0])) as Record<ChangeImpact, number>;
    for (const c of items) if (c.impact) counts[c.impact] += 1;
    return RAID_SEVERITIES.map((impact) => ({ name: t(lang, IMPACT_KEY[impact]), key: impact, count: counts[impact] }));
  }, [items, lang]);
  const getValue = useCallback((r: typeof mapped[number], k: CountSortKey): string | number => (k === "name" ? r.name : r.count), []);
  const { sorted, click } = useSortableFilter(mapped, sort, setSort, "", getValue);
  const w = colResize.colWidths;
  const sr = colResize.startColResize as (col: string, e: React.MouseEvent) => void;

  return (
    <Section title={t(lang, "changeReportByImpact")}>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="min-w-full text-left text-sm">
          <CountHead lang={lang} labelKey="changeFieldImpact" sort={sort} click={click} w={w} sr={sr} />
          <tbody className="divide-y divide-line">
            {sorted.map((row) => (
              <tr key={row.key}>
                <td className="px-3 py-2 font-medium text-foreground">
                  <span className="inline-flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${healthDot[changeImpactRag(row.key)]}`} aria-hidden />
                    {row.name}
                  </span>
                </td>
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
// By Requestor — group by requestedBy (blank -> unassigned); filterable.
// ---------------------------------------------------------------------------

function RequestorTable({ lang, items, colResize }: { lang: Lang; items: readonly ChangeItem[]; colResize: CountResizable }) {
  const [sort, setSort] = useState<SortState<CountSortKey>>({ key: "count", dir: "desc" });
  const [filter, setFilter] = useState("");
  const unassigned = t(lang, "raidReportUnassigned");
  const mapped = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of items) {
      const who = c.requestedBy?.trim() ? c.requestedBy.trim() : unassigned;
      counts.set(who, (counts.get(who) ?? 0) + 1);
    }
    return Array.from(counts, ([name, count]) => ({ name, count }));
  }, [items, unassigned]);
  const getValue = useCallback((r: typeof mapped[number], k: CountSortKey): string | number => (k === "name" ? r.name : r.count), []);
  const { sorted, click } = useSortableFilter(mapped, sort, setSort, filter, getValue);
  const w = colResize.colWidths;
  const sr = colResize.startColResize as (col: string, e: React.MouseEvent) => void;

  return (
    <Section title={t(lang, "changeReportByRequestor")}>
      <TableFilter lang={lang} value={filter} onChange={setFilter} placeholderKey="raidReportFilterOwner" />
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="min-w-full text-left text-sm">
          <CountHead lang={lang} labelKey="changeFieldRequestedBy" sort={sort} click={click} w={w} sr={sr} />
          <tbody className="divide-y divide-line">
            {sorted.map((row) => (
              <tr key={row.name}>
                <td className="px-3 py-2 font-medium text-foreground">
                  {row.name === unassigned ? <span className="italic text-muted-foreground">{row.name}</span> : row.name}
                </td>
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
// Top Pending — selectTopChanges(items, 10): id / title / impact / raised.
// ---------------------------------------------------------------------------

type TopPendingResizable = ReturnType<typeof useColumnResize<TopPendingCol>>;

function TopPendingTable({ lang, items, colResize }: { lang: Lang; items: readonly ChangeItem[]; colResize: TopPendingResizable }) {
  const [sort, setSort] = useState<SortState<TopPendingSortKey>>({ key: "impact", dir: "desc" });
  const rows = useMemo(() => selectTopChanges(items, TOP_PENDING_LIMIT), [items]);
  const mapped = useMemo(() => rows.map((r) => ({ ...r, name: r.title })), [rows]);
  const getValue = useCallback((r: typeof mapped[number], k: TopPendingSortKey): string | number => {
    if (k === "name") return r.title;
    if (k === "id") return r.id;
    if (k === "raised") return r.raisedDate;
    return r.impact ? RAID_SEVERITIES.indexOf(r.impact) : -1;
  }, []);
  const { sorted, click } = useSortableFilter(mapped, sort, setSort, "", getValue);
  const w = colResize.colWidths;
  const sr = colResize.startColResize as (col: string, e: React.MouseEvent) => void;

  return (
    <Section title={t(lang, "changeReportTopPending")}>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="min-w-full text-left text-sm">
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              <th className="relative px-3 py-2 font-medium" style={{ width: w.id, minWidth: w.id }}>
                <SortHeaderButton label={t(lang, "id")} active={sort.key === "id" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("id")} />
                <ColumnResizeHandle col="id" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 font-medium" style={{ width: w.title, minWidth: w.title }}>
                <SortHeaderButton label={t(lang, "changeFieldTitle")} active={sort.key === "name" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("name")} />
                <ColumnResizeHandle col="title" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 font-medium" style={{ width: w.impact, minWidth: w.impact }}>
                <SortHeaderButton label={t(lang, "changeFieldImpact")} active={sort.key === "impact" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("impact")} />
                <ColumnResizeHandle col="impact" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 font-medium" style={{ width: w.raised, minWidth: w.raised }}>
                <SortHeaderButton label={t(lang, "changeFieldRaisedDate")} active={sort.key === "raised" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("raised")} />
                <ColumnResizeHandle col="raised" onMouseDown={sr} />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2 text-muted-foreground tabular-nums">{row.id}</td>
                <td className="px-3 py-2 text-foreground">
                  <span className="block max-w-[40ch] truncate" title={row.title}>{row.title}</span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {row.impact ? (
                    <span className="inline-flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${healthDot[changeImpactRag(row.impact)]}`} aria-hidden />
                      {t(lang, IMPACT_KEY[row.impact])}
                    </span>
                  ) : (
                    ""
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground tabular-nums">{row.raisedDate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
