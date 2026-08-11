// Deps-object hook (render-scope UI glue, coverage-excluded) that builds the
// steering-committee "report" bag: save a meeting's status report into the
// committee blob, and email it to the committee members via Graph. Non-memoized
// handlers read live deps each call. Returns undefined in popouts (read-only).
import { useState } from "react";
import { t, type Lang } from "./i18n";
import type { SteeringCommittee, Resource } from "./types";
import type { Settings } from "./settings-types";
import { isAiEnabled } from "./settings-types";
import { sendMail, buildGraphMessage, MAIL_SEND_SCOPE } from "./graph-mail";
import { sanitizeRichHtml } from "./sanitize-html";
import { runMeetingReport } from "./committee-report/report-call";
import { loadVersions, saveVersion } from "./committee-report-versions-store";
import type { MeetingReportVersionUi } from "./meeting-report-panel";
import type { DashboardModel } from "./dashboard";
import type { TursoConfig } from "./turso-config";

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
  /** Turso project id for version rows (only used when tursoConfig !== null). */
  projectId: string;
}

export interface MeetingReportBag {
  m365Configured: boolean;
  aiConfigured: boolean;
  tursoActive: boolean;
  onSaveReport: (meetingId: number, html: string) => void;
  onSendReport: (meetingId: number, recipients: readonly string[]) => void;
  sendBusyMeetingId: number | null;
  onGenerateReport: (meetingId: number) => void;
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

export function useMeetingReportActions(deps: MeetingReportActionsDeps): MeetingReportBag | undefined {
  const [sendBusyMeetingId, setSendBusyMeetingId] = useState<number | null>(null);
  const [generateBusyMeetingId, setGenerateBusyMeetingId] = useState<number | null>(null);
  const [restoreBusyId, setRestoreBusyId] = useState<string | null>(null);
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

  // Functional committee setter — writes the report onto the meeting; the prior
  // sentAt survives (a re-save doesn't clear the last-sent stamp).
  function onSaveReport(meetingId: number, html: string): void {
    void snapshotCurrent(meetingId); // snapshot the prior before we overwrite it
    // Uniform write-time sanitization (defense-in-depth) — every body write
    // (manual save, AI draft, restore) routes through here. A NEW body is
    // unsent, so `sentAt` is intentionally dropped.
    const clean = sanitizeRichHtml(html);
    deps.setSteeringCommittee((c) =>
      c
        ? {
            ...c,
            meetings: c.meetings.map((m) =>
              m.id === meetingId ? { ...m, report: { html: clean, updatedAt: nowIso() } } : m,
            ),
          }
        : c,
    );
  }

  async function onSendReport(meetingId: number, recipients: readonly string[]): Promise<void> {
    const committee = deps.committee;
    if (!committee || !deps.m365Configured) return;
    const meeting = committee.meetings.find((m) => m.id === meetingId);
    if (!meeting?.report) return;
    const emails = recipients.map((e) => e.trim()).filter((e) => e !== "");
    if (emails.length === 0) {
      deps.showToast("info", t(deps.lang, "reportNoRecipients"));
      return;
    }
    setSendBusyMeetingId(meetingId);
    try {
      const token = await deps.acquireToken(MAIL_SEND_SCOPE, { interactive: true });
      if (!token) {
        deps.showToast("error", t(deps.lang, "reportSendFailed"));
        return;
      }
      const subject = `${t(deps.lang, "reportStatusReport")}: ${meeting.title || meeting.date}`;
      const html = sanitizeRichHtml(meeting.report.html);
      await sendMail(token, buildGraphMessage(emails, subject, html));
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
      deps.showToast("info", t(deps.lang, "reportSentToast", emails.length));
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
    setGenerateBusyMeetingId(meetingId);
    try {
      const html = await runMeetingReport(deps.getDashboardModel(), meeting.agenda ?? "", {
        apiKey: deps.aiKey,
        model: deps.aiModel,
        lang: deps.lang,
      });
      // onSaveReport sanitizes (AI output is untrusted) before it lands.
      onSaveReport(meetingId, html);
    } catch {
      // Status-only — never surface the response body (runMeetingReport already
      // throws status-digits/"parse" only).
      deps.showToast("error", t(deps.lang, "reportGenerateFailed"));
    } finally {
      setGenerateBusyMeetingId(null);
    }
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
    try {
      const records = await loadVersions(deps.tursoConfig, deps.projectId, meetingId);
      const v = records.find((x) => x.id === versionId);
      if (!v) return;
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
    onSendReport: (meetingId: number, recipients: readonly string[]) => {
      void onSendReport(meetingId, recipients);
    },
    sendBusyMeetingId,
    onGenerateReport: (meetingId: number) => {
      void onGenerateReport(meetingId);
    },
    generateBusyMeetingId,
    loadVersions: loadVersionsUi,
    onRestore: (meetingId: number, versionId: string) => {
      void onRestore(meetingId, versionId);
    },
    restoreBusyId,
  };
}
