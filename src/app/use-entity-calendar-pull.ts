"use client";
import { useCallback, useRef, useState } from "react";
import { useMsAuth } from "./use-ms-auth";
import { useToastContext } from "./toast-context";
import { t, type Lang } from "./i18n";
import { CALENDAR_READWRITE_SCOPE, updateEvent, type GraphEvent } from "./outlook-calendar-write";
import { fetchProjectEventDates } from "./outlook-calendar-read";
import { planCalendarPull, type PullPlan } from "./calendar-pull";
import { loadBaseline, writeBaselineDate, removeBaselineEntry } from "./calendar-sync-baseline";

interface Args<T extends { id: number; outlookEventId?: string }> {
  items: readonly T[];
  entityType: string;
  projectId: string;
  getDate: (item: T) => string | undefined;
  getEndDate?: (item: T) => string | undefined;
  withDate: (item: T, date: string, endDate?: string) => T;
  toGraphEvent: (item: T, projectId: string) => GraphEvent;
  setItems: (updater: (prev: T[]) => T[]) => void;
  isPullable?: (item: T) => boolean;
  isPopout: boolean;
  lang: Lang;
  enabled: boolean;
  /** Background auto-pull: non-interactive token, never opens the modal, silent on no-access/error. */
  background?: boolean;
  /** Called once per background pull that auto-applied ≥1 Outlook move, with the
   *  applied count — lets the caller record an audit-trail activity entry. */
  onBackgroundApply?: (count: number) => void;
}

// Cross-instance in-flight lock keyed `${projectId}:${entityType}` so a manual pull
// and a background tick for the SAME entity can't run concurrently (mirrors the
// push side's module-level guard).
const inFlightPull = new Set<string>();

/**
 * Generic "pull from Outlook" hook — a parameterized clone of
 * `useMilestoneCalendarPull` that pulls Outlook reschedules onto ANY entity's
 * date field (tasks, RAID, changes, …) with the same app-wins + convergence
 * semantics. `isPullable` filters out entities the app must not follow (e.g.
 * Jira-synced tasks whose dates Jira owns). Popouts are read-only.
 */
export function useEntityCalendarPull<T extends { id: number; outlookEventId?: string }>(
  { items, entityType, projectId, getDate, getEndDate, withDate, toGraphEvent, setItems, isPullable, isPopout, lang, enabled, background, onBackgroundApply }: Args<T>,
) {
  const { acquireToken } = useMsAuth(enabled);
  const showToast = useToastContext();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ plan: PullPlan } | null>(null);
  // Signature of the conflict set last surfaced by a BACKGROUND pull. The count
  // toast is the only background notice, and background never opens the modal —
  // so without this dedupe the SAME toast would re-fire on every 15-min tick and
  // every tab refocus while a conflict stays unresolved (non-actionable nag).
  // Re-toast only when the set changes; reset to null when it clears so a fresh
  // conflict later re-announces.
  const lastConflictSigRef = useRef<string | null>(null);

  const applyMove = useCallback((id: number, eventId: string, newDate: string, newEndDate?: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? withDate(i, newDate, newEndDate) : i)));
    writeBaselineDate(projectId, entityType, eventId, newEndDate !== undefined ? `${newDate}|${newEndDate}` : newDate);
  }, [setItems, withDate, projectId, entityType]);

  // A definitively-gone event (missing/cancelled): clear the entity's stored link
  // and drop its baseline so the item stops re-appearing on every subsequent pull.
  const prune = useCallback((id: number, eventId: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, outlookEventId: undefined } : i)));
    removeBaselineEntry(projectId, entityType, eventId);
  }, [setItems, projectId, entityType]);

  const keepApp = useCallback(async (c: { id: number; eventId: string; appDate: string; appEndDate?: string }) => {
    // App-wins: converge Outlook to the entity's (kept) date so baseline===appDate
    // becomes GENUINELY true. Just refreshing the baseline would make the next pull
    // see baseline===date and silently auto-apply the Outlook date the user rejected.
    const item = items.find((x) => x.id === c.id);
    if (!item) return;
    const token = await acquireToken(CALENDAR_READWRITE_SCOPE, { interactive: true }).catch(() => null);
    if (!token) { showToast("error", t(lang, "calendarPushNoAccess")); return; }
    try {
      await updateEvent(token, c.eventId, toGraphEvent(item, projectId));
      writeBaselineDate(projectId, entityType, c.eventId, c.appEndDate !== undefined ? `${c.appDate}|${c.appEndDate}` : c.appDate);
      showToast("info", t(lang, "calendarPushResult", 0, 1, 0));
    } catch {
      // Do NOT write baseline on failure — leave it non-matching so it re-conflicts
      // next pull (never falsely "in sync").
      showToast("error", t(lang, "calendarPushPartial", 1));
    }
  }, [items, acquireToken, showToast, lang, projectId, entityType, toGraphEvent]);

  const pull = useCallback(async () => {
    if (isPopout || !enabled) return;
    const lockKey = `${projectId}:${entityType}`;
    if (inFlightPull.has(lockKey)) return; // another pull for this entity is already running
    inFlightPull.add(lockKey);
    if (!background) setBusy(true);
    try {
      const token = await acquireToken(CALENDAR_READWRITE_SCOPE, { interactive: !background }).catch(() => null);
      if (!token) {
        // A background pull that can't confirm the current conflict set must forget
        // its dedupe signature, so a genuinely-new re-conflict re-toasts once truth
        // is re-established on the next successful pull.
        if (background) lastConflictSigRef.current = null;
        else showToast("error", t(lang, "calendarPushNoAccess"));
        return;
      }
      const { events, truncated } = await fetchProjectEventDates(token, projectId, entityType);
      const baseline = loadBaseline(projectId, entityType);
      const pullable = isPullable ? items.filter(isPullable) : items;
      const entities = pullable
        .map((i) => ({ id: i.id, date: getDate(i) ?? "", endDate: getEndDate?.(i), outlookEventId: i.outlookEventId }))
        .filter((e) => e.date);
      const plan = planCalendarPull({ entities, events, baseline, eventsComplete: !truncated });
      // auto-apply non-conflicting moves
      for (const a of plan.applies) applyMove(a.id, a.eventId, a.newDate, a.newEndDate);
      // self-heal baseline for events already in sync but missing a baseline
      for (const i of pullable) {
        if (i.outlookEventId) {
          const ev = events.find((e) => e.id === i.outlookEventId);
          const d = getDate(i);
          const end = getEndDate?.(i);
          const inSync = ev && d && ev.date === d && (end === undefined || ev.endDate === end);
          const entKey = end !== undefined ? `${d}|${end}` : d;
          if (inSync && baseline[i.outlookEventId] !== entKey) {
            writeBaselineDate(projectId, entityType, i.outlookEventId, entKey!);
          }
        }
      }
      // Prune definitively-gone events in BOTH modes: clear the entity link + baseline.
      for (const d of plan.deletions) prune(d.id, d.eventId);
      if (background) {
        // Audit trail: a background auto-apply silently changes an entity's date —
        // let the caller log it (once per pull, not per item).
        if (plan.applies.length > 0) onBackgroundApply?.(plan.applies.length);
        if (plan.conflicts.length > 0) {
          const sig = plan.conflicts.map((c) => c.eventId).sort().join(",");
          if (sig !== lastConflictSigRef.current) {
            lastConflictSigRef.current = sig;
            showToast("info", t(lang, "calendarPullConflictsPending", plan.conflicts.length));
          }
        } else {
          lastConflictSigRef.current = null; // conflicts cleared → re-announce a future one
        }
        // background NEVER opens the modal; applies + deletions already acted on silently.
      } else {
        const hasRows = plan.applies.length + plan.conflicts.length + plan.deletions.length > 0;
        if (hasRows) setResult({ plan });
        else showToast("info", t(lang, "calendarPullInSync"));
      }
    } catch (e) {
      if (background) {
        // Can't confirm the conflict set on a failed background pull → reset the
        // dedupe ref so a persisting/new conflict re-announces on the next success.
        lastConflictSigRef.current = null;
        console.warn("calendar auto-pull failed", e);
      } else {
        showToast("error", t(lang, "calendarPushNoAccess"));
      }
    } finally {
      inFlightPull.delete(lockKey);
      if (!background) setBusy(false);
    }
  }, [isPopout, enabled, background, acquireToken, showToast, lang, items, projectId, entityType, getDate, getEndDate, isPullable, applyMove, prune, onBackgroundApply]);

  return { pull, busy, result, clearResult: useCallback(() => setResult(null), []), keepApp, applyMove };
}
