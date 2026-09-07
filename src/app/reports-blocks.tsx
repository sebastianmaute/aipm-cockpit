"use client";
/**
 * The nine built-in Reports block BODIES, presentational.
 *
 * ★★ PURE MOVE OUT OF `reports.tsx`. Same JSX, same classes, same accessible
 * names, no behaviour change — the orchestrator keeps every `useState`,
 * `useColumnResize`, `computeStats`, the `driverKey` map, the saved-view state
 * and `renderEmbedded`, and passes each block exactly what it reads.
 *
 * ★★★ THESE ARE BODIES, NOT SECTIONS — no component here renders a `<Section>`
 * or any heading of its own, and that is deliberate rather than incidental.
 * `reports.tsx` still wraps each one in its `<Section title={…}>` today, which
 * is what keeps this commit a pure move; when Task 12 renders them inside an
 * `ArrangementTile`, that tile draws its own bordered frame and `<h3>`, so the
 * wrapper is dropped there instead. The Dashboard learned this the hard way —
 * `docs/AGENTS/dashboard.md` records that a titled body inside tile chrome
 * "stacks two borders and two identical headings".
 *
 * ★ ONE-WAY DEPENDENCY, PRESERVED: `reports.tsx` → this file →
 * `reports-tables.tsx` → `reports-stats.ts`. Nothing here imports `reports.tsx`.
 *
 * ★ Row and stat types are read off `Stats` with indexed access
 * (`Stats["byAssignee"]`) rather than re-imported, so a change to the engine's
 * row shape cannot leave these signatures behind.
 */
import type React from "react";
import { Card } from "./card";
import { DataTable } from "./data-table";
import { EmptyState } from "./empty-state";
import { InfoTooltip } from "./info-tooltip";
import { RagDot } from "./rag-dot";
import { Tile } from "./report-table";
import { ColumnResizeHandle } from "./task-manager-ui";
import { type Lang, t, type TranslationKey } from "./i18n";
import { PRIORITIES } from "./types";
import type { GroupHealth, HealthDriver } from "./health";
import type { Stats } from "./reports-stats";
import {
  AssigneeTable,
  GroupOrLabelTable,
  StackedBar,
  type AssigneeSort,
  type GroupOrLabelSort,
  type ReportsAssigneeCol,
  type ReportsByXCol,
  type ReportsInquiryCol,
} from "./reports-tables";

/** ★ The orchestrator widens `startColResize` to this before passing it down —
 *  `ColumnResizeHandle` takes a `col: string`, while `useColumnResize` is
 *  generic over the column union. The widening stays at the call site it always
 *  was; this type only names what arrives. */
type StartResize = (col: string, e: React.MouseEvent) => void;

/** One group-health row as the orchestrator builds it.
 *
 *  ★ NAMED HERE because `health.ts`'s `GroupHealth` is the health OBJECT — the
 *  colour, counts and drivers — not the row that carries it. The row shape is
 *  assembled by `reports.tsx`'s `groupHealth` memo and was previously only
 *  inferred; typing the prop as `GroupHealth[]` compiles to nine `TS2339`s,
 *  which is how this was caught rather than guessed. */
export interface GroupHealthRow {
  name: string;
  health: GroupHealth;
  isUngrouped: boolean;
}

/** The headline strip: four flat tiles. */
export function StatsBlock({
  lang, total, cancelled, open, completed, overdue,
}: {
  lang: Lang;
  total: number;
  cancelled: number;
  open: number;
  completed: number;
  overdue: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Tile
        label={t(lang, "reportsTotal")}
        value={total}
        sub={
          cancelled > 0
            ? t(lang, "reportsCancelledCount", String(cancelled))
            : undefined
        }
        size="2xl"
        flat
      />
      <Tile label={t(lang, "reportsOpen")} value={open} size="2xl" flat />
      <Tile
        label={t(lang, "reportsCompleted")}
        value={completed}
        size="2xl"
        flat
      />
      <Tile
        label={t(lang, "reportsOverdue")}
        value={overdue}
        danger={overdue > 0}
        size="2xl"
        flat
      />
    </div>
  );
}

/** ★ `driverKey` stays in `reports.tsx` and arrives as a prop — it is a
 *  translation-key map, not view state, and the plan keeps it with the
 *  orchestrator. */
export function GroupHealthBlock({
  lang, rows, driverKey,
}: {
  lang: Lang;
  rows: readonly GroupHealthRow[];
  driverKey: Record<HealthDriver, TranslationKey>;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => (
        <Card
          key={row.name}
          className="flex items-start gap-3 p-3"
        >
          <RagDot level={row.health.color} size="lg" className="mt-1" />
          <div className="min-w-0 flex-1">
            <div
              className={`truncate text-sm font-medium ${
                row.isUngrouped
                  ? "italic text-muted-foreground"
                  : "text-foreground"
              }`}
              title={row.name}
            >
              {row.name}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {t(
                lang,
                "reportsGroupCounts",
                row.health.counts.R,
                row.health.counts.A,
                row.health.counts.G,
              )}
              {row.health.outOfScope > 0
                ? ` · ${t(lang, "reportsGroupOutOfScope", String(row.health.outOfScope))}`
                : null}
            </div>
            {row.health.drivers.length > 0 && (
              <div className="mt-1 text-[11px] text-foreground">
                {row.health.drivers
                  .map((d) => t(lang, driverKey[d]))
                  .join(", ")}
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

export function OpenByStatusBlock({
  lang, openByStatus, open,
}: {
  lang: Lang;
  openByStatus: Stats["openByStatus"];
  open: number;
}) {
  return (
    <StackedBar
      segments={[
        {
          value: openByStatus.red,
          color: "bg-[var(--rag-red)]",
          label: t(lang, "alertCatOverdue"),
        },
        {
          value: openByStatus.yellow,
          color: "bg-[var(--rag-amber)]",
          label: t(lang, "reportsDueSoon"),
        },
        {
          value: openByStatus.green,
          color: "bg-[var(--rag-green)]",
          label: t(lang, "reportsOnTrack"),
        },
      ]}
      total={open}
      emptyText={t(lang, "reportsNoOpen")}
    />
  );
}

/** ★ The `completedTotal` sum moved here WITH its only consumer — it was a
 *  one-line derivation in the orchestrator read by nothing else, so keeping it
 *  there would have left a value whose sole purpose is this block. Same
 *  rendered output. */
export function CompletionOutcomesBlock({
  lang, completedOnTime, completedLate,
}: {
  lang: Lang;
  completedOnTime: number;
  completedLate: number;
}) {
  const completedTotal = completedOnTime + completedLate;
  return completedTotal === 0 ? (
    <EmptyState compact title={t(lang, "reportsNoCompletions")} />
  ) : (
    <StackedBar
      segments={[
        {
          value: completedOnTime,
          color: "bg-[var(--rag-green)]",
          label: t(lang, "reportsCompletedOnTime"),
        },
        {
          value: completedLate,
          color: "bg-[var(--rag-red)]",
          label: t(lang, "reportsCompletedLate"),
        },
      ]}
      total={completedTotal}
    />
  );
}

export function InquiriesBlock({
  lang, inquiriesTotal, inquiriesAvg, topInquiries, colWidths, onStartResize,
}: {
  lang: Lang;
  inquiriesTotal: number;
  inquiriesAvg: number;
  topInquiries: Stats["topInquiries"];
  colWidths: Record<ReportsInquiryCol, number>;
  onStartResize: StartResize;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile
          label={t(lang, "reportsInquiriesTotal")}
          value={inquiriesTotal}
          size="2xl"
          flat
        />
        <Tile
          label={t(lang, "reportsInquiriesAvg")}
          value={inquiriesAvg.toFixed(1)}
          size="2xl"
          flat
        />
        <Tile
          label={t(lang, "reportsInquiriesTasks")}
          value={topInquiries.length}
          size="2xl"
          flat
        />
      </div>
      {topInquiries.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-md border border-line">
          <DataTable
            className="min-w-full text-left text-xs"
            head={
              <tr>
                <th className="relative px-3 py-2" style={{ width: colWidths.id, minWidth: colWidths.id }}>
                  #
                  <ColumnResizeHandle col="id" onMouseDown={onStartResize} />
                </th>
                <th className="relative px-3 py-2" style={{ width: colWidths.task, minWidth: colWidths.task }}>
                  {t(lang, "task")}
                  <ColumnResizeHandle col="task" onMouseDown={onStartResize} />
                </th>
                <th className="relative px-3 py-2 text-right" style={{ width: colWidths.count, minWidth: colWidths.count }}>
                  {t(lang, "reportsInquiriesCol")}
                  <InfoTooltip text={t(lang, "reportsInquiriesColHint")} />
                  <ColumnResizeHandle col="count" onMouseDown={onStartResize} />
                </th>
              </tr>
            }
            tbodyClassName="divide-y divide-line"
          >
              {topInquiries.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2 font-mono text-muted-foreground">
                    #{row.id}
                  </td>
                  <td className="px-3 py-2">{row.taskName}</td>
                  <td className="px-3 py-2 text-right font-medium">
                    {row.inquiriesSent}
                  </td>
                </tr>
              ))}
          </DataTable>
        </div>
      )}
    </>
  );
}

export function ByAssigneeBlock({
  lang, rows, colWidths, onStartResize, sort, setSort, filter, setFilter,
}: {
  lang: Lang;
  rows: Stats["byAssignee"];
  colWidths: Record<ReportsAssigneeCol, number>;
  onStartResize: StartResize;
  sort: AssigneeSort;
  setSort: (s: AssigneeSort) => void;
  filter: string;
  setFilter: (v: string) => void;
}) {
  return (
    <AssigneeTable
      rows={rows}
      lang={lang}
      // The SECTION HEADING, not `headerKey`/a column key: it is what a
      // sighted user reads above the table, and it is the one vocabulary
      // all three sibling tables can share (`AssigneeTable` has no
      // `headerKey` at all).
      nameContext={t(lang, "reportsByAssignee")}
      colWidths={colWidths}
      onStartResize={onStartResize}
      sort={sort}
      setSort={setSort}
      filter={filter}
      setFilter={setFilter}
    />
  );
}

/** ★ NO `lang` PROP — this is the one block that translates nothing. The tile
 *  labels are the `PRIORITIES` literals themselves, exactly as in the source it
 *  moved from, and an unused prop is fatal at `--max-warnings=0`. */
export function ByPriorityBlock({ byPriority }: {
  byPriority: Stats["byPriority"];
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {PRIORITIES.map((p) => (
        <Tile key={p} label={p} value={byPriority[p] ?? 0} size="2xl" flat />
      ))}
    </div>
  );
}

/** ★ `ByGroupBlock` and `ByLabelBlock` are two components over one table on
 *  purpose. Their `nameContext`, `headerKey`, `emptyKey` and
 *  `filterPlaceholderKey` all differ, and `nameContext` in particular is
 *  load-bearing for WCAG 2.4.6 — `report-table.tsx` builds each sortable
 *  header's accessible name from it, which is what keeps two tables sharing a
 *  column label apart. Collapsing them into one parameterised component would
 *  put four keys at every call site to save one small function. */
export function ByGroupBlock({
  lang, rows, colWidths, onStartResize, sort, setSort, filter, setFilter,
}: {
  lang: Lang;
  rows: Stats["byGroup"];
  colWidths: Record<ReportsByXCol, number>;
  onStartResize: StartResize;
  sort: GroupOrLabelSort;
  setSort: (s: GroupOrLabelSort) => void;
  filter: string;
  setFilter: (v: string) => void;
}) {
  return (
    <GroupOrLabelTable
      rows={rows}
      lang={lang}
      nameContext={t(lang, "reportsByGroup")}
      headerKey="group"
      emptyKey="reportsNoGroups"
      colWidths={colWidths}
      onStartResize={onStartResize}
      sort={sort}
      setSort={setSort}
      filter={filter}
      setFilter={setFilter}
      filterPlaceholderKey="reportsFilterGroup"
    />
  );
}

export function ByLabelBlock({
  lang, rows, colWidths, onStartResize, sort, setSort, filter, setFilter,
}: {
  lang: Lang;
  rows: Stats["byLabel"];
  colWidths: Record<ReportsByXCol, number>;
  onStartResize: StartResize;
  sort: GroupOrLabelSort;
  setSort: (s: GroupOrLabelSort) => void;
  filter: string;
  setFilter: (v: string) => void;
}) {
  return (
    <GroupOrLabelTable
      rows={rows}
      lang={lang}
      nameContext={t(lang, "reportsByLabel")}
      headerKey="labels"
      emptyKey="reportsNoLabels"
      colWidths={colWidths}
      onStartResize={onStartResize}
      sort={sort}
      setSort={setSort}
      filter={filter}
      setFilter={setFilter}
      filterPlaceholderKey="reportsFilterLabel"
    />
  );
}
