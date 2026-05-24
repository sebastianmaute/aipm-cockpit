"use client";

import { useMemo } from "react";
import { type Lang, t } from "./i18n";
import { computeResourceReport, type ReportGroupRow } from "./resource-report";
import { formatCurrency } from "./resource-cost";
import type { Absence, Discipline, Grade, Resource, ResourcePlan, Role } from "./types";

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

function localeFor(lang: Lang): string {
  if (lang === "de") return "de-DE";
  if (lang === "en-GB") return "en-GB";
  return "en-US";
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

  if (resources.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-AIPM-light-grey p-10 text-center text-sm text-AIPM-medium-grey dark:border-zinc-800">
        {t(lang, "resourcesReportEmpty")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">{t(lang, "resourcesReportTitle")}</h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label={t(lang, "resourcesReportTotalCapacity")} value={`${days(rep.totalCapacityHours)} d`} />
        <Tile label={t(lang, "resourcesInternalCost")} value={money(rep.totalInternal)} />
        <Tile label={t(lang, "resourcesExternalCost")} value={money(rep.totalExternal)} />
        <Tile label={t(lang, "resourcesMargin")} value={money(rep.totalMargin)} />
      </div>

      <Section title={t(lang, "resourcesReportByPeriod")}>
        <Table head={[t(lang, "resourcesReportByPeriod"), t(lang, "resourcesCapacityDays"), t(lang, "resourcesInternalCost"), t(lang, "resourcesExternalCost"), t(lang, "resourcesMargin")]}>
          {rep.perPeriod.map((p) => (
            <tr key={p.key}>
              <Td>{p.key}</Td><TdR>{days(p.capacityHours)}</TdR><TdR>{money(p.internal)}</TdR><TdR>{money(p.external)}</TdR><TdR>{money(p.margin)}</TdR>
            </tr>
          ))}
        </Table>
      </Section>

      <GroupSection title={t(lang, "resourcesReportByDiscipline")} rows={rep.perDiscipline} lang={lang} days={days} money={money} />
      <GroupSection title={t(lang, "resourcesReportByGrade")} rows={rep.perGrade} lang={lang} days={days} money={money} />
      <GroupSection title={t(lang, "resourcesReportByCombo")} rows={rep.perCombo} lang={lang} days={days} money={money} />

      <Section title={t(lang, "resourcesReportByResource")}>
        <Table head={[t(lang, "assignee"), t(lang, "resourcesRole"), t(lang, "resourcesReportAvgUtil"), t(lang, "resourcesCapacityDays"), t(lang, "resourcesInternalCost"), t(lang, "resourcesExternalCost")]}>
          {rep.perResource.map((r) => (
            <tr key={r.id}>
              <Td>{r.name}</Td>
              <Td>{r.hasRole ? r.roleLabel : <span className="italic text-AIPM-medium-grey">{t(lang, "resourcesUnassignedRole")}</span>}</Td>
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

function GroupSection({ title, rows, lang, days, money }: {
  title: string; rows: ReportGroupRow[]; lang: Lang; days: (h: number) => string; money: (n: number) => string;
}) {
  if (rows.length === 0) return null;
  return (
    <Section title={title}>
      <Table head={[title, t(lang, "resourcesReportHeadcount"), t(lang, "resourcesCapacityDays"), t(lang, "resourcesInternalCost"), t(lang, "resourcesExternalCost")]}>
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
    <div className="rounded-lg border border-AIPM-light-grey bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs uppercase tracking-wide text-AIPM-medium-grey">{label}</p>
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

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-AIPM-light-grey dark:border-zinc-800">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-AIPM-light-grey/50 uppercase tracking-wide text-AIPM-dark-grey dark:bg-zinc-900 dark:text-AIPM-medium-grey">
          <tr>{head.map((h, i) => <th key={i} className={`px-3 py-2 ${i === 0 ? "" : "text-right"}`}>{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-AIPM-light-grey dark:divide-zinc-800">{children}</tbody>
      </table>
    </div>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey">{children}</td>;
}
function TdR({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 text-right tabular-nums">{children}</td>;
}
