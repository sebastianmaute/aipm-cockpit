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
//    - the model and the tool list are unchanged (each model keeps its own
//      cache, and `tools` sit in front of `system` in the prefix, so a
//      change to either rewrites the cache anyway);
//    - the previous send is in the SAME thread (another thread has its own
//      prefix);
//    - the cache is still warm (after the TTL the write happens anyway);
//    - the send continues a conversation (a first message has no transcript
//      to rewrite, and file mode keeps ONE thread id across "New chat").
//    A send failing any of those would cost the same under G2, so counting it
//    would overstate the saving. Such a send is "cold".
// ★★ THREE KINDS, NOT TWO. A warm send whose view block did NOT change is the
//    baseline a switch is compared with: both pay the ordinary write for the
//    new turn, so the difference between their average cache writes is what
//    G2 would save. Cold sends write the whole prefix whatever G2 does, so
//    folding them into the baseline would inflate it and understate the
//    saving; they are counted as sends and their writes are not kept.
// ★ KNOWN BLIND SPOT: the transcript prefix can change on its own. When
//    `fitHistoryToBudget` swaps an earlier turn's attachment for a
//    placeholder (on the send that first crosses the attachment budget), the
//    whole transcript is rewritten whatever G2 does, yet that send is still
//    classified switch or warm. It takes large attachments, so it is named
//    here rather than fingerprinted.

import { isoDate, mondayOf } from "./ai-usage";

/** Anthropic's default `ephemeral` cache lifetime. ★ The lifetime is
 *  refreshed when a request is PROCESSED, which is when it goes out, not when
 *  its answer finishes arriving. So the window runs from the previous send's
 *  LAST request to this send's FIRST. Both stamps are taken just before a
 *  request leaves the browser, so its upload time sits on both sides and
 *  cancels; what is left is well under a second either way. */
export const VIEW_SWITCH_CACHE_TTL_MS = 5 * 60 * 1000;

/** The MODELLED break-even this counter exists to check: G2 pays
 *  `0.9 × view-guide` on every API REQUEST and saves a transcript rewrite on
 *  every warm switch, which evens out at about one switch per this many
 *  requests. Source: docs/superpowers/specs/2026-09-08-ai-guide-block-cache-split-design.md
 *  ("Break-even"), which says "turns".
 *  ★★ A TURN THERE IS ONE REQUEST, NOT ONE SEND. G2 puts the guide beside the
 *  turn context, and `chat-panel.tsx` attaches the turn context on every
 *  round-trip of a send (`buildWireMessages` runs inside the tool loop), so a
 *  send with three tool calls pays G2's cost four times. Comparing switches
 *  with SENDS would understate G2's cost and argue for it too early. */
export const G2_BREAK_EVEN_REQUESTS_PER_SWITCH = 46;

/** What one chat send put in front of the transcript, and when. */
export type SendFingerprint = {
  /** Project and thread, so a send in another thread never counts. */
  threadKey: string;
  /** The model the requests named: every model keeps its own cache. */
  model: string;
  /** The names of the tools the requests carried, joined in request order. */
  toolNames: string;
  /** `system` block 0's text. */
  stableText: string;
  /** Every later `system` block's text joined; `""` when the view has none. */
  viewText: string;
  /** Epoch ms just before the send's first request went out. */
  startedAt: number;
  /** Epoch ms just before the send's last request went out. */
  lastRequestAt: number;
  /** Messages in the thread before this send's user message. */
  priorTurns: number;
};

export type SendKind = "switch" | "warm" | "cold";

/** ★ The window runs from the previous send's LAST REQUEST to this send's
 *  FIRST: the question is whether the cache was warm when this send's first
 *  request went out. Measuring from the previous send's last ANSWER would
 *  stretch the window by that answer's generation time and count an expired
 *  cache as warm; measuring to this send's last request would let its own
 *  tool loop push a warm send past it. */
export function classifySend(
  prev: SendFingerprint | null | undefined,
  next: SendFingerprint,
  ttlMs: number = VIEW_SWITCH_CACHE_TTL_MS,
): SendKind {
  if (!prev) return "cold";
  if (next.priorTurns <= 0) return "cold";
  if (prev.threadKey !== next.threadKey) return "cold";
  if (next.startedAt - prev.lastRequestAt >= ttlMs) return "cold";
  if (prev.model !== next.model) return "cold";
  if (prev.toolNames !== next.toolNames) return "cold";
  if (prev.stableText !== next.stableText) return "cold";
  return prev.viewText !== next.viewText ? "switch" : "warm";
}

/** Remembers `fp` as its thread's latest send and forgets every thread whose
 *  last request is a whole cache window before `fp` started. A forgotten
 *  entry could only ever classify a later send as cold: `ChatPanel` runs one
 *  send at a time (`abortRef`, §321) and records it before the next can
 *  start, so every later send starts after `fp` did. Without this the map
 *  would keep one entry for every thread touched since the app loaded. */
export function pruneLastSends(
  last: ReadonlyMap<string, SendFingerprint>,
  fp: SendFingerprint,
  ttlMs: number = VIEW_SWITCH_CACHE_TTL_MS,
): ReadonlyMap<string, SendFingerprint> {
  const out = new Map<string, SendFingerprint>();
  for (const [k, v] of last) {
    if (fp.startedAt - v.lastRequestAt < ttlMs) out.set(k, v);
  }
  out.set(fp.threadKey, fp);
  return out;
}

export type ViewSwitchStats = {
  sends: number;
  /** API requests (round-trips) across those sends: the break-even's unit. */
  requests: number;
  switches: number;
  warmSends: number;
  switchCacheWrite: number;
  warmCacheWrite: number;
};
export type ViewSwitchBuckets = Record<string, ViewSwitchStats>; // key: YYYY-MM-DD (local)

/** A week with nothing in it. Frozen, because it is shared as a default. */
export const EMPTY_VIEW_SWITCH_STATS: Readonly<ViewSwitchStats> = Object.freeze({
  sends: 0,
  requests: 0,
  switches: 0,
  warmSends: 0,
  switchCacheWrite: 0,
  warmCacheWrite: 0,
});

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

const finite = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function normalizeStats(v: unknown): ViewSwitchStats {
  const o = (v && typeof v === "object" ? v : {}) as Partial<Record<keyof ViewSwitchStats, unknown>>;
  return {
    sends: finite(o.sends),
    requests: finite(o.requests),
    switches: finite(o.switches),
    warmSends: finite(o.warmSends),
    switchCacheWrite: finite(o.switchCacheWrite),
    warmCacheWrite: finite(o.warmCacheWrite),
  };
}

/** ★★ NORMALISE, NEVER CAST — the same rule as the token buckets: a field
 *  missing from storage would otherwise turn every later sum into NaN. A key
 *  that is not a day is dropped: it parses to an Invalid Date, which every
 *  comparison in the week filter answers false, so it would be summed in. */
export function normalizeViewSwitchBuckets(raw: unknown): ViewSwitchBuckets {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ViewSwitchBuckets = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (DAY_KEY.test(k)) out[k] = normalizeStats(v);
  }
  return out;
}

export function addViewSwitchSend(
  b: ViewSwitchBuckets,
  when: Date,
  kind: SendKind,
  cacheWrite: number,
  requests: number,
): ViewSwitchBuckets {
  const k = isoDate(when);
  const prev = normalizeStats(b[k] ?? EMPTY_VIEW_SWITCH_STATS);
  const w = finite(cacheWrite);
  return {
    ...b,
    [k]: {
      sends: prev.sends + 1,
      requests: prev.requests + finite(requests),
      switches: prev.switches + (kind === "switch" ? 1 : 0),
      warmSends: prev.warmSends + (kind === "warm" ? 1 : 0),
      switchCacheWrite: prev.switchCacheWrite + (kind === "switch" ? w : 0),
      warmCacheWrite: prev.warmCacheWrite + (kind === "warm" ? w : 0),
    },
  };
}

export function weekViewSwitchStats(b: ViewSwitchBuckets, now: Date): ViewSwitchStats {
  const start = mondayOf(now);
  const total = { ...EMPTY_VIEW_SWITCH_STATS };
  for (const [k, v] of Object.entries(b)) {
    const d = new Date(`${k}T00:00:00`);
    if (d < start || d > now) continue;
    const s = normalizeStats(v);
    total.sends += s.sends;
    total.requests += s.requests;
    total.switches += s.switches;
    total.warmSends += s.warmSends;
    total.switchCacheWrite += s.switchCacheWrite;
    total.warmCacheWrite += s.warmCacheWrite;
  }
  return total;
}
