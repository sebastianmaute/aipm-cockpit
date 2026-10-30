# Reassigning a task moves its planned hours (§774, #863)

Status: draft for the owner's approval, 2026-10-30.

## Intent

When a task changes owner, its planned hours should change owner too, so that Resources → Workload shows the
real load after a rebalance. Today the hours plan (`Resource.utilization`, one value per planning period, typed by
hand or written by *Plan with AI*) and task assignments do not know about each other. In the demo, Maya Patel stood
at 240 % with one overdue task. That task was reassigned to Liam Foster: her Open and Overdue counts dropped, but
Util (now) stayed at 240 %.

This is the first of four related pieces (§774, then §769, §773, §771). §769 (*Plan with AI* reassigns tasks along
with hours) will reuse the step built here.

## Decided with the owner

- **Every owner change moves the hours**, whichever path made it. It is not limited to the Workload triage.
- **Automatic, with an undoable notice**, not a confirm dialog. The owner first chose "confirm each", then took it
  back in favour of the notice. The issue text's "a confirm step, never automatic" is replaced by this.
- **One shared reassign step** (approach 3 below), which every path driven by a person or by Claude goes through.
- **The new owner may go over capacity.** The hours move in full even when that overloads the new owner, and the
  notice says so, for example "Liam is now at 130 % in Sep". Rebalancing often means accepting a temporary overload;
  the notice makes it visible. No limit, no partial move.

## Goals

- The owner change and the hours move are one action: one undo step and one activity-log entry.
- The notice says what moved, for example "Moved 16 h from Maya to Liam (Sep 8 h, Oct 8 h)", and carries Undo.
- When nothing moves, the notice says why: no remaining estimate, the task is done or cancelled, or a person is not
  a linked resource.
- Each person's planned hours change in their own unit (hours or percent).

## Non-goals

- Summary or parent tasks: the app has none (`Task` carries no parent link), so no estimate can be counted twice.

- Deriving the hours plan from tasks. The plan stays hand-made. This only keeps it in step on a reassignment.
- *Plan with AI* reassigning tasks (that is §769, which reuses this step).
- Moving hours when an estimate or a date changes without an owner change.
- Changing load in other projects.

## Anti-goals (a failure even if it technically works)

- A sync, import, project load, undo or redo that moves hours. Only a deliberate reassignment by a person or by
  Claude may move them.
- Negative planned hours, or hours taken from periods outside the task's span.
- A reassignment that silently changes the plan with no notice, or that cannot be undone in one step.
- A notice that claims more hours moved than did.

## How the hours move

- **Hours to move:** the task's `remainingEstimateMinutes`, in hours. If the task has no remaining estimate,
  nothing moves (`originalEstimateMinutes` is not a fallback: a stale original estimate would move hours already
  spent).
- **Span:** from the task's `startDate`, or today when the task is overdue or its start lies in the past, to its
  `dueDate`. With no `startDate`, the span starts today. If the due date has already passed (an overdue task), the
  remaining hours go to the period that contains today.
- **Split:** proportional to each period's workdays inside the span (the overlap, not the whole period; holidays
  excluded, as `workdaysInRange` counts them). For example, two weeks in September and one in October split 2 : 1.
  A period whose share the old owner's plan does not hold counts as "not in Maya's plan". (My call.)
- **Estimate used:** the one after the edit, when the same save changes the owner and the estimate (task editor,
  bulk edit, the chat's `update_task`). (My call.)
- **Capped by the old owner's plan:** in each period, at most what the old owner's plan holds is taken, where "holds"
  means the planned hours the Planning grid shows for that period, net of absences (`periodCapacityHours`). The new
  owner receives exactly what was taken, never more. (My call, from the builder check.) The notice reports the amount actually moved, and says
  "(N h not in Maya's plan)" when the plan held less than the estimate.
- **Units:** each person's stored value changes by whatever makes the hours the grid shows for them rise or fall
  by exactly the moved hours, in their own unit (hours or percent, per `periodCapacityHours`), even when the two
  people's absences or units differ. So a moved 8 h shows as 8 h less for one and 8 h more for the other. (My call.)
  Where a percent-mode receiver has no net capacity in a period (fully absent), that period's share cannot be shown
  as hours; it stays with the old owner and the notice counts it as not moved.
- **Periods** are the plan's canonical periods (`ResourcePlan.granularity`, `generatePeriods`). Hours outside the
  plan window are not moved, and the notice says so.

### When nothing moves (the notice says why)

- the task has no remaining estimate, or it is 0;
- the task is done or cancelled (`isTaskClosed`);
- either the old or the new owner is not a linked resource (`Task.resourceId` before, the new person after): a
  free-text owner has no planned hours;
- the owner is unchanged (no notice at all). "Owner" is the linked resource (`Task.resourceId`): a change of name or
  email alone, with the same resource, is not a reassignment (my call);
- the task's span lies entirely outside the plan window.

Clearing the owner (to nobody) is not a move. It leaves the plan as it is, with no notice. Clearing the unlinked
owners in Workload triage is the same.

## Approaches considered

1. **Inside the workspace's task setter**, comparing old and new owners on every change. This catches every path,
   but cannot tell intent: Jira sync, import, load, undo and redo also change owners, and each would need a flag.
   One missed flag silently changes someone's plan. Rejected.
2. **At each path separately.** Explicit, but six copies, and a path added later would quietly not move hours.
   Rejected.
3. **One shared reassign step (chosen).** A pure planner computes the move. One hook,
   `reassignTasks(changes, source)`, applies the owner change and the hours move together and records one undo
   entry, one activity entry and one notice. Every path driven by a person or by Claude calls it. A guard test lists
   every code site that writes a task's owner, and fails when a new site is neither routed through the step nor on
   an explicit exempt list (with a reason).

## Shape (the builder's starting point)

- **Pure, i18n-free planner** (new module, for example `reassign-hours.ts`):
  `planHoursMove(task, fromResource, toResource, plan, ctx) → { cells: per-period deltas for both resources, movedHours, shortfallHours, outsideWindowHours, reason? }`.
  `reason` is set when nothing moves. Deterministic: `today` is passed in.
- **Batch:** `planHoursMoves(changes[], …)` folds several tasks (bulk edit) into one set of resource patches, with
  the cap applied to the running total, so two tasks cannot take the same hours twice.
- **Hook** (for example `use-reassign-tasks.ts`), called unconditionally like the other deps-object hooks: applies
  the task patch and the resource patch through functional setters, records one `captureComposite` entry (task rows
  plus resource rows), one activity entry, and shows the notice. The undo label names the task (or the count, for a
  bulk edit).
- **Undo:** `captureComposite` already takes fragments from several collections in one entry
  (`docs/AGENTS/undo.md`). Undo follows the existing field-patch merge (`mergeFieldValue`), so a planned-hours
  edit made after the reassignment is kept rather than overwritten (my call). The tasks fragment and the resources fragment are both edits (no creates), so the
  create trap does not apply. The builder confirms the redo arm restores both too.
- **Activity log:** one entry per reassignment action (a bulk edit counts as one action), carrying the moved hours
  per person. New `ActivityKind`s need the undo registrations `docs/AGENTS/undo.md` describes.

### Paths that go through the step

The builder enumerates these from the code and records the list beside the guard test. Known today:

- Workload triage's Owner select (`onReassignTask`, `workload-triage-handlers.ts`);
- the task editor's save (`use-task-submit.ts`);
- the table's inline assignee cell (`use-task-row-handlers.ts`, `task-row.tsx`);
- the Kanban card, if it edits the owner;
- bulk edit (`bulk-edit-modal.tsx`), as one action;
- the Action Center's Assign-owner (`use-action-center-handlers.ts`), which assigns an unassigned task, so it never
  moves hours (no old owner), but routes through the step for one rule;
- Claude: the chat's `update_task` (`use-chat-dispatcher.ts`, where `withReassignFields` already moves the email
  with the name), and inline AI edit (`inline-ai-edit/plan.ts`). On a staged plan, the hours move is part of the
  same applied entry (`useUndoBatch`), and the tool result tells the model what moved.

**Exempt** (owner changes that are not a reassignment): Jira sync (`use-jira-sync.ts`), Outlook imports, CSV,
Markdown and JSON decode, project load and templates, undo and redo, the load-time FK backfill, and
"Clear unlinked" (it clears owners, it does not hand work over).

## Constraints

- AGENTS.md hard constraints: i18n EN and DE (the notice texts, German with real umlauts); no
  `react-hooks/set-state-in-effect`; the load hold (`loadPending`) and the scope epoch for anything that awaits
  (the chat path awaits); functional setters (the bulk-edit "N saves in one tick" rule).
- The planner stays pure and i18n-free; the surfaces translate.
- No new persisted field (the move writes existing `Task` and `Resource.utilization` fields), so the six write paths
  are untouched.
- Popouts: undo is not available there (`docs/AGENTS/undo.md`), so a popout reassignment moves the hours and shows
  the notice without Undo. The builder confirms the popout writes reach the same setters, or excludes popouts with
  a stated reason.

## Left to the builder

- Module and hook names. The notice uses the existing toast slot as a normal (not warning) notice, EN and DE (my
  call); the over-capacity sentence is part of the same notice.
- Rounding: whole hours for hours-mode cells, one decimal for percent, chosen so that the two sides of a move always
  agree.
- The exact notice wording within the goals above, and its German text.
- The guard test's mechanism (an AST or grep inventory of task-owner writers), as long as it fails on a new
  unrouted writer and passes on the exempt list.

## Register

§774 has no entry in `docs/open-followups.md` yet; the implementation branch adds it (closed, with the index row)
and closes #863 through the PR description.
