// Deps-object hook (render-scope UI glue, coverage-excluded) that builds the
// steering-committee "report" bag: save a meeting's status report into the
// committee blob, and email it to the committee members via Graph. Non-memoized
// handlers read live deps each call. Returns undefined in popouts (read-only).
import { useEffect, useRef, useState } from "react";
import { t, type Lang, tPlural } from "./i18n";
import { aiFailureMessageKey } from "./ai-key-status";
import type { SteeringCommittee, CommitteeMeeting, Resource, MeetingReport } from "./types";
import type { Settings } from "./settings-types";
import { isAiEnabled } from "./settings-types";
import { sendMail, buildGraphMessage, MAIL_SEND_SCOPE } from "./graph-mail";
import { sanitizeRichHtml } from "./sanitize-html";
import { htmlToPlainText } from "./html-to-text";
import { runMeetingReport } from "./committee-report/report-call";
import { splitSections, type ReportSection } from "./committee-report/report-sections";
import { useGuideTextFrom } from "./action-guides-context";
import type { OperatingGuide } from "./operating-guide";
import { loadVersions, saveVersion } from "./committee-report-versions-store";
import type { MeetingReportVersionUi } from "./meeting-report-panel";
import type { DashboardModel } from "./dashboard";
import type { TursoConfig } from "./turso-config";
import { dropStaleScopeWrite, type ScopeEpochReader } from "./scope-epoch";
import type { UndoStackApi } from "./undo/use-undo-stack";
import type { LogActivityAsFn } from "./activity-log-context";
import { meetingReportUndoFragment } from "./meeting-report-undo";

export interface MeetingReportActionsDeps {
  lang: Lang;
  isPopout: boolean;
  settings: Settings;
  committee: SteeringCommittee | undefined;
  resources: readonly Resource[];
  setSteeringCommittee: (
    updater: (c: SteeringCommittee | undefined) => SteeringCommittee | undefined,
  ) => void;
  tursoConfig: TursoConfig | null;
  m365Configured: boolean;
  acquireToken: (scopes: readonly string[], options?: { interactive?: boolean }) => Promise<string | null>;
  showToast: (kind: "info" | "error", text: string) => void;
  /** Live project status projection for the AI draft (read at generate time). */
  getDashboardModel: () => DashboardModel;
  /** Resolved Anthropic key ("" when the AI master switch is off / no key). */
  aiKey: string;
  aiModel: string;
  /** §701 — REQUIRED: this hook runs in task-manager's body, above the guide
   *  provider (see `useGuideTextFrom`). */
  guides: readonly OperatingGuide[];
  /** Turso project id for version rows (only used when tursoConfig !== null). */
  projectId: string;
  /** §548 / §763 — REQUIRED (the deps boundary, see scope-epoch.ts): `useStorageBackend`'s scope
   *  epoch. Each writer below that awaits (the AI draft, a restore, a send) captures it before its first
   *  await and drops its write when it moved: meeting ids restart at 1 in every project, so a late
   *  write would otherwise land on the next project's meeting with the same id. */
  getScopeEpoch: ScopeEpochReader;
  /** AI-04 — a report save / swap is ONE undo entry (restores `html` and `previous` together). */
  captureComposite: UndoStackApi["captureComposite"];
  /** AI-04 — a save that contains AI-drafted text is logged as actor "ai". */
  logActivityAs: LogActivityAsFn;
}

/** AI-04 — an AI draft held per meeting until the user takes sections from it (or discards it). */
export interface ReportProposal {
  sections: readonly ReportSection[];
  /** Indices into `sections` already taken into the report. */
  taken: ReadonlySet<number>;
  createdAt: string;
}

/** A stored proposal plus the project scope and the meeting it was drafted for. */
interface StoredProposal extends ReportProposal {
  epoch: number;
  /** `meetingFingerprint` at the time the draft started. */
  fingerprint: string;
}

/** Identity of a meeting beyond its id: ids are max + 1, so a deleted newest meeting's id is reused by the
 *  next one. `CommitteeMeeting` carries no creation stamp (and a new persisted field is a six-path change),
 *  so this is the strongest fingerprint that survives an ordinary edit. The title is left out on purpose (a title
 *  edit must keep a held draft). Residual: the same id + the same date + the same Outlook id is treated as the
 *  same meeting, so a meeting re-created like that shows the old draft; a date change discards the proposal. */
function meetingFingerprint(m: CommitteeMeeting): string {
  return JSON.stringify([m.date, m.outlookEventId ?? ""]);
}

export interface MeetingReportBag {
  m365Configured: boolean;
  aiConfigured: boolean;
  tursoActive: boolean;
  onSaveReport: (meetingId: number, html: string, opts?: { fromAi?: boolean }) => void;
  /** Swap a report with its previous version (new `updatedAt`, `sentAt` dropped);
   *  a no-op when there is no previous. Calling it again swaps back. */
  onRestorePrevious: (meetingId: number) => void;
  onSendReport: (meetingId: number, recipients: readonly string[]) => void;
  sendBusyMeetingId: number | null;
  /** Drafts a report with the AI and holds it as that meeting's proposal; it does NOT save. */
  onGenerateReport: (meetingId: number) => void;
  /** The meeting's held proposal; undefined when none, when it was drafted in another project
   *  scope, or when the meeting no longer exists. */
  getProposal: (meetingId: number) => ReportProposal | undefined;
  /** Marks proposal sections (by index) as taken; accumulates. */
  markTaken: (meetingId: number, indices: readonly number[]) => void;
  discardProposal: (meetingId: number) => void;
  /** Stop the in-flight AI draft (§125). Aborting stops the WAIT, not the bill:
   *  a request already sent is still charged. A user stop shows no error toast. */
  onCancelGenerateReport: () => void;
  generateBusyMeetingId: number | null;
  /** Turso-only: load a meeting's report version history (newest first). Returns
   *  [] when Turso is inactive. */
  loadVersions: (meetingId: number) => Promise<MeetingReportVersionUi[]>;
  onRestore: (meetingId: number, versionId: string) => void;
  restoreBusyId: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** True when a body has no visible text (empty, or only tags and whitespace). */
function isBlankReport(html: string): boolean {
  return htmlToPlainText(html).trim() === "";
}

/** The report after a save: the new text, with the replaced text kept as `previous`
 *  when it was non-empty. A new body is unsent, so `sentAt` is not carried. */
function replacedReport(old: MeetingReport | undefined, html: string, stamp: string): MeetingReport {
  const report: MeetingReport = { html, updatedAt: stamp };
  if (old && old.html === html) return { ...report, ...(old.previous ? { previous: old.previous } : {}) };
  if (old && old.html !== "") report.previous = { html: old.html, savedAt: old.updatedAt };
  return report;
}

export function useMeetingReportActions(deps: MeetingReportActionsDeps): MeetingReportBag | undefined {
  const [sendBusyMeetingId, setSendBusyMeetingId] = useState<number | null>(null);
  const [generateBusyMeetingId, setGenerateBusyMeetingId] = useState<number | null>(null);
  const [restoreBusyId, setRestoreBusyId] = useState<string | null>(null);
  /** The in-flight AI draft's controller — a ref so Stop can reach it (§125). */
  const generateCtrlRef = useRef<AbortController | null>(null);
  /** AI-04 — held drafts by meeting id. Hook state so they survive the modal closing. */
  const [proposals, setProposals] = useState<ReadonlyMap<number, StoredProposal>>(() => new Map());
  /** The committee as of the last commit, for the resolve-time "meeting still exists" check (the closure's
   *  `deps` is the render the draft started in). */
  const committeeRef = useRef<SteeringCommittee | undefined>(deps.committee);
  useEffect(() => {
    committeeRef.current = deps.committee;
  }, [deps.committee]);
  const guideText = useGuideTextFrom(deps.guides, deps.settings.ai.groundInGuides, "committeeReport");
  if (deps.isPopout) return undefined;

  // Turso-only: snapshot the meeting's CURRENT report as a version before it's
  // overwritten (manual save / AI draft / restore all route through onSaveReport,
  // so this is the single snapshot point). Best-effort — a snapshot failure never
  // blocks the write.
  async function snapshotCurrent(meetingId: number): Promise<void> {
    if (!deps.tursoConfig) return;
    const meeting = deps.committee?.meetings.find((m) => m.id === meetingId);
    if (!meeting?.report) return;
    try {
      await saveVersion(deps.tursoConfig, {
        id: crypto.randomUUID(),
        projectId: deps.projectId,
        meetingId,
        html: meeting.report.html,
        isAuto: true,
        capturedAt: nowIso(),
      });
    } catch {
      /* snapshot is best-effort — never block the overwrite */
    }
  }

  // Functional committee setter — writes the report onto the meeting, built from the LIVE report. Every save
  // drops `sentAt`; a new body moves the old text into `previous`, an identical body keeps the existing `previous`.
  function onSaveReport(meetingId: number, html: string, opts?: { fromAi?: boolean }): void {
    const meeting = deps.committee?.meetings.find((m) => m.id === meetingId);
    if (!meeting) return;
    void snapshotCurrent(meetingId); // snapshot the prior before we overwrite it
    // Uniform write-time sanitization (defense-in-depth) — every body write
    // (manual save, AI draft, restore) routes through here. A NEW body is
    // unsent, so `sentAt` is intentionally dropped.
    const clean = sanitizeRichHtml(html);
    const stamp = nowIso();
    const seen = writeLiveReport(meetingId, (old) => replacedReport(old, clean, stamp));
    // An unchanged body is not a change: nothing to undo and nothing to log. (Judged on the render-scope
    // meeting, which is enough for a capture decision; the write above is judged on the live one.)
    if (meeting.report?.html === clean) return;
    captureReportChange(meeting.id, meeting.date, seen);
    // ★ Deliberately NOT gated on the stash: a React setState updater does not run inside the call (it runs at the
    // next render), so `seen.after()` is still null here for nearly every real save and gating on it would never log.
    // Accepted residual: if the meeting was deleted between render and click the row is logged though nothing was
    // written (the undo entry is harmless, its thunks read null).
    if (opts?.fromAi) deps.logActivityAs("ai", "ai.reportDraft", meeting.date);
  }

  /** Rewrites ONE meeting's report inside a functional setter, from the LIVE `m.report` (N saves in one tick
   *  compose; a write between render and click is not clobbered). `next` returning undefined skips the write.
   *  Returns what the updater actually saw and wrote, for the undo fragment to read later: the updater is
   *  deterministic in (live state, args) — the timestamp is taken by the caller — so a StrictMode double-run
   *  stores the same pair. The undo entry itself is captured OUTSIDE the updater (no side effect in it). */
  function writeLiveReport(
    meetingId: number,
    next: (old: MeetingReport | undefined) => MeetingReport | undefined,
  ): { before: () => MeetingReport | undefined | null; after: () => MeetingReport | undefined | null } {
    let wrote = false;
    let before: MeetingReport | undefined;
    let after: MeetingReport | undefined;
    deps.setSteeringCommittee((c) => {
      // A re-run (rebase) starts clean: it must not keep an earlier run's pair when it writes nothing.
      wrote = false;
      before = undefined;
      after = undefined;
      if (!c) return c;
      return {
        ...c,
        meetings: c.meetings.map((m) => {
          if (m.id !== meetingId) return m;
          const r = next(m.report);
          if (r === undefined) return m;
          wrote = true;
          before = m.report;
          after = r;
          return { ...m, report: r };
        }),
      };
    });
    return { before: () => (wrote ? before : null), after: () => (wrote ? after : null) };
  }

  function captureReportChange(
    meetingId: number,
    date: string,
    seen: { before: () => MeetingReport | undefined | null; after: () => MeetingReport | undefined | null },
  ): void {
    deps.captureComposite({
      kind: "meetingReport.updated",
      primaryCount: 1,
      name: date,
      parts: [meetingReportUndoFragment({ setSteeringCommittee: deps.setSteeringCommittee, meetingId, before: seen.before, after: seen.after })],
      readEpoch: deps.getScopeEpoch(),
    });
  }

  function onRestorePrevious(meetingId: number): void {
    const meeting = deps.committee?.meetings.find((m) => m.id === meetingId);
    const current = meeting?.report;
    const prev = current?.previous;
    if (!meeting || !current || !prev) return;
    const stamp = nowIso();
    const seen = writeLiveReport(meetingId, (live) => {
      // Judged on the LIVE report: no previous there (a concurrent swap or save) means nothing to swap.
      const p = live?.previous;
      if (!live || !p) return undefined;
      return {
        html: p.html,
        updatedAt: stamp,
        // An empty current body is not kept (the load sanitizer would drop it).
        ...(live.html !== "" ? { previous: { html: live.html, savedAt: live.updatedAt } } : {}),
      };
    });
    captureReportChange(meeting.id, meeting.date, seen);
  }

  async function onSendReport(meetingId: number, recipients: readonly string[]): Promise<void> {
    const committee = deps.committee;
    if (!committee || !deps.m365Configured) return;
    const meeting = committee.meetings.find((m) => m.id === meetingId);
    if (!meeting?.report || isBlankReport(meeting.report.html)) return;
    const emails = recipients.map((e) => e.trim()).filter((e) => e !== "");
    if (emails.length === 0) {
      deps.showToast("info", t(deps.lang, "reportNoRecipients"));
      return;
    }
    setSendBusyMeetingId(meetingId);
    const startEpoch = deps.getScopeEpoch();
    try {
      const token = await deps.acquireToken(MAIL_SEND_SCOPE, { interactive: true });
      if (!token) {
        deps.showToast("error", t(deps.lang, "reportSendFailed"));
        return;
      }
      const subject = `${t(deps.lang, "reportStatusReport")}: ${meeting.title || meeting.date}`;
      const html = sanitizeRichHtml(meeting.report.html);
      await sendMail(token, buildGraphMessage(emails, subject, html));
      // The mail went out, so the toast below still says so; only the sentAt stamp is dropped, because
      // after a swap meeting #meetingId is another project's meeting.
      if (!dropStaleScopeWrite(deps.getScopeEpoch, startEpoch, "useMeetingReportActions.send", { meetingId })) {
        deps.setSteeringCommittee((c) =>
          c
            ? {
                ...c,
                meetings: c.meetings.map((m) =>
                  m.id === meetingId && m.report ? { ...m, report: { ...m.report, sentAt: nowIso() } } : m,
                ),
              }
            : c,
        );
      }
      deps.showToast("info", tPlural(deps.lang, "reportSentToast", emails.length, emails.length));
    } catch {
      // Never surface the Graph error body — status-only.
      deps.showToast("error", t(deps.lang, "reportSendFailed"));
    } finally {
      setSendBusyMeetingId(null);
    }
  }

  async function onGenerateReport(meetingId: number): Promise<void> {
    const committee = deps.committee;
    if (!committee || !deps.aiKey) return;
    const meeting = committee.meetings.find((m) => m.id === meetingId);
    if (!meeting) return;
    const ctrl = new AbortController();
    generateCtrlRef.current = ctrl;
    setGenerateBusyMeetingId(meetingId);
    // §548 / §763 — the project this draft is read from and will be written into.
    const startEpoch = deps.getScopeEpoch();
    const startFingerprint = meetingFingerprint(meeting);
    try {
      const html = await runMeetingReport(
        deps.getDashboardModel(),
        meeting.agenda ?? "",
        { apiKey: deps.aiKey, model: deps.aiModel, lang: deps.lang, guideText },
        ctrl.signal,
      );
      // A stop that lost the race to the response still means "don't use it".
      if (ctrl.signal.aborted) return;
      // A swap that finished while the model was answering: meeting #meetingId is now another project's
      // meeting, and onSaveReport would overwrite its report (and snapshot the OLD project's, from this
      // render's stale deps). Dropped, not queued.
      if (dropStaleScopeWrite(deps.getScopeEpoch, startEpoch, "useMeetingReportActions.generate", { meetingId })) return;
      // A meeting deleted while the model was answering has nothing to hold the draft for.
      // ... or deleted and re-created under the same id (ids are max + 1).
      const liveMeeting = committeeRef.current?.meetings.find((m) => m.id === meetingId);
      if (!liveMeeting || meetingFingerprint(liveMeeting) !== startFingerprint) return;
      // AI output is untrusted: sanitize BEFORE splitting, so the held sections are already clean.
      const clean = sanitizeRichHtml(html);
      const sections = isBlankReport(clean) ? [] : splitSections(clean);
      if (sections.length === 0) {
        deps.showToast("error", t(deps.lang, "reportGenerateFailed"));
        return;
      }
      const createdAt = nowIso();
      setProposals((prev) =>
        new Map(prev).set(meetingId, { sections, taken: new Set<number>(), createdAt, epoch: startEpoch, fingerprint: startFingerprint }),
      );
    } catch (e) {
      // A user stop is not a failure — no toast (§125).
      if (ctrl.signal.aborted) return;
      // Status-only — never surface the response body (runMeetingReport already
      // throws status-digits/"parse" only). §650 — a refused key (401/403) names the key.
      deps.showToast("error", t(deps.lang, aiFailureMessageKey(e) ?? "reportGenerateFailed"));
    } finally {
      if (generateCtrlRef.current === ctrl) generateCtrlRef.current = null;
      setGenerateBusyMeetingId(null);
    }
  }

  function getProposal(meetingId: number): ReportProposal | undefined {
    const p = proposals.get(meetingId);
    if (!p || p.epoch !== deps.getScopeEpoch()) return undefined;
    const meeting = deps.committee?.meetings.find((m) => m.id === meetingId);
    if (!meeting || meetingFingerprint(meeting) !== p.fingerprint) return undefined;
    return { sections: p.sections, taken: p.taken, createdAt: p.createdAt };
  }

  function markTaken(meetingId: number, indices: readonly number[]): void {
    setProposals((prev) => {
      const p = prev.get(meetingId);
      if (!p) return prev;
      return new Map(prev).set(meetingId, { ...p, taken: new Set([...p.taken, ...indices]) });
    });
  }

  function discardProposal(meetingId: number): void {
    setProposals((prev) => {
      if (!prev.has(meetingId)) return prev;
      const next = new Map(prev);
      next.delete(meetingId);
      return next;
    });
  }

  function onCancelGenerateReport(): void {
    generateCtrlRef.current?.abort();
  }

  async function loadVersionsUi(meetingId: number): Promise<MeetingReportVersionUi[]> {
    if (!deps.tursoConfig) return [];
    try {
      const records = await loadVersions(deps.tursoConfig, deps.projectId, meetingId);
      return records.map((v) => ({ id: v.id, capturedAt: v.capturedAt, isAuto: v.isAuto, html: v.html }));
    } catch {
      return [];
    }
  }

  async function onRestore(meetingId: number, versionId: string): Promise<void> {
    if (!deps.tursoConfig) return;
    setRestoreBusyId(versionId);
    const startEpoch = deps.getScopeEpoch();
    try {
      const records = await loadVersions(deps.tursoConfig, deps.projectId, meetingId);
      const v = records.find((x) => x.id === versionId);
      if (!v) return;
      if (dropStaleScopeWrite(deps.getScopeEpoch, startEpoch, "useMeetingReportActions.restore", { meetingId })) return;
      // onSaveReport snapshots the current (pre-restore) report, then writes the
      // restored body — so a restore is itself undoable via a new version.
      onSaveReport(meetingId, v.html);
      deps.showToast("info", t(deps.lang, "reportRestored"));
    } catch {
      deps.showToast("error", t(deps.lang, "reportGenerateFailed"));
    } finally {
      setRestoreBusyId(null);
    }
  }

  return {
    m365Configured: deps.m365Configured,
    aiConfigured: isAiEnabled(deps.settings.ai),
    tursoActive: deps.tursoConfig !== null,
    onSaveReport,
    onRestorePrevious,
    onSendReport: (meetingId: number, recipients: readonly string[]) => {
      void onSendReport(meetingId, recipients);
    },
    sendBusyMeetingId,
    onGenerateReport: (meetingId: number) => {
      void onGenerateReport(meetingId);
    },
    getProposal,
    markTaken,
    discardProposal,
    onCancelGenerateReport,
    generateBusyMeetingId,
    loadVersions: loadVersionsUi,
    onRestore: (meetingId: number, versionId: string) => {
      void onRestore(meetingId, versionId);
    },
    restoreBusyId,
  };
}
