"use client";
// AI-04 — the stored report's previous version (`MeetingReport.previous`): its save time, a line
// diff against the current draft, and Restore. Presentational; the unsaved-changes confirm before a
// restore lives in meeting-report-panel, which owns the draft.
import { useMemo, useState } from "react";
import { t, type Lang } from "./i18n";
import type { MeetingReport } from "./types";
import { htmlToPlainText } from "./html-to-text";
import { diffLines } from "./text-diff";
import { CommTemplateDiffView } from "./comm-template-diff-view";
import { Button } from "./button";
import { rowLabel } from "./row-tokens";

export interface MeetingReportPreviousProps {
  lang: Lang;
  previous: NonNullable<MeetingReport["previous"]>;
  /** The editor's current text, compared against the previous version. */
  draft: string;
  onRestore: () => void;
}

export function MeetingReportPrevious({ lang, previous, draft, onRestore }: MeetingReportPreviousProps) {
  const [comparing, setComparing] = useState(false);
  const previousHtml = previous.html;
  const diff = useMemo(
    () =>
      comparing
        ? diffLines(htmlToPlainText(previousHtml).split("\n"), htmlToPlainText(draft).split("\n"))
        : null,
    [comparing, previousHtml, draft],
  );
  // The versions list beside this one also has Compare and Restore buttons, so these carry a token.
  const name = t(lang, "reportPreviousVersionName");
  const compareLabel = rowLabel(t(lang, "reportDiff"), name);

  return (
    <div className="rounded-md border border-line">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-xs">
        <span>{t(lang, "reportPreviousVersion", previous.savedAt)}</span>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="xs"
            onClick={() => setComparing((c) => !c)}
            aria-expanded={comparing}
            aria-label={compareLabel}
          >
            {t(lang, "reportDiff")}
          </Button>
          <Button variant="secondary" size="xs" onClick={onRestore} aria-label={rowLabel(t(lang, "reportRestore"), name)}>
            {t(lang, "reportRestore")}
          </Button>
        </div>
      </div>
      {diff ? (
        <div className="border-t border-line px-3 py-2">
          <CommTemplateDiffView
            lines={diff}
            addedLabel={t(lang, "reportDiffCurrent")}
            removedLabel={name}
            summary={compareLabel}
          />
        </div>
      ) : null}
    </div>
  );
}
