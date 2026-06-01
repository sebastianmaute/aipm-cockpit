"use client";

import { useCallback, useMemo, useState } from "react";
import { localeFor } from "./date-format";
import { type Lang, t } from "./i18n";
import { computeResourceReport, type ReportGroupRow, type ReportPeriodRow, type ReportResourceRow } from "./resource-report";
import { formatCurrency } from "./resource-cost";
import type { Absence, Discipline, Grade, Resource, ResourcePlan, Role } from "./types";
import { useColumnResize } from "./use-column-resize";
import { useResizable } from "./use-resizable";
import { ColumnResizeHandle } from "./task-manager-ui";
import { TABLE_HEAD_CLASS } from "./table-styles";
import {
  ReportCard,
  TableFilter,
  SortHeaderButton,
  useSortableFilter,
  type SortDir,
} from "./report-table";

// ---------------------------------------------------------------------------
// Column-width default maps
// ---------------------------------------------------------------------------

const RES_REPORT_BY_PERIOD_WIDTHS = {
  label: 100, days: 110, internal: 110, external: 110, margin: 110,
} as const;
type ResReportByPeriodCol = keyof typeof RES_REPORT_BY_PERIOD_WIDTHS;

const RES_REPORT_BY_DISCIPLINE_WIDTHS = {
  label: 160, headcount: 110, days: 110, internal: 110, external: 110,
} as const;
type ResReportByDisciplineCol = keyof typeof RES_REPORT_BY_DISCIPLINE_WIDTHS;

const RES_REPORT_BY_GRADE_WIDTHS = {
  label: 160, headcount: 110, days: 110, internal: 110, external: 110,
} as const;
type ResReportByGradeCol = keyof typeof RES_REPORT_BY_GRADE_WIDTHS;

const RES_REPORT_BY_COMBO_WIDTHS = {
  label: 200, headcount: 110, days: 110, internal: 110, external: 110,
} as const;
type ResReportByComboCol = keyof typeof RES_REPORT_BY_COMBO_WIDTHS;

const RES_REPORT_BY_RESOURCE_WIDTHS = {
  name: 160, role: 160, avgUtil: 90, capDays: 110, internal: 120, external: 120,
} as const;
type ResReportByResourceCol = keyof typeof RES_REPORT_BY_RESOURCE_WIDTHS;

// ---------------------------------------------------------------------------
// Sort key types
// ---------------------------------------------------------------------------

type SortState<K extends string> = { key: K; dir: SortDir };

type PeriodSortKey = "name" | "days" | "internal" | "external" | "margin";
type GroupSortKey = "name" | "headcount" | "days" | "internal" | "external";
type ResourceSortKey = "name" | "role" | "avgUtil" | "capDays" | "internal" | "external";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  lang: Lang;
  resources: readonly Resource[];
  roles: readonly Role[];
  disciplines: readonly Discipline[];
  grades: readonly Grade[];
  plan: ResourcePlan;
  absences: readonly Absence[];
  holidaySet: ReadonlySet<string>;
  workdayHours: number;
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function ResourcesReportPanel({
  lang, resources, roles, disciplines, grades, plan, absences, holidaySet, workdayHours,
}: Props) {
  const rep = useMemo(
    () => computeResourceReport(resources, roles, disciplines, grades, plan, absences, holidaySet, workdayHours),
    [resources, roles, disciplines, grades, plan, absences, holidaySet, workdayHours],
  );
  const loc = localeFor(lang);
  const money = (n: number) => formatCurrency(n, plan.currency, loc);
  const days = (h: number) => (h / workdayHours).toFixed(1);

  const { ref, reset } = useResizable("lop-app:resources-size");

  const byPeriod = useColumnResize<ResReportByPeriodCol>("resReportByPeriod", RES_REPORT_BY_PERIOD_WIDTHS);
  const byDiscipline = useColumnResize<ResReportByDisciplineCol>("resReportByDiscipline", RES_REPORT_BY_DISCIPLINE_WIDTHS);
  const byGrade = useColumnResize<ResReportByGradeCol>("resReportByGrade", RES_REPORT_BY_GRADE_WIDTHS);
  const byCombo = useColumnResize<ResReportByComboCol>("resReportByCombo", RES_REPORT_BY_COMBO_WIDTHS);
  const byResource = useColumnResize<ResReportByResourceCol>("resReportByResource", RES_REPORT_BY_RESOURCE_WIDTHS);

  const resetAllCols = useCallback(() => {
    byPeriod.resetColWidths();
    byDiscipline.resetColWidths();
    byGrade.resetColWidths();
    byCombo.resetColWidths();
    byResource.resetColWidths();
  }, [byPeriod, byDiscipline, byGrade, byCombo, byResource]);

  if (resources.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line p-10 text-center text-sm text-muted-foreground">
        {t(lang, "resourcesReportEmpty")}
      </div>
    );
  }

  return (
    <ReportCard lang={lang} sizeRef={ref} onResetSize={reset} onResetCols={resetAllCols} title={t(lang, "resourcesReportTitle")}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label={t(lang, "resourcesReportTotalCapacity")} value={`${days(rep.totalCapacityHours)} d`} />
        <Tile label={t(lang, "resourcesInternalCost")} value={money(rep.totalInternal)} />
        <Tile label={t(lang, "resourcesExternalCost")} value={money(rep.totalExternal)} />
        <Tile label={t(lang, "resourcesMargin")} value={money(rep.totalMargin)} />
      </div>

      {/* By Period — sortable by columns; no filter (rows are time-ordered periods
          and free-text filtering on a period key like "2026-02" is unhelpful). */}
      <ByPeriodTable
        lang={lang}
        rows={rep.perPeriod}
        colResize={byPeriod}
        days={days}
        money={money}
      />

      {/* By Discipline — sortable + filterable */}
      <ByGroupTable
        lang={lang}
        title={t(lang, "resourcesReportByDiscipline")}
        rows={rep.perDiscipline}
        colResize={byDiscipline}
        days={days}
        money={money}
      />

      {/* By Grade — sortable + filterable */}
      <ByGroupTable
        lang={lang}
        title={t(lang, "resourcesReportByGrade")}
        rows={rep.perGrade}
        colResize={byGrade}
        days={days}
        money={money}
      />

      {/* By Combo (role) — sortable + filterable */}
      <ByGroupTable
        lang={lang}
        title={t(lang, "resourcesReportByCombo")}
        rows={rep.perCombo}
        colResize={byCombo}
        days={days}
        money={money}
      />

      {/* By Resource — sortable + filterable */}
      <ByResourceTable
        lang={lang}
        rows={rep.perResource}
        colResize={byResource}
        days={days}
        money={money}
      />
    </ReportCard>
  );
}

// ---------------------------------------------------------------------------
// By Period — sortable, no filter
// ---------------------------------------------------------------------------

type ByPeriodResizable = ReturnType<typeof useColumnResize<ResReportByPeriodCol>>;

function ByPeriodTable({ lang, rows, colResize, days, money }: {
  lang: Lang;
  rows: ReportPeriodRow[];
  colResize: ByPeriodResizable;
  days: (h: number) => string;
  money: (n: number) => string;
}) {
  const [sort, setSort] = useState<SortState<PeriodSortKey>>({ key: "name", dir: "asc" });
  const mapped = useMemo(() => rows.map((r) => ({ ...r, name: r.key })), [rows]);
  const getValue = useCallback((r: typeof mapped[number], k: PeriodSortKey): string | number => {
    if (k === "name") return r.key;
    if (k === "days") return r.capacityHours;
    if (k === "internal") return r.internal;
    if (k === "external") return r.external;
    return r.margin;
  }, []);
  const { sorted, click } = useSortableFilter(mapped, sort, setSort, "", getValue);
  const w = colResize.colWidths;
  const sr = colResize.startColResize as (col: string, e: React.MouseEvent) => void;

  return (
    <Section title={t(lang, "resourcesReportByPeriod")}>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="min-w-full text-left text-sm">
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              <th className="relative px-3 py-2 font-medium" style={{ width: w.label, minWidth: w.label }}>
                <SortHeaderButton label={t(lang, "resourcesReportByPeriod")} active={sort.key === "name" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("name")} />
                <ColumnResizeHandle col="label" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.days, minWidth: w.days }}>
                <SortHeaderButton label={t(lang, "resourcesCapacityDays")} active={sort.key === "days" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("days")} />
                <ColumnResizeHandle col="days" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.internal, minWidth: w.internal }}>
                <SortHeaderButton label={t(lang, "resourcesInternalCost")} active={sort.key === "internal" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("internal")} />
                <ColumnResizeHandle col="internal" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.external, minWidth: w.external }}>
                <SortHeaderButton label={t(lang, "resourcesExternalCost")} active={sort.key === "external" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("external")} />
                <ColumnResizeHandle col="external" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.margin, minWidth: w.margin }}>
                <SortHeaderButton label={t(lang, "resourcesMargin")} active={sort.key === "margin" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("margin")} />
                <ColumnResizeHandle col="margin" onMouseDown={sr} />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.map((p) => (
              <tr key={p.key}>
                <td className="px-3 py-2 font-medium text-foreground">{p.key}</td>
                <td className="px-3 py-2 text-right tabular-nums">{days(p.capacityHours)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(p.internal)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(p.external)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(p.margin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// By Group (Discipline / Grade / Combo) — sortable + filterable
// ---------------------------------------------------------------------------

type ByGroupResizable =
  | ReturnType<typeof useColumnResize<ResReportByDisciplineCol>>
  | ReturnType<typeof useColumnResize<ResReportByGradeCol>>
  | ReturnType<typeof useColumnResize<ResReportByComboCol>>;

function ByGroupTable({ lang, title, rows, colResize, days, money }: {
  lang: Lang;
  title: string;
  rows: ReportGroupRow[];
  colResize: ByGroupResizable;
  days: (h: number) => string;
  money: (n: number) => string;
}) {
  const [sort, setSort] = useState<SortState<GroupSortKey>>({ key: "name", dir: "asc" });
  const [filter, setFilter] = useState("");
  // ReportGroupRow already has `label` — map that to `name` for useSortableFilter
  const mapped = useMemo(() => rows.map((r) => ({ ...r, name: r.label })), [rows]);
  const getValue = useCallback((r: typeof mapped[number], k: GroupSortKey): string | number => {
    if (k === "name") return r.label;
    if (k === "headcount") return r.headcount;
    if (k === "days") return r.capacityHours;
    if (k === "internal") return r.internal;
    return r.external;
  }, []);
  const { sorted, click } = useSortableFilter(mapped, sort, setSort, filter, getValue);
  const w = colResize.colWidths as Record<string, number>;
  const sr = colResize.startColResize as (col: string, e: React.MouseEvent) => void;

  if (rows.length === 0) return null;

  return (
    <Section title={title}>
      <TableFilter lang={lang} value={filter} onChange={setFilter} placeholderKey="reportsFilterLabel" />
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="min-w-full text-left text-sm">
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              <th className="relative px-3 py-2 font-medium" style={{ width: w.label, minWidth: w.label }}>
                <SortHeaderButton label={title} active={sort.key === "name" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("name")} />
                <ColumnResizeHandle col="label" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.headcount, minWidth: w.headcount }}>
                <SortHeaderButton label={t(lang, "resourcesReportHeadcount")} active={sort.key === "headcount" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("headcount")} />
                <ColumnResizeHandle col="headcount" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.days, minWidth: w.days }}>
                <SortHeaderButton label={t(lang, "resourcesCapacityDays")} active={sort.key === "days" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("days")} />
                <ColumnResizeHandle col="days" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.internal, minWidth: w.internal }}>
                <SortHeaderButton label={t(lang, "resourcesInternalCost")} active={sort.key === "internal" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("internal")} />
                <ColumnResizeHandle col="internal" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.external, minWidth: w.external }}>
                <SortHeaderButton label={t(lang, "resourcesExternalCost")} active={sort.key === "external" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("external")} />
                <ColumnResizeHandle col="external" onMouseDown={sr} />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.map((row) => (
              <tr key={row.key}>
                <td className="px-3 py-2 font-medium text-foreground">{row.label}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.headcount}</td>
                <td className="px-3 py-2 text-right tabular-nums">{days(row.capacityHours)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(row.internal)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(row.external)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// By Resource — sortable + filterable
// ---------------------------------------------------------------------------

type ByResourceResizable = ReturnType<typeof useColumnResize<ResReportByResourceCol>>;

function ByResourceTable({ lang, rows, colResize, days, money }: {
  lang: Lang;
  rows: ReportResourceRow[];
  colResize: ByResourceResizable;
  days: (h: number) => string;
  money: (n: number) => string;
}) {
  const [sort, setSort] = useState<SortState<ResourceSortKey>>({ key: "name", dir: "asc" });
  const [filter, setFilter] = useState("");
  // ReportResourceRow already has `name` — no remapping needed
  const getValue = useCallback((r: ReportResourceRow, k: ResourceSortKey): string | number => {
    if (k === "name") return r.name;
    if (k === "role") return r.roleLabel;
    if (k === "avgUtil") return r.avgUtilization;
    if (k === "capDays") return r.capacityHours;
    if (k === "internal") return r.internal;
    return r.external;
  }, []);
  const { sorted, click } = useSortableFilter(rows, sort, setSort, filter, getValue);
  const w = colResize.colWidths;
  const sr = colResize.startColResize as (col: string, e: React.MouseEvent) => void;

  return (
    <Section title={t(lang, "resourcesReportByResource")}>
      <TableFilter lang={lang} value={filter} onChange={setFilter} placeholderKey="reportsFilterAssignee" />
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="min-w-full text-left text-sm">
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              <th className="relative px-3 py-2 font-medium" style={{ width: w.name, minWidth: w.name }}>
                <SortHeaderButton label={t(lang, "assignee")} active={sort.key === "name" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("name")} />
                <ColumnResizeHandle col="name" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 font-medium" style={{ width: w.role, minWidth: w.role }}>
                <SortHeaderButton label={t(lang, "resourcesRole")} active={sort.key === "role" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("role")} />
                <ColumnResizeHandle col="role" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.avgUtil, minWidth: w.avgUtil }}>
                <SortHeaderButton label={t(lang, "resourcesReportAvgUtil")} active={sort.key === "avgUtil" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("avgUtil")} />
                <ColumnResizeHandle col="avgUtil" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.capDays, minWidth: w.capDays }}>
                <SortHeaderButton label={t(lang, "resourcesCapacityDays")} active={sort.key === "capDays" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("capDays")} />
                <ColumnResizeHandle col="capDays" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.internal, minWidth: w.internal }}>
                <SortHeaderButton label={t(lang, "resourcesInternalCost")} active={sort.key === "internal" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("internal")} />
                <ColumnResizeHandle col="internal" onMouseDown={sr} />
              </th>
              <th className="relative px-3 py-2 text-right font-medium" style={{ width: w.external, minWidth: w.external }}>
                <SortHeaderButton label={t(lang, "resourcesExternalCost")} active={sort.key === "external" && sort.dir !== "off"} dir={sort.dir} onClick={() => click("external")} />
                <ColumnResizeHandle col="external" onMouseDown={sr} />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2 font-medium text-foreground">{r.name}</td>
                <td className="px-3 py-2 text-foreground">
                  {r.hasRole
                    ? r.roleLabel
                    : <span className="italic text-muted-foreground">{t(lang, "resourcesUnassignedRole")}</span>
                  }
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{r.avgUtilization.toFixed(0)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{days(r.capacityHours)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(r.internal)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(r.external)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey tabular-nums">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{title}</h3>
      {children}
    </div>
  );
}
