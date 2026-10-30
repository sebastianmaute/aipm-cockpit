"use client";
// Presentational report pane for a steering-committee meeting's status report.
// Props-only (no context) — the steering panel is unit-tested outside providers,
// and this renders inside a shared Modal (see steering-committee-panel). The rich
// editor comes from rich-text-editor-lazy (Tiptap is browser-only). Save/send/generate/
// restore are all no-ops in popouts (read-only).
// AI-04 — an AI draft arrives as a PROPOSAL (held by use-meeting-report-actions, passed in as
// `proposal`), taken into the editor text by section; the stored previous version can be
// compared and restored.
import { useEffect, useMemo, useRef, useState } from "react";
import { t, type Lang } from "./i18n";
import type { MeetingReport } from "./types";
import { sanitizeRichHtml } from "./sanitize-html";
import { htmlToPlainText } from "./html-to-text";
import { diffLines } from "./text-diff";
import { CommTemplateDiffView } from "./comm-template-diff-view";
import { Button } from "./button";
import { buildRowTokens, rowLabel } from "./row-tokens";
import { AiTriggerButton } from "./ai-trigger-button";
import { Input } from "./form-controls";
import { RichTextEditor } from "./rich-text-editor-lazy";
import { useConfirm, useNotice } from "./confirm-dialog";
import { planTake, applyTake, isBlankReport, type TakePlan } from "./committee-report/report-sections";
import type { ReportProposal } from "./use-meeting-report-actions";
import { MeetingReportProposal } from "./meeting-report-proposal";
import { MeetingReportPrevious } from "./meeting-report-previous";

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
  /** `fromAi` is true when the saved text contains sections taken from the AI proposal. */
  /** Returns whether the report was actually written (false: identical body, or the meeting is gone). */
  onSave: (html: string, opts?: { fromAi?: boolean }) => boolean;
  onSend: (recipients: readonly string[]) => void;
  m365Configured: boolean;
  sendBusy?: boolean;
  isPopout?: boolean;
  // Slice 2 (AI draft):
  onGenerate?: () => void;
  /** Stops the in-flight AI draft (§125). While busy the trigger reads "Stop". */
  onCancelGenerate?: () => void;
  generateBusy?: boolean;
  aiConfigured?: boolean;
  // Slice 3 (Turso versions):
  versions?: readonly MeetingReportVersionUi[];
  onRestore?: (versionId: string) => void;
  restoreBusyId?: string | null;
  // AI-04:
  proposal?: ReportProposal;
  onTaken?: (indices: readonly number[]) => void;
  onDiscardProposal?: () => void;
  /** Swap the stored report with its previous version. */
  onRestorePrevious?: () => void;
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

/** The replace confirm's message: one line per user section a take would replace. */
function takeConfirmMessage(lang: Lang, plan: TakePlan): string {
  const lines = plan.replacements.map((r) =>
    r.removedSubheadings.length > 0
      ? t(lang, "reportTakeConfirmBody", r.userHeading, r.removedSubheadings.join(", "))
      : t(lang, "reportTakeConfirmBodyNoSub", r.userHeading),
  );
  return [...lines, "", t(lang, "reportTakeConfirmHint")].join("\n");
}

/** I-2 (WCAG 2.4.3) — after a take, focus goes to the next untaken row's Take (wrapping to an earlier
 *  one), else Take all, else Discard, else the proposal heading. */
function focusAfterTake(root: HTMLElement | null, after: number): void {
  if (!root) return;
  // A taken row's Take stays enabled (it can be taken again), so "untaken" is read off `data-taken`.
  const takes = [...root.querySelectorAll<HTMLButtonElement>("button[data-take-index]")].filter(
    (b) => !b.disabled && b.dataset.taken !== "true",
  );
  const next =
    takes.find((b) => Number(b.dataset.takeIndex) > after) ??
    takes[0] ??
    root.querySelector<HTMLElement>("button[data-take-all]:not(:disabled)") ??
    root.querySelector<HTMLElement>("button[data-discard]") ??
    root.querySelector<HTMLElement>("[data-proposal-heading]");
  next?.focus();
}

/** A version row's visible text, which is also its row token's name (§669). */
function versionLabel(lang: Lang, v: MeetingReportVersionUi): string {
  return `${v.capturedAt} · ${t(lang, v.isAuto ? "reportVersionAuto" : "reportVersionManual")}`;
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
  onCancelGenerate,
  generateBusy,
  aiConfigured,
  versions,
  onRestore,
  restoreBusyId,
  proposal,
  onTaken,
  onDiscardProposal,
  onRestorePrevious,
}: MeetingReportPanelProps) {
  const readOnly = !!isPopout;
  const confirm = useConfirm();
  const notice = useNotice();
  const [draft, setDraft] = useState(report?.html ?? "");
  const [seenUpdatedAt, setSeenUpdatedAt] = useState(report?.updatedAt);
  // AI-04 — a take rewrites the draft, and the editor binds its content once at mount, so a take
  // bumps this to remount it (the key below). Typing never does.
  const [seedNonce, setSeedNonce] = useState(0);
  // Panel-local: whether the draft holds text taken from the proposal since the last save. Not
  // persisted — closing the dialog with unsaved taken text loses it with the rest of the draft.
  const [tookFromProposal, setTookFromProposal] = useState(false);
  // I-1 — sections taken into the draft but not saved yet. They show as Taken here at once, and reach
  // the proposal (onTaken) only with the Save that stores their text; a draft closed unsaved leaves
  // the proposal untouched.
  const [pendingTaken, setPendingTaken] = useState<ReadonlySet<number>>(() => new Set());
  // Unsaved taken marks are indices into ONE proposal: a regenerated draft (new createdAt) or a
  // discarded one (undefined) drops them, by the same render-time reconcile as the one above.
  // tookFromProposal stays: the draft really does hold AI text.
  const [seenProposalAt, setSeenProposalAt] = useState(proposal?.createdAt);
  if (proposal?.createdAt !== seenProposalAt) {
    setSeenProposalAt(proposal?.createdAt);
    setPendingTaken(new Set());
  }
  // M-1 — the stored body's stamp and the proposal's as last committed, read after the take's confirm resolves.
  const updatedAtRef = useRef(report?.updatedAt);
  const proposalAtRef = useRef(proposal?.createdAt);
  useEffect(() => {
    updatedAtRef.current = report?.updatedAt;
    proposalAtRef.current = proposal?.createdAt;
  });
  // I-2 — the last proposal index a take just applied; the effect below moves focus on from its
  // now-taken row once the take has rendered.
  const focusAfterTakeRef = useRef<number | null>(null);
  const proposalRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const after = focusAfterTakeRef.current;
    if (after === null) return;
    focusAfterTakeRef.current = null;
    focusAfterTake(proposalRef.current, after);
  });
  // Render-time reconcile (NOT an effect — set-state-in-effect is banned): when a
  // NEW report body arrives (AI draft or a restore bumps updatedAt), re-seed the
  // draft. A plain user edit leaves updatedAt unchanged, so typing isn't clobbered.
  if (report?.updatedAt !== seenUpdatedAt) {
    setSeenUpdatedAt(report?.updatedAt);
    setDraft(report?.html ?? "");
    setTookFromProposal(false);
    setPendingTaken(new Set());
  }
  // Unsaved edits: what a restore or an undo of this report would overwrite.
  const dirty = draft !== (report?.html ?? "");

  async function take(indices: number[]): Promise<void> {
    if (!proposal || indices.length === 0) return;
    const base = draft;
    const startedAt = report?.updatedAt;
    const proposalAt = proposal.createdAt;
    const plan = planTake(base, proposal.sections, indices);
    // A section the report already has asks first: Replace swaps it (and its sub-sections) for the
    // AI text; Keep both — or dismissing the dialog — adds the AI text after it.
    const replace =
      plan.replacements.length > 0 &&
      (await confirm({
        title: t(lang, "reportTakeConfirmTitle"),
        message: takeConfirmMessage(lang, plan),
        confirmLabel: t(lang, "reportTakeReplace"),
        cancelLabel: t(lang, "reportTakeKeepBoth"),
      }));
    // M-1 — a write (save, restore, undo) landed while the confirm was open: `base` is stale and the
    // editor now shows the new stored body, so the take is dropped rather than applied to old text. Likewise
    // a new draft (or a discard) replaced the proposal: `indices` point into a proposal that is gone.
    if (updatedAtRef.current !== startedAt || proposalAtRef.current !== proposalAt) {
      void notice({ title: t(lang, "reportTakeDroppedTitle"), message: t(lang, "reportTakeDroppedBody") });
      return;
    }
    focusAfterTakeRef.current = Math.max(...indices);
    setDraft(applyTake(base, proposal.sections, indices, replace));
    setSeedNonce((n) => n + 1);
    setTookFromProposal(true);
    setPendingTaken((prev) => new Set([...prev, ...indices]));
  }

  function save(): void {
    const wrote = onSave(draft, { fromAi: tookFromProposal });
    // Takes are marked when the text is in the stored report: it was just written, or the body was already stored
    // (an unchanged save). A save that wrote nothing for any other reason (the meeting is gone) marks nothing.
    const stored = report?.html ?? "";
    const inReport = wrote || sanitizeRichHtml(draft) === stored;
    if (inReport && pendingTaken.size > 0) onTaken?.([...pendingTaken].sort((a, b) => a - b));
    setTookFromProposal(false);
    setPendingTaken(new Set());
    // A save whose sanitized text equals the stored body writes nothing (no new updatedAt, so no reconcile
    // below): settle the draft on the stored body here, so a sanitizer-only difference does not stay dirty.
    if (draft !== stored && sanitizeRichHtml(draft) === stored) setDraft(stored);
  }

  /** A restore replaces the editor text, so over unsaved changes both restore paths ask first. Called only while
   *  dirty: a clean restore stays synchronous (no await on its path). */
  function confirmRestoreOverUnsaved(messageKey: "reportRestoreUnsavedBody" | "reportRestoreVersionUnsavedBody"): Promise<boolean> {
    return confirm({
      title: t(lang, "reportUnsavedTitle"),
      message: t(lang, messageKey),
      confirmLabel: t(lang, "reportRestore"),
    });
  }

  async function restorePrevious(): Promise<void> {
    if (!onRestorePrevious) return;
    if (dirty && !(await confirmRestoreOverUnsaved("reportRestoreUnsavedBody"))) return;
    onRestorePrevious();
  }

  // Review item 2 — the Turso version list restores through onSaveReport, which re-seeds the editor from the new
  // stored body: without this ask, unsaved typing was replaced without a word.
  async function restoreVersion(versionId: string): Promise<void> {
    if (!onRestore) return;
    if (dirty && !(await confirmRestoreOverUnsaved("reportRestoreVersionUnsavedBody"))) return;
    onRestore(versionId);
  }

  // Recipients are seeded from the committee members but EDITABLE before send
  // (fresh mount per modal-open re-seeds from the current members).
  const [toList, setToList] = useState(recipients.join(", "));
  const parsedRecipients = parseRecipients(toList);
  const noRecipients = parsedRecipients.length === 0;
  // What Send mails is the STORED body, so a blank one (e.g. cleared, with a previous kept) cannot be sent.
  const blankReport = isBlankReport(report?.html ?? "");

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
  // §669 — two versions can carry one capture time (an auto and a manual save in
  // the same minute, or two of either). The token is the row's visible text.
  const versionTokens = useMemo(
    () => buildRowTokens((versions ?? []).map((v) => ({ id: v.id, name: versionLabel(lang, v) }))),
    [versions, lang],
  );
  // The diff summary below writes rowLabel's "verb – token" shape as a template
  // literal on purpose. Calling rowLabel() there was tried and made
  // react-hooks/preserve-manual-memoization flag the diff memo above; the literal does not.
  const compareToken = compareVersionId === null ? undefined : versionTokens.get(compareVersionId);

  return (
    // data-report-dirty is read by the top-bar undo guard (use-report-undo-guard.ts).
    <div className="flex flex-col gap-3" data-report-dirty={dirty ? "true" : undefined}>
      {aiConfigured && onGenerate && !readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          {/* ★ The shared trigger: while busy it reads "Stop" and aborts (§125).
              Progress text sits BESIDE it, never on it (WCAG 2.5.3). Only one
              meeting's report modal is open at a time, so no nameQualifier. */}
          <AiTriggerButton
            lang={lang}
            busy={!!generateBusy}
            onRun={onGenerate}
            onCancel={() => onCancelGenerate?.()}
            idleLabelKey="reportDraftWithAi"
          />
          {generateBusy ? (
            <span role="status" className="text-xs text-muted-foreground">
              {t(lang, "reportGenerating")}
            </span>
          ) : null}
        </div>
      )}

      {proposal && proposal.sections.length > 0 && !readOnly ? (
        <div ref={proposalRef}>
          <MeetingReportProposal
            lang={lang}
            sections={proposal.sections}
            taken={pendingTaken.size === 0 ? proposal.taken : new Set([...proposal.taken, ...pendingTaken])}
            onTake={(indices) => void take(indices)}
            onDiscard={() => {
              setPendingTaken(new Set());
              onDiscardProposal?.();
            }}
          />
        </div>
      ) : null}

      {readOnly ? (
        <div
          className="min-h-40 rounded-md border border-line bg-surface p-3 text-sm"
          // Body is sanitized at write time; re-sanitize on render (defense-in-depth).
          dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(report?.html ?? "") }}
        />
      ) : (
        <RichTextEditor
          // §763 — the editor binds `content` once at mount, so the re-seeded draft above
          // reaches it only through a remount: key it on the stored body's stamp, which
          // every write (manual save, restore, undo) bumps and typing never touches. AI-04: a take
          // rewrites the draft without a write, so it bumps `seedNonce` instead.
          key={`${report?.updatedAt ?? "new"}:${seedNonce}`}
          value={draft}
          onChange={setDraft}
          label={t(lang, "reportBody")}
          lang={lang}
        />
      )}

      {report?.previous && onRestorePrevious && !readOnly ? (
        <MeetingReportPrevious
          lang={lang}
          previous={report.previous}
          draft={draft}
          onRestore={() => void restorePrevious()}
        />
      ) : null}

      {versions && versions.length > 0 && onRestore && !readOnly && (
        <details className="rounded-md border border-line">
          <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium">
            {t(lang, "reportVersions")} ({versions.length})
          </summary>
          <ul className="divide-y divide-line">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                <span>{versionLabel(lang, v)}</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => setCompareVersionId((cur) => (cur === v.id ? null : v.id))}
                    aria-expanded={compareVersionId === v.id}
                    aria-label={rowLabel(t(lang, "reportDiff"), versionTokens.get(v.id) ?? versionLabel(lang, v))}
                    title={t(lang, "reportDiffHint")}
                  >
                    {t(lang, "reportDiff")}
                  </Button>
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => void restoreVersion(v.id)}
                    disabled={restoreBusyId === v.id}
                    aria-label={rowLabel(t(lang, "reportRestore"), versionTokens.get(v.id) ?? versionLabel(lang, v))}
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
                summary={`${t(lang, "reportDiff")} – ${compareToken ?? compareVersion.capturedAt}`}
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
          <Button variant="secondary" size="xs" onClick={save}>
            {t(lang, "reportSave")}
          </Button>
          <Button
            size="xs"
            onClick={() => onSend(parsedRecipients)}
            disabled={!m365Configured || sendBusy || noRecipients || blankReport}
          >
            {t(lang, sendBusy ? "reportSending" : "reportSend")}
          </Button>
        </div>
      )}
    </div>
  );
}
