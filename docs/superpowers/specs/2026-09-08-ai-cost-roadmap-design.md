# AI cost roadmap — cache layout · opt-in cost controls · prompt-quality harness (B · C · H)

Date: 2026-09-08
Status: **B specced and approved, unimplemented. C and H outlined only.**
Baseline: 0.293.1 "Vandermeer", `main` @ `3a690305`

> B's full design is `2026-09-08-ai-prompt-cache-layout-design.md`. This file owns the
> ORDER, the dependencies between the three, and the interactions that only appear when
> you look at them together. It does not restate B.

## Problem

An external analysis put the assistant's Anthropic spend at $18.14 for the month against
9,421,569 input and 111,505 output tokens — 94% of cost on the input side. Its three
recommended levers were: keep the system prompt stable for caching, use `list_tasks`'s
`limit`, and don't bother shortening answers. Two are already shipped here and the third
asks for no work; its claim that `list_tasks` returns every field for every task is false
against this tree (`slimTaskForList`).

The levers that remain are ones it could not see without the code:

1. the request layout makes the message transcript structurally uncacheable (**B**);
2. the usage meter cannot see cached tokens, so nothing can be priced (**B**);
3. no cost control is exposed to the user (**C**);
4. nothing can prove a prompt change did not make answers worse (**H**).

## Order, and what each slice is waiting on

| | Slice | Blocked by | Why this position |
|---|---|---|---|
| **B** | Cache layout + honest meter | — | Nothing downstream can be measured or priced until the meter counts cache reads and writes. It is also the only slice that saves money without asking the user for anything. |
| **C** | Opt-in cost controls | B's meter | Every control in C is a trade the user has to price. Shipping the settings first means shipping numbers we cannot compute. |
| **H** | Prompt-quality harness | — technically; C in practice | Turns B's owed manual eval into a gate, and is what makes C's defaults safe to tune. |

**The ordering has a real cost and it should be stated rather than discovered.** H is
sequenced last by choice, so B's relocation ships behind a manual eval and C's defaults
ship without a regression gate either. The mitigation is B's own fallback (keep
`buildViewScopeBlock` in `system`, take the smaller win) and C's controls being opt-in and
off by default. If the manual eval in B goes badly, the correct response is to promote H
ahead of C, not to push through.

---

## B — cache layout + honest meter (specced)

See `2026-09-08-ai-prompt-cache-layout-design.md`. One line: move the volatile block off
`system` and onto the current user turn so the transcript sits inside the cached prefix,
and carry `cache_creation_input_tokens` / `cache_read_input_tokens` through the meter that
drives the session and weekly caps.

**What B must hand to C:** a per-send record of uncached input, cache reads, cache writes
and output, bucketed by day. C's settings are unpriceable without it.

**Two open questions B deliberately leaves to measurement**, both of which land in C's lap:

1. **Guide placement.** `stableText` holds the operating guides and is view-dependent
   (22 of 23 built-in feature guides are view-scoped), so a mid-conversation view switch
   still re-caches everything behind it. Whether to move the guide onto the turn tail
   depends on how often real users switch view mid-conversation, which B's meter measures.
2. **`tokenMultiplier` vs per-field billing weights.** A uniform 5× margin and a real
   per-field weighting cover overlapping ground. B keeps the multiplier's semantics exactly
   and uses weights for display only.

---

## C — opt-in cost controls (outline)

A Settings → AI cost section, every control **off by default**, each showing what it costs
and what it saves in the units B's meter produces.

### C1 — history budget

Cap the transcript at N tokens; drop or summarise the oldest turns beyond it.

**★★★ THE OBVIOUS IMPLEMENTATION UNDOES B ENTIRELY.** A cache hit requires the prefix to
be byte-identical from the start. Trimming the *head* of the history changes the first
message, so a per-turn rolling trim invalidates the whole cached prefix on **every single
send** — converting B's win into a permanent cache-write bill, which is billed at 1.25×
and is therefore *worse than not having built B at all*.

The trim must therefore be **coarse and hysteretic**: let the transcript grow to a high-water
mark, drop a large block once (say half), then let it grow again — so re-caching is paid a few
times per conversation instead of every turn. The saving is the smaller transcript; the cost
is one cache write per trim event. This is the single most important thing on this roadmap
and it is not visible from inside C.

### C2 — default row cap on the list tools

`limit` already exists on three list tools and the envelope already reports `total` before
the limit, so the honest-count property is free. C2 sets a *default* where today an absent
`limit` means "no limit".

**Interaction with B:** none on the prefix — tool results land in the fresh tail and are
cached on the next send like everything else. The trade is purely answer quality on
large projects, and `total` means the model can always tell it was truncated.

### C3 — cheaper model for simple turns

**★★ Prompt caches are per-model.** Switching model mid-conversation invalidates every
entry and pays a full cache write on the next send. So per-turn routing is not viable
alongside B; the only coherent forms are per-conversation choice, or routing to a
model whose *whole* conversation is separate. Treat "route this turn to Haiku" as
refuted by B unless the measurement says the transcript is small enough not to matter.

### C4 — guide placement (from B's open question 1)

Decide with a week of B's meter data: compare cache-write volume against view-switch
frequency. If switches are common, move the guide to the turn tail; if rare, leave it.

---

## H — prompt-quality harness (outline)

**What it is for:** B relocates instruction-bearing content from `system` to the user turn.
That is lossless in bytes and not in emphasis. Nothing in this repo can currently detect
the resulting regression, which is why B carries a manual eval and a fallback.

**Shape.** A fixed prompt set against a seeded workspace, exercising each moved block —
a date-relative question, a view-scoped question, an insight-referencing question, an
activity-recall question, a thread-recall question — with recorded answers.

**The hard part is the assertion, not the runner.** The model is not deterministic, so
prose diffing produces noise. Assert on what is checkable instead: which tools were called
and with what arguments, whether the answer names the right entity ids, whether it
respected the current view. Reserve prose judgement for a human reading a recorded diff.

**★ It cannot be a per-MR gate, and pretending otherwise would be the joke this roadmap
writes itself.** Every run costs real tokens against a real key. It belongs on the weekly
`schedule` pipeline beside `unit-tests-shuffled-random`, or as a local command run
deliberately before a prompt change — not on every push.

**★★ It needs a key CI does not have.** No Anthropic key is available to the pipeline
today, and adding one is its own decision with its own blast radius. Until that is
settled, H is a local command plus a recorded artifact, which is still strictly more than
the nothing that exists now.

---

## What would make this roadmap wrong

- **If B's meter shows the transcript is a small share of input.** Then C1 is not worth its
  complexity and the guide question (C4) becomes the main lever instead. Re-read the order
  before starting C.
- **If B's manual eval regresses.** Promote H ahead of C.
- **If the spend stops mattering.** $18.14/month is not a crisis; this roadmap is worth
  running because the meter is *wrong* and the caps built on it are *weaker than
  advertised*, which is a defect regardless of the bill. B is justified on correctness
  alone. C and H are justified only by the numbers B produces.
