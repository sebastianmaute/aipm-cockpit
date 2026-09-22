# AI cost basis + task-list narrowing — design

Date: 2026-09-09
Status: **Specced, unimplemented.**
Baseline: 0.296.0 "McHugh", `main` @ `e7d74eb8`

> ★ **Deliberately carries no roadmap letter.** It sits inside **C** in
> `2026-09-08-ai-cost-roadmap-design.md` but is none of C's three numbered items, and an
> earlier draft titled it "slice C1" — which collides head-on with that roadmap's C1
> (history budget), a slice this one explicitly declines to build. Refer to it by name.
>
> That roadmap's C is three independent subsystems (C1 history budget, C2 row caps, C3 model
> routing); this slice takes none of them. It takes the **cap basis** — which the roadmap
> filed under C's preamble rather than as a numbered item — plus a payload narrowing that
> was not on the roadmap at all, because the defect it fixes had not been found.
>
> Two roadmap claims are refuted below and corrected in place: C2's premise about which
> tools carry a `limit`, and C1's economics after slice B.

## Problem

Three separate things, found by measuring rather than by reading the roadmap.

### 1. The caps stopped meaning anything when B landed

Slice B widened the usage meter to count `cache_creation_input_tokens` and
`cache_read_input_tokens`. Those counts go into the same buckets, at the same weight, as
fresh input — against caps that were calibrated when only `input` and `output` were counted.

Measured, using the live 8-request run recorded in `docs/AGENTS/ai-assistant.md`
(2026-09-09, `claude-sonnet-5`, real 24 guides, real 52 tools):

| | counted tokens | x the default `tokenMultiplier` of 5 | vs the 200,000 session cap |
|---|---|---|---|
| pre-B warm turn (`input` + `output` only) | 434 | 2,170 | ~92 turns |
| post-B warm turn (all four fields) | 32,486 | 162,430 | **80% notice on turn 1, 100% on turn 2** |

Same conversation, same spend, ~75x apart. The session bar then sits pinned at 100% for the
rest of the session, and both threshold toasts fire in the first two messages of every one.

★ **Bound the severity honestly: the caps are advisory.** `crossed80` / `crossed100` drive a
toast and two bars and nothing else — no send is blocked anywhere. This degrades a signal;
it does not stop work.

★★ **This was not an oversight, and the slice must not be written as if it were.**
`ai-usage-context.tsx` states the decision explicitly — `tokenMultiplier` is "a blunt safety
margin over counted tokens, not a per-field billing weight, so scaling the cache fields
differently would silently re-base a cap the user configured under the old
(input+output-only) meaning" — and B shipped `AI_CAP_BASIS_NOTICE_KEY`, a one-time toast, as
the mitigation. What is being re-opened is a documented trade, not a bug.

★★ **And it is B's doing, not G's.** An earlier reading of this attributed the saturation to
the guide-block cache split (0.296.0), on the grounds that G raised the cache-read share.
G left the basis untouched; B is the change that put cache tokens on the scale at all. The
mis-attribution mattered because it would have pointed the fix at the wrong slice's
assumptions.

### 2. The distortion is not a constant, so the cap cannot even rank conversations

Cost-equivalent for the same two turns, weighting each field by its billing multiplier:

| | counted | cost-equivalent | ratio |
|---|---|---|---|
| cold first turn | 32,444 | 20,010 | 1.6x |
| warm turn | 32,486 | 3,689 | 8.8x |

A counted-token cap therefore over-counts by somewhere between 1.6x and 8.8x depending on
cache warmth, which is not a property the user controls or can see. Two conversations with
the same real cost consume very different fractions of the cap.

### 3. `list_tasks` ships an audit trail the guides forbid the model to use

`lib/app-feature-guide.md` denies the note-reading capability **four times**, twice
emphatically:

> "You have no tool that can read or write a note — if the user asks about notes, say so and
> point them at the window rather than guessing from the description."

> "It CANNOT read or write the note log: there is no tool for notes, so never answer a
> question about a task's notes from its description."

Meanwhile `slimTaskForList` returns `noteLog` on every `list_tasks` call, and `get_task`
returns the raw `Task` including `noteLog` with its HTML. The `list_tasks` tool description
says so out loud — "each `noteLog` entry projected to PLAIN TEXT". **One prompt contains
both the claim and its refutation.**

★ Checked, not assumed: `RaidSummary` and the change summary carry no `noteLog`, and
`withRowTokens`'s full-row getter feeds token derivation rather than the model. So the
denial is **true for RAID and changes, false for tasks on both paths**. Of the four bullets:
two (RAID, Changes) are wholly true, one (Open Points) is wholly false, and one (Overview)
denies all three registers in a single sentence and is therefore true in part — see Part 3
for why that last one cannot be corrected as a single claim.

**What it costs.** Measured over `sample-workspace-huge.json` (140 tasks), summing each
field's serialized length at 2.92 chars/token:

| field | tokens | share |
|---|---|---|
| `noteLog` | 15,719 | **37.8%** |
| `description` | 2,983 | 7.2% |
| everything else | 22,858 | 55% |
| **total** | **41,560** | |

★★ **These are UPPER BOUNDS and the plan must re-measure.** They are stored-row JSON, and
the projection strips markup from exactly the two largest fields before the model sees them.
The absolute saving is smaller than 15,719; what the figures establish is the ordering —
notes are the single biggest field, by a factor of five over the next one.

For scale: the whole fixed prefix is 31,100 tokens (tools 17,796 + block 0 13,305). One
unbounded `list_tasks` on a 140-task project is **larger than the entire cached prefix**, and
a tool result is fresh input at 1.0x on the turn it arrives — roughly **11.5 warm turns of
cost in one call**.

## What this slice does

### Part 1 — cost-equivalent cap basis

The weights are ratios against base input price, and Anthropic holds those ratios across
models (Sonnet $3/$15, Haiku $1/$5, Opus $15/$75 — all 1:5; cache write 1.25x, cache read
0.1x everywhere). So:

| field | weight |
|---|---|
| `input` | 1.0 |
| `cacheWrite` | 1.25 |
| `cacheRead` | 0.1 |
| `output` | 5.0 |

**No price table, no per-model branch, nothing that drifts when a rate changes.** That was
the roadmap's whole maintenance objection to pricing the caps in currency, and it does not
apply to a ratio basis.

**Store raw, weight at read.** `record()` today multiplies all four fields by
`tokenMultiplier` *before* writing them to the buckets, which is exactly why B's re-basing is
permanent: the stored history cannot be re-interpreted, because the multiplier in force at
write time was never recorded beside it. After this slice the buckets hold raw API counts and
the weighting is applied at comparison time, in `weekToDate` and in the session accumulator.
If the weights ever change, stored history stays readable.

**`usageTotal` is deleted, not re-bodied.** A reader seeing that name expects a sum of its
fields, and leaving it callable lets the raw sum back into a cap comparison by accident.
`usageCostEquivalent(u)` replaces it at both call sites. Deleting the name is what makes the
mistake unavailable rather than merely discouraged.

**`tokenMultiplier` is retired.** Its stated job is a blunt safety margin over counted
tokens — a fudge that existed *because* counted tokens were not cost. On an honest basis a
5x margin makes the number dishonest again in the other direction, and a user who wants
headroom expresses that directly by lowering the cap. Removed: the `AiConfig` field, the
`DEFAULT_TOKEN_MULTIPLIER` constant, the `CapInput` row in `ai-section.tsx`, and the
`aiTokenMultiplier` / `aiTokenMultiplierHint` strings in both dictionaries.

★★★ `sanitizeAiConfig` must **ignore** a stored `tokenMultiplier`, never reject the settings
blob over it. Every existing device has one persisted — `DEFAULT_AI_CONFIG` carries it, and
`writeSettings` writes the whole object — so a strict reader would refuse every real settings
blob in existence.

**Why the existing default caps do not need rescaling.** At weight-1 accounting:

| | cost-equivalent | vs the 200,000 session cap |
|---|---|---|
| warm turn | 3,689 | 54 turns |
| cold first turn | 20,010 | 10 turns |

Pre-B the same cap allowed ~92 turns, so the unit change and the multiplier retirement
roughly cancel and the caps land back in their original design range without being touched.
★ The harness ran `max_tokens: 64`; a realistic 800-token answer adds ~4,000 cost-equivalent
and cuts a warm turn's allowance to roughly 26 per session. Directionally right, not a
promise — the plan re-measures against a real answer length before the defaults are declared
sound.

**A display defect falls out of this.** `ai-usage-panel.tsx` reads "Uncached input", "Cache
read" and "Cache write" from `sessionUsage`, which today holds the **multiplied** values —
so all three are rendered at 5x while labelled as token counts. Storing raw fixes them
without any change to the panel's own code. ★ The cache hit-rate percentage is a ratio over
three commonly-scaled figures and was always correct.

**Panel additions.** An `output` row (5.0 is the heaviest weight and is currently the one
class not displayed at all) and the cost-equivalent figure the bars are actually measuring,
so the bar and the breakdown beneath it are not in different units. Bars keep the existing
`ProgressTrack` primitive — nothing is hand-rolled.

### Part 2 — narrow the task list

`slimTaskForList` drops `noteLog`. `TaskListItem` becomes
`Omit<Task, "description" | "noteLog"> & { description: string }`.

`NoteLogListEntry` and `slimNoteEntry` lose their last consumer and are deleted. `npm run
lint` runs at `--max-warnings=0`, so a stranded export is fatal rather than untidy.

`get_task` keeps `noteLog` with its HTML, unchanged. The capability survives at roughly 112
tokens per task on demand instead of 15,719 in bulk.

★ This is deliberately **not** a row cap. Hiding rows is the one change that can make an
answer wrong rather than merely terser; narrowing a row cannot, because everything removed
stays fetchable by id. See "Explicitly out of scope" for why C2 is a separate slice and why
its roadmap premise is wrong.

### Part 3 — the read/write constraint, anchored nearest-first

The model can read task notes and cannot write them. That asymmetry invites it to offer an
edit it cannot make, so the constraint is stated where the decision is taken, not only in
prose thousands of tokens away.

1. **`get_task`'s tool description** gains a clause: a task's `noteLog` is read-only, and no
   tool can add or change a note. This lives in the tools array — the block the model reads
   while choosing what to call.
2. **`list_tasks`'s tool description** loses its now-false `noteLog` clause.
3. **`lib/app-feature-guide.md`** — of the four denials, the two under the RAID and Changes
   headings are **true today and stay verbatim**. The one under Open Points is task-only and
   is corrected outright: task notes are readable one task at a time via `get_task` and are
   not writable.
   ★★ **The fourth is the trap.** The Overview bullet denies note access for "tasks, RAID
   items and changes" in a single sentence, so it is *partly* true and cannot be either kept
   or deleted — it has to be split, granting the read for tasks while keeping the denial for
   the other two registers. A correction that treats it as one claim will make it wrong in
   the opposite direction.
   Regenerated through `scripts/gen-operating-guide.mjs`;
   `operating-guide-builtin.generated.ts` is never hand-edited.
4. **`note-log-panel.tsx`** carries a user-facing line: the assistant can read these notes and
   cannot change them. Disclosure lands where someone is already looking at the notes in
   question, rather than in a settings page they may never open.

★★ **A refusing `add_task_note` tool was considered and rejected.** It would convert a
promised-but-absent edit into a visible tool call plus a `reportCapabilityGap` toast and a
`logDiag` entry, which is the repo's existing pattern for a capability no-op. It is rejected
because a model that sees `add_task_note` in the tool list is *more* likely to promise a note
edit, not less — it would routinise the failure it exists to catch, and pay tool-description
tokens on every request to do so. Reconsider only if the diagnostic trail is wanted for its
own sake.

★ Changing any tool description invalidates the tools block, and changing the guide
invalidates block 0. Both are **one-time** re-caches on the next send per device, not a
recurring cost.

## Migration

A one-time notice reusing `AI_CAP_BASIS_NOTICE_KEY`'s shape under a **new** key — the same
mechanism, a second event. A device that never saw the first notice must not be told about a
"before" it never experienced, which is exactly the case the existing fresh-install seeding
branch handles and which the new key must handle the same way.

★★★ **Buckets written before this slice hold multiplied values and cannot be un-multiplied.**
The multiplier in force at write time was never recorded beside the numbers, and it is
user-configurable, so there is no factor to divide by. They inflate the current week's
reading until the week rolls over on Monday — at most six days. Since the caps are advisory,
the worst outcome is a toast that fires early. This is disclosed in the notice rather than
papered over; the alternative is deleting the user's usage history, which is a worse answer
to a six-day cosmetic problem.

## Testing

- **Weighting arithmetic** against the four measured turns, covering both ends of the
  cold/warm spread — a single fixture would pass under several wrong weightings.
- **A stored `tokenMultiplier` is ignored, not rejected**, and a bucket written before the
  cache-token widening still normalises to zeros rather than `NaN`. The `NaN` path is the one
  that makes `crossed80` and `crossed100` permanently false, i.e. silently disables the cap —
  the existing landmine this slice must not reopen.
- **`slimTaskForList` output has no `noteLog` key.** This is the test that pins the saving;
  without it the field drifts back in on the next widening of `TaskListItem` and nothing
  reports it.
- **`chat-tools.test.ts`** — the existing assertion that a list item *carries* a projected
  note inverts to asserting its absence. The `get_task`-keeps-the-HTML assertion is unchanged
  and becomes the pin for the surviving path; both are needed, because a test proving only
  that notes are gone from the list would still pass if `get_task` lost them too.
- **Panel renders raw counts**, not multiplied ones — the display defect above, pinned so it
  cannot return with the next accumulator change.

## Explicitly out of scope

- **C2 row caps.** ★★ The roadmap says "`limit` already exists on three list tools ... so the
  honest-count property is free". Measured against this tree, **only `list_tasks` has a
  `limit` or an envelope**; `list_raid`, `list_changes`, `list_milestones`,
  `list_stakeholders` and `list_resources` declare an empty `input_schema` properties object
  and return the whole array bare. The other two tools the roadmap is counting are *search*
  tools, which already carry their own defaults via `resolveLimit`. Capping the list tools
  therefore means first giving five of them an envelope and a `total` — a real slice, not a
  default plus a settings row. Part 2 removes most of its urgency.
- **C1 history budget.** Its economics inverted when B landed: a cached history is billed at
  0.1x, so a trim saves tenth-price tokens while each trim event pays a 1.25x rewrite of
  everything behind the cut. Modelled against the real 31,100-token fixed prefix, payback
  takes ~47 turns at a 20,000-token history, ~26 at 50,000 and ~19 at 100,000 — and only if
  the conversation continues that long *after* the cut. Recorded in `docs/open-followups.md`
  as the argument for not building it yet. ★ The one case that still favours it is bursty
  use, where the 5-minute cache TTL expires the prefix anyway and a smaller history is
  genuinely cheaper — a different feature with a different control.
- **Note writing.** No tool, no path, no plan for one. `docs/open-followups.md` §49 records
  that the sanitizers drop `noteLog` because they are DOM-free, so this is real work rather
  than a missing wire.

## German

`i18n.de.ts` is patched by script with CRLF anchors and real umlauts, never with the Edit or
Write tool. The 0.295.0 cap-basis string is still agent-translated and owed a native review;
it is folded into this slice rather than left to accumulate, since this slice touches the
same section of the dictionary.

## What would make this design wrong

- **If Anthropic's per-model price ratios stop being uniform.** The whole no-price-table
  argument rests on 1:5 output, 1.25x write and 0.1x read holding across models. A model
  whose output is 3x input would need the weights to become model-aware, at which point
  pricing the caps in currency is the better answer after all.
- **If the projection measurement comes back much smaller than 15,719.** The ordering would
  survive but the slice's headline would not, and Part 2 would then be worth doing on the
  guide-contradiction argument alone rather than on the saving.
- **If a real answer-length measurement puts a warm turn far above 3,689.** The default caps
  would then need rescaling after all, which this design explicitly declines to do.
