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
// ★ `THREAD_NAME_MAX` is imported, never re-spelled as 60 here: a copy would
//   drift from the cap `deriveThreadName` applies, and the derived branch and
//   the user-set branch must stay in step.
import { deriveThreadName, THREAD_NAME_MAX, type ChatThread } from "./chat-threads";
import { resolveLimit } from "./resolve-limit";
// ★★ `sanitizeMultiline` is the EXPORTED spelling of `sanitize-core`'s private
//   `clipText` for a string input — cap only, whitespace preserved. Deliberately
//   NOT a hand-rolled `.slice()`: `clipText` backs a cut off a lone HIGH
//   SURROGATE, so a cap landing inside an astral character drops it WHOLE. A
//   raw slice keeps the half-character, which the CSV/Markdown backends encode
//   to U+FFFD while JSON/IndexedDB survive it — a backend-dependent corruption
//   this repo already fixed once (§22). Do not re-hand-roll it here.
import { sanitizeMultiline } from "./sanitize-core";
import { isoInZone, makeDayInZone } from "./timezone";

export const DEFAULT_CHAT_LIMIT = 20;
export const MAX_CHAT_LIMIT = 50;

/**
 * Per-MESSAGE character cap on a returned excerpt.
 *
 * ★★★ THE MESSAGE COUNT IS NOT A SIZE BUDGET. Every field of the tool's schema
 * is optional, so a bare `search_chats {}` is a legal call — and the ambient
 * chat pointer makes it a likely FIRST move. User messages are stored up to
 * `CHAT_MESSAGE_MAX` (10 000) and assistant messages are bounded only by the
 * model's `max_tokens`, so an uncapped default call could return ~200 KB of
 * verbatim conversation into one `tool_result`, inside an agentic loop free to
 * call again, and the result is then PERSISTED into this thread's own row.
 * `search_history`'s identical count-only cap is safe only because its page
 * items are short RENDERED summaries; these are raw message bodies.
 *
 * ★ 1 000 characters ≈ 150 words ≈ ~250 tokens — enough to carry a decision and
 * the reasoning immediately around it, which is the whole point of recall —
 * while bounding a bare call (20 messages) at ~20 KB and the worst LEGAL call
 * (`MAX_CHAT_LIMIT`) at ~50 KB, against ~500 KB unbounded. It is also the value
 * `sanitize-core` already uses for a voice transcript, i.e. one utterance.
 */
export const CHAT_EXCERPT_MAX = 1000;

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
  /** Clipped to `CHAT_EXCERPT_MAX` — see `clipped`. */
  text: string;
  /**
   * ★★ "This message BODY was shortened" — a different claim from
   * `moreMessages`/`truncated`, which only ever say that other MESSAGES matched.
   * Without it the model cannot tell an excerpt from a complete message and will
   * quote a fragment as if it were the whole thing.
   *
   * ★ Present only when true, so the common case costs nothing on the wire
   * — absent means complete.
   */
  clipped?: boolean;
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

/**
 * A thread's display title: the user's own name when they have set one, else
 * the name derived from the first user message. `ChatThread.name` is "" until
 * the first save AND is user-editable via `renameThread` — deriving
 * unconditionally would cite a renamed thread under a title that appears
 * nowhere in the sidebar.
 *
 * ★★★ THE CAP LIVES HERE, at the PRODUCER, because only the DERIVED branch is
 *   capped upstream: the rename `Input` in `chat-thread-list.tsx` sets no
 *   `maxLength`, `renameThread` (`use-chat-threads.ts`) writes the value
 *   verbatim, and the loader (`chat-threads-schema.ts`) reads `r.name ?? ""`
 *   with no clamp — a user-set name is uncapped end to end. Capping at a SINK
 *   instead is opt-in per call site and was already missed twice: both
 *   `searchChats` (what `search_chats` hands the model) and
 *   `summarizeChatThreads` (`getSnapshot().chatPointer`, returned verbatim by
 *   `get_app_state`) emitted this value raw.
 *
 *   ★★ Safe to cap here because NOTHING renders this to a human — the sidebar
 *   has its own `displayName` over `ChatThread.name` (`chat-thread-list.tsx`)
 *   and never calls this. Verify before adding a UI caller:
 *   `grep -rn "threadTitle" src --include=*.ts --include=*.tsx`. A new
 *   UI consumer must read `th.name`, not this.
 *
 *   ★★ NOT self-injection only — `chat-threads-schema.ts` scopes `chat_threads`
 *   by `project_id` with no per-user or per-device column, so on a shared Turso
 *   project this text belongs to another collaborator.
 *
 *   ★ IDEMPOTENT on an already-derived title: `deriveThreadName` emits
 *   THREAD_NAME_MAX characters + `…` (61 units), which clips back to the same
 *   60 and re-gains the same `…`, byte-identical.
 *   ★ The two caps count DIFFERENT UNITS — `clipText` counts UTF-16 code units,
 *   `deriveThreadName` counts code points — so an astral-heavy derived title
 *   clips SHORTER here than it did upstream. Bounded either way; do not "fix"
 *   that by hand-rolling a code-point slice (see the import note above).
 */
export function threadTitle(th: ChatThread): string {
  const raw = th.name.trim() || deriveThreadName(th.display);
  const clipped = sanitizeMultiline(raw, THREAD_NAME_MAX);
  return clipped === raw ? clipped : `${clipped}…`;
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
      // ★★ The needle is matched against the FULL text and only the RETURNED
      //   copy is clipped — the alternative silently drops a thread whose only
      //   mention sits past the cap. The consequence is deliberate: an excerpt
      //   may not itself contain the needle, which is exactly what `clipped`
      //   exists to disclose.
      const text = sanitizeMultiline(item.text, CHAT_EXCERPT_MAX);
      matched.push(
        text.length < item.text.length
          ? { role: item.kind, text, clipped: true }
          : { role: item.kind, text },
      );
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
