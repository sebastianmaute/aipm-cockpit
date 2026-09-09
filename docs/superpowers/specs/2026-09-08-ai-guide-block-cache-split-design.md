# AI guide-block cache split (slice G) — design

Date: 2026-09-08
Status: **Specced, unimplemented. Sequenced as G in `2026-09-08-ai-cost-roadmap-design.md`;
its successor G2 is outlined at the end of this file and is eval-gated.**
Baseline: 0.295.0 "Borges", branch `feat/ai-prompt-cache-layout` @ `65e4cfc0`

> Follows slice B (`2026-09-08-ai-prompt-cache-layout-design.md`), which made the message
> transcript cacheable. This slice makes the SYSTEM half survive a view switch. It is the
> concrete form of that roadmap's open question 1 / C4 ("guide placement"), and it answers it
> differently than the roadmap assumed — see "What the roadmap got wrong" below.

## Problem

The operating guides are large, they are sent on every turn, and today a view switch throws all
of them out of the cache — including the ~9.9k tokens (a chars÷3.6 estimate at the time; measured
2026-09-09 at 13,305 tokens for the equivalent block-0 payload — see "What was measured" at the end
of this file) of them that did not change.

Measured 2026-09-08 against this tree (`builtinSeeds()`, `selectActiveGuides`, `assembleGuideBlock`,
`toolsFor({})`; ~3.6 chars/token unless noted):

| payload | tokens | scoped? |
|---|---|---|
| Project Leadership Operating Guide | ~9,164 | `scope: {}` — **never** view-scoped |
| App overview | ~778 | never view-scoped |
| the current view's feature guide | ~65–1,140 | one at a time |
| tools array (52 tools) | 17,796 (measured 2026-09-09 against the real API; corrected from an earlier ~12,596 chars÷3.6 estimate) | always sent |

So a request carries roughly **23k tokens of fixed prefix** (this sum used the original ~12,596
chars÷3.6 tools estimate and is now stale by the tools correction above — the fixed prefix is larger
than this figure states, not smaller), of which the guide block is ~10.3k–11.2k on every view (3
active guides on 30 of 34 views; 2 on `projects`/`help`; 4 on `raid-report`/`change-report`).

### The defect, and it is one line

`assembleGuideBlock` opens with `You have N operating guides, in priority order.` — **N varies by
view.** Because the prompt cache matches a byte-identical prefix from the start, that digit sits
ahead of everything and invalidates all of it.

**Measured: the longest common prefix of the assembled guide block across the 34 nav-reachable
views is 9 characters** (`"You have "`). (`AppView` has 35 members; `learning-insights` is
deep-link-only and unreachable from the nav tree, so it was not probed — including it could not
have raised the figure, since a common prefix only shrinks as strings are added.) The always-on
guide text below it — estimated at the time as ~9.9k tokens, measured 2026-09-09 at 13,305 tokens
for the equivalent block-0 payload (see "What was measured" at the end of this file) — is
byte-identical on every view and is re-written at 1.25× anyway, on every switch, because of the
count.

★★★ This is why the split alone is not the fix. Partitioning the array while leaving one shared
counted header in front leaves block 1 differing per view over a single digit, and buys **nothing**.
Anyone implementing this must fix the header or the slice is inert while looking complete.

★★ It is also why the existing docs undersell the cost, though not for the reason an earlier
revision of this paragraph gave. `BUILTIN_FEATURE_GUIDES` really is 22-of-23 view-scoped, and that
figure is quoted correctly in several places — but `builtinSeeds()` returns **24** guides: the
leadership guide is added separately and is unscoped. It does NOT outweigh the entire feature-guide
corpus 3:1 — measured 2026-09-09, the 22 view-scoped guides total 28,977 chars against leadership's
32,989 (plus App overview's 2,799), a ratio of **1.14x**, not 3x. The corpus total is the wrong
comparison anyway: the corpus is never sent — only ONE view-scoped guide is ever active per
request — so what actually matters is that leadership alone dwarfs the single active view guide on
every request (~8x the largest one, 4,103 chars). That leadership and the corpus are comparable IN
TOTAL (1.14x) is precisely why view scoping saves far less than the 22-of-23 guide-count ratio
suggests. Reproduce:
`npx vite-node` a script importing `builtinSeeds` from `use-operating-guides` and summing
`content.length` grouped on whether `scope.views` is empty-or-absent.

## Approach

Split `buildStableSystemBlocks`' single `SystemBlock` into two, and move the existing
`cache_control` marker onto the first.

- **Block 1 — view-invariant prefix.** `stableInstructions` plus every active guide whose
  `scope.views` is absent (leadership, App overview). **Carries the marker.**
- **Block 2 — view-scoped tail.** The guides selected by `snapshot.currentView`. **No marker.**

The partition is on `scope.views`, not a re-ordering: `selectActiveGuides` already sorts by
`priority`, and the always-on guides hold priorities 1 and 2 against the feature guides' 3+, so they
already lead the block today.

### Breakpoint accounting — unchanged at exactly 4

`tools` 1 + `system` 1 + `messages` 2 (`chat-cache-layout.ts`'s anchor + boundary) = 4, Anthropic's
maximum. This slice **spends none**: the system marker moves from the end of one block to the end of
the first of two. That is the property that makes this approach cheap, and any variant that wants a
marker on block 2 as well must first free one — which is a different design (see slice G2).

Block 2 still sits inside whatever a LATER marker covers, so it is not necessarily uncached, merely
never the boundary of a cache lookup by itself — whether it actually lands inside a message-level
cache segment depends on where `chat-cache-layout.ts` places its two breakpoints, which is not
guaranteed. It simply has no read point of its own.

### The header, restated as a requirement

Each block gets its own header, and block 1's count is derived from the always-on set ALONE, so it
cannot move when the view changes. Guide numbering (`=== GUIDE n …`) is positional, so block 2's
numbering continues from block 1's count — otherwise the two blocks disagree about which guide is
"GUIDE 3".

## What this buys, and what it does not

**Buys:** on a mid-conversation view switch, the tools + instructions + always-on guides entry stays
alive — estimated at the time as roughly 9.9k tokens moving from a 1.25× re-write to a 0.1× read;
**measured 2026-09-09 at 13,305 tokens** (see "What was measured" at the end of this file).

**Does not buy:** the history. Block 2 still precedes the messages in the prefix, so a view switch
still invalidates every message-level entry and the transcript is re-written. **That is the ceiling
on this slice, and it is the entire reason slice G2 exists.** Do not describe this slice as
"a view switch no longer costs anything".

## Consumers

- `chat-panel.tsx` calls `buildStableSystemBlocks` directly and passes the array straight to
  `callClaude`. Takes the change as-is.
- `inline-ai-edit-call.ts` spreads `buildSystemPrompt`'s output and appends its own scope block, so
  2→3 blocks is transparent. It is single-turn with no transcript, so it neither gains nor loses —
  consistent with slice B's per-consumer split, which already says this consumer owes nothing.
- `buildSystemPrompt` stays a thin composition and simply grows by one block.

## Testing

1. **Block 1 is byte-identical across every view.** The property nothing covers today. Sweep the
   real view list, not two hand-picked views — a two-view test passes on any pair that happens to
   share a guide count, which is exactly the defect. ★ Seed the sweep so it spans all three observed
   counts (2, 3 and 4 active guides) or it cannot see the header bug it exists to prevent.
2. **The marker is on block 1 and absent from block 2.**
3. **Total `cache_control` count across tools + system + messages stays ≤ 4**, asserted on the
   assembled request rather than any one layer — the same shape slice B used, for the same reason.
4. **Block 2 carries the view's guide and block 1 does not**, positively asserted on both sides. A
   negative-only assertion passes when a block is dropped entirely.
5. `chat-panel.test.tsx`'s two `expect(body.system).toHaveLength(1)` assertions move to 2. ★ Change
   them deliberately: they are what would otherwise catch an accidental block count change.

## Risks

- **Inert-but-green.** Fixing the split and not the header ships a slice that passes every test
  above except (1) while saving nothing. Test 1 is the gate; do not weaken it to a two-view check.
- **No behaviour change.** Content and order reaching the model are unchanged — same text, same
  `system` role, same sequence. This slice therefore does NOT need the answer-quality eval.
- **Measurement — RESOLVED 2026-09-09.** This risk read "the saving is arithmetic, not observed" and
  called for a live two-arm run (switch view between turns, read `cache_creation_input_tokens` and
  `cache_read_input_tokens`) to confirm it. That run has since happened, using the harness pattern
  slice B established: see "What was measured" at the end of this file, and
  `docs/AGENTS/ai-assistant.md`'s corresponding bullet for the full numbers and their stated bounds.
  The mechanism is confirmed; nothing here evaluates answer quality, and none is owed, since this
  slice never changed what the model is told.

## Follow-up G2 — move the view-scoped block onto the turn tail

Recorded here so the ceiling above has a named successor, and deliberately NOT part of this slice.

Move block 2 to the tail of the current user turn, beside the turn context slice B already
relocated. `system` becomes fully view-invariant, so a view switch invalidates **nothing** and the
history stays cached.

**Break-even.** G2 pays `0.9 × view-guide` every turn (~256 token-equivalents at the ~285-token
median) and saves `1.15 × (view guide + history)` per switch (~11,800 against a 10k-token history).
G2 wins above roughly **one view switch per 46 turns** — in a project-management app, effectively
always.

**Why it is not this slice.** B moves instruction text from a `system` block into a `user` message.
That is the same role change as slice B, carries the same emphasis risk, and therefore ships behind
the answer-quality eval rather than ahead of it. The eval harness and its ceiling are recorded in
`docs/AGENTS/ai-assistant.md`.

## What the roadmap got wrong

`2026-09-08-ai-cost-roadmap-design.md`'s open question 1 frames guide placement as: guides are
view-dependent, so a view switch re-caches everything behind them, therefore consider moving the
guide to the turn tail. The measurement inverts the premise. The dominant guide is **not**
view-dependent — it is unscoped and never changes — so a view switch re-pays for content that was
identical (estimated at the time as ~9.9k tokens; measured 2026-09-09 at 13,305 tokens for the
equivalent block-0 payload). The first move is therefore to stop paying for the part that did not
change (this slice), and only then to decide about the part that did (slice G2).

## Out of scope

- **Trimming the leadership guide** (~9,164 tokens, every turn). The largest single lever on both
  cost and context-window headroom, and the only one that reduces WINDOW usage — a cached token
  still occupies the full window, it just bills at 0.1×. It changes what the model is told, so it
  needs the answer-quality eval as a gate. Its own slice.
- **Gating unused tool families** out of the tools array (estimated at the time as ~12.6k tokens;
  measured 2026-09-09 at 17,796 tokens against the real API) via `toolsFor`'s flags. Same class: a
  real window reduction, and a behaviour change.

## What was measured (2026-09-09)

The "Measurement is owed" risk above has been resolved. A live two-arm run against the real
Anthropic API (`claude-sonnet-5`, `max_tokens: 64`) replayed a canned 4-turn conversation carrying
the real 24 guides from `builtinSeeds` and the real 52-tool array from `toolsFor`, with a view switch
between turns 2 and 3 (`budget` → `raid-report`) — one request per arm per turn, 8 requests total,
reading `cache_read_input_tokens`/`cache_creation_input_tokens` off each response. The OLD arm
reconstructed the pre-split single system block; the NEW arm is this slice's `buildStableSystemBlocks`
+ `buildTurnContext` + `buildWireMessages`.

At the switch (turn 3): cache read rose 17,796 → 31,101 (+13,305), cache write fell 13,836 → 563
(−13,273), billed cost (token-equivalents at fresh-input 1.0×, cache-write 1.25×, cache-read 0.1×,
output 5×) fell 19,632.6 → 4,381.9 (**−77.7%**). Two independently-derived readings agree on the
moved amount: the NEW arm's turn-1 cache write (13,305) and the NEW−OLD cache-read delta at the
switch (31,101 − 17,796 = 13,305) are the same number — that is block 0, and it corrects the
~9.9k-token estimate used throughout this file (the payload is 38,791 chars, a real ratio of 2.92
chars/token, not the ~3.6 assumed above). The `tools` entry alone measured 17,796 tokens (both arms
read exactly that whenever only `tools` survives in cache), correcting the ~12,596/~12.6k estimates
above. Over turns 2–4 (turn 1 excluded — see below), cumulative cost fell 27,295.9 → 13,027.2
(**−52.3%**).

Steady state within one view is NOT free: turn 4 (no switch since turn 3) cost 3,670.5 (OLD) vs
3,688.7 (NEW) — NEW is 0.5% worse, the price of the extra per-request header bytes the two-block
layout adds.

Do not quote a turn-1-inclusive cumulative figure: the NEW arm's turn 1 read the `tools` segment
warm from the OLD arm's prior run in the same measurement session, while OLD's turn 1 paid a cold
write, so turn 1 is not comparable between arms.

Limits, stated with the result: n=1 per arm (no repetition), one model, one canned conversation, one
view pair, and output tokens carry a 5× cost multiplier while varying 30–64 tokens across the eight
requests — the per-turn cache-read/cache-write token counts are the deterministic part; the cost
column inherits that output-token noise. This measured cache behaviour only — nothing here evaluates
answer quality, and this slice never changed what the model is told, so no eval claim is attached.
Reproduce with a script importing `buildStableSystemBlocks`, `buildTurnContext`, `toolsFor` and
`buildWireMessages`, replaying a canned multi-turn conversation across a view switch and reading the
two cache fields off each response; the harness itself is a scratchpad script, not part of this
repo.
