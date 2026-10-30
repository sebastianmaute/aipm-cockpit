"use client";
// AI-04 — the AI draft of a meeting report, held as a proposal beside the editor: one row per
// section with a Take button, Take all and Discard. Presentational: what a take DOES to the
// editor text (planTake / applyTake and the replace confirm) lives in meeting-report-panel.
import { useId, useMemo } from "react";
import { t, type Lang } from "./i18n";
import { Button } from "./button";
import { buildRowTokens, rowLabel } from "./row-tokens";
import type { ReportSection } from "./committee-report/report-sections";

export interface MeetingReportProposalProps {
  lang: Lang;
  sections: readonly ReportSection[];
  /** Indices into `sections` already taken into the report. */
  taken: ReadonlySet<number>;
  onTake: (indices: number[]) => void;
  onDiscard: () => void;
}

/** A row's visible name, which is also its row token's name. */
function sectionName(lang: Lang, s: ReportSection): string {
  if (s.level === 0) return t(lang, "reportProposalOpening");
  return s.heading === "" ? t(lang, "reportProposalUntitled") : s.heading;
}

/** Sub-sections are indented by level (h1 and h2 sit flush). */
const INDENT = ["", "", "", "pl-3", "pl-6"] as const;

export function MeetingReportProposal({ lang, sections, taken, onTake, onDiscard }: MeetingReportProposalProps) {
  // Two sections can share a heading, so the Take names are disambiguated (WCAG 2.4.6).
  const tokens = useMemo(
    () => buildRowTokens(sections.map((s, i) => ({ id: i, name: sectionName(lang, s) }))),
    [sections, lang],
  );
  const untaken = sections.map((_, i) => i).filter((i) => !taken.has(i));
  const takeLabel = t(lang, "reportProposalTake");
  const headingId = useId();

  return (
    <section className="rounded-md border border-line" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
        <h3 id={headingId} tabIndex={-1} data-proposal-heading className="text-xs font-medium">
          {t(lang, "reportProposalHeading")}
        </h3>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="xs" onClick={() => onTake(untaken)} disabled={untaken.length === 0} data-take-all>
            {t(lang, "reportProposalTakeAll")}
          </Button>
          <Button variant="secondary" size="xs" onClick={onDiscard} data-discard>
            {t(lang, "reportProposalDiscard")}
          </Button>
        </div>
      </div>
      <ul className="divide-y divide-line border-t border-line">
        {sections.map((s, i) => {
          const isTaken = taken.has(i);
          const name = sectionName(lang, s);
          return (
            <li key={i} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
              <span className={INDENT[s.level]}>{name}</span>
              <div className="flex items-center gap-2">
                {/* The taken state is TEXT, not colour alone (WCAG 1.4.1). */}
                {isTaken ? <span className="text-muted-foreground">{t(lang, "reportProposalTaken")}</span> : null}
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => onTake([i])}
                  disabled={isTaken}
                  data-take-index={i}
                  aria-label={rowLabel(takeLabel, tokens.get(i) ?? name)}
                >
                  {takeLabel}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
