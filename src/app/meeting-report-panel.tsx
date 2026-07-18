"use client";
// Presentational report pane for a steering-committee meeting's status report.
// Props-only (no context) — the steering panel is unit-tested outside providers,
// and this renders inside a shared Modal (see steering-committee-panel). The rich
// editor loads via next/dynamic (Tiptap is browser-only). Save/send/generate/
// restore are all no-ops in popouts (read-only).
import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { t, type Lang } from "./i18n";
import type { MeetingReport } from "./types";
import { sanitizeTemplateHtml } from "./sanitize-html";
import { htmlToPlainText } from "./html-to-text";
import { diffLines } from "./text-diff";
import { CommTemplateDiffView } from "./comm-template-diff-view";
import { Button } from "./button";
import { Input } from "./form-controls";

const RichTextEditor = dynamic(() => import("./rich-text-editor").then((m) => m.RichTextEditor), {
  ssr: false,
  loading: () => <div className="min-h-40 rounded-md border border-line bg-surface-muted" />,
});

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
  /** Snapshot body — used to render a diff against the current report. */
  html: string;
}

export interface MeetingReportPanelProps {
  lang: Lang;
  report: MeetingReport | undefined;
  /** Initial recipients (committee members' emails) — editable before send. */
  recipients: readonly string[];
  onSave: (html: string) => void;
  onSend: (recipients: readonly string[]) => void;
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

function parseRecipients(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const email = part.trim();
    if (email && !seen.has(email.toLowerCase())) {
      seen.add(email.toLowerCase());
      out.push(email);
    }
  }
  return out;
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

  // Recipients are seeded from the committee members but EDITABLE before send
  // (fresh mount per modal-open re-seeds from the current members).
  const [toList, setToList] = useState(recipients.join(", "));
  const parsedRecipients = parseRecipients(toList);
  const noRecipients = parsedRecipients.length === 0;

  // Version-diff: compare the CURRENT draft against a selected version's snapshot.
  const [compareVersionId, setCompareVersionId] = useState<string | null>(null);
  const compareVersion = versions?.find((v) => v.id === compareVersionId) ?? null;
  // Hoist the member out of the dep array (exhaustive-deps bans obj.member) and
  // memoize the diff so it doesn't recompute on every editor keystroke.
  const compareHtml = compareVersion?.html;
  const diffResult = useMemo(
    () =>
      compareHtml == null
        ? null
        : diffLines(htmlToPlainText(compareHtml).split("\n"), htmlToPlainText(draft).split("\n")),
    [compareHtml, draft],
  );

  return (
    <div className="flex flex-col gap-3">
      {aiConfigured && onGenerate && !readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="xs"
            onClick={onGenerate}
            disabled={generateBusy}
          >
            {t(lang, generateBusy ? "reportGenerating" : "reportDraftWithAi")}
          </Button>
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
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => setCompareVersionId((cur) => (cur === v.id ? null : v.id))}
                    aria-expanded={compareVersionId === v.id}
                    aria-label={`${t(lang, "reportDiff")} – ${v.capturedAt}`}
                  >
                    {t(lang, "reportDiff")}
                  </Button>
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => onRestore(v.id)}
                    disabled={restoreBusyId === v.id}
                    aria-label={`${t(lang, "reportRestore")} – ${v.capturedAt}`}
                  >
                    {t(lang, "reportRestore")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {compareVersion && diffResult && (
            <div className="border-t border-line px-3 py-2">
              <CommTemplateDiffView
                lines={diffResult}
                addedLabel={t(lang, "reportDiffCurrent")}
                removedLabel={t(lang, "reportDiffVersion")}
                summary={`${t(lang, "reportDiff")} – ${compareVersion.capturedAt}`}
              />
            </div>
          )}
        </details>
      )}

      {readOnly ? null : (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t(lang, "reportTo")}
          <Input
            type="text"
            size="xs"
            className="w-full"
            value={toList}
            onChange={(e) => setToList(e.target.value)}
            aria-label={t(lang, "reportTo")}
          />
          {noRecipients && <span className="text-ui-pink-strong">{t(lang, "reportNoRecipients")}</span>}
        </label>
      )}

      {!readOnly && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="xs" onClick={() => onSave(draft)}>
            {t(lang, "reportSave")}
          </Button>
          <Button
            size="xs"
            onClick={() => onSend(parsedRecipients)}
            disabled={!m365Configured || sendBusy || noRecipients}
          >
            {t(lang, sendBusy ? "reportSending" : "reportSend")}
          </Button>
        </div>
      )}
    </div>
  );
}
