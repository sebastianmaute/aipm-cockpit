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
import { AI_USAGE_KEY } from "./use-ai-usage";
import { crossed80 } from "./usage-warning";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import type { AiConfig } from "./settings-types";
import { DEFAULT_SESSION_TOKEN_CAP, DEFAULT_WEEKLY_TOKEN_CAP } from "./settings-types";

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

  // Per-scope "already warned this session" flags — booleans in a ref so they
  // never trigger re-renders and are never reset within the provider lifetime
  // (session resets on page reload; week flag is accurate enough as a simple bool).
  const warnedRef = useRef({ session: false, week: false });

  const sessionCap = ai.sessionTokenCap ?? DEFAULT_SESSION_TOKEN_CAP;
  const weeklyCap = ai.weeklyTokenCap ?? DEFAULT_WEEKLY_TOKEN_CAP;

  const record = useCallback(
    (u: Usage): void => {
      const tokens = u.input + u.output;

      setSessionTotal((prevSession) => {
        const nextSession = prevSession + tokens;
        if (!warnedRef.current.session && crossed80(prevSession, nextSession, sessionCap)) {
          warnedRef.current.session = true;
          showToast("error", t(lang, "usage80Toast"));
        }
        return nextSession;
      });

      setBuckets((prevBuckets) => {
        const now = new Date();
        const prevWeek = weekToDate(prevBuckets, now);
        const updated = addToBuckets(prevBuckets, now, u);
        const nextWeek = weekToDate(updated, now);
        if (!warnedRef.current.week && crossed80(prevWeek, nextWeek, weeklyCap)) {
          warnedRef.current.week = true;
          showToast("error", t(lang, "usage80Toast"));
        }
        saveBuckets(updated);
        return updated;
      });
    },
    [lang, sessionCap, weeklyCap, showToast],
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
