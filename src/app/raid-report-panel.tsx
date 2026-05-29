"use client";

import { useMemo, useState } from "react";
import { SegmentedControl } from "./segmented-control";
import { type Lang, t } from "./i18n";
import { PrintButton } from "./task-manager-ui";
import {
  UNASSIGNED_OWNER,
  computeRaidReport,
  type RaidReport,
} from "./raid-report";
import type { RaidItem } from "./types";

interface Props {
  lang: Lang;
  items: readonly RaidItem[];
  today: string;
}

type View = "summary" | "full";

export function RaidReportPanel({ lang, items, today }: Props) {
  const rep: RaidReport = useMemo(() => computeRaidReport(items, today), [items, today]);
  const [view, setView] = useState<View>("summary");

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line p-10 text-center text-sm text-muted-foreground">
        {t(lang, "raidReportEmpty")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-medium text-foreground">{t(lang, "raidReportTitle")}</h2>
        <div className="flex items-center gap-3 print:hidden">
          <SegmentedControl<View>
            value={view}
            ariaLabel={t(lang, "raidReportTitle")}
            options={[
              { value: "summary", label: t(lang, "raidReportSummary") },
              { value: "full", label: t(lang, "raidReportFullDetail") },
            ]}
            onChange={(v) => setView(v)}
          />
          <PrintButton lang={lang} />
        </div>
      </div>

      {view === "summary" && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label={t(lang, "raidReportOpenRisks")} value={String(rep.tiles.openR)} />
            <Tile label={t(lang, "raidReportOpenAssumptions")} value={String(rep.tiles.openA)} />
            <Tile label={t(lang, "raidReportOpenIssues")} value={String(rep.tiles.openI)} />
            <Tile label={t(lang, "raidReportOpenDependencies")} value={String(rep.tiles.openD)} />
          </div>
          <Section title={t(lang, "raidReportBySeverity")}>
            <ReportTableShell
              head={
                <>
                    <th className="px-3 py-2 font-medium">{t(lang, "raidReportBySeverity")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "raidCategoryRisk")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "raidCategoryAssumption")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "raidCategoryIssue")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "raidCategoryDependency")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "raidReportColTotal")}</th>
                </>
              }
            >
                  {rep.bySeverity.map((row) => (
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
            </ReportTableShell>
          </Section>
          <Section title={t(lang, "raidReportByStatus")}>
            <ReportTableShell
              head={
                <>
                    <th className="px-3 py-2 font-medium">{t(lang, "raidReportByStatus")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "raidReportColOpen")}</th>
                </>
              }
            >
                  {rep.byStatus.map((row) => (
                    <tr key={row.status}>
                      <td className="px-3 py-2 font-medium text-foreground">{row.status}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.count}</td>
                    </tr>
                  ))}
            </ReportTableShell>
          </Section>
          <Section title={t(lang, "raidReportByOwner")}>
            <ReportTableShell
              head={
                <>
                    <th className="px-3 py-2 font-medium">{t(lang, "raidReportByOwner")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "raidCategoryRisk")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "raidCategoryAssumption")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "raidCategoryIssue")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "raidCategoryDependency")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "raidReportColTotal")}</th>
                </>
              }
            >
                  {rep.byOwner.map((row) => (
                    <tr key={row.owner}>
                      <td className="px-3 py-2 font-medium text-foreground">{ownerCell(lang, row.owner)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.openR}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.openA}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.openI}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.openD}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{row.total}</td>
                    </tr>
                  ))}
            </ReportTableShell>
          </Section>
          <Section title={t(lang, "raidReportTopOpen")}>
            <ReportTableShell
              head={
                <>
                    <th className="px-3 py-2 font-medium">{t(lang, "id")}</th>
                    <th className="px-3 py-2 font-medium">{t(lang, "raidCategory")}</th>
                    <th className="px-3 py-2 font-medium">{t(lang, "raidTitle")}</th>
                    <th className="px-3 py-2 font-medium">{t(lang, "raidSeverity")}</th>
                    <th className="px-3 py-2 font-medium">{t(lang, "raidOwner")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "raidReportColAge")}</th>
                </>
              }
            >
                  {rep.topOpen.map((row) => (
                    <tr key={row.id}>
                      <td className="px-3 py-2 text-muted-foreground tabular-nums">{row.id}</td>
                      <td className="px-3 py-2">{row.category}</td>
                      <td className="px-3 py-2 text-foreground">
                        <span className="block max-w-[40ch] truncate" title={row.title}>{row.title}</span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{row.severity ?? ""}</td>
                      <td className="px-3 py-2">{ownerCell(lang, row.owner)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${row.overdue ? "text-AIPM-pink font-medium" : "text-muted-foreground"}`}>
                        {row.ageDays}d
                      </td>
                    </tr>
                  ))}
            </ReportTableShell>
          </Section>
          <Section title={t(lang, "raidReportByCategory")}>
            <ReportTableShell
              head={
                <>
                    <th className="px-3 py-2 font-medium">{t(lang, "raidReportByCategory")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "raidReportColOpen")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "raidReportColClosed")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "raidReportColOverdue")}</th>
                </>
              }
            >
                  {rep.byCategory.map((row) => (
                    <tr key={row.category}>
                      <td className="px-3 py-2 font-medium text-foreground">{row.category}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.open}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{row.closed}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${row.overdue > 0 ? "text-AIPM-pink font-medium" : "text-muted-foreground"}`}>{row.overdue}</td>
                    </tr>
                  ))}
            </ReportTableShell>
          </Section>
          <Section title={t(lang, "raidReportByAging")}>
            <ReportTableShell
              head={
                <>
                    <th className="px-3 py-2 font-medium">{t(lang, "raidReportByAging")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "raidReportColOpen")}</th>
                </>
              }
            >
                  {rep.byAging.map((row) => (
                    <tr key={row.bucket}>
                      <td className="px-3 py-2 font-medium text-foreground">{agingLabel(lang, row.bucket)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.open}</td>
                    </tr>
                  ))}
            </ReportTableShell>
          </Section>
        </>
      )}

      {view === "full" && (
        <FullDetail lang={lang} rows={rep.fullDetail} />
      )}
    </div>
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

/**
 * Scrollable bordered table shell with the standard sticky header styling used
 * by every summary section. `head` is the `<tr>`'s header cells; `children` are
 * the `<tbody>` rows.
 */
function ReportTableShell({
  head,
  children,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="min-w-full text-left text-sm">
        <thead className="sticky top-0 z-10 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

type DetailSortKey = "id" | "category" | "title" | "severity" | "status" | "owner" | "raisedDate" | "targetDate" | "ageDays" | "linkedTaskCount";
type DetailSortDir = "asc" | "desc" | "off";

function FullDetail({ lang, rows }: { lang: Lang; rows: RaidReport["fullDetail"] }) {
  const [sortKey, setSortKey] = useState<DetailSortKey>("category");
  const [sortDir, setSortDir] = useState<DetailSortDir>("asc");

  function clickHeader(k: DetailSortKey) {
    if (k !== sortKey) {
      setSortKey(k);
      setSortDir("asc");
      return;
    }
    setSortDir((d) => (d === "asc" ? "desc" : d === "desc" ? "off" : "asc"));
  }

  const sorted = useMemo(() => {
    if (sortDir === "off") return rows;
    const cmp = (a: RaidReport["fullDetail"][number], b: RaidReport["fullDetail"][number]): number => {
      const av = (a[sortKey] ?? "") as string | number;
      const bv = (b[sortKey] ?? "") as string | number;
      if (av === bv) return a.id - b.id;
      return av < bv ? -1 : 1;
    };
    const arr = rows.slice().sort(cmp);
    if (sortDir === "desc") arr.reverse();
    return arr;
  }, [rows, sortKey, sortDir]);

  function indicator(k: DetailSortKey) {
    if (sortKey !== k || sortDir === "off") return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="min-w-full text-left text-sm">
        <thead className="sticky top-0 z-10 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <SortTh label={t(lang, "id")} k="id" sortKey={sortKey} dir={sortDir} onClick={clickHeader} indicator={indicator("id")} />
            <SortTh label={t(lang, "raidCategory")} k="category" sortKey={sortKey} dir={sortDir} onClick={clickHeader} indicator={indicator("category")} />
            <SortTh label={t(lang, "raidTitle")} k="title" sortKey={sortKey} dir={sortDir} onClick={clickHeader} indicator={indicator("title")} />
            <SortTh label={t(lang, "raidSeverity")} k="severity" sortKey={sortKey} dir={sortDir} onClick={clickHeader} indicator={indicator("severity")} />
            <SortTh label={t(lang, "raidStatus")} k="status" sortKey={sortKey} dir={sortDir} onClick={clickHeader} indicator={indicator("status")} />
            <SortTh label={t(lang, "raidOwner")} k="owner" sortKey={sortKey} dir={sortDir} onClick={clickHeader} indicator={indicator("owner")} />
            <SortTh label={t(lang, "raidReportColRaised")} k="raisedDate" sortKey={sortKey} dir={sortDir} onClick={clickHeader} indicator={indicator("raisedDate")} />
            <SortTh label={t(lang, "raidReportColTarget")} k="targetDate" sortKey={sortKey} dir={sortDir} onClick={clickHeader} indicator={indicator("targetDate")} />
            <SortTh label={t(lang, "raidReportColAge")} k="ageDays" sortKey={sortKey} dir={sortDir} onClick={clickHeader} indicator={indicator("ageDays")} />
            <SortTh label={t(lang, "raidReportColLinkedTasks")} k="linkedTaskCount" sortKey={sortKey} dir={sortDir} onClick={clickHeader} indicator={indicator("linkedTaskCount")} />
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
              <td className={`px-3 py-2 tabular-nums ${r.overdue ? "text-AIPM-pink font-medium" : "text-muted-foreground"}`}>
                {r.targetDate ?? "—"}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{r.ageDays}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.linkedTaskCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortTh({
  label, k, sortKey, dir, onClick, indicator,
}: {
  label: string;
  k: DetailSortKey;
  sortKey: DetailSortKey;
  dir: DetailSortDir;
  onClick: (k: DetailSortKey) => void;
  indicator: string;
}) {
  const active = sortKey === k && dir !== "off";
  return (
    <th className="px-3 py-2 font-medium">
      <button
        type="button"
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 ${active ? "text-foreground" : ""} hover:text-foreground`}
      >
        {label}{indicator}
      </button>
    </th>
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

export { Section, ownerCell };
