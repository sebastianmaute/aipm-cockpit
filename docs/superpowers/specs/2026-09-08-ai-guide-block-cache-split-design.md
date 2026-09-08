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
of them out of the cache — including the ~9.9k tokens of them that did not change.

Measured 2026-09-08 against this tree (`builtinSeeds()`, `selectActiveGuides`, `assembleGuideBlock`,
`toolsFor({})`; ~3.6 chars/token):

| payload | tokens | scoped? |
|---|---|---|
| Project Leadership Operating Guide | ~9,164 | `scope: {}` — **never** view-scoped |
| App overview | ~778 | never view-scoped |
| the current view's feature guide | ~65–1,140 | one at a time |
| tools array (52 tools) | ~12,596 | always sent |

So a request carries roughly **23k tokens of fixed prefix**, of which the guide block is
~10.3k–11.2k on every view (3 active guides on 30 of 34 views; 2 on `projects`/`help`; 4 on
`raid-report`/`change-report`).

### The defect, and it is one line

`assembleGuideBlock` opens with `You have N operating guides, in priority order.` — **N varies by
view.** Because the prompt cache matches a byte-identical prefix from the start, that digit sits
ahead of everything and invalidates all of it.

**Measured: the longest common prefix of the assembled guide block across the 34 nav-reachable
views is 9 characters** (`"You have "`). (`AppView` has 35 members; `learning-insights` is
deep-link-only and unreachable from the nav tree, so it was not probed — including it could not
have raised the figure, since a common prefix only shrinks as strings are added.) The ~9.9k tokens
of always-on guide text below it are byte-identical on every view and are re-written at 1.25×
anyway, on every switch, because of the count.

★★★ This is why the split alone is not the fix. Partitioning the array while leaving one shared
counted header in front leaves block 1 differing per view over a single digit, and buys **nothing**.
Anyone implementing this must fix the header or the slice is inert while looking complete.

★★ It is also why the existing docs undersell the cost. `BUILTIN_FEATURE_GUIDES` really is 22-of-23
view-scoped, and that figure is quoted correctly in several places — but `builtinSeeds()` returns
**24** guides: the leadership guide is added separately, is unscoped, and alone outweighs the entire
feature-guide corpus roughly 3:1. View scoping therefore saves far less than the 22-of-23 ratio
suggests. Reproduce:
`npx vite-node` a script importing `builtinSeeds` and summing `content.length` grouped on
`scope.views == null`.

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

Block 2 is still cached, by the message-level breakpoints whose prefix contains it. It simply has no
read point of its own.

### The header, restated as a requirement

Each block gets its own header, and block 1's count is derived from the always-on set ALONE, so it
cannot move when the view changes. Guide numbering (`=== GUIDE n …`) is positional, so block 2's
numbering continues from block 1's count — otherwise the two blocks disagree about which guide is
"GUIDE 3".

## What this buys, and what it does not

**Buys:** on a mid-conversation view switch, the tools + instructions + always-on guides entry stays
alive — roughly **9.9k tokens move from a 1.25× re-write to a 0.1× read**.

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
- **Measurement is owed.** The saving is arithmetic, not observed. A live two-arm run (switch view
  between turns, read `cache_creation_input_tokens` and `cache_read_input_tokens`) is what confirms
  it. Record it as owed until run — the harness pattern from slice B applies.

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
view-dependent — it is unscoped and never changes — so a view switch re-pays for ~9.9k tokens of
content that was identical. The first move is therefore to stop paying for the part that did not
change (this slice), and only then to decide about the part that did (slice G2).

## Out of scope

- **Trimming the leadership guide** (~9,164 tokens, every turn). The largest single lever on both
  cost and context-window headroom, and the only one that reduces WINDOW usage — a cached token
  still occupies the full window, it just bills at 0.1×. It changes what the model is told, so it
  needs the answer-quality eval as a gate. Its own slice.
- **Gating unused tool families** out of the ~12.6k-token tools array via `toolsFor`'s flags. Same
  class: a real window reduction, and a behaviour change.
