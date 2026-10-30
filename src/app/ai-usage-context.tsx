"use client";
// src/app/ai-usage-context.tsx
// Shared provider that owns sessionTotal + the per-path localStorage buckets. It is the ONE
// recorder (it hears the transport's usage tap) and the AI settings panel reads it.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  nextWeekReset,
  normalizeUsage,
  usageCostEquivalent,
  weekToDate,
  type Usage,
} from "./ai-usage";
import { subscribeAiUsage } from "./ai-transport";
import { parseAiPathId, type AiFeature } from "./ai-usage-paths";
import {
  AI_USAGE_BY_PATH_KEY,
  AI_USAGE_KEY,
  readPathBuckets,
  recordPathUsage,
  totalsByDay,
  weekByPath,
  type PathBuckets,
} from "./ai-usage-store";
import {
  addViewSwitchSend,
  EMPTY_VIEW_SWITCH_STATS,
  classifySend,
  normalizeViewSwitchBuckets,
  pruneLastSends,
  weekViewSwitchStats,
  type SendFingerprint,
  type ViewSwitchBuckets,
  type ViewSwitchStats,
} from "./ai-view-switch";
import { crossed80, crossed100 } from "./usage-warning";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import type { AiConfig } from "./settings-types";
import { DEFAULT_SESSION_TOKEN_CAP, DEFAULT_WEEKLY_TOKEN_CAP } from "./settings-types";

/** §702's view-switch counter (`ai-view-switch.ts`). ★ A KEY OF ITS OWN, not
 *  extra fields on the token buckets: every cap reader walks those buckets, and
 *  a counter there could only ever reach the cap arithmetic by mistake. */
export const AI_VIEW_SWITCH_KEY = "aipm-cockpit:ai-view-switches";
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
  /** This week's cost-equivalent tokens per feature, largest first, features with none left out. */
  weekByFeature: ReadonlyArray<{ feature: AiFeature; usage: Usage; cost: number }>;
  /** The part of `weekTotal` spent by background (unattended) calls. */
  backgroundWeekCost: number;
  /** This week's chat sends and warm view switches (§702). */
  viewSwitchWeek: ViewSwitchStats;
  /** Records one finished chat send: classifies it against the previous send
   *  in its thread and adds its cache writes to the matching side. */
  recordChatSend: (fp: SendFingerprint, cacheWrite: number, requests: number) => void;
  /** A send stopped or failed AFTER a response: it is not billed or counted,
   *  but its prefix reached the cache, so it becomes the thread's baseline. */
  noteUnbilledChatSend: (fp: SendFingerprint) => void;
};

const EMPTY_SESSION_USAGE: Usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };

const AiUsageContext = createContext<AiUsageContextValue>({
  sessionTotal: 0,
  sessionUsage: EMPTY_SESSION_USAGE,
  weekTotal: 0,
  nextReset: new Date(),
  weekByFeature: [],
  backgroundWeekCost: 0,
  viewSwitchWeek: EMPTY_VIEW_SWITCH_STATS,
  recordChatSend: () => {},
  noteUnbilledChatSend: () => {},
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
function loadBucketsAndSeedBasisNotices(): PathBuckets {
  if (typeof window === "undefined") return {};
  try {
    const storage = window.localStorage;
    // ★ Both keys null means the usage store was NEVER written — a genuinely
    //   fresh install with no prior blob, as opposed to an empty-but-present
    //   one (`{}`) or storage having thrown (caught below). Only THIS case never
    //   experienced either superseded cap basis — neither the pre-cache-accounting
    //   one nor the pre-cost-weighting one — so seed both flags now: the panel's
    //   migration line must never explain a "before" that, for this user, never
    //   existed. The pre-path key counts as "written" so an upgrading device is
    //   not mistaken for a fresh one.
    if (storage.getItem(AI_USAGE_KEY) === null && storage.getItem(AI_USAGE_BY_PATH_KEY) === null) {
      storage.setItem(AI_CAP_BASIS_NOTICE_KEY, "1");
      storage.setItem(AI_COST_BASIS_NOTICE_KEY, "1");
      return {};
    }
    // The store normalises field by field, so a blob written before the cache-token widening
    // cannot put NaN into the cap arithmetic.
    return readPathBuckets(storage);
  } catch {
    return {};
  }
}

/** localStorage, or an in-memory stand-in when the accessor throws (SSR is handled by the caller). */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => Array.from(m.keys())[i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, v); },
  };
}

function usageStorage(fallback: Storage): Storage {
  try {
    return window.localStorage;
  } catch {
    return fallback;
  }
}

type FeatureRow = { feature: AiFeature; usage: Usage; cost: number };

/** This week per feature (largest first, zero-cost rows left out) and the background share. */
function summariseWeek(b: PathBuckets, now: Date): { rows: FeatureRow[]; background: number } {
  const byFeature = new Map<AiFeature, Usage>();
  let background = 0;
  for (const [path, u] of Object.entries(weekByPath(b, now))) {
    const { feature, level } = parseAiPathId(path);
    const prev = byFeature.get(feature) ?? normalizeUsage(undefined);
    byFeature.set(feature, {
      input: prev.input + u.input,
      output: prev.output + u.output,
      cacheWrite: prev.cacheWrite + u.cacheWrite,
      cacheRead: prev.cacheRead + u.cacheRead,
    });
    if (level === "background") background += usageCostEquivalent(u);
  }
  const rows = [...byFeature].map(([feature, usage]) => ({ feature, usage, cost: usageCostEquivalent(usage) }))
    .filter((r) => r.cost > 0)
    .sort((x, y) => y.cost - x.cost);
  return { rows, background };
}

function loadViewSwitchBuckets(): ViewSwitchBuckets {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(AI_VIEW_SWITCH_KEY);
    return raw ? normalizeViewSwitchBuckets(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function saveViewSwitchBuckets(buckets: ViewSwitchBuckets): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AI_VIEW_SWITCH_KEY, JSON.stringify(buckets));
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
  const [pathBuckets, setPathBuckets] = useState<PathBuckets>(() => loadBucketsAndSeedBasisNotices());
  const [sessionTotal, setSessionTotal] = useState(0);
  const [sessionUsage, setSessionUsage] = useState<Usage>(EMPTY_SESSION_USAGE);

  // Refs that mirror the session values so the tap listener can read them
  // synchronously without capturing stale closures. Session is per tab: only this
  // tab's taps move it, never a storage event.
  const sessionTotalRef = useRef(0);
  const sessionUsageRef = useRef<Usage>(EMPTY_SESSION_USAGE);
  const fallbackStorageRef = useRef<Storage | null>(null);

  // Per-scope "already warned this session" flags — booleans in a ref so they
  // never trigger re-renders and are never reset within the provider lifetime
  // (session resets on page reload; week flag is accurate enough as a simple bool).
  const warnedRef = useRef({ session: false, week: false });
  // Separate per-scope flags for the 100 % (own-cap-reached) notice, so it fires
  // once independently of the 80 % warning.
  const warned100Ref = useRef({ session: false, week: false });

  const sessionCap = ai.sessionTokenCap ?? DEFAULT_SESSION_TOKEN_CAP;
  const weeklyCap = ai.weeklyTokenCap ?? DEFAULT_WEEKLY_TOKEN_CAP;

  // ★★★ THE TRANSPORT'S TAP IS THE ONLY RECORDER. Every Messages response of every path (chat,
  // inline edit, forced calls, background jobs) reaches here, so nothing else records usage.
  // ★★★ PERSIST ONLY THROUGH `recordPathUsage`, which re-reads storage before it adds: a copy
  // of the buckets held in state is never written back, or this tab would erase what another
  // tab recorded since it last looked. State is set FROM the returned value.
  // ★★★ STORE RAW, WEIGHT AT READ. The buckets hold the API's own counts; the per-field
  // billing weights are applied at comparison time, never baked into what is persisted.
  useEffect(() => {
    return subscribeAiUsage((path, apiUsage) => {
      fallbackStorageRef.current ??= memoryStorage();
      const storage = usageStorage(fallbackStorageRef.current);
      const normalized = normalizeUsage({
        input: apiUsage.input_tokens,
        output: apiUsage.output_tokens,
        cacheWrite: apiUsage.cache_creation_input_tokens,
        cacheRead: apiUsage.cache_read_input_tokens,
      });
      const tokens = usageCostEquivalent(normalized);
      const now = new Date();

      const prevSession = sessionTotalRef.current;
      const prevSessionUsage = sessionUsageRef.current;
      const prevWeek = weekToDate(totalsByDay(readPathBuckets(storage)), now);
      const nextBuckets = recordPathUsage(storage, now, path, normalized);
      const nextWeek = weekToDate(totalsByDay(nextBuckets), now);
      const nextSession = prevSession + tokens;
      const nextSessionUsage: Usage = {
        input: prevSessionUsage.input + normalized.input,
        output: prevSessionUsage.output + normalized.output,
        cacheWrite: prevSessionUsage.cacheWrite + normalized.cacheWrite,
        cacheRead: prevSessionUsage.cacheRead + normalized.cacheRead,
      };

      // Advance refs before setState so back-to-back taps in the same tick see
      // the accumulated totals, not the stale committed state.
      sessionTotalRef.current = nextSession;
      sessionUsageRef.current = nextSessionUsage;
      setSessionTotal(nextSession);
      setSessionUsage(nextSessionUsage);
      setPathBuckets(nextBuckets);

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
    });
  }, [lang, sessionCap, weeklyCap, showToast]);

  // Another tab's recording: re-read the shared store. Week figures only; the session is this tab's.
  useEffect(() => {
    const onStorage = (e: StorageEvent): void => {
      if (e.key !== null && e.key !== AI_USAGE_BY_PATH_KEY) return;
      setPathBuckets(readPathBuckets(usageStorage(fallbackStorageRef.current ?? memoryStorage())));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const [viewSwitchBuckets, setViewSwitchBuckets] = useState<ViewSwitchBuckets>(loadViewSwitchBuckets);
  const viewSwitchBucketsRef = useRef<ViewSwitchBuckets>(viewSwitchBuckets);
  // ★ The previous send PER THREAD, since each thread has its own cached
  //   prefix. Per provider lifetime, so the first send after a reload is cold:
  //   the cache may well be warm, but nothing says what it holds.
  const lastSendsRef = useRef<ReadonlyMap<string, SendFingerprint>>(new Map());
  const rememberSend = useCallback((fp: SendFingerprint): void => {
    lastSendsRef.current = pruneLastSends(lastSendsRef.current, fp);
  }, []);

  const recordChatSend = useCallback(
    (fp: SendFingerprint, cacheWrite: number, requests: number): void => {
      // ★ A send none of whose requests went out never reached the cache:
      //   neither count it nor let it become the thread's baseline.
      if (!(requests > 0)) return;
      const kind = classifySend(lastSendsRef.current.get(fp.threadKey), fp);
      rememberSend(fp);
      const next = addViewSwitchSend(viewSwitchBucketsRef.current, new Date(), kind, cacheWrite, requests);
      viewSwitchBucketsRef.current = next;
      setViewSwitchBuckets(next);
      saveViewSwitchBuckets(next);
    },
    [rememberSend],
  );

  const now = new Date();
  const weekTotal = weekToDate(totalsByDay(pathBuckets), now);
  const { rows: weekByFeature, background: backgroundWeekCost } = summariseWeek(pathBuckets, now);
  const nextReset = nextWeekReset(now);
  const viewSwitchWeek = weekViewSwitchStats(viewSwitchBuckets, now);

  const value: AiUsageContextValue = {
    sessionTotal,
    sessionUsage,
    weekTotal,
    nextReset,
    weekByFeature,
    backgroundWeekCost,
    viewSwitchWeek,
    recordChatSend,
    noteUnbilledChatSend: rememberSend,
  };

  return <AiUsageContext.Provider value={value}>{children}</AiUsageContext.Provider>;
}

/** Consumes the shared usage state. Must be used inside <AiUsageProvider>. */
export function useAiUsageContext(): AiUsageContextValue {
  return useContext(AiUsageContext);
}
