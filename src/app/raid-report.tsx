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
