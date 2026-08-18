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
  /** `deriveThreadName`, or "" when the thread holds no user message yet. */
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
    .slice()
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
    // ★ Budget exhausted: the thread matched but nothing of it fits. Keep
    //   scanning so `truncated` stays honest about later threads too.
    if (take === 0) continue;
    budget -= take;

    hits.push({
      threadId: th.id,
      title: deriveThreadName(th.display),
      updatedAt: isoInZone(th.updatedAt, tz),
      messages: matched.slice(0, take),
      moreMessages: matched.length - take,
    });
  }

  return { hits, truncated, coverage: "turso" };
}
