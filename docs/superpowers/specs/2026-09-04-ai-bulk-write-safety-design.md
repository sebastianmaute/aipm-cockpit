# Track B — AI bulk-write safety: Design

**Date:** 2026-09-04
**Status:** approved design; planned and partly implemented. The plan is
`docs/superpowers/plans/2026-09-04-ai-bulk-write-safety.md`, and this spec names it below. Read
that plan's `★★★ CORRECTIONS` section before this document — where the two disagree, the
corrections win, because they were measured during execution and this was written before it.
★ Phase 1 (dispatcher undo capture) is wired in production; the Phase 2 staging gate, review card
and apply path exist but have NO production caller — see `docs/open-followups.md` §377.
**Track:** B of a four-track decomposition (A authoring completeness · **B bulk-write safety** ·
C planning/calendar writers · D ingest breadth). D shipped as 0.281.0 "Womack" (`7f90fd81`).
**Base:** `origin/main` at `7f90fd81`, `APP_VERSION = "0.281.0"`.

## Goal

An assistant must not write many rows, or delete anything, without the user seeing what it is about
to do and being able to reject part of it — and every AI write that the undo engine is *capable* of
reversing must be undoable by the same mechanism every human write already uses.

★★★ **CORRECTED 2026-09-04, during implementation. This sentence originally read "every AI write,
staged or instant, must be undoable" and that is not achievable.** The undo engine has no create op:
`undo-stack.ts:12` is `export type UndoOp = "delete" | "edit";`, and a comment in
`src/app/undo/use-undo-stack.ts` states the consequence outright — "The UNDO direction never
removes … no entity in the app captures a create"
(`grep -n "direction never removes" src/app/undo/use-undo-stack.ts`).
★ This citation used to read `use-undo-stack.ts:203-205`: WRONG PATH (the file is under
`src/app/undo/`) and, measured 2026-09-04, wrong LINES too — the quoted comment sits three lines
lower. Every `use-undo-stack.ts` line citation in this document was off by the same 3, i.e. one
insertion above them drifted all of them at once, which is why they are now symbols plus greps. Capturing a create as a `removed` image does not merely fail to work; it is ACTIVELY
HARMFUL. At undo time the created row is still live, so `present.has(item.id)` is true and
`applyUndoRestoreWithRemap` takes its id-reuse branch (`undo-stack.ts:137-146`), minting `max+1` and
splicing in a SECOND copy. Measured against the real engine: undoing an AI create of a third row
yields four rows with the new row present twice. **So capture is for updates and deletes only.**
Creates are protected by the Phase 2 gate instead — a turn writing more than one row stages, so a
bulk create is reviewed before it lands. A SINGLE create stays un-undoable, which is exactly how
every human create in this app already behaves; it is uniform, not an AI-specific hole.

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

1. **AI writes bypass the undo stack.** The `createTask` and `updateTask` handlers in
   `use-chat-dispatcher.ts` (`grep -n "      createTask:\|      updateTask:" src/app/use-chat-dispatcher.ts`)
   build the row, call `setTasks(next)` and call `args.logActivityAs?.("ai", …)`.
   They log; they capture no before-image. `grep -c pushUndo` over `chat-tools.ts`,
   `chat-tools-updates.ts`, `chat-tools-lists.ts`, `chat-tools-documents.ts` and `chat-api.ts`
   returns 0 in every file. The chat path is the one writer in the app outside the undo stack.
   ★ **This gap is closed for `update_*` and `delete_*` only.** `createTask` is named above as
   evidence that the chat path captures nothing — which is true — but it is NOT a site this spec
   fixes: no entity in the app captures a create, because the engine cannot reverse one. Read the
   ★★★ note under Goal before treating a create site as an outstanding gap; adding a capture there
   is a regression, not a completion, and it duplicates the row on undo.
   ★★ **Nor are the two AI DOCUMENT write paths a gap, and they cannot be closed here anyway.**
   `CaptureCompositeOpts.kind` is typed `ActivityKind`; documents log `ai.documentWrite`, and
   `UndoEntityKey` has no `document` member — so no valid capture can be constructed without
   widening both, which needs a new `undoEntityDocument` string in BOTH i18n files. It is moot:
   `use-document-tools.ts` writes through `mutateDocuments`, which takes a `DocVersionSource`, runs
   `applyDocMutation` and stores `result.versions` — so an AI document write **already records a
   version before-image** and is recoverable by version restore. Documents have their own history
   mechanism and are deliberately outside the undo stack. Passing `entityKey: undefined` to force a
   capture would compile and silently degrade every document undo label to "Edited 1 item(s)".
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
   instantly, with undo capture (B1) **if it is an update; a single create applies instantly and
   cannot be undone**, per the engine constraint recorded under Goal. The gate is what covers
   creates: two or more writes stage, so the only un-undoable create is a lone one.
   ★★ **The gate is WIDER than this design first specified, decided during implementation against
   the live `TOOL_DEFS` (45 tools — 40 `case` labels in `chat-tools.ts` plus the 5-name
   `DOCUMENT_TOOLS` set it routes to).** Three additions beyond the six inline entities:
   - **`create_document` / `update_document` / `delete_document`**, with `delete_document`
     DESTRUCTIVE. The single-write exemption's stated justification is undo, and document chat
     writes have none — `use-document-tools.ts` says so at three sites — so the exemption is
     unsound there. Version history does cover `update_document`, which is the honest counter,
     but it does not cover discoverability: recovery lives on the Documents tombstone list, a
     different surface with nothing on the chat panel pointing at it. Excluding them would also
     make `delete_document` the only delete in the app that applies unreviewed.
   - **`send_inquiry`**, which reads like "send an email" and is really a persisted
     `Workspace.tasks` write — `use-chat-dispatcher.ts` builds `next = tasksRef.current.map(...)`
     incrementing `inquiriesSent` and calls `setTasks(next)`. It is deliberately NOT an undo
     capture site, and that is correct rather than a gap: the human path (`handleSendInquiries` in
     `use-bulk-operations.ts`) contains zero capture calls either, so inquiries are outside the
     stack for everybody. It stages because it persists AND fires an external side effect
     (`window.open` on a `mailto:`) that no undo could retract.
   ★ `set_language`, `set_filters` and `update_settings` stay excluded, verified rather than
   assumed: they write through `args.setSettings` / `applyFilters` only, touching no workspace
   setter and no `Workspace` slice.
   ★★ **A partition test pins this.** `chat-proposal.test.ts` asserts the live `TOOL_DEFS` equals
   three hand-written literals (destructive / non-destructive write / non-write, 8 + 16 + 21 = 45),
   deliberately NOT derived from `chat-proposal.ts` — deriving them would make every row
   tautological. A tool added later and left unclassified fails there BY NAME, instead of silently
   never counting toward the gate.

   ★★★ **THREE CONSEQUENCES OF THE WIDENING, all binding on the apply path.**

   1. **Apply must RE-INVOKE each call. It must never replay a computed data diff.**
      `send_inquiry`'s handler calls `window.open` on a `mailto:` URL *during* the write and only
      then increments the counter. A diff-replay apply would bump `inquiriesSent` and **open no
      mail client** — a silent send-nothing, with no error at any layer and a counter that says it
      worked. `ProposedCall` is `{name, input}`, so re-invocation through `runTool` is the natural
      design; this records it as an INVARIANT rather than leaving it an accident of how the apply
      path happens to get written. Any future tool with an in-handler side effect inherits the
      same protection for free, and only from this rule.
   2. **A staged call is not necessarily an entity ROW.** `update_document` carries an ops array of
      block mutations, not a row, so the card shows one opaque "update document #N" line that can
      be rejected whole but not partially. That is acceptable — reject-the-whole-call beats no
      review — but the row model must not ASSUME an entity-row shape, or document calls render
      blank or crash it.
   3. **"One undoable commit" is not achievable for a mixed plan, and the card must not say it
      is.** Document writes take no undo capture at all and recover through `documentVersions`
      instead, so a plan mixing document and entity writes is only PARTIALLY undoable. Combined
      with the create rule under Goal, the honest statement is: **an applied plan's updates and
      deletes to the six inline entities are reversible by one undo entry; its creates and its
      document writes are not.** Whatever Task 12/13 tells the user must say no more than that.
2. **Tool result.** A staged call returns `{ staged: true, id, ... }`. The system prompt states that
   staged writes are not yet applied and must not be re-issued. This replaces the unenforced
   "Confirm with the user first" prose, which is removed from the seven tool descriptions.
3. **Reads see committed state, not staged.** A staged plan is a proposal; grounding it against live
   data at apply time is what `recommend-plan.ts` already does for a background-generated proposal.
   The model is told this explicitly rather than being silently misled.
4. **Partial reject cascades.** Rejecting a staged `create` also deselects every staged call
   referencing its provisional id, and the row says so. Without this, Apply replays an update
   against an id that was never created.
5. **Tokens verified at apply; stamped at propose ONLY when the model supplied none.** A row whose
   entity a human edited in the interval fails **that row only**; the rest apply, and failures are
   reported in the card. This is the guarantee §349 gave document blocks, extended to a plan.

   ★★★ **CORRECTED during implementation. This rule originally read "Tokens stamped at propose,
   verified at apply", copied from the insights pipeline — and on the chat path that is STRICTLY
   WEAKER than what already ships.** The two paths differ in the one way that matters. On the
   insights path a stored proposal carries no token, so stamping strictly ADDS a guard. On the chat
   path the model must already supply `expectedToken` — `requireToken`
   (`chat-tools-updates.ts:183`) throws on absence, so every chat update that works today carries
   one, derived from the model's own `get_*` read at T0. Stamping at stage time T1 REPLACES that,
   so the guard covers only T1→T2 (the review window) and **loses T0→T1**: a concurrent writer who
   moves the row between the model's read and the staging is no longer caught.
   `recommend-tokens.ts`'s own header names this exact failure mode — "compare a value against the
   very read it came from" — which makes walking into it the more embarrassing.
   So: **preserve the model's token when present; stamp only to fill an absence.** Strictly stronger
   than either alternative, and two lines.
   ★ It also resolves an inconsistency for free. `UPDATE_TARGET` has five rows and no
   `update_resource` — it structurally cannot have one, since its `key` is
   `keyof RecommendPlanWorkspace` and that `Pick` omits `resources` — while `update_resource` IS
   token-guarded (`chat-tools.ts:751`). Under stamp-always, resource updates alone would have kept
   a T0 token while every other entity got a T1 one. Under stamp-when-absent they all keep T0.
   Widening `UPDATE_TARGET` is therefore NOT needed and is deliberately not done: it is a security
   path, and the fix above approximates it better than the table would.
6. **One undo entry per applied plan** — `captureComposite`, with the entity-ambiguous `bulk.edit`
   kind and an explicit `entityKey` (without which `buildUndoLabel` degrades to "Edited N items").

   ★ **NOT `pushUndoMany`, which an earlier revision of this spec named.** That helper appends N
   entries and is used only for redo-stack inverses — its two call sites are the `setRedoStack` and
   `setStack` updaters in `src/app/undo/use-undo-stack.ts`
   (`grep -n "pushUndoMany" src/app/undo/use-undo-stack.ts`) — never for
   capture. `captureComposite` is the right call for a second reason too: `capture` binds to ONE
   setter and array, while a plan spans several entities. A composite takes one fragment per
   affected array (`capturePart` for whole-row removals, `captureFieldPart` for field patches) and
   pushes exactly one entry. Its own doc states the single-array case is legitimate and is "how a
   fan-out of field edits becomes ONE undo entry instead of N".

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
| Partially applied plan, then Undo | Before-images are captured for **applied** rows only, so undo restores exactly what landed — **for the update and delete rows.** A plan's CREATE rows contribute no before-image at all (see Goal), so undoing an applied mixed plan reverts its edits and restores its deletions while leaving its created rows in place. The undo label must not promise otherwise. |
| Read-only popout | `popoutReadOnly` throws before the gate — neither write nor stage. |
| **A staged create's id, referenced by a later call in the same turn** | ★★★ **THE DESIGN DOES NOT CLOSE THIS AND THE WIRING TASK MUST.** The staged tool result hands the model a provisional id (`{staged: true, id, …}`), so the model can and will reference it in a later call — that is the whole point of minting ahead. But at APPLY time the create is replayed through `runTool`, and `createTask` mints its OWN id from the session high-water map. The dependent row is replayed carrying the PROVISIONAL id. **Those two agree only by luck.** `PlanRow` carries `mintedId`/`dependsOn`, but `DescribedRow` carries neither, and `applyProposal` currently discards `runTool`'s return value — so nothing in the apply path can currently reconcile them. The fix is to capture each create's REAL returned id and remap dependents' `id` fields before replaying them, using the `provisional → real` mapping the `PlanRow` graph already describes. Note this is NOT the `mintId` collision hazard (that one is handled — the high-water mark guarantees a discarded provisional id is never re-minted); it is the reverse problem, that the id which IS minted at apply differs from the one already handed out. ★★ **NOW FILED AS `docs/open-followups.md` §378, and that is where it must be tracked.** This cell was its only record until 2026-09-04; `followups-status-check` gates the register in CI and nothing reads `docs/superpowers/`, so a hazard living only here is invisible to every gate and to every reader who did not open this file. §378 also carries the ordering constraint: it must be closed in the SAME change that gives the staging gate a production caller (§377), because that change is what makes it reachable. |
| Applied plan mixing a create with a delete | ★★★ **The create must be excluded from the image list, not merely tolerated.** `buildBeforeImages(removed, edited, fromArray)` takes ONE `fromArray` for every image in a fragment, so a fragment holding both a create-as-`removed` and a real delete has no correct value for it: post-op gives the create a truthful index and collapses the delete's to 0 via `Math.max(0, -1)`; pre-op inverts the damage. Measured — a `{delete B, create NEW}` plan went in at 2 rows and came out of undo at 4, with B restored at index 0 instead of 1. A create image does not merely fail to undo itself, it **misplaces every sibling delete in the same fragment.** Worse, the phantom re-mint publishes an id-remap (`capturePart` does `if (isPrimary) primaryRemap.current = remap`), so every cascade declaring `fkRemapField` rewrites foreign keys onto the duplicate — a data-integrity failure with no row-level symptom. |

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
dependent rows deselect); and a `captureComposite` test proving a plan spanning **two different
entities** pushes exactly **one** undo entry rather than N, and that undoing it restores every
applied row and only those. The two-entity fixture is load-bearing: a single-entity plan would pass
against a wrong implementation that called `capture` per array.

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
extension for one entity (`resource`), dispatcher capture at 14 write sites, a system-prompt
change, and new EN + DE i18n keys.

★ **14, not "about ten"** — this line estimated and every other artifact counts. Measure, do not
re-estimate: `grep -cE "undoRef\.current\?\.capture" src/app/use-chat-dispatcher.ts src/app/use-register-tools.ts`
returns 6 and 8.

**B1 (dispatcher capture) is independently shippable** if the whole proves too large in one go. It
closes the unrecoverable-write hole on its own and is what track C actually depends on.

## Coordination

Session `aipm-cockpit-01` holds `feat/timelog-guardrails` (§347) in the main checkout. Its 33 files
do not intersect this slice's set, with two exceptions to watch:

- `task-manager.tsx` — held heavily modified there. This slice was **not expected to touch it**;
  proposal state belongs on the chat message, not the orchestrator.
  ★★ **IT DID TOUCH IT, in exactly one property, and the expectation above was written before
  execution.** Phase 1 threads the undo API into the dispatcher args object as `undo: undoApi`
  (`grep -n "undo: undoApi" src/app/task-manager.tsx`), with a comment beside it forbidding a
  `useMemo` on the enclosing object. The prediction holds for PROPOSAL state — none of that lives
  here — but a reader planning a merge on the strength of "not expected to touch it" would miss a
  real one-line conflict surface.
- `i18n.ts` / `i18n.de.ts` — that branch adds 12 EN and 12 DE keys. These two files conflict on
  almost any concurrent edit. Whoever merges second re-applies their keys by hand rather than
  resolving the hunk, and `i18n.de.ts` is patched by node utf8 write with `\r\n` anchors, never the
  Edit tool.

Register numbers §352-§359 are on `origin/main` as of `7f90fd81`; new filings start at §360.
