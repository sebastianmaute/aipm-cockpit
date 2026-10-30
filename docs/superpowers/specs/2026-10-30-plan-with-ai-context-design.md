# Plan with AI understands the project (§769, #857) — design

Status: draft for owner approval, 2026-10-30.

## Intent

*Plan with AI* (Resources → Planning) today sees only the hours grid: each resource's name, role, unit and planned
against available hours per period (`buildAllocContext`, `alloc-plan/alloc-plan.ts`). It answers with hour values only.
So "bring Maya under 100 % in September by sharing her work" moves hours to a colleague while Maya's tasks stay hers,
and after Apply the hours plan and the task assignments disagree. The owner wants it to understand the project —
tasks, milestones, RACI and rates — and to propose the changes a project manager would actually make.

## Owner decisions (2026-10-30)

1. **Both kinds of change.** A proposal may move tasks to other people **and** edit hours directly (for planned work
   that is not a task yet).
2. **A task move carries its hours.** Moving a task moves its remaining estimate through the shared §774 step
   (`useReassignHours`), so the hours follow; the review window shows each move with its hours.
3. **Alternatives, the user picks.** When there is more than one sensible way, the answer holds up to three
   alternatives; the user picks one in the review window, then ticks or unticks its individual changes. One sensible
   way → one proposal, as today.
4. **Over capacity is a warning, not a refusal** (matches §774's notice).
5. **The AI sees** open tasks per person, milestones, RACI and rates — all in the first version. **Other projects are
   out** (follow-up).
6. **Approach A**: extend the one existing call (one round trip, forced tool answer, grounding, review window, one
   undo). Rejected: B, two calls (summaries first, details second — double wait and cost, the details can drift from
   the chosen summary); C, hand the request to the chat assistant (loses the review window and side-by-side picking).
7. **A task with no linked owner** (unassigned, or a typed name with no `resourceId`) may be given an owner. §774 moves
   no hours for it (no one's plan holds them), so the AI may add hour edits for the new owner for that work; the
   review window says those hours come from the edits, not from the move. `covered-by-move` does not apply to such a
   move (it touches no cells). The system prompt says so.
8. **The cost line is internal cost** (hours × internal rate, added minus removed), following the app's rule that a
   person marked external (`Resource.isExternal`) carries no cost. When an alternative moves work to or from an
   external, the line names it: "+€800 internal · 16 h to externals, not costed". No billing line.
9. **Design choices go to the owner** (standing): when the build meets a choice this document does not settle and it
   changes what the user gets, ask.

## Goals

- The AI can propose task reassignments, and the hours follow them without being counted twice.
- The AI prefers people already involved (RACI R or A on the milestone a task belongs to) over people whose role only
  fits on paper.
- Each alternative shows its internal cost effect, and names hours moved to or from externals (who carry no cost).
- A proposed value above available hours is visibly flagged before Apply.
- Everything the model returns stays untrusted until grounded against the live workspace, exactly like today's cells.

## Non-goals

- Load from other projects (the person's work elsewhere). Filed as a follow-up when this ships.
- Creating, splitting, rescheduling or re-estimating tasks. The AI moves whole tasks only; dates and estimates stay.
- Editing RACI, milestones or rates.
- Changing §774's rules (split by workdays, giver cap, receiver caps, notice text, undo shape).
- Auto-apply. Nothing is written without the user's Apply.

## Anti-goals (a failure even if it "works")

- **Hours counted twice**: a task move and an hour edit both shifting the same work.
- **Silent overwrite**: applying a change against data that moved while the review window was open (today's stale
  check must keep holding, and extend to tasks).
- **Invented work**: a move naming a task or person that does not exist, or moving a closed task.
- **Prompt injection through free text**: task names, milestone names and descriptions are user data; one line each
  (the §770 `oneLine` rule), never able to start a fake row in the digest.
- **A slower, heavier feature for small projects**: a project with five people and twenty tasks must feel the same.

## What the AI sees (the digest)

`buildAllocContext` grows three sections after RESOURCES, each one line per item, ids prefixed with `#` as today:

- **TASKS (open only)** — not closed (`isTaskClosed` false), with an owner who is a listed resource, or unassigned.
  Per task: id, one-line name, owner resource id (or `unassigned`), remaining estimate in hours, start and due date,
  status, the ids of FS predecessors that are still open, the milestone id(s) it is linked to (worked out from
  `Milestone.linkedTaskIds`; `Task` has no milestone field), and its hours per period as §774 would split them by
  workdays. That split is the private `splitAcrossPeriods` in `reassign-hours.ts`; the builder exports it or adds a
  helper. It is an UPPER bound of what a move carries: the real move is also capped by the giver's planned hours and
  the receiver's room, which the review window shows exactly (`planHoursMoves` with the chosen receiver).
- **MILESTONES** — id, one-line name, date, achieved or not.
- **RACI** — per milestone, the resource ids that hold R or A (stakeholders linked to a resource via `resourceId`;
  C and I are left out to save tokens; stakeholders with no resource are left out — they cannot receive hours).
- **RATES** — on each resource line, its hourly internal rate (from its role, as `periodCost` reads it; none for an
  external), in the plan currency, with the currency code once in the PLAN line.

**Size limit.** A fixed budget of task lines (constant, builder sets the number; start near 150) and milestone lines
(near 40). When cut, tasks are ordered so the most relevant come first: tasks of resources named in the instruction
(matched by display name), then tasks overlapping the instruction's period if one is named, then by due date. A
trailing `…(N more tasks truncated)` line, as for resources. The system prompt already tells the model what a truncated
view means; it gains one sentence that a task not shown may still exist.

## What the AI answers (the tool)

`propose_allocations` keeps its name and its forced `tool_choice`. Its input becomes:

```
alternatives: [            // 1..3
  {
    summary: string,       // one short line, shown as the alternative's title
    taskMoves: [ { taskId: integer, toResourceId: integer } ],
    cells:     [ { resourceId: integer, periodKey: string, hours: number } ],   // as today
    rationale?: string
  }
]
```

A top-level `cells` (today's shape) is still accepted and read as one alternative, so an older model answer or a
cached response cannot break the feature. The system prompt adds: a task move carries the task's hours automatically
(shown per period in the digest); never also return cells for those hours; return more than one alternative only when
they are genuinely different ways (moving tasks vs. shifting hours, or different people), at most three; prefer people
with R or A on the task's milestone; respect available hours unless asked.

## Grounding (untrusted → reviewable)

Per alternative, against the LIVE tasks, resources and plan at propose time:

- **Task moves** are dropped with a reason when: the task does not exist; it is closed; its owner is unchanged; the
  target is not a listed resource; the same task is moved twice in one alternative (first wins, later ones skipped as
  duplicate); the task is Jira-synced (`!!task.jiraKey`, read-only everywhere else too). Caps apply to the WHOLE
  answer, not per alternative: `MAX_ALLOC_CELLS` (200) cells and a moves cap (builder sets it; start near 50) across
  all alternatives, so three alternatives cannot overflow the response. The builder raises the call's `max_tokens`
  (8192 today, `alloc-plan-call.ts`) if a test answer at the caps needs it.
- **Each kept move is planned with `planHoursMoves`** on the live state, so the review window shows exactly what §774
  will move, including its shortfall and cap notes.
- **Cells** go through today's `groundAllocationCells` unchanged, plus one new skip reason, **`covered-by-move`**: a
  cell whose resource and period is touched by any kept move in the same alternative is dropped. This is the rule
  that makes double counting impossible. (Builder's call recorded below: an absolute cell value on top of a delta move
  would be wrong as soon as the user unticks the move.)
- An alternative left with no move and no cell after grounding still shows, with its skipped list, as today's
  skipped-only preview does; an answer with no alternatives at all is today's "nothing was proposed" toast.

## The review window

`alloc-plan-modal.tsx` keeps its stages (input → thinking → preview). In preview:

- **Alternative picker** at the top when there are two or more: a `SegmentedControl` (accessible, keyboard-operable,
  state not colour-only) with each alternative's summary. Switching keeps each alternative's own tick state.
- **Per alternative**, a one-line summary of effect: "Moves 3 tasks (24 h) · edits 4 cells · cost +€1,200 internal".
- **Task moves section**: one row per move with its checkbox, "#42 Design review: Maya Patel → Liam Foster", and
  below it the hours as §774's notice would phrase them ("16 h: Sep 8 h, Oct 8 h"), plus its shortfall or cap note.
  Each checkbox has a row-unique accessible name (`buildRowTokens`/`rowLabel` pattern).
- **Hour edits section**: today's rows unchanged.
- **Warnings**: a row whose result (after all ticked moves and cells of this alternative) is above that person's
  available hours in a period shows a warning marker with text ("Liam Foster: 190 h of 160 h in Sep"), not colour
  alone. The warning is recomputed as rows are ticked or unticked.
- **Cost effect**: the sum over ticked changes of hours × the person's internal rate, added minus removed, in the plan
  currency via `formatCurrency` (decision 8). Externals add nothing and are named with their hours. Recomputed on
  tick. A resource with no role adds nothing and the line says so once ("2 people have no rate").
- **Skipped list**: today's, plus the new task-move reasons and `covered-by-move`, each with an EN and DE text.

## Apply

One click, one undo entry, one activity entry:

1. **Stale check** (extends today's): a ticked move is skipped and counted when its task's live owner, remaining
   estimate, dates or status changed since propose, or when the giver's or receiver's stored hours in any period the
   move touches changed (each kept move snapshots those at propose time); a ticked cell whose live value moved is skipped, as today. One toast
   reports both counts (single toast slot).
2. **Task moves** go through `useReassignHours.prepare`, so the hours move by §774's rules and §774's notice text is
   folded into the apply toast. Today `onConfirm` uses the plain `capture` (`kind: "bulk.edit"`), and `record()`
   always makes an entry of its own; to get ONE undo entry, `useAllocPlan` calls `captureComposite` itself with the
   task part, the step's resources part and the cells part. `captureComposite` is threaded to `ResourcesPanel`
   through `workspace-section` like `onCaptureUndo` today.
3. **Cells** apply as today (`applyAllocationCells`) on top of the post-move state; `covered-by-move` guarantees no
   ticked cell touches a moved cell.
4. Undo reverses tasks, hours and cells together. The activity log gets §774's own `resource.hoursMoved` entry (the
   step's `commit` writes it, unchanged) plus one Plan-with-AI entry with the alternative's NUMBER and its counts,
   language-neutral. The model's `summary` text is never stored: it is untrusted, and the activity log is later read
   into AI prompts.

**Wiring.** `useAllocPlan` lives in `resources-panel.tsx`, which is `memo()`'d and takes function props through
`useStableHandlers`. It already receives `tasks` (not yet passed to `useAllocPlan`); it gains `milestones`,
`stakeholders` (read), `captureComposite`, and the task-manager's `reassignHours.prepare` as its own function prop
through `useStableHandlers` (the `reassignHours` object is new on every render, so passing it whole would break the
memo bail), threaded as props — never a `useWorkspace()` call inside the panel (AGENTS.md "Several panels are
memo()'d"). `reassign-hours.guard.test.ts` lists the new write path as ROUTED.

## Constraints

- i18n: every new string in EN (`i18n.ts`) and DE (`i18n.de.ts`, real umlauts, edited by node utf8 script).
- Accessibility: row-unique names, `SegmentedControl` for the picker, warnings readable without colour; the review
  window is a modal and follows the dismissal protocol already in place.
- The AI master switch, the popout guard and the "no key → no button" rules stay as they are.
- Free text in the digest is one line per item (`oneLine`), as §770 made it for names.
- File size: `alloc-plan.ts` is 946 lines; the digest sections, the tool schema and the grounding of moves go in new
  pure modules beside it (`alloc-plan/` subdirectory), i18n-free.
- Byte-stable serializers and the six write paths are untouched (no new persisted field).

## Calls I made (owner may override)

- RACI shows only R and A, and only stakeholders linked to a resource.
- An hour edit on a cell touched by a move in the same alternative is dropped (`covered-by-move`) rather than
  re-based on the post-move value.
- At most three alternatives.
- Jira-synced tasks cannot be moved.
- Apply logs two activity entries (§774's own and Plan with AI's); the shared §774 step is not changed to merge them.
- A move is stale when the task OR the people's planned hours in its periods changed.
- The caps count across all alternatives together.
- The old single-`cells` answer is still accepted.

## Left to the builder

- The exact token budgets and caps (task lines, milestone lines, moves per alternative), with a test that a large
  sample stays inside the request size the current call already uses.
- Module split and names inside `alloc-plan/`.
- How the instruction's names and periods are matched for the truncation order (a simple, documented match is
  enough).
- Visual layout inside the review window, within the palette and the toolbar/button conventions.

## Done means

- A unit test per grounding rule (each skip reason, both kinds), each failing before its code.
- A test that a proposal moving a task and editing a cell of the same person and period drops the cell.
- A hook test: Apply with one move and one cell is one undo entry; undo restores task owner, hours and cell.
- A stale test for a move whose task changed while the window was open.
- Digest tests: closed tasks absent, one line per free-text item, truncation line and order.
- Modal tests: picker switching keeps tick state, warning text appears and clears as rows are ticked, cost line.
- EN and DE strings present; tsc, eslint, the static gate green; the full suite in CI.
