"use client";

import { useMemo } from "react";
import { localeFor } from "./date-format";
import { type Lang, t } from "./i18n";
import { computeResourceReport, type ReportGroupRow } from "./resource-report";
import { formatCurrency } from "./resource-cost";
import type { Absence, Discipline, Grade, Resource, ResourcePlan, Role } from "./types";
import { useColumnResize } from "./use-column-resize";
import { ColumnResizeHandle, PrintButton } from "./task-manager-ui";
import { TABLE_HEAD_CLASS } from "./table-styles";

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

  const byPeriod = useColumnResize<ResReportByPeriodCol>("resReportByPeriod", RES_REPORT_BY_PERIOD_WIDTHS);
  const byDiscipline = useColumnResize<ResReportByDisciplineCol>("resReportByDiscipline", RES_REPORT_BY_DISCIPLINE_WIDTHS);
  const byGrade = useColumnResize<ResReportByGradeCol>("resReportByGrade", RES_REPORT_BY_GRADE_WIDTHS);
  const byCombo = useColumnResize<ResReportByComboCol>("resReportByCombo", RES_REPORT_BY_COMBO_WIDTHS);
  const byResource = useColumnResize<ResReportByResourceCol>("resReportByResource", RES_REPORT_BY_RESOURCE_WIDTHS);

  if (resources.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line p-10 text-center text-sm text-muted-foreground">
        {t(lang, "resourcesReportEmpty")}
      </div>
    );
  }

  return (
    <div className="print-root space-y-6">
      <div className="flex items-center justify-end print:hidden">
        <PrintButton lang={lang} />
      </div>
      <h2 className="text-lg font-medium text-foreground">{t(lang, "resourcesReportTitle")}</h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label={t(lang, "resourcesReportTotalCapacity")} value={`${days(rep.totalCapacityHours)} d`} />
        <Tile label={t(lang, "resourcesInternalCost")} value={money(rep.totalInternal)} />
        <Tile label={t(lang, "resourcesExternalCost")} value={money(rep.totalExternal)} />
        <Tile label={t(lang, "resourcesMargin")} value={money(rep.totalMargin)} />
      </div>

      <Section title={t(lang, "resourcesReportByPeriod")}>
        <Table
          head={[t(lang, "resourcesReportByPeriod"), t(lang, "resourcesCapacityDays"), t(lang, "resourcesInternalCost"), t(lang, "resourcesExternalCost"), t(lang, "resourcesMargin")]}
          widths={byPeriod.colWidths}
          startResize={byPeriod.startColResize}
          cols={["label", "days", "internal", "external", "margin"] as const}
        >
          {rep.perPeriod.map((p) => (
            <tr key={p.key}>
              <Td>{p.key}</Td><TdR>{days(p.capacityHours)}</TdR><TdR>{money(p.internal)}</TdR><TdR>{money(p.external)}</TdR><TdR>{money(p.margin)}</TdR>
            </tr>
          ))}
        </Table>
      </Section>

      <GroupSection
        title={t(lang, "resourcesReportByDiscipline")}
        rows={rep.perDiscipline}
        lang={lang}
        days={days}
        money={money}
        widths={byDiscipline.colWidths}
        startResize={byDiscipline.startColResize}
        cols={["label", "headcount", "days", "internal", "external"] as const}
      />
      <GroupSection
        title={t(lang, "resourcesReportByGrade")}
        rows={rep.perGrade}
        lang={lang}
        days={days}
        money={money}
        widths={byGrade.colWidths}
        startResize={byGrade.startColResize}
        cols={["label", "headcount", "days", "internal", "external"] as const}
      />
      <GroupSection
        title={t(lang, "resourcesReportByCombo")}
        rows={rep.perCombo}
        lang={lang}
        days={days}
        money={money}
        widths={byCombo.colWidths}
        startResize={byCombo.startColResize}
        cols={["label", "headcount", "days", "internal", "external"] as const}
      />

      <Section title={t(lang, "resourcesReportByResource")}>
        <Table
          head={[t(lang, "assignee"), t(lang, "resourcesRole"), t(lang, "resourcesReportAvgUtil"), t(lang, "resourcesCapacityDays"), t(lang, "resourcesInternalCost"), t(lang, "resourcesExternalCost")]}
          widths={byResource.colWidths}
          startResize={byResource.startColResize}
          cols={["name", "role", "avgUtil", "capDays", "internal", "external"] as const}
        >
          {rep.perResource.map((r) => (
            <tr key={r.id}>
              <Td>{r.name}</Td>
              <Td>{r.hasRole ? r.roleLabel : <span className="italic text-muted-foreground">{t(lang, "resourcesUnassignedRole")}</span>}</Td>
              <TdR>{r.avgUtilization.toFixed(0)}</TdR>
              <TdR>{days(r.capacityHours)}</TdR>
              <TdR>{money(r.internal)}</TdR>
              <TdR>{money(r.external)}</TdR>
            </tr>
          ))}
        </Table>
      </Section>
    </div>
  );
}

function GroupSection<TId extends string>({
  title, rows, lang, days, money, widths, startResize, cols,
}: {
  title: string;
  rows: ReportGroupRow[];
  lang: Lang;
  days: (h: number) => string;
  money: (n: number) => string;
  widths: Record<TId, number>;
  startResize: (col: TId, e: React.MouseEvent) => void;
  cols: readonly TId[];
}) {
  if (rows.length === 0) return null;
  return (
    <Section title={title}>
      <Table
        head={[title, t(lang, "resourcesReportHeadcount"), t(lang, "resourcesCapacityDays"), t(lang, "resourcesInternalCost"), t(lang, "resourcesExternalCost")]}
        widths={widths}
        startResize={startResize}
        cols={cols}
      >
        {rows.map((row) => (
          <tr key={row.key}>
            <Td>{row.label}</Td><TdR>{row.headcount}</TdR><TdR>{days(row.capacityHours)}</TdR><TdR>{money(row.internal)}</TdR><TdR>{money(row.external)}</TdR>
          </tr>
        ))}
      </Table>
    </Section>
  );
}

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

function Table<TId extends string>({
  head,
  widths,
  startResize,
  cols,
  children,
}: {
  head: string[];
  widths: Record<TId, number>;
  startResize: (col: TId, e: React.MouseEvent) => void;
  cols: readonly TId[];
  children: React.ReactNode;
}) {
  const startResizeAsString = startResize as (col: string, e: React.MouseEvent) => void;
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="min-w-full text-left text-sm">
        <thead className={TABLE_HEAD_CLASS}>
          <tr>
            {head.map((h, i) => (
              <th
                key={i}
                className={`relative px-3 py-2 font-medium ${i === 0 ? "" : "text-right"}`}
                style={{ width: widths[cols[i]], minWidth: widths[cols[i]] }}
              >
                {h}
                <ColumnResizeHandle col={cols[i]} onMouseDown={startResizeAsString} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 font-medium text-foreground">{children}</td>;
}
function TdR({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 text-right tabular-nums">{children}</td>;
}
