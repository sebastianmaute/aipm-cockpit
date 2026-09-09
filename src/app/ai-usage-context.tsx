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
  normalizeUsage,
  usageCostEquivalent,
  weekToDate,
  type Usage,
  type UsageBuckets,
} from "./ai-usage";
import { crossed80, crossed100 } from "./usage-warning";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import type { AiConfig } from "./settings-types";
import { DEFAULT_SESSION_TOKEN_CAP, DEFAULT_WEEKLY_TOKEN_CAP } from "./settings-types";

export const AI_USAGE_KEY = "aipm-cockpit:ai-usage";
/** ★ One-time, and keyed in localStorage rather than a ref: the point is to
 *  explain the change ACROSS the upgrade, so a per-session flag would re-fire
 *  it on every reload and a ref would lose it on remount. */
export const AI_CAP_BASIS_NOTICE_KEY = "aipm-cockpit:ai-cap-basis-notice";

export type AiUsageContextValue = {
  sessionTotal: number;
  sessionUsage: Usage;
  weekTotal: number;
  nextReset: Date;
  record: (u: Usage) => void;
};

const EMPTY_SESSION_USAGE: Usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };

const AiUsageContext = createContext<AiUsageContextValue>({
  sessionTotal: 0,
  sessionUsage: EMPTY_SESSION_USAGE,
  weekTotal: 0,
  nextReset: new Date(),
  record: () => {},
});

// ★ Named to surface its side effect at the call site (a lazy useState
//   initializer below) — despite the "load" shape this ALSO WRITES the
//   AI_CAP_BASIS_NOTICE_KEY seed on a genuinely fresh install (see the
//   raw === null branch). Kept as a synchronous write inside the lazy
//   initializer rather than moved to a mount effect: an effect only runs
//   AFTER the first commit, so it would open a window between mount and
//   effect-run where the flag is not yet seeded, changing the current
//   before-first-paint timing for no benefit — the write is idempotent, so
//   there is nothing to gain from deferring it.
function loadBucketsAndSeedCapBasisNotice(): UsageBuckets {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(AI_USAGE_KEY);
    // ★ raw === null means the key was NEVER written — a genuinely fresh
    //   install with no prior usage blob, as opposed to an empty-but-present
    //   one (raw === "" or "{}") or storage having thrown (caught below).
    //   Only THIS case never experienced the pre-cache-accounting cap basis,
    //   so seed the notice flag now: noteCapBasisOnce() must never explain a
    //   "before" that, for this user, never existed.
    if (raw === null) {
      window.localStorage.setItem(AI_CAP_BASIS_NOTICE_KEY, "1");
      return {};
    }
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    // ★★★ NORMALISE, NEVER CAST. A blob written before the cache-token widening
    //     has no cacheWrite/cacheRead, and `undefined + n` is NaN — which
    //     propagates into weekToDate and makes crossed80/crossed100
    //     (src/app/usage-warning.ts) permanently false, silently disabling the
    //     cap the user configured. Rebuild every bucket field by field.
    const out: UsageBuckets = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      out[k] = normalizeUsage(v as Partial<Usage> | undefined);
    }
    return out;
  } catch {
    return {};
  }
}

// ★ Guards a localStorage read+write with a synchronous try/catch so the
// flag is set BEFORE showToast is ever called — a second call in the same
// tick (session and weekly crossing together) sees the flag already "1" and
// stays silent, so the notice fires once GLOBALLY, not once per scope.
function noteCapBasisOnce(showToast: (kind: "info" | "error", text: string) => void, lang: Lang): void {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(AI_CAP_BASIS_NOTICE_KEY) === "1") return;
    window.localStorage.setItem(AI_CAP_BASIS_NOTICE_KEY, "1");
  } catch {
    return; // storage unavailable: skip the notice rather than repeating it
  }
  showToast("info", t(lang, "aiUsageCapBasisChanged"));
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
  const [buckets, setBuckets] = useState<UsageBuckets>(() => loadBucketsAndSeedCapBasisNotice());
  const [sessionTotal, setSessionTotal] = useState(0);
  const [sessionUsage, setSessionUsage] = useState<Usage>(EMPTY_SESSION_USAGE);

  // Refs that mirror the latest committed state values so the record callback
  // can read them synchronously without capturing stale closures. Kept in sync
  // immediately after every setState call (same event loop tick).
  const sessionTotalRef = useRef(0);
  const sessionUsageRef = useRef<Usage>(EMPTY_SESSION_USAGE);
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

  const record = useCallback(
    (u: Usage): void => {
      // ★★★ STORE RAW, WEIGHT AT READ. The buckets hold the API's own counts;
      // the per-field billing weights are applied here, at comparison time,
      // and never baked into what is persisted. The previous shape multiplied
      // every field by `tokenMultiplier` BEFORE writing, which is why that
      // re-basing was permanent — the multiplier in force at write time was
      // never recorded beside the numbers, so stored history could not be
      // re-interpreted. It still cannot, for buckets written before this
      // change; see the cost-basis notice.
      const normalized = normalizeUsage(u);
      const tokens = usageCostEquivalent(normalized);

      // Read previous values from refs — no state reads inside updaters.
      const prevSession = sessionTotalRef.current;
      const prevSessionUsage = sessionUsageRef.current;
      const prevBuckets = bucketsRef.current;
      const now = new Date();

      // Compute next values purely.
      const nextSession = prevSession + tokens;
      const nextSessionUsage: Usage = {
        input: prevSessionUsage.input + normalized.input,
        output: prevSessionUsage.output + normalized.output,
        cacheWrite: prevSessionUsage.cacheWrite + normalized.cacheWrite,
        cacheRead: prevSessionUsage.cacheRead + normalized.cacheRead,
      };
      const prevWeek = weekToDate(prevBuckets, now);
      const nextBuckets = addToBuckets(prevBuckets, now, normalized);
      const nextWeek = weekToDate(nextBuckets, now);

      // Advance refs before setState so back-to-back record() calls in the
      // same tick see the accumulated totals, not the stale committed state.
      sessionTotalRef.current = nextSession;
      sessionUsageRef.current = nextSessionUsage;
      bucketsRef.current = nextBuckets;

      // Pure state updates — no side effects inside the updater functions.
      setSessionTotal(nextSession);
      setSessionUsage(nextSessionUsage);
      setBuckets(nextBuckets);

      // Side effects outside the updaters: persist and warn.
      saveBuckets(nextBuckets);

      if (!warnedRef.current.session && crossed80(prevSession, nextSession, sessionCap)) {
        warnedRef.current.session = true;
        noteCapBasisOnce(showToast, lang);
        showToast("error", t(lang, "usage80Toast"));
      }
      if (!warnedRef.current.week && crossed80(prevWeek, nextWeek, weeklyCap)) {
        warnedRef.current.week = true;
        noteCapBasisOnce(showToast, lang);
        showToast("error", t(lang, "usage80Toast"));
      }
      // Crossing 100 % of a self-imposed cap: ADVISORY notice only — nothing is
      // blocked, the assistant keeps working.
      // ★ Also note the cap-basis explanation here, not just on the crossed80
      //   branches above: crossed80 is an EDGE detector, so a bucket already
      //   above 80 % when the provider mounted (e.g. the weekly total) can
      //   jump straight to a 100 % crossing without ever registering an 80 %
      //   "crossing" — noteCapBasisOnce()'s localStorage flag makes this
      //   call site idempotent with the two above, so this cannot double-fire.
      if (!warned100Ref.current.session && crossed100(prevSession, nextSession, sessionCap)) {
        warned100Ref.current.session = true;
        noteCapBasisOnce(showToast, lang);
        showToast("error", t(lang, "aiSelfLimitReached"));
      }
      if (!warned100Ref.current.week && crossed100(prevWeek, nextWeek, weeklyCap)) {
        warned100Ref.current.week = true;
        noteCapBasisOnce(showToast, lang);
        showToast("error", t(lang, "aiSelfLimitReached"));
      }
    },
    [lang, sessionCap, weeklyCap, showToast],
  );

  const now = new Date();
  const weekTotal = weekToDate(buckets, now);
  const nextReset = nextWeekReset(now);

  const value: AiUsageContextValue = { sessionTotal, sessionUsage, weekTotal, nextReset, record };

  return <AiUsageContext.Provider value={value}>{children}</AiUsageContext.Provider>;
}

/** Consumes the shared usage state. Must be used inside <AiUsageProvider>. */
export function useAiUsageContext(): AiUsageContextValue {
  return useContext(AiUsageContext);
}
