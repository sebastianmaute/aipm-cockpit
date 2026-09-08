// src/app/chat-cache-layout.ts — where the Anthropic prompt-cache breakpoints go
// on the MESSAGE array. Pure: no React, no i18n, no clock, no I/O.
//
// ★★★ THE ORDERING RULE THIS FILE EXISTS FOR. Anthropic checks the cache prefix
// in order `tools` → `system` → `messages`, and a cache entry is reusable only
// when the prefix is byte-identical from the very start. So ANY per-turn content
// placed before the messages makes the ENTIRE transcript uncacheable, no matter
// how many breakpoints the messages carry. Before this change the volatile
// prompt block sat in the `system` array and did exactly that: every message in
// every conversation was billed as fresh input on every turn.
//
// ★★★ A `cache_control` MARKER IS WRITE-POSITION METADATA, NOT PART OF THE
// BYTES THE CACHE MATCHES AGAINST. Moving a marker off a message does NOT
// invalidate the cache entry that message sits inside. Anthropic's own
// guidance (`shared/prompt-caching.md`, bundled with this harness) says so
// directly, in two places:
//   § Multi-turn conversations — "Put a breakpoint on the last content block
//   of the most-recently-appended turn... Earlier breakpoints remain valid
//   read points, so hits accrue incrementally as the conversation grows."
//   § Finding the invalidator — "Strip `cache_control` markers before
//   diffing: the moving marker always differs between adjacent requests and
//   is not an invalidator (previously-marked blocks are still cache hits)."
// § Automatic vs explicit breakpoints describes Anthropic's own default
// mechanism for exactly this file's job as one that "moves it forward as the
// conversation grows" — a marker that moves every turn is the RECOMMENDED
// shape, not a defect to eliminate.
//
// ★★★ THIS FILE ALREADY GOT THAT BACKWARDS ONCE — do not repeat it. An
// earlier revision asserted prefix stability with `cache_control` INCLUDED in
// a byte-for-byte `.toEqual`, correctly observed that a plain moving-boundary
// marker fails that assertion, and drew the wrong conclusion: that the moving
// marker was costing real cache hits. It replaced the boundary with
// power-of-two bucket quantization to "fix" a cost that was never real —
// and the fix was itself expensive: coverage between two doubling points
// converges to `ln 2` ≈ 0.69 average / 0.50 worst case (worst immediately
// BEFORE each doubling, i.e. exactly when the transcript is most expensive),
// against ~0.11× uncached-fraction for a boundary that moves every turn —
// roughly 3.4× more spent on history than necessary, permanently, plus a
// write point buried at `bucket - 1` that can leave a short conversation
// under a model's minimum cacheable prefix (512 tokens on Opus 5) and cache
// NOTHING, silently. The test file's `stripCacheControl` helper and the
// comment on its sweep test exist so nobody re-derives that same wrong
// conclusion from the same wrong assertion shape again.
//
// ★★★ THE TURN CONTEXT MUST NEVER BE PERSISTED. It is injected here, into the
// OUTGOING copy only. Persisting it breaks this module's whole purpose twice
// over: stale "Today is …" lines accumulate down the transcript, AND history's
// tail is rewritten on every send, so the byte-identical prefix the next send
// depends on no longer exists. `chat-panel.tsx` therefore keeps `messages` (the
// persisted array) and passes `buildWireMessages(messages, ctx).messages` to the
// API. If that ever gets collapsed into one array, nothing fails visibly — the
// only symptom is a larger bill.
//
// ★★ A HEAD-TRIM OF HISTORY DESTROYS THE PROPERTY. Dropping the oldest turns
// changes the first message, so a per-turn rolling trim invalidates the whole
// prefix on EVERY send and pays a cache write (1.25x) each time — worse than not
// caching at all. Any history budget must be coarse and hysteretic; see slice C1
// in `docs/superpowers/specs/2026-09-08-ai-cost-roadmap-design.md`.
import type { ApiMessage, ContentBlock, TextBlock } from "./chat-api";

/** At most two message breakpoints: Anthropic allows four in total and `tools`
 *  and `system` already claim one each (`shared/prompt-caching.md`'s "Max 4
 *  `cache_control` breakpoints per request"). `checkpointMarks` never exceeds
 *  this by construction — it returns the current bucket boundary plus the
 *  previous one, deduplicated to one entry when they coincide — so this is
 *  asserted across a full length sweep in `chat-cache-layout.test.ts` rather
 *  than enforced by a runtime check here. An earlier revision threw at
 *  runtime on this exact invariant; that branch was permanently unreachable
 *  (an invariant the function establishes itself can't be violated by its own
 *  output) and sat under the coverage floor for it — moved into the test. */
export const MAX_MESSAGE_BREAKPOINTS = 2;

export type WireMessages = {
  messages: ApiMessage[];
  /** How many leading messages are inside the marked prefix `checkpointMarks`
   *  placed breakpoints across. Marks are always chosen from `[0,
   *  cachedPrefixLength)`, so this is also the exclusive upper bound the
   *  caller can use to know where the marked region ends — not a claim that
   *  every message in it carries a breakpoint. */
  cachedPrefixLength: number;
};

/** Largest power of two ≤ `n` (0 for `n <= 0`). Loop rather than
 *  `2 ** Math.floor(Math.log2(n))` — the float form is fine for the sizes a
 *  chat transcript reaches, but the loop is exact by construction and does not
 *  ask a reader to trust floating-point rounding at the exact powers of two. */
function largestPowerOfTwoAtMost(n: number): number {
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return n >= 1 ? p : 0;
}

/** The two message-level breakpoints this file places: a fixed CHECKPOINT
 *  anchor and the moving BOUNDARY. Each buys something the other cannot:
 *
 *  - BOUNDARY (`cachedPrefixLength - 1`) is what actually buys coverage. It
 *    moves every call — see the file header for why a moving marker is free,
 *    not costly, and matches Anthropic's own recommended default for
 *    multi-turn conversations.
 *  - ANCHOR (`largestPowerOfTwoAtMost(cachedPrefixLength) - 1`) buys
 *    something the boundary alone cannot: a position that is FIXED for an
 *    entire power-of-two range, found at a small, bounded distance from the
 *    start of the message array. `shared/prompt-caching.md`'s § 20-block
 *    lookback window caps how far back a breakpoint walks to find a prior
 *    entry (20 positions) — a single turn that appends more than 20 positions
 *    of sequential content (a long tool loop, not the parallel-call case,
 *    which collapses to one position) can push the PREVIOUS boundary mark's
 *    position out of that window, silently losing the read for that request.
 *    The anchor is far less exposed to that: it does not move at all within
 *    its bucket, and buckets double, so a lookback miss on it requires a
 *    single turn to cross a power-of-two threshold on its own — much rarer
 *    than losing 20 positions of an ordinary turn.
 *
 *  Deduplicated: when `cachedPrefixLength` is itself a power of two, anchor
 *  and boundary land on the SAME index — returning both would claim two
 *  breakpoints while the wire carries one marker, which would make the
 *  `marks.length <= MAX_MESSAGE_BREAKPOINTS` assertion in the test file true
 *  for the wrong reason at exactly the value most worth checking. */
function checkpointMarks(cachedPrefixLength: number): number[] {
  if (cachedPrefixLength <= 0) return [];
  const boundary = cachedPrefixLength - 1;
  const anchor = largestPowerOfTwoAtMost(cachedPrefixLength) - 1;
  return anchor === boundary ? [boundary] : [anchor, boundary];
}

function withCacheControl(msg: ApiMessage): ApiMessage {
  const blocks: ContentBlock[] =
    typeof msg.content === "string" ? [{ type: "text", text: msg.content }] : [...msg.content];
  if (blocks.length === 0) return msg;
  const last = blocks[blocks.length - 1];
  // Only `text` and `tool_result` accept a breakpoint; never mark a `tool_use`.
  if (last.type !== "text" && last.type !== "tool_result") return msg;
  // `TextBlock`/`ToolResultBlock` both declare `cache_control` as optional
  // (chat-api.ts) so this is a plain, statically-checked object literal — no
  // cast. An earlier revision routed this through `as unknown as
  // ContentBlock` because chat-api.ts modeled the field only on
  // `SystemBlock`; that cast defeated all checking on the assignment (a
  // renamed field or a changed `"ephemeral"` literal would have passed tsc
  // while silently disabling caching), so the shared type was widened
  // instead — see the doc comment on `TextBlock` in chat-api.ts.
  blocks[blocks.length - 1] = { ...last, cache_control: { type: "ephemeral" } };
  return { ...msg, content: blocks } as ApiMessage;
}

export function buildWireMessages(history: ApiMessage[], turnContext: string): WireMessages {
  let messages: ApiMessage[];
  let cachedPrefixLength: number;

  if (turnContext === "") {
    // ★ Still marked, not returned untouched: `cachedPrefixLength`'s contract
    //   is "the prefix `checkpointMarks` placed breakpoints across", and that
    //   must hold on every path, including this one, or a caller can't trust
    //   the field without checking which branch produced it. The alternative
    //   (leave this path unmarked, reword the docstring to describe two
    //   different meanings) makes the type lie about itself depending on an
    //   input the caller doesn't see in the return value.
    messages = history;
    cachedPrefixLength = history.length;
  } else {
    const ctxBlock: TextBlock = { type: "text", text: turnContext };
    const tail = history[history.length - 1];
    if (tail && tail.role === "user") {
      // ★ The context goes AFTER any tool_result blocks: the API requires a
      //   user message's tool_result blocks to LEAD its content.
      const blocks: ContentBlock[] =
        typeof tail.content === "string"
          ? [{ type: "text", text: tail.content }]
          : [...tail.content];
      messages = [...history.slice(0, -1), { role: "user", content: [...blocks, ctxBlock] }];
    } else {
      messages = [...history, { role: "user", content: [ctxBlock] }];
    }
    // Everything before the context-bearing message is stable across sends
    // and is what we ask the cache to hold.
    cachedPrefixLength = messages.length - 1;
  }

  const marks = checkpointMarks(cachedPrefixLength);
  if (marks.length === 0) return { messages, cachedPrefixLength };
  const out = messages.slice();
  for (const i of marks) out[i] = withCacheControl(out[i]);
  return { messages: out, cachedPrefixLength };
}
