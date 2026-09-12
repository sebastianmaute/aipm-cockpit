# AI cost and prompt caching

How the prompt is laid out so the cacheable prefix stays stable, what that
layout bought and what it cost, and the harness that measures prompt quality.

This file owns the subject. `README.md` links here rather than summarising it.

This is a bring-your-own-key app — every assistant turn is billed to your own Anthropic account — so what the app sends, and how often it re-sends it, is a first-order design concern rather than an implementation detail.

The dominant cost is not your question. It is the fixed prefix in front of it: the tool definitions the assistant needs to read and write your register, plus the operating-guide text that grounds its answers. Measured on `claude-sonnet-5`, that prefix is 31,101 tokens before you have typed anything.

| Part of the fixed prefix | Tokens |
|---|---|
| Tool definitions | 17,796 |
| System block 0 — fixed instructions plus the always-on guides | 13,305 |
| **Total** | **31,101** |

Sent naively, you pay for all of that on every single turn. The app instead lays the request out so the provider serves the prefix from its prompt cache:

| Token class | Price, relative to base input |
|---|---|
| Input (uncached) | 1 |
| Cache write | 1.25 |
| **Cache read** | **0.1** |
| Output | 5 |

That 0.1 is the whole point. A cached prefix is not skipped — it is still read, and still billed — but at a tenth of a fresh input token, which turns the largest term in a turn into something close to a rounding error. Writing the cache costs 1.25, so the arrangement pays for itself on the second turn. These ratios hold across the model tiers the app supports, and they are also what the advisory usage caps weight by (see the AI assistant row in [docs/features.md](features.md)).

## How the layout works

A cache hit needs a byte-identical prefix, and the provider matches it in a fixed order: tools, then system, then messages. Anything that varies per turn must therefore sit *after* everything you want cached — one per-turn value placed early makes the entire transcript uncacheable. So the prompt is split along that seam:

- `buildStableSystemBlocks` (`chat-api.ts`) returns the cacheable half of the system prompt. Block 0 — the fixed instructions plus the always-on leadership guide and app overview — is byte-identical whichever view you are in, and carries the cache marker. Block 1 is the current view's feature guide, present only when non-empty.
- `buildTurnContext` returns the volatile suffix — the current mode, view, groups and labels — as a plain string, rebuilt every turn.
- `buildWireMessages` (`chat-cache-layout.ts`) injects that turn context into the *outgoing copy* of the message array only. It is never persisted: storing it would rewrite the tail of the saved history on every send and break the byte-identical prefix the cache depends on.
- `toolsFor` returns one cached tool array per tool-flag combination, and `withCacheBreakpoint` marks only the last definition, so the tool block caches as a unit.

A request may carry four cache breakpoints, and this layout spends up to four: one on the tools, one on system block 0, and up to two in the messages — a moving boundary that follows the conversation, plus a fixed power-of-two anchor so a long conversation does not lose the cache to the provider's lookback window. The two land on the same message whenever the cached prefix length is itself a power of two, and are deduplicated into one there — so a request in that state spends three.

## What it bought, and what it cost

- **0.295.0 "Borges"** — the chat transcript is sent as a stable cacheable prefix instead of being rebuilt each turn, and the usage meter was corrected to count every billed token class rather than only input and output.
- **0.296.0 "McHugh"** — the always-on guides moved into their own cached block, so switching view mid-conversation no longer re-sends that text. Measured live: a view-switching conversation cost about **52% less** over the measured turns and **78% less** on the switch itself, while a conversation that never switches view cost about **0.5% more**. The extra block boundary is not free and the never-switching case pays for it; the trade was taken deliberately — half the cost on a realistic conversation, against a fraction of a percent on the ideal one.
- **0.298.0 "Malzberg"** — usage caps weight token classes by the real billing ratios above instead of counting every token equally.

## Prompt-quality harness

The remaining cost ideas all work by removing prompt text or relocating it, and every one of them risks the model quietly no longer reading something. Cheaper output that is also worse is not a saving. Until now the only evidence was a single hand-run evaluation that scored full marks on every probe — it had no headroom, and could only ever have caught a catastrophic regression.

The harness is a developer guard on future cost work, not something users interact with. It plants a unique nonsense token in one prompt block and a decoy in a different block, then asks the model to return the target, exactly as written; a hit is evidence that the block was actually read, and returning the decoy is a miss rather than an alternative answer. It runs interleaved arms — the current layout, a candidate layout, a negative control, and two drift references — so a score move can be attributed to the change rather than to the model shifting underneath the measurement. The candidate arm is at present a deliberate alias of the current layout: until a gated slice registers a real variant there is no second layout to compare against.

A full run is **65 requests** — that figure is measured. The cost, on the order of **$2** against a mostly-cached prefix, is modelled rather than measured: the app deliberately ships no price table, so nothing in this repo turns a run's token counts into a currency amount. A dry run is the default and spends nothing; spending requires an explicit opt-in, and the harness refuses to spend when it detects a CI environment. It exits **0** on pass, **1** on a real regression, and **2** when it could not do its job — the 1/2 split is deliberate, because a broken measurement must never be reported as a failure of the thing being measured, and a run that measured nothing must never report success.

**Status:** the harness has been run against the live API and carries a recorded baseline in `docs/baselines/ai-eval-runs.json` — read that artifact rather than this sentence, which cannot keep up with it. Any pass it records is an A/A self-test of the machinery and not evidence about a candidate layout, because the candidate arm is still an alias of the current one — it shows the harness measures what it claims to, not that any relocation is safe.
