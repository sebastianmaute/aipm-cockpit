"use client";
// src/app/ai-usage-context.tsx
// Shared provider that owns sessionTotal + localStorage buckets so the chat
// panel (recorder) and the AI settings panel (reader) share one live source.

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  addToBuckets,
  nextWeekReset,
  weekToDate,
  type Usage,
  type UsageBuckets,
} from "./ai-usage";
import { crossed80, crossed100 } from "./usage-warning";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import type { AiConfig } from "./settings-types";
import { DEFAULT_SESSION_TOKEN_CAP, DEFAULT_WEEKLY_TOKEN_CAP, DEFAULT_TOKEN_MULTIPLIER } from "./settings-types";

export const AI_USAGE_KEY = "lop-app:ai-usage";

export type AiUsageContextValue = {
  sessionTotal: number;
  weekTotal: number;
  nextReset: Date;
  record: (u: Usage) => void;
};

const AiUsageContext = createContext<AiUsageContextValue>({
  sessionTotal: 0,
  weekTotal: 0,
  nextReset: new Date(),
  record: () => {},
});

function loadBuckets(): UsageBuckets {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(AI_USAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as UsageBuckets;
  } catch {
    return {};
  }
}

function saveBuckets(buckets: UsageBuckets): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AI_USAGE_KEY, JSON.stringify(buckets));
  } catch {
    // non-fatal: storage quota or private browsing
  }
}

type AiUsageProviderProps = {
  lang: Lang;
  ai: AiConfig;
  showToast: (kind: "info" | "error", text: string) => void;
  children: ReactNode;
};

export function AiUsageProvider({ lang, ai, showToast, children }: AiUsageProviderProps) {
  const [buckets, setBuckets] = useState<UsageBuckets>(() => loadBuckets());
  const [sessionTotal, setSessionTotal] = useState(0);

  // Refs that mirror the latest committed state values so the record callback
  // can read them synchronously without capturing stale closures. Kept in sync
  // immediately after every setState call (same event loop tick).
  const sessionTotalRef = useRef(0);
  const bucketsRef = useRef<UsageBuckets>(buckets);

  // Per-scope "already warned this session" flags — booleans in a ref so they
  // never trigger re-renders and are never reset within the provider lifetime
  // (session resets on page reload; week flag is accurate enough as a simple bool).
  const warnedRef = useRef({ session: false, week: false });
  // Separate per-scope flags for the 100 % (own-cap-reached) notice, so it fires
  // once independently of the 80 % warning.
  const warned100Ref = useRef({ session: false, week: false });

  const sessionCap = ai.sessionTokenCap ?? DEFAULT_SESSION_TOKEN_CAP;
  const weeklyCap = ai.weeklyTokenCap ?? DEFAULT_WEEKLY_TOKEN_CAP;
  const multiplier = ai.tokenMultiplier ?? DEFAULT_TOKEN_MULTIPLIER;

  const record = useCallback(
    (u: Usage): void => {
      // Apply the counting multiplier ONCE, up front, so BOTH the session
      // total and the weekly buckets count in the same (multiplied) units —
      // otherwise the two caps would be compared against different scales.
      const scaled: Usage = { input: u.input * multiplier, output: u.output * multiplier };
      const tokens = scaled.input + scaled.output;

      // Read previous values from refs — no state reads inside updaters.
      const prevSession = sessionTotalRef.current;
      const prevBuckets = bucketsRef.current;
      const now = new Date();

      // Compute next values purely.
      const nextSession = prevSession + tokens;
      const prevWeek = weekToDate(prevBuckets, now);
      const nextBuckets = addToBuckets(prevBuckets, now, scaled);
      const nextWeek = weekToDate(nextBuckets, now);

      // Advance refs before setState so back-to-back record() calls in the
      // same tick see the accumulated totals, not the stale committed state.
      sessionTotalRef.current = nextSession;
      bucketsRef.current = nextBuckets;

      // Pure state updates — no side effects inside the updater functions.
      setSessionTotal(nextSession);
      setBuckets(nextBuckets);

      // Side effects outside the updaters: persist and warn.
      saveBuckets(nextBuckets);

      if (!warnedRef.current.session && crossed80(prevSession, nextSession, sessionCap)) {
        warnedRef.current.session = true;
        showToast("error", t(lang, "usage80Toast"));
      }
      if (!warnedRef.current.week && crossed80(prevWeek, nextWeek, weeklyCap)) {
        warnedRef.current.week = true;
        showToast("error", t(lang, "usage80Toast"));
      }
      // Crossing 100 % of a self-imposed cap: ADVISORY notice only — nothing is
      // blocked, the assistant keeps working.
      if (!warned100Ref.current.session && crossed100(prevSession, nextSession, sessionCap)) {
        warned100Ref.current.session = true;
        showToast("error", t(lang, "aiSelfLimitReached"));
      }
      if (!warned100Ref.current.week && crossed100(prevWeek, nextWeek, weeklyCap)) {
        warned100Ref.current.week = true;
        showToast("error", t(lang, "aiSelfLimitReached"));
      }
    },
    [lang, sessionCap, weeklyCap, multiplier, showToast],
  );

  const now = new Date();
  const weekTotal = weekToDate(buckets, now);
  const nextReset = nextWeekReset(now);

  const value: AiUsageContextValue = { sessionTotal, weekTotal, nextReset, record };

  return <AiUsageContext.Provider value={value}>{children}</AiUsageContext.Provider>;
}

/** Consumes the shared usage state. Must be used inside <AiUsageProvider>. */
export function useAiUsageContext(): AiUsageContextValue {
  return useContext(AiUsageContext);
}
