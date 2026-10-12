// src/app/ai-view-switch.ts
// §702: counts chat sends whose view-scoped guide block changed while the
// prompt cache was still warm, so the saving slice G2 would buy can be
// measured instead of modelled. Pure and i18n-free; `AiUsageProvider` owns the
// storage and `AiUsagePanel` renders the week.
//
// ★★ WHY THIS IS THE EVENT TO COUNT. `buildStableSystemBlocks` sends the
//    always-on guides as `system` block 0 and the current view's guides as
//    block 1. Anthropic matches the cache prefix tools → system → messages, so
//    a send whose block 1 differs from the thread's previous send re-bills the
//    whole transcript as a cache write. G2 would move block 1 onto the turn
//    and make that write disappear — but only when:
//    - block 0 is unchanged (if it changed, the cache is rewritten anyway);
//    - the previous send is in the SAME thread (another thread has its own
//      prefix);
//    - the cache is still warm (after the TTL the write happens anyway);
//    - the send continues a conversation (a first message has no transcript
//      to rewrite, and file mode keeps ONE thread id across "New chat").
//    A send failing any of those would cost the same under G2, so counting it
//    would overstate the saving.

import { isoDate, mondayOf } from "./ai-usage";

/** Anthropic's default `ephemeral` cache lifetime. The real lifetime is
 *  refreshed on every read, so measuring from the previous send's finish is
 *  the conservative reading. */
export const VIEW_SWITCH_CACHE_TTL_MS = 5 * 60 * 1000;

/** The MODELLED break-even this counter exists to check: G2 pays
 *  `0.9 × view-guide` on every send and saves a transcript rewrite on every
 *  warm switch, which evens out at about one switch per this many sends.
 *  Source: docs/superpowers/specs/2026-09-08-ai-guide-block-cache-split-design.md
 *  ("Break-even"). */
export const G2_BREAK_EVEN_SENDS_PER_SWITCH = 46;

/** What one chat send put in front of the transcript, and when it finished. */
export type SendFingerprint = {
  /** Project and thread, so a send in another thread never counts. */
  threadKey: string;
  /** `system` block 0's text. */
  stableText: string;
  /** Every later `system` block's text joined; `""` when the view has none. */
  viewText: string;
  /** Epoch ms when the send finished. */
  at: number;
  /** Messages in the thread before this send's user message. */
  priorTurns: number;
};

export function isWarmViewSwitch(
  prev: SendFingerprint | null,
  next: SendFingerprint,
  ttlMs: number = VIEW_SWITCH_CACHE_TTL_MS,
): boolean {
  if (prev === null) return false;
  if (next.priorTurns <= 0) return false;
  if (prev.threadKey !== next.threadKey) return false;
  if (next.at - prev.at >= ttlMs) return false;
  if (prev.stableText !== next.stableText) return false;
  return prev.viewText !== next.viewText;
}

/** ★ Cache writes are split by whether the send was a switch: a switch
 *  send's write also includes the ordinary write for the new turn, so only
 *  the difference between the two averages is what G2 would save. */
export type ViewSwitchStats = {
  sends: number;
  switches: number;
  switchCacheWrite: number;
  otherCacheWrite: number;
};
export type ViewSwitchBuckets = Record<string, ViewSwitchStats>; // key: YYYY-MM-DD (local)

const EMPTY_STATS: ViewSwitchStats = { sends: 0, switches: 0, switchCacheWrite: 0, otherCacheWrite: 0 };

const finite = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function normalizeStats(v: unknown): ViewSwitchStats {
  const o = (v && typeof v === "object" ? v : {}) as Partial<Record<keyof ViewSwitchStats, unknown>>;
  return {
    sends: finite(o.sends),
    switches: finite(o.switches),
    switchCacheWrite: finite(o.switchCacheWrite),
    otherCacheWrite: finite(o.otherCacheWrite),
  };
}

/** ★★ NORMALISE, NEVER CAST — the same rule as the token buckets: a field
 *  missing from storage would otherwise turn every later sum into NaN. */
export function normalizeViewSwitchBuckets(raw: unknown): ViewSwitchBuckets {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ViewSwitchBuckets = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) out[k] = normalizeStats(v);
  return out;
}

export function addViewSwitchSend(
  b: ViewSwitchBuckets,
  when: Date,
  isSwitch: boolean,
  cacheWrite: number,
): ViewSwitchBuckets {
  const k = isoDate(when);
  const prev = normalizeStats(b[k] ?? EMPTY_STATS);
  const w = finite(cacheWrite);
  return {
    ...b,
    [k]: {
      sends: prev.sends + 1,
      switches: prev.switches + (isSwitch ? 1 : 0),
      switchCacheWrite: prev.switchCacheWrite + (isSwitch ? w : 0),
      otherCacheWrite: prev.otherCacheWrite + (isSwitch ? 0 : w),
    },
  };
}

export function weekViewSwitchStats(b: ViewSwitchBuckets, now: Date): ViewSwitchStats {
  const start = mondayOf(now);
  const total = { ...EMPTY_STATS };
  for (const [k, v] of Object.entries(b)) {
    const d = new Date(`${k}T00:00:00`);
    if (d < start || d > now) continue;
    const s = normalizeStats(v);
    total.sends += s.sends;
    total.switches += s.switches;
    total.switchCacheWrite += s.switchCacheWrite;
    total.otherCacheWrite += s.otherCacheWrite;
  }
  return total;
}
