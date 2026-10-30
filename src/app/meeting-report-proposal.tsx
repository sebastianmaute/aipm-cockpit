"use client";
// AI-04 — the AI draft of a meeting report, held as a proposal above the editor: one row per
// section with a Take button, Take all and Discard, and a closed-by-default read-only Preview of
// the section. Presentational: what a take DOES to the editor text (planTake / applyTake and the
// Replace / Keep both confirm) lives in meeting-report-panel's take().
import { useId, useMemo } from "react";
import { t, type Lang } from "./i18n";
import { Button } from "./button";
import { buildRowTokens, rowLabel } from "./row-tokens";
import { RichTextView } from "./rich-text-view";
import { FOCUS_RING } from "./interaction-styles";
import { isBlankReport, sectionBodyHtml, type ReportSection } from "./committee-report/report-sections";

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
  const previewLabel = t(lang, "reportProposalPreview");
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
          const token = tokens.get(i) ?? name;
          // The row already names the section, so the preview shows its body only (no nested, repeated heading).
          const body = sectionBodyHtml(s.html);
          return (
            <li key={i} className="px-3 py-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className={INDENT[s.level]}>{name}</span>
                <div className="flex items-center gap-2">
                  {/* The taken state is TEXT, not colour alone (WCAG 1.4.1). A taken row's Take stays ENABLED: a
                      saved take can be undone or restored over, and the text must stay takeable (a second take of a
                      heading the report has asks Replace / Keep both). Take all still skips taken rows. */}
                  {isTaken ? <span className="text-muted-foreground">{t(lang, "reportProposalTaken")}</span> : null}
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => onTake([i])}
                    data-take-index={i}
                    data-taken={isTaken ? "true" : undefined}
                    aria-label={rowLabel(takeLabel, token)}
                  >
                    {takeLabel}
                  </Button>
                </div>
              </div>
              {/* Read the section before taking it. A native <details> (the house disclosure pattern): closed by
                  default, keyboard-operable through its <summary>, and toggling it moves no focus and changes no taken
                  state. The summary is named per row (WCAG 2.4.6) with its visible text first (2.5.3). The section
                  html is sanitized by the hook; RichTextView, the shared read-only sink, sanitizes it again. */}
              <details data-section-preview className={`mt-1 ${INDENT[s.level]}`}>
                <summary
                  className={`w-fit cursor-pointer rounded-sm text-muted-foreground hover:text-foreground ${FOCUS_RING}`}
                  aria-label={rowLabel(previewLabel, token)}
                >
                  {previewLabel}
                </summary>
                <div data-section-preview-body className="mt-1 rounded-sm border border-line bg-surface p-2">
                  {isBlankReport(body) ? (
                    <p className="text-muted-foreground">{t(lang, "reportProposalPreviewEmpty")}</p>
                  ) : (
                    <RichTextView html={body} />
                  )}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
