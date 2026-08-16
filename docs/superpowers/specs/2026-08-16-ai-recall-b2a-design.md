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

Three data sources now hold that history per-project, and none of them reaches the model:

- **`activityLog`** — the audit trail, promoted to workspace data in 0.239.0. Available on all six
  write paths, so every storage backend has it.
- **Chat threads** — past conversations, persisted in 0.239.0. Turso-only by construction.
- **Insight outcomes** — `resolved`/`acted` insights carrying
  `outcome: {direction, baseline, current, delta, measuredAt}`. Workspace data, all backends.

The third is the sharpest gap. `buildInsightsPromptBlock` already runs on every turn and already
feeds insights into the prompt — but it filters to `active`/`acknowledged` only. The model therefore
sees every open problem and has **never once** seen that an action was taken and improved or worsened
the metric. That is not a missing subsystem; it is an excluded filter branch.

## Decomposition

"Recall" as originally framed covered three distinct mechanisms. They are separate slices:

| Piece | Mechanism | Storage reach | Cost shape |
|---|---|---|---|
| **B2a** (this doc) | `search_history` tool + ambient outcomes | activity/insights: all backends; chats: Turso-only | Pay-per-use, plus ~5 ambient lines |
| **B2b** | Ambient recent-activity recap in the prompt | All backends | Every turn, every conversation |
| **B2c** | Cross-thread continuity via generated summaries | Turso-only | New durable write path + staleness policy |

B2a is first because it delivers a complete user-visible capability alone, works in every storage
mode, and builds the renderer B2b consumes. B2c is deliberately last: it is the only piece that needs
the model to *write* something durable, which brings a new write path, an invalidation rule and a
cost-per-summary decision with it.

## Non-goals

- Any ambient recap of raw activity (B2b).
- Cross-thread summaries or continuity (B2c).
- Ranking, fuzzy matching, or embeddings over any source. Substring only.
- Any new UI. This slice ships no component and no i18n key.
- Changing what the existing 38 tools do.

## Architecture

Two new pure modules plus one thin tool registration. Nothing async is added to the tool despite
`runTool` being async — every source is already in memory by the time the tool runs.

### `activity-prompt.ts` — the activity renderer

Pure, i18n-free, English-only regardless of UI language, deterministic (no clock). Modelled directly
on `insight-prompt.ts`, which established every one of those properties and states them in its own
header.

It must **not** use `t(lang, …)`. Two reasons: the model-facing view must not change when a user
switches to German, and the module is pure-engine territory where `t` does not belong.

That means an English template per `ActivityKind` — **55 of them**, as an exhaustive
`Record<ActivityKind, string>`. Exhaustiveness is the guard: a 56th kind added without a template is
a typecheck error, the same mechanism `ACTION_SOURCE_LABEL` uses for `ActionSource`.

**Two behaviours the insights precedent does not cover:**

*Field diffs.* `ActivityEntry.changes` renders as a compact suffix — `(status: To Do → Done)` —
bounded by `MAX_FIELD_CHANGES` (12), exported from `activity-log.ts` during the Rusch slice.

*Unknown kinds must survive.* `sanitizeActivityEntry` deliberately **keeps** an unrecognised string
`kind`, so an older client cannot delete entries a newer release wrote. The renderer therefore needs
the same `hasOwnProperty` discipline `activityMessageKey` already carries: a bare index lookup on
`kind: "toString"` resolves a `Function.prototype` method, and `t()` then throws on `undefined.replace`,
crashing the app through the top-level `ErrorBoundary`. That exact bug is already documented in
`AGENTS.md`; it must not be reintroduced one file over.

### `history-search.ts` — filter, merge, cap

Pure and deterministic. Takes rendered activity lines, the in-memory threads, and the query
parameters; returns the merged, time-ordered result plus the coverage report. No clock: `since`/
`until` resolve against a `today` passed in, matching `gantt-status-buckets.ts` and
`insight-prompt.ts`. Converting "last week" into a date is the model's job.

### Tool contract

`search_history`, the 39th tool. Defined in `chat-tool-defs.ts`, routed in `chat-tools.ts` `runTool`.

**Input** — all optional: `{ query?: string, since?: string, until?: string, kinds?: string[],
limit?: number }`. `since`/`until` are ISO dates; `kinds` filters to `ActivityKind` values; `query` is
a case-insensitive substring match over rendered line text.

**Output:**

```
{
  events: [{ at, source, summary, detail? }],
  coverage: {
    activityLog: "searched",
    chatThreads: "searched" | "unavailable-file-mode",
    truncated: boolean
  }
}
```

`source` is `"activity" | "chat"`. `detail?` carries the field-diff suffix for an activity event and
the matched excerpt plus thread name for a chat event; it is omitted when there is nothing extra to
say. `at` is the entry's ISO timestamp for activity, the thread's `updatedAt` for chat.

**Insight outcomes are deliberately absent from `events`.** They reach the model ambiently (see
below), so the tool never returns them and its description must not imply otherwise — a model told a
history tool covers outcomes would call it to answer a question the prompt already answered.

`limit` defaults to 50 and is hard-capped at 200. `activityLog` has no query cap of its own —
`mergeActivityLogs` caps the stored log, not a read — so an unbounded call on a busy project would
push thousands of lines into the context window.

### Chat thread search

The dispatcher reaches threads exactly as it reaches insights: a ref mirrored into `getSnapshot()`,
alongside `insightsRef`. `useChatThreads` already holds each thread's **full** history and display in
memory, capped at 50 per project and fetched once on mount — so this is an in-memory filter with no
second Turso round-trip and no new SQL.

Searched text is the **stored** history, already attachment-stripped by
`stripAttachmentsForPersistence`, so an image reads as a `[attachment: report.pdf]` placeholder. That
is the honest thing to search; the bytes are not there to search.

The **active thread is skipped** — it is already verbatim in the model's context, and re-injecting it
spends tokens telling the model what it just read.

### ★★ The coverage field must derive from `tursoMode`, never from `threads.length`

Two different facts look identical from the result end:

| Situation | `threads` | Correct coverage |
|---|---|---|
| Turso, no chats yet | `[]` | `"searched"` — genuinely nothing to find |
| File mode | `[]` | `"unavailable-file-mode"` — could not look |

Collapsing them makes the model report "I searched your past conversations and found nothing" to
every file-mode user, permanently, with nothing to signal the error. The tool's description instructs
the model to surface an `"unavailable-file-mode"` coverage value to the user rather than reporting an
empty result as a negative finding.

This is the single line in the slice most likely to be written the convenient way.

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

| File | Lines | Status |
|---|---|---|
| `chat-panel.tsx` | 996 | **baselined at 996 — zero headroom** |
| `task-manager.tsx` | 3007 | baselined at 3007 — zero headroom |
| `tasks-section.tsx` | 1082 | baselined at 1082 — zero headroom |
| `workspace-section.tsx` | 1000 | baselined at 1000 — zero headroom |
| `chat-tools.ts` | 763 | 37 lines to the 800 cap |
| `use-chat-dispatcher.ts` | 765 | 35 lines to the 800 cap |
| `chat-tool-defs.ts` | 596 | comfortable |

(The ratchet measures `split("\n").length`, which is `wc -l` + 1. Budgeting from `wc -l` overstates
headroom by exactly one line.)

So: **all logic goes in the two new pure modules.** `chat-tools.ts` gets thin routing only,
`chat-tool-defs.ts` gets a tool definition, `use-chat-dispatcher.ts` gets one ref and one snapshot
field. `chat-panel.tsx` must come out **net-zero or negative** — the `threads` value already exists
there, so passing it down should be an edit to an existing props object rather than added lines. If
it cannot be, the plan condenses something adjacent. It does **not** re-baseline.

Both new modules are pure logic, so they stay **coverage-gated** — not added to `coverage.exclude`.
That is the "exclude glue, not logic" rule, and these are logic.

## Testing

In order of what actually catches something:

1. **The coverage disclaimer** — two fixtures: Turso mode with zero threads (`"searched"`) and file
   mode (`"unavailable-file-mode"`). Only this pair separates the two cases; a file-mode-only fixture
   passes whichever way the line is written. This is the test the slice most needs.
2. **All 55 kinds render** — table-driven over `ActivityKind`. A missing template fails the
   typecheck; a wrong one fails a readable assertion. Fixtures are built from each i18n string's
   placeholder order, **not** from a reading of it (see risk 1).
3. **Unknown kind survives** — including a `kind: "toString"` fixture specifically, since the
   prototype-lookup crash is already documented for the sibling function.
4. **Outcomes section** — cap at 5, sort by `measuredAt`, `unchanged` included, empty string when no
   outcomes exist.
5. **`chat-api.system-prompt.test.ts` still passes** — the block stays uncached.
6. **Search mechanics** — `since`/`until`/`kinds`/`query` filters, `limit` default 50 and hard cap
   200, diff suffix bounded at 12, active thread excluded.
7. **Tool wiring** — the definition is registered and `runTool` routes it.

**No axe work, no e2e, no eye-verify.** This slice ships no UI and no i18n key, which removes the two
failure classes that dominated the last three slices — the axe gate's blind spots and `i18n.de.ts`
umlaut corruption. Stated explicitly so the absence reads as a property of the design rather than an
oversight.

## Risks

**1 — The 55 argument contracts (dominant).** `ActivityEntry.args` is `(string | number)[]`,
positionally interpolated, with no per-kind schema anywhere in the types. What `args[0]` *means* for
`raid.statusChanged` is defined only by the EN i18n string it feeds. Writing 55 templates means
recovering 55 argument contracts by reading 55 i18n strings, and a misread produces a grammatical,
confident, **false** line that the model will assert as fact and that no gate can detect.

Mitigation: derive each test fixture from the i18n string's own placeholder order rather than from
the template author's reading of it, so the test and the template cannot share one misreading.

**2 — The unverified `chat-panel.tsx` net-zero claim.** This design asserts the file can absorb the
change without growing, and that assertion has not been tested against the code. A confident,
unmeasured claim about code structure in a brief is the exact class that produced both CRITICALs on
the 0.239.0 slice. **The plan measures it before committing to the approach**, and if it fails, the
plan chooses between condensing adjacent lines and moving the snapshot wiring elsewhere.

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

- B2b (ambient activity recap) and B2c (cross-thread continuity).
- Attachment content in search results.
- Any ranking or relevance scoring.
- Widening `search_history` to entities the existing `list_*` tools already cover.
