"use client";
import { useCallback, useState } from "react";
import { useMsAuth } from "./use-ms-auth";
import { useToastContext } from "./toast-context";
import { t, type Lang } from "./i18n";
import { planCommitteeReconcile } from "./committee-calendar-reconcile";
import {
  CALENDAR_READWRITE_SCOPE, committeeMeetingToGraphEvent, committeeInfoToGraphEvent,
  createEvent, updateEvent, deleteEvent,
} from "./outlook-calendar-write";
import type { SteeringCommittee } from "./types";

interface Args {
  committee: SteeringCommittee | undefined;
  committeeName: string; // committee?.name ?? "" — used in event subjects
  projectId: string;
  today: string; // ISO yyyy-mm-dd, passed in (no Date.now in render)
  setSteeringCommittee: (updater: (prev: SteeringCommittee | undefined) => SteeringCommittee | undefined) => void;
  isPopout: boolean;
  lang: Lang;
  enabled: boolean;
}

/**
 * Push committee MEETINGS + INFO-PACK REMINDER instances to the user's Outlook
 * calendar via Graph, then persist the returned event ids back into the
 * committee. The reconcile is id-tracked (derives create/update/delete from the
 * committee's OWN stored ids) so we never list Outlook — we act directly on the
 * plan. Each Graph call is wrapped so one failure does not abort the batch; only
 * status digits (via GraphCalendarError) ever reach logs/toasts — never the
 * token or any response body.
 */
export function useCommitteeOutlookPush({
  committee, committeeName, projectId, today, setSteeringCommittee, isPopout, lang, enabled,
}: Args) {
  const { acquireToken } = useMsAuth(enabled);
  const showToast = useToastContext();
  const [busy, setBusy] = useState(false);

  const pushToOutlook = useCallback(async () => {
    if (isPopout || !committee) return;
    setBusy(true);
    try {
      const token = await acquireToken(CALENDAR_READWRITE_SCOPE, { interactive: true }).catch(() => null);
      if (!token) { showToast("error", t(lang, "committeePushError")); return; }

      const plan = planCommitteeReconcile(committee, today);
      const newMeetingIds = new Map<number, string>(); // meetingId -> created eventId
      const newInfoIds = new Map<string, string>(); // "<meetingId>:<scheduleId>" -> created eventId
      let failed = 0;

      for (const m of plan.meetingCreate) {
        try { newMeetingIds.set(m.id, await createEvent(token, committeeMeetingToGraphEvent(m, committeeName, projectId))); }
        catch (err) { failed++; console.warn("Committee Outlook push: meeting create failed", err); }
      }
      for (const u of plan.meetingUpdate) {
        try { await updateEvent(token, u.eventId, committeeMeetingToGraphEvent(u.meeting, committeeName, projectId)); }
        catch (err) { failed++; console.warn("Committee Outlook push: meeting update failed", err); }
      }
      for (const item of plan.infoCreate) {
        try { newInfoIds.set(item.key, await createEvent(token, committeeInfoToGraphEvent(item, projectId))); }
        catch (err) { failed++; console.warn("Committee Outlook push: info create failed", err); }
      }
      for (const item of plan.infoUpdate) {
        try { await updateEvent(token, item.eventId, committeeInfoToGraphEvent(item, projectId)); }
        catch (err) { failed++; console.warn("Committee Outlook push: info update failed", err); }
      }
      for (const id of plan.deleteEventIds) {
        try { await deleteEvent(token, id); }
        catch (err) { failed++; console.warn("Committee Outlook push: delete failed", err); }
      }

      const deletedSet = new Set(plan.deleteEventIds);
      const persist = newMeetingIds.size > 0 || newInfoIds.size > 0 || deletedSet.size > 0;
      if (persist) {
        setSteeringCommittee((prev) => {
          if (!prev) return prev;
          const meetings = newMeetingIds.size > 0
            ? prev.meetings.map((m) => (newMeetingIds.has(m.id) ? { ...m, outlookEventId: newMeetingIds.get(m.id) } : m))
            : prev.meetings;
          const infoReminderEventIds: Record<string, string> = {};
          for (const [k, v] of Object.entries(prev.infoReminderEventIds ?? {})) {
            if (!deletedSet.has(v)) infoReminderEventIds[k] = v; // prune stale ids
          }
          for (const [k, v] of newInfoIds) infoReminderEventIds[k] = v;
          return { ...prev, meetings, infoReminderEventIds };
        });
      }

      showToast(
        "info",
        t(lang, "committeePushResult",
          plan.meetingCreate.length + plan.meetingUpdate.length,
          plan.infoCreate.length + plan.infoUpdate.length),
      );
      if (failed > 0) showToast("error", t(lang, "committeePushPartial", failed));
    } catch {
      showToast("error", t(lang, "committeePushError"));
    } finally {
      setBusy(false);
    }
  }, [isPopout, committee, acquireToken, showToast, lang, today, committeeName, projectId, setSteeringCommittee]);

  return { pushToOutlook, busy };
}
