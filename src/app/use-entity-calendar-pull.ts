"use client";
import { useCallback, useState } from "react";
import { useMsAuth } from "./use-ms-auth";
import { useToastContext } from "./toast-context";
import { t, type Lang } from "./i18n";
import { CALENDAR_READWRITE_SCOPE, updateEvent, type GraphEvent } from "./outlook-calendar-write";
import { fetchProjectEventDates } from "./outlook-calendar-read";
import { planCalendarPull, type PullPlan } from "./calendar-pull";
import { loadBaseline, writeBaselineDate } from "./calendar-sync-baseline";

interface Args<T extends { id: number; outlookEventId?: string }> {
  items: readonly T[];
  entityType: string;
  projectId: string;
  getDate: (item: T) => string | undefined;
  withDate: (item: T, date: string) => T;
  toGraphEvent: (item: T, projectId: string) => GraphEvent;
  setItems: (updater: (prev: T[]) => T[]) => void;
  isPullable?: (item: T) => boolean;
  isPopout: boolean;
  lang: Lang;
  enabled: boolean;
}

/**
 * Generic "pull from Outlook" hook — a parameterized clone of
 * `useMilestoneCalendarPull` that pulls Outlook reschedules onto ANY entity's
 * date field (tasks, RAID, changes, …) with the same app-wins + convergence
 * semantics. `isPullable` filters out entities the app must not follow (e.g.
 * Jira-synced tasks whose dates Jira owns). Popouts are read-only.
 */
export function useEntityCalendarPull<T extends { id: number; outlookEventId?: string }>(
  { items, entityType, projectId, getDate, withDate, toGraphEvent, setItems, isPullable, isPopout, lang, enabled }: Args<T>,
) {
  const { acquireToken } = useMsAuth(enabled);
  const showToast = useToastContext();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ plan: PullPlan } | null>(null);

  const applyMove = useCallback((id: number, eventId: string, newDate: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? withDate(i, newDate) : i)));
    writeBaselineDate(projectId, entityType, eventId, newDate);
  }, [setItems, withDate, projectId, entityType]);

  const keepApp = useCallback(async (c: { id: number; eventId: string; appDate: string }) => {
    // App-wins: converge Outlook to the entity's (kept) date so baseline===appDate
    // becomes GENUINELY true. Just refreshing the baseline would make the next pull
    // see baseline===date and silently auto-apply the Outlook date the user rejected.
    const item = items.find((x) => x.id === c.id);
    if (!item) return;
    const token = await acquireToken(CALENDAR_READWRITE_SCOPE, { interactive: true }).catch(() => null);
    if (!token) { showToast("error", t(lang, "calendarPushNoAccess")); return; }
    try {
      await updateEvent(token, c.eventId, toGraphEvent(item, projectId));
      writeBaselineDate(projectId, entityType, c.eventId, c.appDate);
      showToast("info", t(lang, "calendarPushResult", 0, 1, 0));
    } catch {
      // Do NOT write baseline on failure — leave it non-matching so it re-conflicts
      // next pull (never falsely "in sync").
      showToast("error", t(lang, "calendarPushPartial", 1));
    }
  }, [items, acquireToken, showToast, lang, projectId, entityType, toGraphEvent]);

  const pull = useCallback(async () => {
    if (isPopout || !enabled) return;
    setBusy(true);
    try {
      const token = await acquireToken(CALENDAR_READWRITE_SCOPE, { interactive: true }).catch(() => null);
      if (!token) { showToast("error", t(lang, "calendarPushNoAccess")); return; }
      const events = await fetchProjectEventDates(token, projectId, entityType);
      const baseline = loadBaseline(projectId, entityType);
      const pullable = isPullable ? items.filter(isPullable) : items;
      const entities = pullable
        .map((i) => ({ id: i.id, date: getDate(i) ?? "", outlookEventId: i.outlookEventId }))
        .filter((e) => e.date);
      const plan = planCalendarPull({ entities, events, baseline });
      // auto-apply non-conflicting moves
      for (const a of plan.applies) applyMove(a.id, a.eventId, a.newDate);
      // self-heal baseline for events already in sync but missing a baseline
      for (const i of pullable) {
        if (i.outlookEventId) {
          const ev = events.find((e) => e.id === i.outlookEventId);
          const d = getDate(i);
          if (ev && d && ev.date === d && baseline[i.outlookEventId] !== d) {
            writeBaselineDate(projectId, entityType, i.outlookEventId, d);
          }
        }
      }
      const hasRows = plan.applies.length + plan.conflicts.length + plan.deletions.length > 0;
      if (hasRows) setResult({ plan });
      else showToast("info", t(lang, "calendarPullInSync"));
    } catch {
      showToast("error", t(lang, "calendarPushNoAccess"));
    } finally {
      setBusy(false);
    }
  }, [isPopout, enabled, acquireToken, showToast, lang, items, projectId, entityType, getDate, isPullable, applyMove]);

  return { pull, busy, result, clearResult: useCallback(() => setResult(null), []), keepApp, applyMove };
}
