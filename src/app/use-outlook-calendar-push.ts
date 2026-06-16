"use client";
import { useCallback, useState } from "react";
import { useMsAuth } from "./use-ms-auth";
import { useToastContext } from "./toast-context";
import { t, type Lang } from "./i18n";
import { planCalendarReconcile } from "./calendar-reconcile";
import {
  CALENDAR_READWRITE_SCOPE, milestoneToGraphEvent, listProjectEvents, createEvent, updateEvent, deleteEvent,
} from "./outlook-calendar-write";
import type { Milestone } from "./types";

interface Args {
  milestones: readonly Milestone[];
  projectId: string;
  setMilestones: (updater: (prev: Milestone[]) => Milestone[]) => void;
  isPopout: boolean;
  lang: Lang;
  enabled: boolean;
}

export function useOutlookCalendarPush({ milestones, projectId, setMilestones, isPopout, lang, enabled }: Args) {
  const { acquireToken } = useMsAuth(enabled);
  const showToast = useToastContext();
  const [busy, setBusy] = useState(false);

  const pushToOutlook = useCallback(async () => {
    if (isPopout) return;
    setBusy(true);
    try {
      const token = await acquireToken(CALENDAR_READWRITE_SCOPE, { interactive: true }).catch(() => null);
      if (!token) { showToast("error", t(lang, "calendarPushNoAccess")); return; }
      const existing = await listProjectEvents(token, projectId);
      const plan = planCalendarReconcile(milestones, existing);
      const newIds = new Map<number, string>();
      let failed = 0;
      for (const m of plan.create) {
        try { newIds.set(m.id, await createEvent(token, milestoneToGraphEvent(m, projectId))); }
        catch (err) { failed++; console.warn("Outlook calendar push: create event failed", err); }
      }
      for (const u of plan.update) {
        try { await updateEvent(token, u.eventId, milestoneToGraphEvent(u.milestone, projectId)); }
        catch (err) { failed++; console.warn("Outlook calendar push: update event failed", err); }
      }
      for (const id of plan.delete) {
        try { await deleteEvent(token, id); }
        catch (err) { failed++; console.warn("Outlook calendar push: delete event failed", err); }
      }
      if (newIds.size > 0) {
        setMilestones((prev) => prev.map((m) => (newIds.has(m.id) ? { ...m, outlookEventId: newIds.get(m.id) } : m)));
      }
      showToast("info", t(lang, "calendarPushResult", plan.create.length, plan.update.length, plan.delete.length));
      if (failed > 0) showToast("error", t(lang, "calendarPushPartial", failed));
    } catch {
      showToast("error", t(lang, "calendarPushNoAccess"));
    } finally {
      setBusy(false);
    }
  }, [isPopout, acquireToken, showToast, lang, milestones, projectId, setMilestones]);

  return { pushToOutlook, busy };
}
