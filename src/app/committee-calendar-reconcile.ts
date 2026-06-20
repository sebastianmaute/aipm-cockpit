// src/app/committee-calendar-reconcile.ts — pure steering-committee↔calendar reconcile (no Graph, no i18n).
import type { SteeringCommittee, CommitteeMeeting } from "./types";
import { dueInfoReminders } from "./steering-reminders";

export interface CommitteeReconcile {
  meetingCreate: CommitteeMeeting[];
  meetingUpdate: { meeting: CommitteeMeeting; eventId: string }[];
  infoCreate: { key: string; label: string; dueDate: string; meetingTitle: string }[];
  infoUpdate: { key: string; eventId: string; label: string; dueDate: string; meetingTitle: string }[];
  deleteEventIds: string[];
}

/**
 * Plan the Outlook reconcile for a steering committee. Meetings split into
 * create (no stored `outlookEventId`) vs update (1:1 by id, like milestones).
 * Info-schedule instances are keyed `"<meetingId>:<scheduleId>"` in
 * `infoReminderEventIds`: a desired instance with a stored id -> update, without
 * -> create; any stored id whose key is no longer desired (removed/past meeting
 * or removed schedule) lands in `deleteEventIds`. Pure; never throws.
 */
export function planCommitteeReconcile(committee: SteeringCommittee, today: string): CommitteeReconcile {
  const meetingCreate: CommitteeMeeting[] = [];
  const meetingUpdate: { meeting: CommitteeMeeting; eventId: string }[] = [];
  for (const m of committee.meetings) {
    if (m.outlookEventId) meetingUpdate.push({ meeting: m, eventId: m.outlookEventId });
    else meetingCreate.push(m);
  }

  const desired = dueInfoReminders(committee, today);
  const stored = committee.infoReminderEventIds ?? {};
  const desiredKeys = new Set(desired.map((d) => `${d.meetingId}:${d.scheduleId}`));
  const infoCreate: CommitteeReconcile["infoCreate"] = [];
  const infoUpdate: CommitteeReconcile["infoUpdate"] = [];
  for (const d of desired) {
    const key = `${d.meetingId}:${d.scheduleId}`;
    const eventId = stored[key];
    if (eventId) infoUpdate.push({ key, eventId, label: d.label, dueDate: d.dueDate, meetingTitle: d.meetingTitle });
    else infoCreate.push({ key, label: d.label, dueDate: d.dueDate, meetingTitle: d.meetingTitle });
  }

  const deleteEventIds = Object.entries(stored).filter(([k]) => !desiredKeys.has(k)).map(([, v]) => v);
  return { meetingCreate, meetingUpdate, infoCreate, infoUpdate, deleteEventIds };
}
