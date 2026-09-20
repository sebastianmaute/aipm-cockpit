"use client";
import { useCallback, useState } from "react";
import { useMsAuth } from "./use-ms-auth";
import { useToastContext } from "./toast-context";
import { t, type Lang } from "./i18n";
import { planEntityReconcile, type HasEventLink } from "./calendar-reconcile";
import { logDiag } from "./diagnostics";
import { dropStaleScopeWrite, type ScopeEpochReader } from "./scope-epoch";
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
  /** §548 — `useStorageBackend`'s scope-epoch reader. Omitted by a caller outside the storage hook's
   *  reach (unit tests), which keeps the pre-§548 behaviour. ★ Every production call site passes it:
   *  the seventeen in `use-calendar-integrations.ts` from its required deps member, and
   *  `tasks-section.tsx`'s own manual push from its own required `getScopeEpoch` prop. */
  getScopeEpoch?: ScopeEpochReader;
}

/**
 * Generic manual "push to Outlook" hook — a parameterized clone of
 * `useOutlookCalendarPush` (milestones) that reconciles ANY entity carrying an
 * `outlookEventId` (tasks, RAID, changes, …) against its TYPE-SCOPED category.
 * Keys by `item.id`; a 404 on PATCH clears the stale link so it re-creates next
 * push. Popouts are read-only (no Graph calls, no state write).
 */
export function useEntityCalendarPush<T extends HasEventLink>(
  { items, entityType, projectId, toGraphEvent, setItems, isPopout, lang, enabled, interactive = true, getScopeEpoch }: Args<T>,
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
    // §548 — the project this reconcile reads `items` from. Checked twice below: once before any
    // Graph MUTATION (so a swap during the listing costs nothing), once before the workspace write.
    const startEpoch = getScopeEpoch?.();
    try {
      const token = await acquireToken(CALENDAR_READWRITE_SCOPE, { interactive }).catch(() => null);
      if (!token) {
        // Auto-sync (interactive:false): a null token = no cached session → silent
        // no-op (no toast). The manual button (interactive:true) still surfaces it.
        if (!interactive) return;
        showToast("error", t(lang, "calendarPushNoAccess")); return;
      }
      const existing = await listEntityEvents(token, projectId, entityType);
      // A swap started while Graph was answering: this plan belongs to the PREVIOUS project. Bail
      // before creating/updating/deleting anything, so no event is orphaned by the later drop.
      if (dropStaleScopeWrite(getScopeEpoch, startEpoch, "useEntityCalendarPush", { entityType, at: "plan" })) return;
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
      // §548 — the swap can also land DURING the create/update/delete loop above, so the ids just
      // created are dropped on the floor. ★★ THEY ARE NOT RE-LINKED: `planEntityReconcile` puts every
      // listed event id NOT referenced by an item into `plan.delete`, so the next push in the right
      // project DELETES the orphan and RE-CREATES the entity's event. Churn (one extra delete + one
      // extra create, once), self-healing, and far better than writing this project's ids onto the
      // next project's rows. ★ No compensating delete is issued here on purpose: a rollback that
      // itself fails mid-way is a worse failure than the churn.
      if (dropStaleScopeWrite(getScopeEpoch, startEpoch, "useEntityCalendarPush", { entityType, at: "write" })) return;
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
    } catch (err) {
      if (interactive) showToast("error", t(lang, "calendarPushNoAccess"));
      // Background auto-sync stays user-silent (no toast) but must remain
      // inspectable in Diagnostics — the failure was previously swallowed.
      else logDiag("warn", "calendar.autoSyncFailed", { entityType, message: err instanceof Error ? err.message : String(err) });
    } finally {
      inFlightReconcile.delete(lockKey);
      setBusy(false);
    }
  }, [isPopout, acquireToken, showToast, lang, items, projectId, setItems, entityType, toGraphEvent, interactive, getScopeEpoch]);

  return { pushToOutlook, busy };
}
