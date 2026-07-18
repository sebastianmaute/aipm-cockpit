"use client";

// Steering-committee editor surface (SP-E). i18n-aware (it is a surface — pure
// date math lives in steering-reminders.ts). All edits are immutable: every
// handler spreads a new SteeringCommittee. Mounted by workspace-section.tsx for
// both the modern and classic shells.

import { useState } from "react";
import { type Lang, t } from "./i18n";
import { ViewCallout } from "./view-callout";
import { ResourcePicker } from "./resource-picker";
import { resourceDisplayName } from "./resource-foundation";
import { dueInfoReminders, type InfoReminder, type ReminderTier } from "./steering-reminders";
import { ColumnResizeHandle, PrintButton, ResetColWidthsButton, ResetSizeButton } from "./task-manager-ui";
import { useResizable } from "./use-resizable";
import { useColumnResize } from "./use-column-resize";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { DataTable } from "./data-table";
import type { CommitteeMeeting, InfoSchedule, Resource, SteeringCommittee } from "./types";
import { Modal } from "./modal";
import { committeePushKey, type CommitteeReconcileTarget } from "./committee-calendar-reconcile";
import { MeetingReportPanel, type MeetingReportVersionUi } from "./meeting-report-panel";
import { committeeMemberEmails } from "./committee-report/report-recipients";
import type { MeetingReportBag } from "./use-meeting-report-actions";

const MEETING_COL_WIDTHS = { date: 150, title: 240, location: 200 } as const;
type MeetingCol = keyof typeof MEETING_COL_WIDTHS;
const SCHEDULE_COL_WIDTHS = { label: 260, leadDays: 120 } as const;
type ScheduleCol = keyof typeof SCHEDULE_COL_WIDTHS;

const EMPTY_COMMITTEE: SteeringCommittee = {
  name: "",
  memberResourceIds: [],
  meetings: [],
  infoSchedules: [],
};

function nextMaxId(items: ReadonlyArray<{ id: number }>): number {
  return items.reduce((max, x) => Math.max(max, x.id), 0) + 1;
}

const BTN_PRIMARY =
  "rounded-md border border-ui-dark-blue bg-ui-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-ui-dark-blue/90";
const BTN_SECONDARY =
  "rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted disabled:opacity-60";
const INPUT_CLASS =
  "rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-foreground focus:border-ui-dark-blue focus:outline-none focus:ring-2 focus:ring-ui-green";

function DeleteCell({ lang, onClick, label }: { lang: Lang; onClick: () => void; label: string }) {
  return (
    <td className="text-right">
      <button
        type="button"
        onClick={onClick}
        aria-label={`${t(lang, "delete")} – ${label}`}
        className={BTN_SECONDARY}
      >
        {t(lang, "delete")}
      </button>
    </td>
  );
}

/** Per-row "Push" cell — scopes an Outlook push to this one meeting/schedule.
 *  Row-unique accessible name (WCAG 2.4.6): "Push to Outlook – <label>".
 *  `busy` (this row is in-flight) drives the label; `disabled` (ANY push in
 *  flight) blocks the click so a concurrent-target press can't hit the hook's
 *  silent inFlightRef no-op. */
function PushRowCell({
  lang,
  onClick,
  label,
  busy,
  disabled,
}: {
  lang: Lang;
  onClick: () => void;
  label: string;
  busy: boolean;
  disabled: boolean;
}) {
  return (
    <td className="text-right print:hidden">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={`${t(lang, "committeePushOutlook")} – ${label}`}
        className={BTN_SECONDARY}
      >
        {t(lang, busy ? "committeePushBusy" : "committeePushRow")}
      </button>
    </td>
  );
}

const REMINDER_TIER_KEY: Record<ReminderTier, "committeeReminderOverdue" | "committeeReminderSoon" | "committeeReminderUpcoming"> = {
  now: "committeeReminderOverdue",
  soon: "committeeReminderSoon",
  upcoming: "committeeReminderUpcoming",
};

export interface SteeringCommitteePanelProps {
  lang: Lang;
  committee: SteeringCommittee | undefined;
  onChange: (next: SteeringCommittee | undefined) => void;
  resources: readonly Resource[];
  today: string;
  /** Supplied by Task 7 (Outlook push). When absent the button is hidden.
   *  Errors surface via toast (not inline), so no `error` field is threaded.
   *  `onPushRow` (optional) scopes a push to a single meeting / info-schedule
   *  row — when absent the per-row "Push" buttons are hidden. `pushingTarget` is
   *  the `committeePushKey` of the row currently pushing (or null when idle), so
   *  only the in-flight button shows busy — the rest stay enabled. */
  outlookPush?: { onPush: () => void; pushingTarget: string | null; onPushRow?: (target: CommitteeReconcileTarget) => void };
  /** Per-meeting status-report actions (save/email + AI/versions). When absent
   *  the per-meeting "Status report" button is hidden. */
  report?: MeetingReportBag;
  showHints?: boolean;
  isPopout?: boolean;
  onLearnMore?: (conceptId: string) => void;
}

export function SteeringCommitteePanel({
  lang,
  committee,
  onChange,
  resources,
  today,
  outlookPush,
  report,
  showHints,
  isPopout,
  onLearnMore,
}: SteeringCommitteePanelProps) {
  const c = committee ?? EMPTY_COMMITTEE;
  const [reportMeetingId, setReportMeetingId] = useState<number | null>(null);
  const [reportVersions, setReportVersions] = useState<readonly MeetingReportVersionUi[]>([]);
  const { ref: paneRef, reset: resetSize } = useResizable("aipm-cockpit:steering-size");
  const { ref: reportPaneRef, reset: resetReportSize } = useResizable("aipm-cockpit:committee-report-size");
  const closeReport = () => {
    setReportMeetingId(null);
    setReportVersions([]);
  };
  const meetingCols = useColumnResize<MeetingCol>("committeeMeetings", MEETING_COL_WIDTHS);
  const scheduleCols = useColumnResize<ScheduleCol>("committeeSchedules", SCHEDULE_COL_WIDTHS);
  const startMeetingResize = meetingCols.startColResize as (col: string, e: React.MouseEvent) => void;
  const startScheduleResize = scheduleCols.startColResize as (col: string, e: React.MouseEvent) => void;
  const resetCols = () => {
    meetingCols.resetColWidths();
    scheduleCols.resetColWidths();
  };

  // New-meeting / new-schedule draft state (kept local; commit on Add).
  const [meetingDraft, setMeetingDraft] = useState<{ date: string; title: string; agenda: string; location: string }>({
    date: today,
    title: "",
    agenda: "",
    location: "",
  });
  const [scheduleDraft, setScheduleDraft] = useState<{ label: string; leadDays: number }>({ label: "", leadDays: 0 });

  function update(patch: Partial<SteeringCommittee>) {
    onChange({ ...c, ...patch });
  }

  // --- Members ---------------------------------------------------------------
  // Re-validate ids against live resources; drop dangling ones from display.
  const memberRows = c.memberResourceIds
    .map((id) => resources.find((r) => r.id === id))
    .filter((r): r is Resource => !!r);

  function addMember(id: number) {
    if (c.memberResourceIds.includes(id)) return;
    update({ memberResourceIds: [...c.memberResourceIds, id] });
  }

  function removeMember(id: number) {
    update({ memberResourceIds: c.memberResourceIds.filter((m) => m !== id) });
  }

  // --- Meetings --------------------------------------------------------------
  function addMeeting() {
    if (!meetingDraft.date) return;
    const meeting: CommitteeMeeting = {
      id: nextMaxId(c.meetings),
      date: meetingDraft.date,
      title: meetingDraft.title,
    };
    if (meetingDraft.agenda.trim()) meeting.agenda = meetingDraft.agenda;
    if (meetingDraft.location.trim()) meeting.location = meetingDraft.location;
    update({ meetings: [...c.meetings, meeting] });
    setMeetingDraft({ date: today, title: "", agenda: "", location: "" });
  }

  function patchMeeting(id: number, patch: Partial<CommitteeMeeting>) {
    update({ meetings: c.meetings.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  }

  function deleteMeeting(id: number) {
    const gone = c.meetings.find((m) => m.id === id);
    const meetings = c.meetings.filter((m) => m.id !== id);
    // A deleted meeting leaves `meetings`, so its pushed Outlook event id can no
    // longer be reconciled — stash it for the next push to delete + clear.
    if (gone?.outlookEventId) {
      update({ meetings, pendingDeleteEventIds: [...(c.pendingDeleteEventIds ?? []), gone.outlookEventId] });
    } else {
      update({ meetings });
    }
  }

  // --- Info schedules --------------------------------------------------------
  function addSchedule() {
    const schedule: InfoSchedule = {
      id: nextMaxId(c.infoSchedules),
      label: scheduleDraft.label,
      leadDays: Math.max(0, Math.round(scheduleDraft.leadDays || 0)),
    };
    update({ infoSchedules: [...c.infoSchedules, schedule] });
    setScheduleDraft({ label: "", leadDays: 0 });
  }

  function patchSchedule(id: number, patch: Partial<InfoSchedule>) {
    update({ infoSchedules: c.infoSchedules.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  }

  function deleteSchedule(id: number) {
    update({ infoSchedules: c.infoSchedules.filter((s) => s.id !== id) });
  }

  // --- Reminders -------------------------------------------------------------
  const reminders = dueInfoReminders(committee, today);
  const byTier: Record<ReminderTier, InfoReminder[]> = { now: [], soon: [], upcoming: [] };
  for (const r of reminders) byTier[r.tier].push(r);

  return (
    <div ref={paneRef} className={`${reportMeetingId === null ? "print-root " : ""}${VIEW_PANE_RESIZABLE_CLASS}`}>
      {onLearnMore && (
        <ViewCallout
          view="steering-committee"
          lang={lang}
          showHints={showHints !== false}
          isPopout={!!isPopout}
          onLearnMore={onLearnMore}
        />
      )}
      <div className="mb-2 flex shrink-0 items-center justify-between">
        <h2 className="text-lg font-medium text-foreground">{t(lang, "committeeTitle")}</h2>
        <div className="flex items-center gap-2 print:hidden">
          <PrintButton lang={lang} />
          <ResetColWidthsButton onClick={resetCols} lang={lang} />
          <ResetSizeButton onClick={resetSize} lang={lang} />
        </div>
      </div>

      <div className="min-h-[240px] flex-1 overflow-auto">
        <div className="flex flex-col gap-6 p-3">
        {/* Name */}
        <section>
          <label htmlFor="committee-name" className="mb-1 block text-sm font-medium text-foreground">
            {t(lang, "committeeName")}
          </label>
          <input
            id="committee-name"
            type="text"
            value={c.name}
            maxLength={200}
            onChange={(e) => update({ name: e.target.value })}
            aria-label={t(lang, "committeeName")}
            className={`${INPUT_CLASS} w-full max-w-md`}
          />
        </section>

        {/* Members */}
        <section>
          <h3 className="mb-2 text-sm font-medium text-foreground">{t(lang, "committeeMembers")}</h3>
          {memberRows.length > 0 && (
            <ul className="mb-2 flex flex-col gap-1">
              {memberRows.map((r) => {
                const name = resourceDisplayName(r);
                return (
                  <li key={r.id} className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5">
                    <span className="text-sm text-foreground">{name}</span>
                    <button
                      type="button"
                      onClick={() => removeMember(r.id)}
                      aria-label={`${t(lang, "remove")} – ${name}`}
                      className={BTN_SECONDARY}
                    >
                      {t(lang, "remove")}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="max-w-md">
            <ResourcePicker
              lang={lang}
              value={{ name: "", email: "", resourceId: null }}
              resources={resources}
              contacts={[]}
              placeholder={t(lang, "committeeAddMember")}
              aria-label={t(lang, "committeeAddMember")}
              onChange={(next) => {
                if (next.resourceId != null) addMember(next.resourceId);
              }}
            />
          </div>
        </section>

        {/* Meetings */}
        <section>
          <h3 className="mb-2 text-sm font-medium text-foreground">{t(lang, "committeeMeetings")}</h3>
          {c.meetings.length > 0 && (
            <DataTable className="mb-2 w-full text-sm" head={<>
                <tr className="text-left">
                  <th className="relative px-3 py-2" style={{ width: meetingCols.colWidths.date, minWidth: meetingCols.colWidths.date }}>
                    {t(lang, "committeeMeetingDate")}
                    <ColumnResizeHandle col="date" onMouseDown={startMeetingResize} />
                  </th>
                  <th className="relative px-3 py-2" style={{ width: meetingCols.colWidths.title, minWidth: meetingCols.colWidths.title }}>
                    {t(lang, "committeeMeetingTitle")}
                    <ColumnResizeHandle col="title" onMouseDown={startMeetingResize} />
                  </th>
                  <th className="relative px-3 py-2" style={{ width: meetingCols.colWidths.location, minWidth: meetingCols.colWidths.location }}>
                    {t(lang, "committeeMeetingLocation")}
                    <ColumnResizeHandle col="location" onMouseDown={startMeetingResize} />
                  </th>
                  {report && !isPopout && <th className="px-3 py-2" />}
                  {outlookPush?.onPushRow && <th className="px-3 py-2 print:hidden" />}
                  <th className="px-3 py-2" />
                </tr>
              </>}>
                {c.meetings.map((m) => (
                  <tr key={m.id} className="border-t border-line">
                    <td className="py-1">
                      <input
                        type="date"
                        value={m.date}
                        onChange={(e) => patchMeeting(m.id, { date: e.target.value })}
                        aria-label={`${t(lang, "committeeMeetingDate")} – ${m.title || m.date}`}
                        className={INPUT_CLASS}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={m.title}
                        maxLength={200}
                        onChange={(e) => patchMeeting(m.id, { title: e.target.value })}
                        aria-label={`${t(lang, "committeeMeetingTitle")} – ${m.title || m.date}`}
                        className={`${INPUT_CLASS} w-full`}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={m.location ?? ""}
                        maxLength={300}
                        onChange={(e) => patchMeeting(m.id, { location: e.target.value })}
                        aria-label={`${t(lang, "committeeMeetingLocation")} – ${m.title || m.date}`}
                        className={`${INPUT_CLASS} w-full`}
                      />
                    </td>
                    {report && !isPopout && (
                      <td className="text-right">
                        <button
                          type="button"
                          onClick={async () => {
                            setReportMeetingId(m.id);
                            setReportVersions(report.tursoActive ? await report.loadVersions(m.id) : []);
                          }}
                          className={BTN_SECONDARY}
                          aria-label={`${t(lang, "reportStatusReport")} – ${m.title || m.date}`}
                        >
                          {t(lang, "reportStatusReport")}
                        </button>
                      </td>
                    )}
                    {outlookPush?.onPushRow && (
                      <PushRowCell
                        lang={lang}
                        onClick={() => outlookPush.onPushRow!({ kind: "meeting", id: m.id })}
                        label={m.title || m.date}
                        busy={outlookPush.pushingTarget === committeePushKey({ kind: "meeting", id: m.id })}
                        disabled={outlookPush.pushingTarget !== null}
                      />
                    )}
                    <DeleteCell lang={lang} onClick={() => deleteMeeting(m.id)} label={m.title || m.date} />
                  </tr>
                ))}
            </DataTable>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <input
              type="date"
              value={meetingDraft.date}
              onChange={(e) => setMeetingDraft((d) => ({ ...d, date: e.target.value }))}
              aria-label={t(lang, "committeeMeetingDate")}
              className={INPUT_CLASS}
            />
            <input
              type="text"
              value={meetingDraft.title}
              maxLength={200}
              placeholder={t(lang, "committeeMeetingTitle")}
              onChange={(e) => setMeetingDraft((d) => ({ ...d, title: e.target.value }))}
              aria-label={t(lang, "committeeMeetingTitle")}
              className={`${INPUT_CLASS} min-w-[12rem]`}
            />
            <input
              type="text"
              value={meetingDraft.location}
              maxLength={300}
              placeholder={t(lang, "committeeMeetingLocation")}
              onChange={(e) => setMeetingDraft((d) => ({ ...d, location: e.target.value }))}
              aria-label={t(lang, "committeeMeetingLocation")}
              className={`${INPUT_CLASS} min-w-[10rem]`}
            />
            <button type="button" onClick={addMeeting} className={BTN_PRIMARY}>
              + {t(lang, "committeeAddMeeting")}
            </button>
          </div>
        </section>

        {/* Info schedules */}
        <section>
          <h3 className="mb-2 text-sm font-medium text-foreground">{t(lang, "committeeInfoSchedules")}</h3>
          {c.infoSchedules.length > 0 && (
            <DataTable className="mb-2 w-full text-sm" head={<>
                <tr className="text-left">
                  <th className="relative px-3 py-2" style={{ width: scheduleCols.colWidths.label, minWidth: scheduleCols.colWidths.label }}>
                    {t(lang, "committeeScheduleLabel")}
                    <ColumnResizeHandle col="label" onMouseDown={startScheduleResize} />
                  </th>
                  <th className="relative px-3 py-2" style={{ width: scheduleCols.colWidths.leadDays, minWidth: scheduleCols.colWidths.leadDays }}>
                    {t(lang, "committeeScheduleLeadDays")}
                    <ColumnResizeHandle col="leadDays" onMouseDown={startScheduleResize} />
                  </th>
                  {outlookPush?.onPushRow && <th className="px-3 py-2 print:hidden" />}
                  <th className="px-3 py-2" />
                </tr>
              </>}>
                {c.infoSchedules.map((s) => (
                  <tr key={s.id} className="border-t border-line">
                    <td className="py-1">
                      <input
                        type="text"
                        value={s.label}
                        maxLength={200}
                        onChange={(e) => patchSchedule(s.id, { label: e.target.value })}
                        aria-label={`${t(lang, "committeeScheduleLabel")} – ${s.label || s.id}`}
                        className={`${INPUT_CLASS} w-full`}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        value={s.leadDays}
                        onChange={(e) => patchSchedule(s.id, { leadDays: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                        aria-label={`${t(lang, "committeeScheduleLeadDays")} – ${s.label || s.id}`}
                        className={`${INPUT_CLASS} w-24`}
                      />
                    </td>
                    {outlookPush?.onPushRow && (
                      <PushRowCell
                        lang={lang}
                        onClick={() => outlookPush.onPushRow!({ kind: "schedule", id: s.id })}
                        label={s.label || String(s.id)}
                        busy={outlookPush.pushingTarget === committeePushKey({ kind: "schedule", id: s.id })}
                        disabled={outlookPush.pushingTarget !== null}
                      />
                    )}
                    <DeleteCell lang={lang} onClick={() => deleteSchedule(s.id)} label={s.label || String(s.id)} />
                  </tr>
                ))}
            </DataTable>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <input
              type="text"
              value={scheduleDraft.label}
              maxLength={200}
              placeholder={t(lang, "committeeScheduleLabel")}
              onChange={(e) => setScheduleDraft((d) => ({ ...d, label: e.target.value }))}
              aria-label={t(lang, "committeeScheduleLabel")}
              className={`${INPUT_CLASS} min-w-[12rem]`}
            />
            <input
              type="number"
              min={0}
              value={scheduleDraft.leadDays}
              onChange={(e) => setScheduleDraft((d) => ({ ...d, leadDays: Math.max(0, Math.round(Number(e.target.value) || 0)) }))}
              aria-label={t(lang, "committeeScheduleLeadDays")}
              className={`${INPUT_CLASS} w-24`}
            />
            <button type="button" onClick={addSchedule} className={BTN_PRIMARY}>
              + {t(lang, "committeeAddSchedule")}
            </button>
          </div>
        </section>

        {/* Reminders (read-only) */}
        <section>
          <h3 className="mb-2 text-sm font-medium text-foreground">{t(lang, "committeeReminders")}</h3>
          {reminders.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t(lang, "committeeRemindersNone")}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {(["now", "soon", "upcoming"] as const).map((tier) =>
                byTier[tier].length === 0 ? null : (
                  <div key={tier}>
                    <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t(lang, REMINDER_TIER_KEY[tier])}
                    </h4>
                    <ul className="flex flex-col gap-1">
                      {byTier[tier].map((r) => (
                        <li
                          key={`${r.meetingId}:${r.scheduleId}`}
                          className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-foreground"
                        >
                          {t(lang, "actionCommitteeInfoTitle", r.label, r.meetingTitle)}
                          {" — "}
                          {t(lang, "actionCommitteeInfoWhy", r.dueDate, r.meetingTitle, r.daysLeft)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ),
              )}
            </div>
          )}
        </section>

        {/* Push to Outlook (Task 7 supplies the prop; hidden until then) */}
        {outlookPush ? (
          <section>
            <button
              type="button"
              onClick={outlookPush.onPush}
              disabled={outlookPush.pushingTarget !== null}
              className={BTN_SECONDARY}
            >
              {t(lang, outlookPush.pushingTarget === committeePushKey() ? "committeePushBusy" : "committeePushOutlook")}
            </button>
          </section>
        ) : null}
        </div>
      </div>

      {report && reportMeetingId !== null
        ? (() => {
            const m = c.meetings.find((mm) => mm.id === reportMeetingId);
            if (!m) return null;
            const title = `${t(lang, "reportStatusReport")} – ${m.title || m.date}`;
            return (
              <Modal open onClose={closeReport} ariaLabel={title} align="center">
                {/* print-root so @media print isn't blank; the panel behind drops
                    its own print-root while this modal is open (see root div) so
                    only the report prints. Resizable + reset/print/cancel chrome. */}
                <div
                  ref={reportPaneRef}
                  className="print-root flex max-h-[85vh] min-w-[320px] w-[min(90vw,720px)] resize flex-col overflow-auto rounded-lg border border-line bg-surface p-4"
                >
                  <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-foreground">{title}</h2>
                    <div className="flex items-center gap-2 print:hidden">
                      <PrintButton lang={lang} />
                      <ResetSizeButton onClick={resetReportSize} lang={lang} />
                      <button type="button" onClick={closeReport} className={BTN_SECONDARY}>
                        {t(lang, "cancel")}
                      </button>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto">
                    <MeetingReportPanel
                      lang={lang}
                      report={m.report}
                      recipients={committeeMemberEmails(c, resources)}
                      onSave={(html) => report.onSaveReport(m.id, html)}
                      onSend={(recips) => report.onSendReport(m.id, recips)}
                      m365Configured={report.m365Configured}
                      sendBusy={report.sendBusyMeetingId === m.id}
                      isPopout={isPopout}
                      aiConfigured={report.aiConfigured}
                      onGenerate={() => report.onGenerateReport(m.id)}
                      generateBusy={report.generateBusyMeetingId === m.id}
                      versions={reportVersions}
                      onRestore={(versionId) => report.onRestore(m.id, versionId)}
                      restoreBusyId={report.restoreBusyId}
                    />
                  </div>
                </div>
              </Modal>
            );
          })()
        : null}
    </div>
  );
}
