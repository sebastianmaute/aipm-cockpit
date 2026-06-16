"use client";

import { useEffect, useRef } from "react";
import { t, type Lang } from "./i18n";
import type { AppView } from "./nav-config";
import type { SuggestedAction } from "./next-actions/types";
import { buildNotificationPlan, newUrgentActions, nextSeenIds } from "./action-notifications";

const SEEN_KEY = "lop-app:notified-urgent";
const SUMMARY_TAG = "urgent-summary";

interface UseActionNotificationsArgs {
  actions: readonly SuggestedAction[];
  enabled: boolean;
  isPopout: boolean;
  lang: Lang;
  requestOpen: (view: AppView, id: number) => void;
  openActionCenter: () => void;
}

function readSeen(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeSeen(ids: readonly string[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids));
  } catch {
    /* storage full / unavailable — dedup degrades to per-session, non-fatal */
  }
}

/**
 * Side-effecting hook: raises a desktop Notification when a new urgent ("now")
 * action appears while the tab is backgrounded. Gated on enabled + granted
 * permission + non-popout. Never fires while the document is focused. The first
 * gated cycle seeds the seen set silently (no popup-storm on enable).
 */
export function useActionNotifications({
  actions,
  enabled,
  isPopout,
  lang,
  requestOpen,
  openActionCenter,
}: UseActionNotificationsArgs): void {
  const seenRef = useRef<string[] | null>(null);
  const seededRef = useRef(false);
  const cbRef = useRef({ lang, requestOpen, openActionCenter });

  useEffect(() => {
    cbRef.current = { lang, requestOpen, openActionCenter };
  });

  useEffect(() => {
    if (seenRef.current === null) seenRef.current = readSeen();

    const granted =
      typeof Notification !== "undefined" && Notification.permission === "granted";
    if (!enabled || isPopout || !granted) {
      if (!enabled) seededRef.current = false; // re-enable must re-seed silently (no storm)
      return;
    }

    if (!seededRef.current) {
      seededRef.current = true;
      seenRef.current = nextSeenIds(actions);
      writeSeen(seenRef.current);
      return;
    }

    const focused = typeof document !== "undefined" && document.hasFocus();
    if (!focused) {
      const plan = buildNotificationPlan(newUrgentActions(actions, seenRef.current));
      if (plan) {
        const { lang: l, requestOpen: open, openActionCenter: center } = cbRef.current;
        try {
          if (plan.kind === "single") {
            const a = plan.action;
            const n = new Notification(t(l, a.title.key, ...(a.title.params ?? [])), {
              body: t(l, a.why.key, ...(a.why.params ?? [])),
              tag: a.id,
            });
            n.onclick = () => {
              window.focus();
              if (a.cta.kind === "open") open(a.cta.view, Number(a.cta.id));
              n.close();
            };
          } else {
            const n = new Notification(t(l, "notifySummaryTitle", plan.count), {
              body: t(l, "notifySummaryBody"),
              tag: SUMMARY_TAG,
            });
            n.onclick = () => {
              window.focus();
              center();
              n.close();
            };
          }
        } catch {
          /* some environments throw on construct even when granted — non-fatal */
        }
      }
    }

    seenRef.current = nextSeenIds(actions);
    writeSeen(seenRef.current);
  }, [actions, enabled, isPopout]);
}
