# Track B — AI bulk-write safety: Design

**Date:** 2026-09-04
**Status:** approved design, not yet planned
**Track:** B of a four-track decomposition (A authoring completeness · **B bulk-write safety** ·
C planning/calendar writers · D ingest breadth). D shipped as 0.281.0 "Womack" (`7f90fd81`).
**Base:** `origin/main` at `7f90fd81`, `APP_VERSION = "0.281.0"`.

## Goal

An assistant must not write many rows, or delete anything, without the user seeing what it is about
to do and being able to reject part of it — and every AI write, staged or instant, must be undoable
by the same mechanism every human write already uses.

## Why this track exists

The originating request was "upload a utilization Excel and have it fill in resources, planning and
calendar entries". Track D delivered the *read* half. Track C will add the allocation and calendar
*writers*. C is the first feature whose normal use is dozens of writes in one turn, and today the AI
write path has neither review nor undo. B is the guardrail C needs, and it must land first.

## Starting position (measured, not assumed)

Three shipped mechanisms already exist. This slice joins them; it invents no new pattern.

| Mechanism | Where | Consumers today |
|---|---|---|
| Undo/redo stack — before-images, forward-images, id remap, `pushUndo`/`pushUndoMany`, cap 25, 13 entity kinds incl. `calendarEvent` and `budget` | `src/app/undo/undo-stack.ts`, `use-undo-stack.ts` | every **human** write path: `use-task-submit`, `use-change-log`, `use-stakeholders`, `use-resource-planner`, `use-resource-directory`, `use-calendar-events`, `absence-move-handler`, tasks/milestones panels |
| Proposal shape + replay — `proposedCalls`, `stampCall`, `ALLOWED_REC_TOOLS`, forward-compat sanitising | `insights/insight.ts`, `insights/recommend.ts`, `insights/recommend-tokens.ts`, `insights/sanitize-insights.ts`, `use-insight-recommendations.ts` | insight recommendations only |
| Descriptor / diff engine — `describeEntityCalls`, `EditPlan`, `ToolUseLike`, `INLINE_DESCRIPTORS` | `inline-ai-edit/plan.ts`, `inline-ai-edit/entity-descriptor.ts` | inline "Ask Claude" row editor; insight recommendations |

Four measured gaps this spec closes:

1. **AI writes bypass the undo stack.** `use-chat-dispatcher.ts:248` (`createTask`) and `:290`
   (`updateTask`) build the row, call `setTasks(next)` and call `args.logActivityAs?.("ai", …)`.
   They log; they capture no before-image. `grep -c pushUndo` over `chat-tools.ts`,
   `chat-tools-updates.ts`, `chat-tools-lists.ts`, `chat-tools-documents.ts` and `chat-api.ts`
   returns 0 in every file. The chat path is the one writer in the app outside the undo stack.
2. **"Confirm with the user first" is unenforced prose.** It appears in the tool *descriptions* in
   `chat-tool-defs.ts` on `delete_task` (:297), `delete_all_tasks` (:307), `delete_resource` (:615),
   `delete_raid_item` (:643), `delete_change` (:671), `delete_milestone` (:698) and
   `delete_stakeholder` (:726). It is a model instruction. Nothing stops the call.
3. **The proposal pipeline has one producer.** Everything needed to stage, describe, token-stamp and
   replay a plan exists — built for insights, unreachable from chat.
4. **The descriptor engine has a one-item binding and one missing entity.**
   `describeEntityCalls` is bound to a single `ctx.item`: an update whose `input.id !== item.id` is
   rejected as `"unsupported"`. That is exactly why `insights/recommend-plan.ts` exists — it calls
   the describer **once per call**, grounding each by its own id, and its header says so. A chat
   plan spans many rows and must do the same.

   Coverage, measured in `inline-ai-edit/plan.ts`: `CREATE_TOOLS` and `DELETE_TOOLS` each hold
   **five** entries (task · raid · change · milestone · stakeholder), and `InlineEntity` is those
   same five. So `create_*` and `delete_*` **are** already describable for them. What is missing is
   `resource` — the string "resource" appears zero times in `plan.ts`, so `create_resource`,
   `update_resource` and `delete_resource` cannot be described at all.

   ★ An earlier revision of this section said the maps carry "no `create_*`". That is true of
   `recommend-plan.ts`'s own `UPDATE_DESCRIPTOR`/`DELETE_DESCRIPTOR` maps and false of the engine
   underneath, which is the reading that matters here.

## Architecture

### Thesis

Chat becomes the third consumer of the descriptor engine and the second consumer of the proposal
pipeline, and the last writer to join the undo stack.

### Flow

```
model emits tool calls
   |
   +-- gate: destructive OR >1 write? -- no --> apply now, pushUndo            (B1)
   |
  yes
   |
   v
stage: ProposedCall[] held on the assistant message
   |
   v
describeEntityCalls -> EditPlan -> inline ProposalBlock (per-row checkboxes)
   |
   v
user applies selection
   |
   v
replay through runTool, tokens verified -- stale? --> that row fails, rest apply
   |
   v
pushUndoMany -> ONE undo entry for the whole applied plan
```

### Units

| Unit | Responsibility | State |
|---|---|---|
| `chat-proposal.ts` | Pure, i18n-free. Given a turn's tool calls, decide stage-vs-apply and build the plan. Owns the destructive/multi-write rule and the dependency-cascade rule. | new |
| `inline-ai-edit/plan.ts`, `entity-descriptor.ts` | Render a call as a human-readable diff row. | existing — **extended** with `resource` only (the other five entities are already covered for create, update and delete) |
| `ai-entity-token.ts`, `stampCall` | Stamp tokens at propose time, verify at apply time. | existing, reused unchanged |
| `chat-proposal-block.tsx` | The inline card: per-row checkboxes, show-more, Discard/Apply, failure reporting. Presentational — data and handlers as props. | new |
| `use-chat-dispatcher.ts` | Capture before-images and call `pushUndo`/`pushUndoMany` on every AI write. | existing — this is B1 |

### Why both halves, not one

B1 alone leaves a wrong 40-row write landing with only all-or-nothing recourse. B2 alone leaves
single writes — which stay instant by design — outside the undo stack, inconsistent with every human
path. Together: instant writes are undoable, bulk and destructive writes are reviewable, and an
applied plan is **one** undo entry. That last point is not cosmetic: `UNDO_CAP = 25`, so 40
individual entries would evict the user's own history.

## Semantics

### The constraint that shapes everything

`chat-api.ts:171-209` repairs dangling `tool_use` blocks because every assistant `tool_use` must be
immediately followed by a `tool_result` or the API rejects the whole request — in that file's own
words, wedging the chat. **A staged call therefore cannot hold the model waiting for approval.** It
must return a truthful result immediately.

This rules out pausing mid-turn, and it rules out fabricating success: a fabricated
`"created task #57"` would invite a follow-up `set_task_dependencies` against an id that may never
exist.

### Resolution: provisional ids

`id-mint-session.ts:45` keeps a per-kind session high-water mark above the list max, so an id minted
for a staged create is never re-minted and cannot collide with a concurrent human create — even if
the plan is discarded and the id is never used. A gap in the id sequence is harmless.

A staged call therefore mints its real id, stages the op, and returns a result marked `staged: true`
carrying that id. Follow-up calls in the same turn reference it and stage too. On Apply, replay uses
ids already allocated. On Discard, nothing is written.

### The six rules

1. **Gate.** A turn stages if any call is destructive (`delete_*`, `delete_all_tasks`) **or** the
   turn's write count exceeds one. Reads never stage. A single non-destructive write applies
   instantly, with undo capture (B1).
2. **Tool result.** A staged call returns `{ staged: true, id, ... }`. The system prompt states that
   staged writes are not yet applied and must not be re-issued. This replaces the unenforced
   "Confirm with the user first" prose, which is removed from the seven tool descriptions.
3. **Reads see committed state, not staged.** A staged plan is a proposal; grounding it against live
   data at apply time is what `recommend-plan.ts` already does for a background-generated proposal.
   The model is told this explicitly rather than being silently misled.
4. **Partial reject cascades.** Rejecting a staged `create` also deselects every staged call
   referencing its provisional id, and the row says so. Without this, Apply replays an update
   against an id that was never created.
5. **Tokens stamped at propose, verified at apply.** A row whose entity a human edited in the
   interval fails **that row only**; the rest apply, and failures are reported in the card. This is
   the guarantee §349 gave document blocks, extended to a plan.
6. **One undo entry per applied plan.** `pushUndoMany` with the entity-ambiguous `bulk.edit` kind
   and an explicit `entityKey`.

### Lifetime

A pending plan lives on the assistant message, so it persists with the thread (Turso) or dies with
the reload (file mode) exactly as the transcript does. It is **not** separately persisted. A
resurrected stale plan cannot silently overwrite, because rule 5 refuses stale rows per row.

Read-only popouts already throw `popoutReadOnly` before any write; the gate sits after that check,
so a popout can neither write nor stage.

## Failure modes

| Case | Behaviour |
|---|---|
| Token stale at apply (human edited that row meanwhile) | That row fails, the rest apply; failures listed in the card with the entity named. |
| Entity deleted between propose and apply | Same path — the row fails "not found", never a silent skip. |
| Model re-issues a staged call despite the prompt | It stages too; identical `(name, input)` pairs collapse in the plan. |
| User discards | Nothing written. Provisional ids are burned; `mintId`'s high-water mark never re-mints them. |
| Reload or thread switch with a pending plan | The plan survives exactly as the transcript does; stale tokens are refused per row at apply. |
| Partially applied plan, then Undo | Before-images are captured for **applied** rows only, so undo restores exactly what landed. |
| Read-only popout | `popoutReadOnly` throws before the gate — neither write nor stage. |

## Testing

Three vacuity traps this repo has already paid for, each with a named countermeasure:

1. **The gate is pure** and gets table-driven tests over turn shapes (read-only · one write · two
   writes · one delete · delete plus read). **Mutation-prove it:** changing `> 1` to `>= 1`, and
   dropping the destructive disjunct, must each turn a test red. A gate test that still passes with
   the rule reverted is the failure mode here.
2. **Per-row accessible names.** The card renders N rows, each with a checkbox — the collision class
   §111 · §126 · §247 · §248 keep reopening. Names come from `buildRowTokens`/`rowLabel`
   (`row-tokens.ts`), asserted with the shared `src/test/row-unique-names.ts` using
   `requireCollisionSeed: true` and a measured `minControls`. This matters more than usual: the axe
   gate cannot see duplicate accessible names at all, and the card only exists after a model turn,
   so **no e2e run will ever render it.** Unit tests are the only possible coverage, in any gate
   configuration.
3. **New i18n keys get a `loadI18n("de")` test per site.** An EN-only assertion is vacuous whenever
   the EN string is byte-identical to what it replaced.

Beyond those: descriptor tests for the newly-described `resource` calls (`create_resource`,
`update_resource`, `delete_resource`); a multi-row grounding test proving a plan spanning several
ids describes every row rather than rejecting all but one as `"unsupported"` — the one-item binding
is the trap here, and a single-row fixture cannot see it; a cascade test (reject a create, its
dependent rows deselect); a `pushUndoMany` test
proving **one** undo entry rather than N, and that undo restores every applied row and only those.

## Non-goals

- **The allocation and calendar writer tools** — track C, and so are their descriptors. An earlier
  revision proposed describing those calls here so C could stage them; that is speculative work
  against tools that do not exist, and C should add each writer and its descriptor together. What
  this slice guarantees C is the *mechanism*: a new writer joins the gate, the plan and the undo
  capture by being added to the descriptor maps, with no change to any of the three engines.
- **Editing a staged value in the card.** Accept or reject a row; to change it, ask the model.
  Editing would make the card a second write path with its own sanitization boundary.
- **Persisting plans independently of the thread.**
- **Retro-fitting review onto insight recommendations** — they already have their own confirm path.

## Size and sequencing

Larger than any slice this branch has shipped: one new pure module, one new component, descriptor
extension for one entity (`resource`), dispatcher capture at about ten write sites, a system-prompt
change, and new EN + DE i18n keys.

**B1 (dispatcher capture) is independently shippable** if the whole proves too large in one go. It
closes the unrecoverable-write hole on its own and is what track C actually depends on.

## Coordination

Session `aipm-cockpit-01` holds `feat/timelog-guardrails` (§347) in the main checkout. Its 33 files
do not intersect this slice's set, with two exceptions to watch:

- `task-manager.tsx` — held heavily modified there. This slice is **not expected to touch it**;
  proposal state belongs on the chat message, not the orchestrator.
- `i18n.ts` / `i18n.de.ts` — that branch adds 12 EN and 12 DE keys. These two files conflict on
  almost any concurrent edit. Whoever merges second re-applies their keys by hand rather than
  resolving the hunk, and `i18n.de.ts` is patched by node utf8 write with `\r\n` anchors, never the
  Edit tool.

Register numbers §352-§359 are on `origin/main` as of `7f90fd81`; new filings start at §360.
