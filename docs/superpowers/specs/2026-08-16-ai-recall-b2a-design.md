# AI Recall — B2a: history search + ambient outcomes — Design

**Status:** Approved for planning
**Date:** 2026-08-16
**Base:** `main` at 0.240.0 "Elliott"

**Sub-project B2a of three.** The AI-recall arc's sub-project B was decomposed during this
brainstorm into B2a (this document), B2b and B2c — see "Decomposition" below. B1 (chat thread
persistence) and the activity-log promotion both shipped in 0.239.0 "Rusch", so all the data this
slice reads already exists per-project.

## Problem

The assistant can read the project's **current state** through 38 existing tools — `list_tasks`,
`list_raid`, `list_changes`, `list_milestones`, `list_stakeholders` and the rest. It cannot read the
project's **history**. It cannot answer "what changed last week", "who moved that milestone", "what
did the budget line say before", or "did the action we took actually work".

Three data sources now hold that history per-project, and none of them reaches the model. **Two are
in scope here**; the third moved to B2c for the reason recorded below.

- **`activityLog`** — the audit trail, promoted to workspace data in 0.239.0. Available on all six
  write paths, so every storage backend has it. **In scope.**
- **Insight outcomes** — `resolved`/`acted` insights carrying
  `outcome: {direction, baseline, current, delta, measuredAt}`. Workspace data, all backends.
  **In scope.**
- **Chat threads** — past conversations, persisted in 0.239.0. Turso-only by construction.
  **Deferred to B2c.**

The second is the sharpest gap. `buildInsightsPromptBlock` already runs on every turn and already
feeds insights into the prompt — but it filters to `active`/`acknowledged` only. The model therefore
sees every open problem and has **never once** seen that an action was taken and improved or worsened
the metric. That is not a missing subsystem; it is an excluded filter branch.

## Decomposition

"Recall" as originally framed covered three distinct mechanisms. They are separate slices:

| Piece | Mechanism | Storage reach | Cost shape |
|---|---|---|---|
| **B2a** (this doc) | `search_history` tool over `activityLog` + ambient outcomes | All backends | Pay-per-use, plus ~5 ambient lines |
| **B2b** | Ambient recent-activity recap in the prompt | All backends | Every turn, every conversation |
| **B2c** | Chat-thread search + cross-thread continuity | Turso-only | New durable write path + staleness policy |

B2a is first because it delivers a complete user-visible capability alone, works in every storage
mode, and builds the renderer B2b consumes. B2c is deliberately last: it is the only piece that needs
the model to *write* something durable, which brings a new write path, an invalidation rule and a
cost-per-summary decision with it.

### ★★ Chat-thread search moved to B2c — a design correction, measured

The first draft of this document put chat threads in B2a, with a `coverage` field disclaiming their
absence in file mode. **That is not implementable as described**, and the correction is worth
recording because the original claim was confident and wrong.

`useChatDispatcher` is called in `task-manager.tsx`; `useChatThreads` is called in `chat-panel.tsx`,
which *receives* the dispatcher as a prop. Data flows down that chain
(`task-manager` → `workspace-section` → `ChatPanel`), so threads sit **below** the point where the
snapshot is assembled and cannot be mirrored into it. Lifting them, or passing a mutable ref back
down, means touching all three files in the chain — and every one of them is baselined at exactly
its cap.

Deferring chat search to B2c costs one source and buys three things: the `coverage` split
disappears (with one all-backends source there is nothing to disclaim), no baselined file is touched,
and the rewiring lands in the slice that is already restructuring thread state for summaries.

## Non-goals

- Any ambient recap of raw activity (B2b).
- **Searching past chat threads, and the coverage disclaimer that needs (B2c)** — see the
  decomposition correction above.
- Ranking, fuzzy matching, or embeddings over any source. Substring only.
- Any new UI. This slice ships no component and no i18n key.
- Changing what the existing 38 tools do.

## Architecture

Two new modules plus one thin tool registration: `activity-prompt.ts` is a **render layer** (may
import `t`), `history-search.ts` is a **pure engine** (may not). That split is the whole reason the
i18n-free rule survives this design. Nothing async is added to the tool despite `runTool` being
async — every source is already in memory by the time the tool runs.

### `activity-prompt.ts` — the activity renderer

A **render layer**, not an engine — the same classification `insight-text.ts` carries, and for the
same reason: it may import `t`. English-only regardless of UI language, deterministic (no clock).

```ts
const key = activityMessageKey(entry.kind);
const summary = key
  ? t("en-US", key, ...entry.args)
  : t("en-US", "activityUnknownKind", entry.kind);
```

**★★ This replaces a hand-written 55-template map, and the reason is worth recording.** The first
draft specified an exhaustive `Record<ActivityKind, string>` of English templates, on the grounds
that a pure module must stay i18n-free. That would have meant transcribing 55 argument contracts by
hand — `ActivityEntry.args` is positional `(string | number)[]` with no per-kind schema, so what
`args[0]` means is defined *only* by the i18n string it feeds. A misread there produces a
grammatical, confident, **false** line the model asserts as fact and no gate can detect. It was the
slice's dominant risk.

Rendering through `t("en-US", …)` removes that risk rather than mitigating it: nothing is
transcribed, so nothing can be mistranscribed. `ACTIVITY_KIND_TO_KEY` is already exhaustive over
`ActivityKind`, so a 56th kind is still a typecheck error at the map, and its English line appears
with no work here. `t`'s signature — `(lang, key, ...args: (string | number)[])` — matches
`ActivityEntry.args` exactly, so the spread needs no adaptation. The EN dictionary is static (only DE
is lazily loaded), so no `loadI18n` call is required.

`AGENTS.md`'s "keep engines i18n-free" rule is preserved: `history-search.ts` remains a pure engine
and receives already-rendered lines. Only this render layer touches `t`.

The accepted cost is that rewording a UI string also rewords what the model sees. That is a feature
more than a defect — the two can no longer disagree about what an event means.

**Two behaviours the insights precedent does not cover:**

*Field diffs.* `ActivityEntry.changes` renders as a compact suffix — `(status: To Do → Done)` —
bounded by `MAX_FIELD_CHANGES` (12), exported from `activity-log.ts` during the Rusch slice.

*Unknown kinds must survive.* `sanitizeActivityEntry` deliberately **keeps** an unrecognised string
`kind`, so an older client cannot delete entries a newer release wrote. The renderer must go through
`activityMessageKey`, which already carries the required `hasOwnProperty` check and returns `null`
for an unknown kind — **never** a bare `ACTIVITY_KIND_TO_KEY[kind]` index, which resolves
`kind: "toString"` to a `Function.prototype` method, after which `t()` throws on
`undefined.replace` and crashes the app through the top-level `ErrorBoundary`. That exact bug is
documented in `AGENTS.md` and already has a regression test in `activity-log-panel.test.tsx`; it must
not be reintroduced one file over.

### `history-search.ts` — filter, merge, cap

Pure and deterministic. Takes the activity entries and the query parameters; returns the filtered,
time-ordered, capped result. No clock: `since`/`until` resolve against a `today` passed in, matching
`gantt-status-buckets.ts` and `insight-prompt.ts`. Converting "last week" into a date is the model's
job.

### Tool contract

`search_history`, the 39th tool. Defined in `chat-tool-defs.ts`, routed in `chat-tools.ts` `runTool`.

**Input** — all optional: `{ query?: string, since?: string, until?: string, kinds?: string[],
limit?: number }`. `since`/`until` are ISO dates; `kinds` filters to `ActivityKind` values; `query` is
a case-insensitive substring match over rendered line text.

**Output:**

```
{ events: [{ at, summary, detail? }], truncated: boolean }
```

`at` is the entry's ISO timestamp. `summary` is the rendered English line. `detail?` carries the
field-diff suffix and is omitted when the entry has no `changes`. `truncated` reports that `limit`
cut the result, so the model can say "showing the most recent 50" instead of implying completeness.

There is no `source` field: `activityLog` is the only source in B2a, and YAGNI says don't ship a
discriminator for one case. B2c adds it when chat events join.

**Insight outcomes are deliberately absent from `events`.** They reach the model ambiently (see
below), so the tool never returns them and its description must not imply otherwise — a model told a
history tool covers outcomes would call it to answer a question the prompt already answered.

### ★★★ `activityLog` must NOT go on `getSnapshot()`

The obvious wiring — mirror it into the snapshot beside `insights` — is wrong, and silently so.
`runTool`'s `get_app_state` case returns `d.getSnapshot()` **verbatim**, so any field added there is
returned wholesale by that tool. `activityLog` is unbounded (`mergeActivityLogs` caps the stored log,
not a read), so a single `get_app_state` call would dump thousands of entries — with field diffs —
into the context window, defeating every cap this design specifies.

Instead the dispatcher gains a dedicated `getActivityLog(): readonly ActivityEntry[]` method that
only the `search_history` case calls. `get_app_state` is unaffected.

`insights` is already on the snapshot and stays there: it is bounded and small, and that is existing
shipped behaviour.

### Wiring

Entirely inside `use-chat-dispatcher.ts` (765 lines, 35 to the cap). It reads entity state from
`useWorkspace()`, not from `ChatDispatcherArgs`, and **`activityLog` is already on that context** —
so the change is a destructure, a ref, a refresh effect and the new dispatcher method. **No baselined
file is touched, and `task-manager.tsx` needs no change at all.**

`limit` defaults to 50 and is hard-capped at 200. `activityLog` has no query cap of its own —
`mergeActivityLogs` caps the stored log, not a read — so an unbounded call on a busy project would
push thousands of lines into the context window.

### Notes carried forward to B2c

Recorded here so the analysis is not redone: `useChatThreads` already holds each thread's **full**
history and display in memory, capped at 50 per project and fetched once on mount, so chat search is
an in-memory filter needing no second Turso round-trip and no new SQL. Searched text will be the
**stored** history, already attachment-stripped by `stripAttachmentsForPersistence`. The active
thread should be skipped — it is already verbatim in the model's context.

B2c will also need the coverage disclaimer this slice no longer carries, and it must derive from
`tursoMode`, **never** from `threads.length`: "Turso with no chats yet" and "file mode, cannot look"
both present as an empty array, and collapsing them makes the model report "I searched your past
conversations and found nothing" to every file-mode user, permanently.

### Ambient insight outcomes

`buildInsightsPromptBlock` gains a second section, built from the branch it currently filters away —
insights that are `acted`/`resolved` **and** carry an `outcome`:

```
Recent outcomes (acted-on insights and what happened):
- Milestone "Beta cutover" slipped → acted, improved (9 → 3, -6)
- RAID "Vendor delay" aging → acted, worsened (4 → 9, +5)
```

**No clock, no window, no signature change.** Sorting by `outcome.measuredAt` descending and capping
at `MAX_PROMPT_OUTCOMES = 5` delivers "recent" while preserving the module's deterministic clock-free
contract and `buildInsightsPromptBlock`'s existing one-argument signature. Nothing new threads
through `chat-api.ts`.

`unchanged` outcomes are **included**. A tried-it-and-nothing-moved result is exactly what stops the
assistant re-recommending the same action, and excluding it would bias the model's view toward things
that worked.

**★★ The block must stay in the volatile, uncached suffix.** `chat-api.system-prompt.test.ts` pins it
there. Growing the block is safe; *moving* it into `stableText` would look like a caching win and
would silently cost a cache read on every turn. `AGENTS.md` records an earlier author reasoning
exactly that way about the view-scope block and being wrong twice over.

## File structure

Dictated by the size ratchet, not merely constrained by it. Measured on `main` at `5a87026a`:

| File | Lines | Status | Touched? |
|---|---|---|---|
| `chat-panel.tsx` | 996 | baselined, zero headroom | **no** |
| `task-manager.tsx` | 3007 | baselined, zero headroom | **no** |
| `tasks-section.tsx` | 1082 | baselined, zero headroom | no |
| `workspace-section.tsx` | 1000 | baselined, zero headroom | no |
| `use-chat-dispatcher.ts` | 765 | 35 lines to the 800 cap | yes — ~6 lines |
| `chat-tools.ts` | 763 | 37 lines to the 800 cap | yes — one `case` |
| `chat-tool-defs.ts` | 596 | comfortable | yes — one tool def |
| `insights/insight-prompt.ts` | 62 | comfortable | yes — outcomes section |

(The ratchet measures `split("\n").length`, which is `wc -l` + 1. Budgeting from `wc -l` overstates
headroom by exactly one line.)

**No baselined file is touched.** That is the result of dropping chat search — the two files with
real headroom are the only ones that change, and both stay well inside the 800 cap. All logic still
goes in the two new pure modules; `chat-tools.ts` gets routing only.

Both edited files must be re-measured after the change: 6 lines into 765 and one case into 763 are
comfortable, but "comfortable" is a prediction until `npm run size:check` says otherwise.

Both new modules are logic rather than UI glue, so they stay **coverage-gated** — not added to
`coverage.exclude`.
That is the "exclude glue, not logic" rule, and these are logic.

## Testing

In order of what actually catches something:

1. **Every `ActivityKind` renders non-empty and interpolates its args** — table-driven over
   `ACTIVITY_KIND_TO_KEY`, asserting no `{0}` placeholder survives in the output for an entry whose
   args are supplied. This no longer needs to check *wording* (the i18n string is the wording), only
   that the render path resolves for all 55 and leaves no unfilled placeholder.
2. **`get_app_state` does not return `activityLog`** — a guard test over the snapshot's keys. Without
   it, a future contributor "completing the pattern" by mirroring `activityLog` beside `insights`
   reintroduces the unbounded dump, and every other test stays green.
3. **Unknown kind survives** — including a `kind: "toString"` fixture specifically, since the
   prototype-lookup crash is already documented for the sibling function.
4. **Outcomes section** — cap at 5, sort by `measuredAt`, `unchanged` included, empty string when no
   outcomes exist.
5. **`chat-api.system-prompt.test.ts` still passes** — the block stays uncached.
6. **Search mechanics** — `since`/`until`/`kinds`/`query` filters, `limit` default 50 and hard cap
   200, `truncated` set only when the cap actually cut, diff suffix bounded at 12.
7. **Tool wiring** — the definition is registered and `runTool` routes it.

**No axe work, no e2e, no eye-verify.** This slice ships no UI and no i18n key, which removes the two
failure classes that dominated the last three slices — the axe gate's blind spots and `i18n.de.ts`
umlaut corruption. Stated explicitly so the absence reads as a property of the design rather than an
oversight.

## Risks

**1 — ELIMINATED, not mitigated.** The dominant risk was transcribing 55 positional argument
contracts by hand, where a misread ships a confident false line no gate can detect. Rendering through
`t("en-US", ACTIVITY_KIND_TO_KEY[kind], ...args)` removes the transcription step, so the failure mode
no longer exists. Recorded rather than deleted because the *reasoning* that produced it — "a pure
module must not import `t`, therefore hand-write the English" — is sound-sounding and will recur; the
answer is that this is a render layer, not an engine.

The residual is far smaller: the model's view now moves when a UI string is reworded. Acceptable, and
arguably correct, since the panel and the assistant can no longer describe the same event
differently.

**2 — RESOLVED before planning, and the resolution is the lesson.** The first draft carried an
unverified claim that `chat-panel.tsx` could absorb the snapshot wiring at net-zero lines. Measuring
it refuted three separate structural assumptions in this document:

- `useChatDispatcher` is called in `task-manager.tsx`, not `chat-panel.tsx`, so the "mirror threads
  into `getSnapshot()`" wiring was not implementable at all (→ chat search deferred to B2c).
- The dispatcher reads entity state from `useWorkspace()`, not `ChatDispatcherArgs`, and `activityLog`
  is **already on that context** — so no baselined file needs touching and `task-manager.tsx` needs no
  change.
- `get_app_state` returns `getSnapshot()` verbatim, so the obvious snapshot wiring would have shipped
  an unbounded audit-log dump (→ dedicated `getActivityLog()` method).

None of the three was visible from reading the design; each took one grep. **A confident, unmeasured
claim about code structure in a brief is the class that produced both CRITICALs in 0.239.0** — the
mitigation is to grep it before writing it down, not to write it more carefully.

**3 — Field diffs leave the device.** Including `changes` sends prior values of edited fields to the
Anthropic API. They are not a new *class* of data — `list_tasks` already ships task content there —
but old values have not left the device before. `AGENTS.md` marks `activityLog` storage-only and bars
it from exports; that rule governs documents handed to clients, not the user's own assistant.
Accepted deliberately, recorded here so it is a decision rather than a side effect.

Two things that are **not** risks, checked during design: `settings.updated` emits no args and no
field values, so no secret can ride the log into the prompt; and the slice's engines are clock-free,
which is the shape open-followup §149 (date-dependent tests detonating on a calendar rollover) exists
to warn about.

## Out of scope

- B2b (ambient activity recap) and B2c (chat-thread search + cross-thread continuity).
- Attachment content in search results.
- Any ranking or relevance scoring.
- Widening `search_history` to entities the existing `list_*` tools already cover.
- A `source` discriminator on `events` — one source, so YAGNI. B2c adds it.
