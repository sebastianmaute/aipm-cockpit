"use client";
// Presentational report pane for a steering-committee meeting's status report.
// Props-only (no context) — the steering panel is unit-tested outside providers,
// and this renders inside a shared Modal (see steering-committee-panel). The rich
// editor loads via next/dynamic (Tiptap is browser-only). Save/send/generate/
// restore are all no-ops in popouts (read-only).
import { useState } from "react";
import dynamic from "next/dynamic";
import { t, type Lang } from "./i18n";
import type { CommitteeMeeting, MeetingReport } from "./types";
import { sanitizeTemplateHtml } from "./sanitize-html";
import { INTERACTIVE } from "./interaction-styles";

const RichTextEditor = dynamic(() => import("./rich-text-editor").then((m) => m.RichTextEditor), {
  ssr: false,
  loading: () => <div className="min-h-40 rounded-md border border-line bg-surface-muted" />,
});

const BTN_PRIMARY =
  "rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90 disabled:opacity-60";
const BTN_SECONDARY =
  "rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted disabled:opacity-60";

function rteLabels(lang: Lang) {
  return {
    bold: t(lang, "commTplBold"),
    italic: t(lang, "commTplItalic"),
    underline: t(lang, "commTplUnderline"),
    heading1: t(lang, "commTplHeading1"),
    heading2: t(lang, "commTplHeading2"),
    bulletList: t(lang, "commTplBulletList"),
    numberedList: t(lang, "commTplNumberedList"),
    link: t(lang, "commTplLink"),
    unlink: t(lang, "commTplUnlink"),
    linkPrompt: t(lang, "commTplLinkPrompt"),
  };
}

/** UI-facing subset of a stored MeetingReportVersion (Slice 3). */
export interface MeetingReportVersionUi {
  id: string;
  capturedAt: string;
  isAuto: boolean;
}

export interface MeetingReportPanelProps {
  lang: Lang;
  meeting: CommitteeMeeting;
  report: MeetingReport | undefined;
  recipients: readonly string[];
  onSave: (html: string) => void;
  onSend: () => void;
  m365Configured: boolean;
  sendBusy?: boolean;
  isPopout?: boolean;
  // Slice 2 (AI draft):
  onGenerate?: () => void;
  generateBusy?: boolean;
  aiConfigured?: boolean;
  // Slice 3 (Turso versions):
  versions?: readonly MeetingReportVersionUi[];
  onRestore?: (versionId: string) => void;
  restoreBusyId?: string | null;
}

export function MeetingReportPanel({
  lang,
  report,
  recipients,
  onSave,
  onSend,
  m365Configured,
  sendBusy,
  isPopout,
  onGenerate,
  generateBusy,
  aiConfigured,
  versions,
  onRestore,
  restoreBusyId,
}: MeetingReportPanelProps) {
  const readOnly = !!isPopout;
  const [draft, setDraft] = useState(report?.html ?? "");
  const [seenUpdatedAt, setSeenUpdatedAt] = useState(report?.updatedAt);
  // Render-time reconcile (NOT an effect — set-state-in-effect is banned): when a
  // NEW report body arrives (AI draft or a restore bumps updatedAt), re-seed the
  // draft. A plain user edit leaves updatedAt unchanged, so typing isn't clobbered.
  if (report?.updatedAt !== seenUpdatedAt) {
    setSeenUpdatedAt(report?.updatedAt);
    setDraft(report?.html ?? "");
  }

  const noRecipients = recipients.length === 0;

  return (
    <div className="flex flex-col gap-3">
      {aiConfigured && onGenerate && !readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onGenerate}
            disabled={generateBusy}
            className={`${BTN_SECONDARY} ${INTERACTIVE}`}
          >
            {t(lang, generateBusy ? "reportGenerating" : "reportDraftWithAi")}
          </button>
        </div>
      )}

      {readOnly ? (
        <div
          className="min-h-40 rounded-md border border-line bg-surface p-3 text-sm"
          // Body is sanitized at write time; re-sanitize on render (defense-in-depth).
          dangerouslySetInnerHTML={{ __html: sanitizeTemplateHtml(report?.html ?? "") }}
        />
      ) : (
        <RichTextEditor
          value={draft}
          onChange={setDraft}
          label={t(lang, "reportBody")}
          mergeFields={[]}
          fieldLabel={(f) => f}
          labels={rteLabels(lang)}
        />
      )}

      {versions && versions.length > 0 && onRestore && !readOnly && (
        <details className="rounded-md border border-line">
          <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium">
            {t(lang, "reportVersions")} ({versions.length})
          </summary>
          <ul className="divide-y divide-line">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                <span>
                  {v.capturedAt} · {t(lang, v.isAuto ? "reportVersionAuto" : "reportVersionManual")}
                </span>
                <button
                  type="button"
                  onClick={() => onRestore(v.id)}
                  disabled={restoreBusyId === v.id}
                  className={`${BTN_SECONDARY} ${INTERACTIVE}`}
                  aria-label={`${t(lang, "reportRestore")} – ${v.capturedAt}`}
                >
                  {t(lang, "reportRestore")}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="text-xs text-muted-foreground">
        {t(lang, "reportTo")}: {noRecipients ? t(lang, "reportNoRecipients") : recipients.join(", ")}
      </p>

      {!readOnly && (
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={() => onSave(draft)} className={`${BTN_SECONDARY} ${INTERACTIVE}`}>
            {t(lang, "reportSave")}
          </button>
          <button
            type="button"
            onClick={onSend}
            disabled={!m365Configured || sendBusy || noRecipients}
            className={`${BTN_PRIMARY} ${INTERACTIVE}`}
          >
            {t(lang, sendBusy ? "reportSending" : "reportSend")}
          </button>
        </div>
      )}
    </div>
  );
}
