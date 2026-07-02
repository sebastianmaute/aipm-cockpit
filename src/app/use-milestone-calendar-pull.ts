"use client";
import { useCallback, useState } from "react";
import { useMsAuth } from "./use-ms-auth";
import { useToastContext } from "./toast-context";
import { t, type Lang } from "./i18n";
import { CALENDAR_READWRITE_SCOPE, updateEvent, milestoneToGraphEvent } from "./outlook-calendar-write";
import { fetchProjectEventDates } from "./outlook-calendar-read";
import { planCalendarPull, type PullPlan } from "./calendar-pull";
import { loadBaseline, writeBaselineDate, removeBaselineEntry } from "./calendar-sync-baseline";
import type { Milestone } from "./types";

interface Args {
  milestones: readonly Milestone[];
  projectId: string;
  setMilestones: (updater: (prev: Milestone[]) => Milestone[]) => void;
  isPopout: boolean;
  lang: Lang;
  enabled: boolean;
}

// Own module-level in-flight lock keyed `${projectId}:milestone` — milestone keys
// never collide with the generic entities' set, so a separate one is fine.
const inFlightPull = new Set<string>();

export function useMilestoneCalendarPull({ milestones, projectId, setMilestones, isPopout, lang, enabled }: Args) {
  const { acquireToken } = useMsAuth(enabled);
  const showToast = useToastContext();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ plan: PullPlan } | null>(null);

  const applyMove = useCallback((id: number, eventId: string, newDate: string) => {
    setMilestones((prev) => prev.map((m) => (m.id === id ? { ...m, date: newDate } : m)));
    writeBaselineDate(projectId, "milestone", eventId, newDate);
  }, [setMilestones, projectId]);

  const keepApp = useCallback(async (c: { id: number; eventId: string; appDate: string }) => {
    // App-wins: converge Outlook to the milestone's (kept) date so baseline===appDate
    // becomes GENUINELY true. Just refreshing the baseline would make the next pull
    // see baseline===date and silently auto-apply the Outlook date the user rejected.
    const m = milestones.find((x) => x.id === c.id);
    if (!m) return;
    const token = await acquireToken(CALENDAR_READWRITE_SCOPE, { interactive: true }).catch(() => null);
    if (!token) { showToast("error", t(lang, "calendarPushNoAccess")); return; }
    try {
      await updateEvent(token, c.eventId, milestoneToGraphEvent(m, projectId));
      writeBaselineDate(projectId, "milestone", c.eventId, c.appDate);
      showToast("info", t(lang, "calendarPushResult", 0, 1, 0));
    } catch {
      // Do NOT write baseline on failure — leave it non-matching so it re-conflicts
      // next pull (never falsely "in sync").
      showToast("error", t(lang, "calendarPushPartial", 1));
    }
  }, [milestones, acquireToken, showToast, lang, projectId]);

  const pull = useCallback(async () => {
    if (isPopout || !enabled) return;
    const lockKey = `${projectId}:milestone`;
    if (inFlightPull.has(lockKey)) return; // another milestone pull is already running
    inFlightPull.add(lockKey);
    setBusy(true);
    try {
      const token = await acquireToken(CALENDAR_READWRITE_SCOPE, { interactive: true }).catch(() => null);
      if (!token) { showToast("error", t(lang, "calendarPushNoAccess")); return; }
      const { events, truncated } = await fetchProjectEventDates(token, projectId);
      const baseline = loadBaseline(projectId, "milestone");
      const plan = planCalendarPull({
        entities: milestones.map((m) => ({ id: m.id, date: m.date, outlookEventId: m.outlookEventId })),
        events,
        baseline,
        eventsComplete: !truncated,
      });
      // auto-apply non-conflicting moves
      for (const a of plan.applies) applyMove(a.id, a.eventId, a.newDate);
      // self-heal baseline for events already in sync but missing a baseline
      for (const m of milestones) {
        if (m.outlookEventId) {
          const ev = events.find((e) => e.id === m.outlookEventId);
          if (ev && ev.date === m.date && baseline[m.outlookEventId] !== m.date) {
            writeBaselineDate(projectId, "milestone", m.outlookEventId, m.date);
          }
        }
      }
      // Prune the stale link for events that are definitively gone in Outlook, so
      // they stop re-appearing in the "removed" list every pull (deletions are
      // definitive — missing/cancelled — since the engine skips transient reads).
      for (const d of plan.deletions) {
        setMilestones((prev) => prev.map((m) => (m.id === d.id ? { ...m, outlookEventId: undefined } : m)));
        removeBaselineEntry(projectId, "milestone", d.eventId);
      }
      const hasRows = plan.applies.length + plan.conflicts.length + plan.deletions.length > 0;
      if (hasRows) setResult({ plan });
      else showToast("info", t(lang, "calendarPullInSync"));
    } catch {
      showToast("error", t(lang, "calendarPushNoAccess"));
    } finally {
      inFlightPull.delete(lockKey);
      setBusy(false);
    }
  }, [isPopout, enabled, acquireToken, showToast, lang, milestones, projectId, applyMove, setMilestones]);

  return { pull, busy, result, clearResult: useCallback(() => setResult(null), []), keepApp, applyMove };
}
