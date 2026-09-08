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
 *  and `system` already claim one each. */
const MAX_MESSAGE_BREAKPOINTS = 2;

export type WireMessages = {
  messages: ApiMessage[];
  /** How many leading messages are inside a marked (cacheable) prefix. The
   *  caller's next send must reproduce these byte-for-byte to get a hit; the
   *  prefix-stability test asserts exactly that, rather than recomputing a slice
   *  bound that is only correct when history ends on a user turn. */
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

/** ★★★ WHY THE BREAKPOINTS ARE QUANTIZED INTO POWER-OF-TWO BUCKETS, rather than
 *  simply "the last `MAX_MESSAGE_BREAKPOINTS` stable messages" (the obvious
 *  first draft, and the one this file's history briefly held). That obvious
 *  version fails the prefix-stability property on almost every other real
 *  turn: it marks positions `cachedPrefixLength - 1` and `cachedPrefixLength -
 *  2`, both of which are counted FROM THE END, so they slide backward every
 *  time `cachedPrefixLength` grows at all — including by exactly one, the
 *  ordinary case of a single new turn landing in history. A message marked at
 *  one call is then unmarked at the very next one, even though it still sits
 *  inside the earlier call's promised-stable prefix. Measured against the
 *  ordinary user→assistant→user growth cycle, that reproduces on roughly every
 *  other call, which pays a fresh 1.25x cache WRITE where a 0.1x cache READ was
 *  the entire point.
 *
 *  A mark position that is a function of `cachedPrefixLength` can only be
 *  stable across growth if it does not move within the range the growth stays
 *  inside. Quantizing to the CURRENT and PREVIOUS power-of-two bucket boundary
 *  gives exactly that: both boundaries are fixed for every `cachedPrefixLength`
 *  in `[2^k, 2^(k+1))`, so ordinary single-turn growth (which essentially never
 *  crosses a power-of-two threshold) leaves both marks untouched, and only a
 *  conversation actually doubling in length pays one cache write to move the
 *  checkpoints forward — an amortized, logarithmic-frequency cost instead of a
 *  per-turn one. Mutation-tested: reverting to `cachedPrefixLength - 1` /
 *  `cachedPrefixLength - 2` turns the growing-prefix test in
 *  `chat-cache-layout.test.ts` red. */
function checkpointMarks(cachedPrefixLength: number): number[] {
  const bucket = largestPowerOfTwoAtMost(cachedPrefixLength);
  if (bucket < 1) return [];
  const marks = [bucket - 1];
  const prevBucket = bucket / 2;
  if (prevBucket >= 1) marks.push(prevBucket - 1);
  return marks;
}

function withCacheControl(msg: ApiMessage): ApiMessage {
  const blocks: ContentBlock[] =
    typeof msg.content === "string" ? [{ type: "text", text: msg.content }] : [...msg.content];
  if (blocks.length === 0) return msg;
  const last = blocks[blocks.length - 1];
  // Only `text` and `tool_result` accept a breakpoint; never mark a `tool_use`.
  if (last.type !== "text" && last.type !== "tool_result") return msg;
  // ★ `ContentBlock`'s `TextBlock`/`ToolResultBlock` members do not declare
  //   `cache_control` (unlike `SystemBlock`, which does) — chat-api.ts models
  //   only the system-block breakpoint today, not the message-level one this
  //   file adds. The Anthropic API accepts `cache_control` on both block kinds
  //   on the wire regardless; widening `ContentBlock` itself is out of scope
  //   for this file (chat-api.ts is not touched here). A direct `as
  //   ContentBlock` is rejected by tsc ("neither type sufficiently overlaps")
  //   since neither member declares the field at all, so the cast routes
  //   through `unknown` — scoped to this one assignment, not the shared type.
  blocks[blocks.length - 1] = {
    ...last,
    cache_control: { type: "ephemeral" },
  } as unknown as ContentBlock;
  return { ...msg, content: blocks } as ApiMessage;
}

export function buildWireMessages(history: ApiMessage[], turnContext: string): WireMessages {
  if (turnContext === "") return { messages: history, cachedPrefixLength: history.length };

  const ctxBlock: TextBlock = { type: "text", text: turnContext };
  const tail = history[history.length - 1];
  let messages: ApiMessage[];

  if (tail && tail.role === "user") {
    // ★ The context goes AFTER any tool_result blocks: the API requires a user
    //   message's tool_result blocks to LEAD its content.
    const blocks: ContentBlock[] =
      typeof tail.content === "string"
        ? [{ type: "text", text: tail.content }]
        : [...tail.content];
    messages = [...history.slice(0, -1), { role: "user", content: [...blocks, ctxBlock] }];
  } else {
    messages = [...history, { role: "user", content: [ctxBlock] }];
  }

  // Everything before the context-bearing message is stable across sends and is
  // what we ask the cache to hold.
  const cachedPrefixLength = messages.length - 1;
  const marks = checkpointMarks(cachedPrefixLength);
  // Structural invariant, not a runtime possibility: `checkpointMarks` returns
  // the current and previous bucket boundary only, so it can never exceed the
  // budget below. Asserted rather than trusted, so a future change to the
  // quantization that widens it fails loudly instead of quietly over-marking.
  if (marks.length > MAX_MESSAGE_BREAKPOINTS) {
    throw new Error(
      `chat-cache-layout: checkpointMarks returned ${marks.length} marks, exceeding the ${MAX_MESSAGE_BREAKPOINTS}-breakpoint budget`,
    );
  }
  const out = messages.slice();
  for (const i of marks) out[i] = withCacheControl(out[i]);
  return { messages: out, cachedPrefixLength };
}
