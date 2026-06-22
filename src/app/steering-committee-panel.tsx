"use client";

// Steering-committee editor surface (SP-E). i18n-aware (it is a surface — pure
// date math lives in steering-reminders.ts). All edits are immutable: every
// handler spreads a new SteeringCommittee. Mounted by workspace-section.tsx for
// both the modern and classic shells.

import { useState } from "react";
import { type Lang, t } from "./i18n";
import { ResourcePicker } from "./resource-picker";
import { resourceDisplayName } from "./resource-foundation";
import { dueInfoReminders, type InfoReminder, type ReminderTier } from "./steering-reminders";
import { ResetSizeButton } from "./task-manager-ui";
import { useResizable } from "./use-resizable";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { TABLE_HEAD_CLASS } from "./table-styles";
import type { CommitteeMeeting, InfoSchedule, Resource, SteeringCommittee } from "./types";

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
  "rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90";
const BTN_SECONDARY =
  "rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted disabled:opacity-60";
const INPUT_CLASS =
  "rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-foreground focus:border-AIPM-dark-blue focus:outline-none focus:ring-1 focus:ring-AIPM-green";

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
   *  Errors surface via toast (not inline), so no `error` field is threaded. */
  outlookPush?: { onPush: () => void; busy: boolean };
}

export function SteeringCommitteePanel({
  lang,
  committee,
  onChange,
  resources,
  today,
  outlookPush,
}: SteeringCommitteePanelProps) {
  const c = committee ?? EMPTY_COMMITTEE;
  const { ref: paneRef, reset: resetSize } = useResizable("lop-app:steering-size");

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
    <div ref={paneRef} className={VIEW_PANE_RESIZABLE_CLASS}>
      <div className="mb-2 flex shrink-0 items-center justify-between">
        <h2 className="text-lg font-medium text-foreground">{t(lang, "committeeTitle")}</h2>
        <ResetSizeButton onClick={resetSize} lang={lang} />
      </div>

      <div className="min-h-[240px] flex-1 overflow-auto rounded-md border border-line pr-2">
        <div className="flex flex-col gap-6">
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
            <table className="mb-2 w-full text-sm">
              <thead className={TABLE_HEAD_CLASS}>
                <tr className="text-left">
                  <th className="px-3 py-2">{t(lang, "committeeMeetingDate")}</th>
                  <th className="px-3 py-2">{t(lang, "committeeMeetingTitle")}</th>
                  <th className="px-3 py-2">{t(lang, "committeeMeetingLocation")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
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
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => deleteMeeting(m.id)}
                        aria-label={`${t(lang, "delete")} – ${m.title || m.date}`}
                        className={BTN_SECONDARY}
                      >
                        {t(lang, "delete")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
            <table className="mb-2 w-full text-sm">
              <thead className={TABLE_HEAD_CLASS}>
                <tr className="text-left">
                  <th className="px-3 py-2">{t(lang, "committeeScheduleLabel")}</th>
                  <th className="px-3 py-2">{t(lang, "committeeScheduleLeadDays")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
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
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => deleteSchedule(s.id)}
                        aria-label={`${t(lang, "delete")} – ${s.label || s.id}`}
                        className={BTN_SECONDARY}
                      >
                        {t(lang, "delete")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
              disabled={outlookPush.busy}
              className={BTN_SECONDARY}
            >
              {t(lang, outlookPush.busy ? "committeePushBusy" : "committeePushOutlook")}
            </button>
          </section>
        ) : null}
        </div>
      </div>
    </div>
  );
}
