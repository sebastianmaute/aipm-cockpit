"use client";
import { useCallback, useState } from "react";
import { useMsAuth } from "./use-ms-auth";
import { useToastContext } from "./toast-context";
import { t, type Lang } from "./i18n";
import { planCalendarReconcile } from "./calendar-reconcile";
import { logDiag } from "./diagnostics";
import { dropStaleScopeWrite, type ScopeEpochReader } from "./scope-epoch";
import {
  CALENDAR_READWRITE_SCOPE, milestoneToGraphEvent, listProjectEvents, createEvent, updateEvent, deleteEvent,
  GraphCalendarError,
} from "./outlook-calendar-write";
import type { Milestone } from "./types";

interface Args {
  milestones: readonly Milestone[];
  projectId: string;
  setMilestones: (updater: (prev: Milestone[]) => Milestone[]) => void;
  isPopout: boolean;
  lang: Lang;
  enabled: boolean;
  /** §548 — `useStorageBackend`'s scope-epoch reader; omitted outside the storage hook's reach. */
  getScopeEpoch?: ScopeEpochReader;
}

export function useOutlookCalendarPush({ milestones, projectId, setMilestones, isPopout, lang, enabled, getScopeEpoch }: Args) {
  const { acquireToken } = useMsAuth(enabled);
  const showToast = useToastContext();
  const [busy, setBusy] = useState(false);

  const pushToOutlook = useCallback(async () => {
    if (isPopout) return;
    setBusy(true);
    // §548 — the project `milestones` were read from; see `scope-epoch.ts`.
    const startEpoch = getScopeEpoch?.();
    try {
      const token = await acquireToken(CALENDAR_READWRITE_SCOPE, { interactive: true }).catch(() => null);
      if (!token) { showToast("error", t(lang, "calendarPushNoAccess")); return; }
      const existing = await listProjectEvents(token, projectId);
      // A swap started while Graph was answering — bail before any Graph mutation.
      if (dropStaleScopeWrite(getScopeEpoch, startEpoch, "useOutlookCalendarPush", { at: "plan" })) return;
      const plan = planCalendarReconcile(milestones, existing);
      const newIds = new Map<number, string>();
      const staleIds = new Set<number>();
      const deletedIds = new Set<string>();
      let failed = 0;
      for (const m of plan.create) {
        try { newIds.set(m.id, await createEvent(token, milestoneToGraphEvent(m, projectId))); }
        catch (err) { failed++; logDiag("warn", "calendar.pushItemFailed", { entityType: "milestone", op: "create", id: m.id, message: err instanceof Error ? err.message : String(err) }); }
      }
      for (const u of plan.update) {
        try { await updateEvent(token, u.eventId, milestoneToGraphEvent(u.milestone, projectId)); }
        catch (err) {
          if (err instanceof GraphCalendarError && err.status === 404) {
            staleIds.add(u.milestone.id); // event gone in Outlook → clear link, re-create next push
          } else {
            failed++;
            logDiag("warn", "calendar.pushItemFailed", { entityType: "milestone", op: "update", id: u.milestone.id, message: err instanceof Error ? err.message : String(err) });
          }
        }
      }
      for (const id of plan.delete) {
        try { await deleteEvent(token, id); deletedIds.add(id); }
        catch (err) { failed++; logDiag("warn", "calendar.pushItemFailed", { entityType: "milestone", op: "delete", message: err instanceof Error ? err.message : String(err) }); }
      }
      // §548 — the swap can land during the create/update/delete loop too, so the ids just created are
      // dropped. ★★ NOT re-linked: `planCalendarReconcile` puts every listed event id not referenced
      // by a milestone into `plan.delete`, so the next push DELETES the orphan and RE-CREATES the
      // event — self-healing churn, and better than this project's ids on the next project's rows.
      if (dropStaleScopeWrite(getScopeEpoch, startEpoch, "useOutlookCalendarPush", { at: "write" })) return;
      // §486 — the app's OWN delete must also drop the link. A row still holding a
      // deleted id (this push passes every milestone, so only a row that
      // joined the list mid-push — an undo restoring a deleted milestone — can) would otherwise look, to the
      // next PULL, like an event the user deleted in Outlook — and the prune would
      // opt it out of sync for good. Only the link is cleared; `calendarOptOut` is
      // never touched here.
      if (newIds.size > 0 || staleIds.size > 0 || deletedIds.size > 0) {
        setMilestones((prev) => prev.map((m) => {
          if (newIds.has(m.id)) return { ...m, outlookEventId: newIds.get(m.id) };
          if (staleIds.has(m.id)) return { ...m, outlookEventId: undefined };
          if (m.outlookEventId && deletedIds.has(m.outlookEventId)) return { ...m, outlookEventId: undefined };
          return m;
        }));
      }
      showToast("info", t(lang, "calendarPushResult", plan.create.length, plan.update.length, plan.delete.length));
      if (failed > 0) showToast("error", t(lang, "calendarPushPartial", failed));
    } catch {
      showToast("error", t(lang, "calendarPushNoAccess"));
    } finally {
      setBusy(false);
    }
  }, [isPopout, acquireToken, showToast, lang, milestones, projectId, setMilestones, getScopeEpoch]);

  return { pushToOutlook, busy };
}
