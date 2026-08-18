// Pure search over the project's stored chat threads.
//
// ★ i18n-free, clock-free and DOM-free by contract, exactly like
//   `history-search.ts`: `tz` is a parameter, no `Date.now()` is read, and
//   nothing here touches a document.
//
// ★★ Threads are Turso-only by construction, so `available` is a REQUIRED
//   argument rather than something inferred from `threads.length`. "Turso with
//   no chats yet" and "file mode, cannot look" both arrive as an empty array,
//   and collapsing them makes the model tell every file-mode user it searched
//   their past conversations and found nothing.
import { deriveThreadName, type ChatThread } from "./chat-threads";
import { resolveLimit } from "./resolve-limit";
import { isoInZone, makeDayInZone } from "./timezone";

export const DEFAULT_CHAT_LIMIT = 20;
export const MAX_CHAT_LIMIT = 50;

export interface ChatQuery {
  query?: string;
  /** Inclusive lower bound, `YYYY-MM-DD`, resolved in the project zone. */
  since?: string;
  /** Inclusive upper bound, `YYYY-MM-DD`, resolved in the project zone. */
  until?: string;
  /** Caps MESSAGES, not threads — see `searchChats`. */
  limit?: number;
}

export interface ChatHitMessage {
  role: "user" | "assistant";
  text: string;
}

export interface ChatHit {
  threadId: string;
  /** `threadTitle` — the user's own thread name when set, else the derived one
   *  (and "" when the thread holds no user message yet either). */
  title: string;
  /** Rewritten into the project zone's offset-bearing form. */
  updatedAt: string;
  messages: readonly ChatHitMessage[];
  /** Matched in this thread but withheld by the cap. */
  moreMessages: number;
}

export type ChatCoverage = "turso" | "unavailable";

export interface ChatSearchResult {
  hits: ChatHit[];
  /**
   * ★★ "More matched than you are seeing" — NOT "a cap was applied". Same
   * contract as `HistoryResult.truncated`: a cap that happened to cut nothing
   * reports false, because the model reads this field to decide whether it may
   * claim a complete answer.
   */
  truncated: boolean;
  coverage: ChatCoverage;
}

/** A thread's display title: the user's own name when they have set one, else
 *  the name derived from the first user message. `ChatThread.name` is "" until
 *  the first save AND is user-editable via `renameThread` — deriving
 *  unconditionally would cite a renamed thread under a title that appears
 *  nowhere in the sidebar. */
export function threadTitle(th: ChatThread): string {
  return th.name.trim() || deriveThreadName(th.display);
}

/**
 * Search stored threads, newest first.
 *
 * ★★ The cap counts MESSAGES, not threads. A thread cap would let one chatty
 *    thread hide every other match; there is no thread cap at all, so every
 *    thread holding a match is eligible and the message budget is what runs out.
 *
 * ★★ The active thread is skipped — it is already verbatim in the request, so
 *    returning it spends context restating what the model can see.
 *
 * ★ `display` is searched rather than `history`: both are persisted, but
 *   `history` carries raw tool-use blocks the model does not need to re-read.
 */
export function searchChats(
  threads: readonly ChatThread[],
  activeThreadId: string | null,
  q: ChatQuery,
  tz: string,
  available: boolean,
): ChatSearchResult {
  if (!available) return { hits: [], truncated: false, coverage: "unavailable" };

  const needle = q.query?.trim().toLowerCase();
  const bounded = !!(q.since || q.until);
  // ★ Built ONCE and only when a bound was asked for — a per-thread `dayInZone`
  //   rebuilds its Intl formatter every call, which is what made a bounded
  //   activity scan cost 160 ms where the hoisted form costs ~2 ms.
  const dayOf = bounded ? makeDayInZone(tz) : null;

  // ★★★ Sort on the RAW UTC stamp, before any zone rewrite. Lexicographic
  //   compare only tracks real time while every string shares one offset, and a
  //   DST transition breaks exactly that: Berlin renders 00:30Z as
  //   `02:30:00+02:00` and the LATER 01:30Z as `02:30:00+01:00`, which sorts the
  //   older one first.
  const ordered = threads
    .filter((th) => th.id !== activeThreadId)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));

  const hits: ChatHit[] = [];
  let budget = resolveLimit(q.limit, DEFAULT_CHAT_LIMIT, MAX_CHAT_LIMIT);
  let truncated = false;

  for (const th of ordered) {
    if (dayOf) {
      // ★★ A thread whose stamp has NO parseable day cannot satisfy a bound and
      //   is dropped rather than compared as a raw string: "whenever" sorts
      //   above every "2026-…" date, so a string compare admits it to any range.
      const day = dayOf(th.updatedAt);
      if (day === null) continue;
      if (q.since && day < q.since) continue;
      if (q.until && day > q.until) continue;
    }

    const matched: ChatHitMessage[] = [];
    for (const item of th.display) {
      if (item.kind !== "user" && item.kind !== "assistant") continue;
      if (needle && !item.text.toLowerCase().includes(needle)) continue;
      matched.push({ role: item.kind, text: item.text });
    }
    if (matched.length === 0) continue;

    const take = Math.min(budget, matched.length);
    if (take < matched.length) truncated = true;
    // ★ Budget exhausted: this thread matched but nothing of it fits, and the
    //   line above has already set `truncated`. `budget` only ever decreases,
    //   so no later thread could contribute a message either — stop.
    if (take === 0) break;
    budget -= take;

    hits.push({
      threadId: th.id,
      title: threadTitle(th),
      updatedAt: isoInZone(th.updatedAt, tz),
      messages: matched.slice(0, take),
      moreMessages: matched.length - take,
    });
  }

  return { hits, truncated, coverage: "turso" };
}

export const CHAT_POINTER_MAX = 3;

export interface ChatPointerEntry {
  title: string;
  /** Rendered in the project zone. */
  at: string;
}

export interface ChatPointer {
  /** Threads other than the active one. */
  count: number;
  recent: readonly ChatPointerEntry[];
}

/**
 * A bounded pointer at past conversations — a count and up to three titles.
 *
 * ★★ COSTS NOTHING. `threadTitle` already supplies each thread's title — the
 *    user's own name when set, else one derived from its first user message —
 *    so this needs no model call and no durable write, which is what removed
 *    summaries, the staleness rule and the cost-per-summary decision from this
 *    slice entirely.
 *
 * ★ Returns `null` when there is nothing to point at, so a project with one
 *   conversation costs zero tokens.
 */
export function summarizeChatThreads(
  threads: readonly ChatThread[],
  activeThreadId: string | null,
  tz: string,
): ChatPointer | null {
  const others = threads
    .filter((th) => th.id !== activeThreadId)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  if (others.length === 0) return null;
  return {
    count: others.length,
    recent: others.slice(0, CHAT_POINTER_MAX).map((th) => ({
      title: threadTitle(th),
      at: isoInZone(th.updatedAt, tz),
    })),
  };
}
