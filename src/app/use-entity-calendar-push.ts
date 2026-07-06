"use client";
import { useCallback, useState } from "react";
import { useMsAuth } from "./use-ms-auth";
import { useToastContext } from "./toast-context";
import { t, type Lang } from "./i18n";
import { planEntityReconcile, type HasEventLink } from "./calendar-reconcile";
import { logDiag } from "./diagnostics";
import {
  CALENDAR_READWRITE_SCOPE, listEntityEvents, createEvent, updateEvent, deleteEvent,
  GraphCalendarError, type GraphEvent,
} from "./outlook-calendar-write";

// Module-scoped in-flight lock keyed by `${projectId}:${entityType}`. Shared
// across ALL hook instances (the silent auto-sync runner AND the manual button
// operate on the same entity set + Outlook category), so only ONE reconcile
// runs at a time — a manual click during an in-flight auto push (or vice-versa)
// no-ops instead of racing to double-create the same event.
const inFlightReconcile = new Set<string>();

interface Args<T extends HasEventLink> {
  items: readonly T[];
  entityType: string;
  projectId: string;
  toGraphEvent: (item: T, projectId: string) => GraphEvent;
  setItems: (updater: (prev: T[]) => T[]) => void;
  isPopout: boolean;
  lang: Lang;
  enabled: boolean;
  /** When false, acquire the Graph token NON-interactively (no consent popup) and
   *  stay SILENT on a null token — used by the background auto-sync runner so a
   *  missing/expired token doesn't spam an error toast on every reconcile. */
  interactive?: boolean;
}

/**
 * Generic manual "push to Outlook" hook — a parameterized clone of
 * `useOutlookCalendarPush` (milestones) that reconciles ANY entity carrying an
 * `outlookEventId` (tasks, RAID, changes, …) against its TYPE-SCOPED category.
 * Keys by `item.id`; a 404 on PATCH clears the stale link so it re-creates next
 * push. Popouts are read-only (no Graph calls, no state write).
 */
export function useEntityCalendarPush<T extends HasEventLink>(
  { items, entityType, projectId, toGraphEvent, setItems, isPopout, lang, enabled, interactive = true }: Args<T>,
) {
  const { acquireToken } = useMsAuth(enabled);
  const showToast = useToastContext();
  const [busy, setBusy] = useState(false);

  const pushToOutlook = useCallback(async () => {
    if (isPopout) return;
    const lockKey = `${projectId}:${entityType}`;
    if (inFlightReconcile.has(lockKey)) return; // another push is already reconciling this set
    inFlightReconcile.add(lockKey);
    setBusy(true);
    try {
      const token = await acquireToken(CALENDAR_READWRITE_SCOPE, { interactive }).catch(() => null);
      if (!token) {
        // Auto-sync (interactive:false): a null token = no cached session → silent
        // no-op (no toast). The manual button (interactive:true) still surfaces it.
        if (!interactive) return;
        showToast("error", t(lang, "calendarPushNoAccess")); return;
      }
      const existing = await listEntityEvents(token, projectId, entityType);
      const plan = planEntityReconcile(items, existing);
      const newIds = new Map<number, string>();
      const staleIds = new Set<number>();
      let failed = 0;
      for (const it of plan.create) {
        try { newIds.set(it.id, await createEvent(token, toGraphEvent(it, projectId))); }
        catch (err) { failed++; logDiag("warn", "calendar.pushItemFailed", { entityType, op: "create", id: it.id, message: err instanceof Error ? err.message : String(err) }); }
      }
      for (const u of plan.update) {
        try { await updateEvent(token, u.eventId, toGraphEvent(u.item, projectId)); }
        catch (err) {
          if (err instanceof GraphCalendarError && err.status === 404) {
            staleIds.add(u.item.id); // event gone in Outlook → clear link, re-create next push
          } else {
            failed++;
            logDiag("warn", "calendar.pushItemFailed", { entityType, op: "update", id: u.item.id, message: err instanceof Error ? err.message : String(err) });
          }
        }
      }
      for (const id of plan.delete) {
        try { await deleteEvent(token, id); }
        catch (err) { failed++; logDiag("warn", "calendar.pushItemFailed", { entityType, op: "delete", message: err instanceof Error ? err.message : String(err) }); }
      }
      if (newIds.size > 0 || staleIds.size > 0) {
        setItems((prev) => prev.map((it) => {
          if (newIds.has(it.id)) return { ...it, outlookEventId: newIds.get(it.id) };
          if (staleIds.has(it.id)) return { ...it, outlookEventId: undefined };
          return it;
        }));
      }
      // Auto-sync (interactive:false) stays fully silent — no result/partial toast.
      if (interactive) {
        showToast("info", t(lang, "calendarPushResult", plan.create.length, plan.update.length, plan.delete.length));
        if (failed > 0) showToast("error", t(lang, "calendarPushPartial", failed));
      }
    } catch {
      if (interactive) showToast("error", t(lang, "calendarPushNoAccess"));
    } finally {
      inFlightReconcile.delete(lockKey);
      setBusy(false);
    }
  }, [isPopout, acquireToken, showToast, lang, items, projectId, setItems, entityType, toGraphEvent, interactive]);

  return { pushToOutlook, busy };
}
