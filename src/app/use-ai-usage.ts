// src/app/use-ai-usage.ts
"use client";

import { useCallback, useState } from "react";
import {
  addToBuckets,
  nextWeekReset,
  weekToDate,
  type Usage,
  type UsageBuckets,
} from "./ai-usage";

export const AI_USAGE_KEY = "lop-app:ai-usage";

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

export type AiUsageHandle = {
  sessionTotal: number;
  weekTotal: number;
  nextReset: Date;
  record: (u: Usage) => void;
};

export function useAiUsage(): AiUsageHandle {
  // Lazy initializer reads localStorage once on mount — same pattern as
  // use-workspace-collapsed.ts. No effect needed; avoids setState-in-effect lint error.
  const [buckets, setBuckets] = useState<UsageBuckets>(() => loadBuckets());
  const [sessionTotal, setSessionTotal] = useState(0);

  const record = useCallback((u: Usage): void => {
    setSessionTotal((prev) => prev + u.input + u.output);
    setBuckets((prev) => {
      const updated = addToBuckets(prev, new Date(), u);
      saveBuckets(updated);
      return updated;
    });
  }, []);

  const now = new Date();
  const weekTotal = weekToDate(buckets, now);
  const nextReset = nextWeekReset(now);

  return { sessionTotal, weekTotal, nextReset, record };
}
