"use client";

import { useMemo, useState } from "react";
import { SegmentedControl } from "./segmented-control";
import { type Lang, t } from "./i18n";
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
        <SegmentedControl<View>
          value={view}
          ariaLabel={t(lang, "raidReportTitle")}
          options={[
            { value: "summary", label: t(lang, "raidReportSummary") },
            { value: "full", label: t(lang, "raidReportFullDetail") },
          ]}
          onChange={(v) => setView(v)}
        />
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
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="min-w-full text-left text-sm">
                <thead className="sticky top-0 z-10 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t(lang, "raidReportBySeverity")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "raidCategoryRisk")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "raidCategoryAssumption")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "raidCategoryIssue")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "raidCategoryDependency")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "raidReportColTotal")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
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
                </tbody>
              </table>
            </div>
          </Section>
          <Section title={t(lang, "raidReportByStatus")}>
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="min-w-full text-left text-sm">
                <thead className="sticky top-0 z-10 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t(lang, "raidReportByStatus")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "raidReportColOpen")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rep.byStatus.map((row) => (
                    <tr key={row.status}>
                      <td className="px-3 py-2 font-medium text-foreground">{row.status}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          <Section title={t(lang, "raidReportByOwner")}>
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="min-w-full text-left text-sm">
                <thead className="sticky top-0 z-10 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t(lang, "raidReportByOwner")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "raidCategoryRisk")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "raidCategoryAssumption")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "raidCategoryIssue")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "raidCategoryDependency")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "raidReportColTotal")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
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
                </tbody>
              </table>
            </div>
          </Section>
          <Section title={t(lang, "raidReportTopOpen")}>
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="min-w-full text-left text-sm">
                <thead className="sticky top-0 z-10 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t(lang, "id")}</th>
                    <th className="px-3 py-2 font-medium">{t(lang, "raidCategory")}</th>
                    <th className="px-3 py-2 font-medium">{t(lang, "raidTitle")}</th>
                    <th className="px-3 py-2 font-medium">{t(lang, "raidSeverity")}</th>
                    <th className="px-3 py-2 font-medium">{t(lang, "raidOwner")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t(lang, "raidReportColAge")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
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
                </tbody>
              </table>
            </div>
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

// Filled in by Task 9.
function FullDetail({ lang, rows }: { lang: Lang; rows: RaidReport["fullDetail"] }) {
  void lang; void rows;
  return null;
}

function ownerCell(lang: Lang, owner: string) {
  if (owner === UNASSIGNED_OWNER) {
    return <span className="italic text-muted-foreground">{t(lang, "raidReportUnassigned")}</span>;
  }
  return owner;
}

export { Section, ownerCell };
