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
/** ★★ SUPERSEDES `AI_CAP_BASIS_NOTICE_KEY`. Whoever sets this one also sets
 *  that one, so a user who never saw the cap-basis notice is shown ONE message
 *  covering both changes rather than two.
 *  ★★★ ITS VALUE IS NOT A BOOLEAN. `AiUsagePanel` writes the ISO timestamp of
 *  the first observation and keeps the notice up until that week resets,
 *  because the notice's own text promises exactly that ("still on the old
 *  scale until the week resets") and a one-shot flag made the sentence false
 *  for anyone who read it on day 1. The literal `"1"` remains a valid value
 *  meaning "already seen, never show" — the seeding below still writes it for
 *  a fresh install, and every pre-0.297 device carries it. Read the shape off
 *  `costBasisNoticeDue` in `settings-sections/ai-usage-panel.tsx`, which owns
 *  it; do NOT treat this key as a flag anywhere new.
 *  ★★★ THE NOTICE ITSELF LIVES IN `AiUsagePanel`, not here. It was a toast on
 *  the four crossing branches below and was NEVER PAINTED: `useToast` holds a
 *  single `Toast | null` slot with no queue, and each branch called it in the
 *  same tick as its own cap warning, so React batched the pair and only the
 *  warning survived to render — while the flag had already been written, so it
 *  could never fire again. The crossing edges could not reach the intended
 *  audience either: `crossed80`/`crossed100` both require `prevUsed <
 *  threshold`, so a device already at or above its cap at mount never crossed
 *  anything. A panel line beside the numbers depends on no edge at all. */
export const AI_COST_BASIS_NOTICE_KEY = "aipm-cockpit:ai-cost-basis-notice";

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
//   initializer below) — despite the "load" shape this ALSO WRITES BOTH
//   basis-notice seeds on a genuinely fresh install (see the
//   raw === null branch). Kept as a synchronous write inside the lazy
//   initializer rather than moved to a mount effect: an effect only runs
//   AFTER the first commit, so it would open a window between mount and
//   effect-run where the flag is not yet seeded, changing the current
//   before-first-paint timing for no benefit — the write is idempotent, so
//   there is nothing to gain from deferring it.
function loadBucketsAndSeedBasisNotices(): UsageBuckets {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(AI_USAGE_KEY);
    // ★ raw === null means the key was NEVER written — a genuinely fresh
    //   install with no prior usage blob, as opposed to an empty-but-present
    //   one (raw === "" or "{}") or storage having thrown (caught below).
    //   Only THIS case never experienced either superseded cap basis — neither
    //   the pre-cache-accounting one nor the pre-cost-weighting one — so seed
    //   both flags now: the panel's migration line must never explain a
    //   "before" that, for this user, never existed.
    if (raw === null) {
      window.localStorage.setItem(AI_CAP_BASIS_NOTICE_KEY, "1");
      window.localStorage.setItem(AI_COST_BASIS_NOTICE_KEY, "1");
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
  const [buckets, setBuckets] = useState<UsageBuckets>(() => loadBucketsAndSeedBasisNotices());
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

      // ★ EXACTLY ONE showToast per crossing. `useToast` holds a single
      //   `Toast | null` slot with no queue, so two calls in one tick leave
      //   only the second painted — see AI_COST_BASIS_NOTICE_KEY above for the
      //   notice that was lost to precisely that and now renders in the panel.
      if (!warnedRef.current.session && crossed80(prevSession, nextSession, sessionCap)) {
        warnedRef.current.session = true;
        showToast("error", t(lang, "usage80Toast"));
      }
      if (!warnedRef.current.week && crossed80(prevWeek, nextWeek, weeklyCap)) {
        warnedRef.current.week = true;
        showToast("error", t(lang, "usage80Toast"));
      }
      // Crossing 100 % of a self-imposed cap: ADVISORY notice only — nothing is
      // blocked, the assistant keeps working. It is a separate pair of flags
      // from the 80 % ones because a bucket already above 80 % when the
      // provider mounted never crosses that edge again and would otherwise be
      // told nothing at all.
      if (!warned100Ref.current.session && crossed100(prevSession, nextSession, sessionCap)) {
        warned100Ref.current.session = true;
        showToast("error", t(lang, "aiSelfLimitReached"));
      }
      if (!warned100Ref.current.week && crossed100(prevWeek, nextWeek, weeklyCap)) {
        warned100Ref.current.week = true;
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
