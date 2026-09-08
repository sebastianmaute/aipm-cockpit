# AI prompt-cache layout + honest usage meter — design

**Date:** 2026-09-08
**Status:** approved, not yet planned
**Slice goal:** make the chat transcript cacheable, and make the usage meter count what Anthropic actually bills.

---

## 1. Why

An external cost analysis of the assistant's Anthropic spend recommended three levers. Two are already
shipped in this repo and one is advice not to act:

| Recommendation | State in this tree |
|---|---|
| "Keep the system prompt stable so prompt caching keeps hitting" | **Already built.** Two `cache_control` breakpoints in `chat-api.ts` — one after `stableText`, one on the last tool def (`CACHED_TOOLS` / `withCacheBreakpoint`). Every volatile block carries a comment saying why it sits outside the cached prefix. |
| "`list_tasks` returns every field for every task; use its `limit`" | **False about this code.** `slimTaskForList` (`chat-tools-lists.ts`) projects `description` and `noteLog` down to text, `limit` exists on three list tools, and the envelope reports `total` before the limit so counts stay honest. |
| "Don't shorten answers — output is ~6% of spend" | Correct, and it asks for no work. |

The analysis was derived from two aggregate numbers without access to the code. The lever nobody has
looked at is the one it could not see: **the request layout that makes the message transcript
structurally uncacheable.**

Two defects follow from that, and this slice closes both.

### 1a. The transcript can never be cached

Anthropic checks the cache prefix in order **tools → system → messages**. A cache entry is reusable only
when the prefix is byte-identical up to a breakpoint; anything after the last breakpoint is billed fresh.

Today's layout:

```
tools     [ …TOOL_DEFS, last carries cache_control ]   ← breakpoint 1
system    [ {stableText, cache_control},               ← breakpoint 2
            {volatileText} ]                           ← rebuilt every turn
messages  [ …entire transcript… ]                      ← therefore never cacheable
```

`volatileText` (today's date, task count, view scope, view digest, insights, activity recap, chat
pointer) sits *between* the last breakpoint and the messages. Because it changes every turn, no cache
entry covering it can ever be reused — so **every message in the conversation is billed at full input
price on every turn**, and no message-level breakpoint could fix that while a volatile system block
precedes it.

The existing per-block comments ("MUST stay in the uncached suffix, or it would invalidate the cached
prefix") are each correct in isolation. They reason about what volatile content costs the *prefix*, and
never about what it costs everything *behind* it.

### 1b. The usage meter cannot see cached tokens, and it drives user-facing caps

`ApiUsage` is `{ input_tokens, output_tokens }`. Anthropic returns `cache_creation_input_tokens` and
`cache_read_input_tokens` as separate fields, and `input_tokens` **excludes** cache reads. The app reads
neither.

This is not only a reporting gap. `ai-usage-context.tsx` runs user-configurable **session and weekly
token caps** with 80% and 100% advisory warnings (`crossed80` / `crossed100` in `usage-warning.ts`) off
this counter. So:

- cache reads are invisible (billed at 0.1×, but real);
- cache writes are invisible (billed at **1.25×** — actively billed tokens counted as zero);
- a user who set a weekly cap is warned late, or never;
- and the size of the under-count grows with exactly how well the cache works.

It also means nobody can measure whether §1a's fix worked, which is why the meter ships in the same
slice rather than after it.

## 2. The layout change

```
tools     [ …TOOL_DEFS, last carries cache_control ]   ← breakpoint 1
system    [ {stableText, cache_control} ]              ← breakpoint 2, now the entire system array
messages  [ …H (persisted history)…,                   ← breakpoints 3 + 4, rolling
            { role:"user", content:[ {turnContext}, {user text} ] } ]   ← the only fresh segment
```

`buildSystemPrompt` splits into two exported builders over the same snapshot:

- `buildStableSystemBlocks(...)` → the `SystemBlock[]` (instructions + guide block, one breakpoint).
- `buildTurnContext(...)` → a single `string` for a `TextBlock` on the current user turn.

Same bytes, different position. Nothing is dropped or summarised.

### Why it compounds

Let `H` be the persisted history before a send. Send *n* writes a cache entry for `tools + system + Hₙ`.
Send *n+1* sends `Hₙ₊₁ = Hₙ + [Uₙ, Aₙ, tool-result carrier]` — a strict extension — so the older prefix
still matches and reads from cache. The fresh segment per send becomes *the previous turn's output plus
the current turn's input*, instead of the whole transcript. The saving therefore grows with conversation
length, which is precisely where today's layout is worst.

Within a single send, `system` is built once (`chat-panel.tsx` builds it before the round-trip loop) and
`messages` only grows, so the multi-turn tool loop keeps hitting the same entry across its turns.

**Two rolling message breakpoints, not one.** Anthropic permits at most 4 breakpoints; this design uses
exactly 4 (tools, system, and the last two turn boundaries). Keeping the previous boundary marked lets
the older entry stay warm while the newer one is written, which is what makes the *n → n+1* hit above
survive a slow turn.

### The turn-context block is never persisted

It is injected at wire-build time only, and never written into `newHistory`, the per-project store, or
the Turso `chat_threads` row. Two reasons, both load-bearing:

1. **Correctness.** A persisted turn context would leave a trail of increasingly stale "Today is …",
   stale insight lists and stale activity counts down the transcript, and the model would read them as
   current.
2. **The cache itself.** The *n → n+1* hit depends on `Hₙ` being byte-identical between sends. A
   persisted turn context rewrites history's tail on every send and destroys the property this whole
   slice exists to create.

If that invariant ever breaks, the only symptom is a silently larger bill. It therefore gets a named
test rather than a comment (§5).

### New module

`chat-cache-layout.ts` — pure, i18n-free, React-free, clock-free, matching the repo's engine convention:

```ts
export function buildWireMessages(
  history: ApiMessage[],
  turnContext: string,
): ApiMessage[]
```

It appends the turn context to the final user message's content (after any `tool_result` blocks, which
the API requires to lead a user message's content) and places the two rolling breakpoints. Keeping this
pure is what makes the prefix-stability property in §5 testable at all.

### Type change

`TextBlock` and `ToolResultBlock` gain an optional `cache_control?: { type: "ephemeral" }`. `ToolUseBlock`
does not — a breakpoint is only ever placed on a block type the API accepts one on.

## 3. What is deliberately NOT moved

`stableText` carries the operating guides, and **it is view-dependent**: `settings.ai.groundInGuides`
defaults to true, and **22 of the 23** `BUILTIN_FEATURE_GUIDES` are view-scoped (one carries an empty
scope), so `selectActiveGuides` swaps a 1–3 KB block on every view switch. Under the new layout that
means **a mid-conversation view switch still invalidates the transcript cache**, because `system`
precedes `messages`.

Measured 2026-09-08, because the number in `chat-api.ts`'s own docstring said "20 of the 21" and was
stale by two — an ungated count, the class `AGENTS.md` warns about explicitly. Do not trust either
number; re-run it:

```bash
node -e "const s=require('fs').readFileSync('src/app/operating-guide-builtin.generated.ts','utf8');const b=s.slice(s.indexOf('BUILTIN_FEATURE_GUIDES'));console.log((b.match(/\"name\":/g)||[]).length, (b.match(/\"views\":/g)||[]).length)"
```

A bare `grep -c scope` on that file answers 27 and is worthless — the guide prose discusses project
scope, so the corpus poisons its own count. The conclusion the stale number supported is unchanged, and
marginally stronger.

Moving the guide to the turn tail as well was considered and rejected for now. Today the guide is read
from cache at 0.1× for any user who does not switch views; moving it makes it fresh at 1.0× on every
send for *every* user. Which is cheaper depends entirely on how often real users switch view
mid-conversation — a number nobody has, and one the meter in §4 will produce.

**Recorded as an open follow-up, with the measurement that settles it** (§7), not as a guess.

## 4. The honest meter

**Wire types.** `ApiUsage` gains `cache_creation_input_tokens?: number` and
`cache_read_input_tokens?: number`. Both optional: the API omits them when caching is inactive, so an
absent field must read as 0 and never as a parse failure.

**Domain type.** `Usage` goes from `{ input, output }` to `{ input, output, cacheWrite, cacheRead }`.
`addToBuckets` and `weekToDate` (`ai-usage.ts`) follow.

**Persistence, and the trap in it.** `aipm-cockpit:ai-usage` holds `Record<YYYY-MM-DD, Usage>`, and
`loadBuckets` currently casts the parsed JSON straight to `UsageBuckets` with no per-field check. A blob
written by an older build has only `input`/`output`, so the two new fields read as `undefined` — and
`undefined + n` is `NaN`, which propagates through `addToBuckets` into `weekToDate` and **silently
disables every cap**, because `NaN < threshold` and `NaN >= threshold` are both false. `crossed80` and
`crossed100` would then never fire again for that user, with no error anywhere.

So the reader must NORMALISE, not cast: every bucket is rebuilt field by field with a numeric default,
and a non-finite stored value is coerced to 0. This gets its own test with a hand-written pre-0.294 blob
as the fixture — the upgrade path is the case that will actually occur, and a fixture written in the new
shape cannot see this bug at all.

The two new fields default to 0. No migration is written —
historic buckets genuinely did not measure these, and back-filling them with a guess would fabricate the
very number the slice exists to measure. A newer blob read by an older build loses the extra keys
harmlessly.

**There is already a multiplier, and it must not be quietly reinterpreted.** `ai.tokenMultiplier`
(`settings-types.ts`: "Multiplier applied to counted tokens before caps (>0, decimals ok). Default 5")
is applied uniformly to `input` and `output` in `record` before bucketing, so both caps compare against
the same scale. It is a blunt safety margin, not a billing model.

The two new fields are scaled by **the same multiplier, uniformly**, preserving today's semantics
exactly. Per-field billing weights are used *only* for the displayed cost estimate and never folded into
the multiplier — a uniform 5× and a per-field weighting cover overlapping ground, and collapsing them
would silently redefine a setting the user chose under the old meaning. That overlap is real and is
recorded as a follow-up (§9), not resolved here.

**The caps change behaviour, and this is a deliberate user-visible break.** The caps count raw tokens,
which is the unit the setting already advertises, so they now include cache reads and cache writes.
Existing caps therefore bind sooner: a user sees the 80% warning earlier than they did on 0.293.x, with
no change to their settings.

State the direction precisely, because "the old number was an under-count" is only half true. The old
count *omitted* cache reads and cache writes entirely (an under-count of tokens) while *multiplying*
what it did count by 5 (a deliberate over-count as margin). Those are two different distortions in two
different directions, and only the first is being fixed. The net effect on any given user is more
tokens counted than before — but do not describe the pre-0.294 figure as simply "too low", because at
the default multiplier it was five times a subset. It ships with:

- a `CHANGELOG.md` entry stating the direction of the change explicitly, and
- a one-time in-app notice on first crossing after upgrade, so the earlier warning is explained rather
  than read as a regression.

**Cost-weighted spend is displayed, never substituted into the cap.** The diagnostics surface shows an
estimated spend using the published multipliers (cache write 1.25×, cache read 0.1×, uncached input 1×,
output 5×) alongside the raw token figure. Silently re-basing an existing user setting from tokens to
cost is the worse failure and is not done.

**Diagnostics surface.** The existing diagnostics ring gains a cache line: reads, writes, uncached input,
and a hit rate for the session. New EN + DE strings (real umlauts; `i18n.de.ts` is patched via a node
utf8 write, never the Edit tool).

## 5. Verification

"The cache now hits" is exactly the class of claim this repo has shipped falsely before, so it is pinned
structurally rather than asserted.

1. **Prefix stability.** Given `H` and `H' = H + [assistant turn, tool-result carrier]`,
   `buildWireMessages(H', ctx')` must start with the exact message prefix that `buildWireMessages(H, ctx)`
   cached. Mutation-proved in both directions: persisting the turn context into history must turn it red.
2. **No volatile content before the last breakpoint.** Every block preceding the final message breakpoint
   is drawn from `stableText` plus persisted history only.
3. **Turn context never persists.** A full send is driven and the persisted history is asserted free of
   the turn-context text — the invariant from §2, tested rather than commented.
4. **Breakpoint count ≤ 4.** Across all four `TOOL_VARIANTS` (the `historySearch` × `chatSearch` bits),
   asserted on the assembled request, not on any one layer. Exceeding four is an API error, and the
   variants are the axis that could push it over.
5. **Meter carry-through.** All four usage fields survive `callClaude` → `chat-panel` → buckets →
   `weekToDate`, with a mutant dropping each field.
6. **Absent-field default.** A response with no cache fields, and a stored blob with no cache keys, both
   read as 0.
7. **Owed manual verification — a gate, not a footnote.** No unit test can prove a cache hit; only the API
   can. Two consecutive real sends against a live key, reading `cache_read_input_tokens` off the second
   response and confirming it is non-zero and approximately the transcript size. Recorded as owed until
   done.

## 6. The risk that cannot be gated

Moving today's date, insights, view scope, view state, activity recap and the chat pointer out of
`system` and onto the user turn is lossless **in bytes** and not lossless **in emphasis** —
system-position instructions carry more weight than tail-position ones, and this prompt was tuned with
them in system.

There is no prompt-quality eval harness in this repo, and building one is its own slice. This slice
therefore carries a **defined manual eval**: a fixed set of prompts exercising the moved blocks
(a date-relative question, a view-scoped question, an insight-referencing question, an activity-recall
question, a thread-recall question) run against both layouts, answers recorded and compared.

If it regresses, the fallback is to keep `buildViewScopeBlock`'s output in `system` and accept a smaller
win — the transcript still becomes cacheable, at the cost of re-caching the system slice on view change.

Stating this beats shipping a "lossless" claim that only covers the bytes.

## 7. Per-consumer split

`buildSystemPrompt` has two non-test callers and they owe different things:

- **`chat-panel.tsx`** — the multi-turn conversation. Takes the new layout. The win is proportional to
  transcript length.
- **`inline-ai-edit-call.ts`** — a one-shot single-turn call that already blanks `chatPointer`,
  `viewDigest` and `activitySummary` out of its snapshot. It has no transcript, so relocation buys it
  nothing and would change a tuned prompt for zero gain. It keeps today's layout by calling both builders
  and joining them into `system` exactly as now.

This is a deliberate per-consumer decision, not an inconsistency: the shared rule is "cacheable prefix
first", and what each consumer owes under it differs because one has a transcript and the other does not.

## 8. Files

**Modified**

- `src/app/chat-api.ts` — `ApiUsage` fields + parse; `TextBlock`/`ToolResultBlock` gain optional
  `cache_control`; `buildSystemPrompt` splits into `buildStableSystemBlocks` + `buildTurnContext`. Also
  corrects the stale "20 of the 21 `BUILTIN_FEATURE_GUIDES`" count in `withCacheBreakpoint`'s docstring
  to the measured 22 of 23, and replaces the number with the reproduce command from §3 — a bare count
  in a comment is ungated and this one had already rotted.
- `src/app/settings-sections/ai-usage-panel.tsx` — the cache line (reads, writes, uncached input,
  session hit rate) beside the two existing `UsageBar`s. **Not** `diagnostics-panel.tsx`: an earlier
  draft of this list said diagnostics, and the usage surface is the settings panel that already renders
  `aiUsageSession` / `aiUsageWeek`. Verify with
  `grep -rln "aiUsageSession" src/app --include=*.tsx | grep -v test`.
- `src/app/chat-panel.tsx` — build wire messages via the new module; accumulate four usage fields.
- `src/app/inline-ai-edit-call.ts` — call both builders, join into `system` (behaviour unchanged).
- `src/app/ai-usage.ts` — `Usage` gains `cacheWrite`/`cacheRead`; `addToBuckets`, `weekToDate`.
- `src/app/ai-usage-context.tsx` — read/default the new keys; caps count raw total; one-time notice.
- `src/app/use-entity-inline-ai-edit.tsx`, `src/app/use-tasks-inline-ai-edit.tsx`,
  `src/app/use-inline-entity-edit.ts` — `recordUsage` mapping carries four fields.
- `src/app/i18n.ts`, `src/app/i18n.de.ts` — diagnostics cache strings + the one-time cap notice.
- `CHANGELOG.md`, `src/app/version.ts` — release entry, including the cap-behaviour change.
- `docs/AGENTS/ai-assistant.md` — the cache section is rewritten: the per-block "must stay in the
  uncached suffix" reasoning is now about the *turn tail*, not the system suffix, and the sentences that
  argue placement purely from prefix invalidation are corrected.

**Created**

- `src/app/chat-cache-layout.ts` + `chat-cache-layout.test.ts`.

**Not touched**

- `src/app/usage-warning.ts` — `crossed80`/`crossed100` take plain numbers and are basis-agnostic.
- `chat-tools-lists.ts` and the list projections — already slim; the external analysis was wrong about
  them, and re-cutting them here would be scope creep.

## 9. Out of scope (follow-ups)

> Sequenced in `2026-09-08-ai-cost-roadmap-design.md` as slices **C** (opt-in cost controls)
> and **H** (prompt-quality harness), in that order. Read the roadmap's C1 before writing any
> history trim: the obvious per-turn implementation invalidates the cached prefix on every
> send and is worse than not shipping this slice at all.

1. **Guide placement** (§3). Settle with the meter: compare cache-write volume against view-switch
   frequency over a week of real use, then decide whether the guide belongs on the turn tail.
2. **Opt-in lossy levers** — history budget, default row cap on the list tools, cheaper model for simple
   turns — behind Settings → AI, each showing its measured cost. Deliberately deferred: these cannot be
   priced honestly until the meter from §4 is running.
3. **A prompt-quality eval harness** (§6), which would turn the manual eval into a gate.
4. **`tokenMultiplier` vs per-field billing weights** (§4). A uniform 5× margin and a real per-field
   weighting cover overlapping ground. Once the meter has run for a while, decide whether the multiplier
   should default to 1 with the weights carrying the cost model — a settings change with a migration
   story, deliberately not bundled into a slice that is already changing when the caps fire.

## 10. Success criteria

- A second send in a conversation reports non-zero `cache_read_input_tokens` against a live key.
- The usage meter's total input equals uncached input + cache reads + cache writes, and the diagnostics
  ring shows a hit rate.
- Session and weekly caps count every billed input token — still scaled by `tokenMultiplier` exactly as
  today, so the unit the user configured against is unchanged and only the omission is fixed.
- No change to the bytes the model receives — only their position.
