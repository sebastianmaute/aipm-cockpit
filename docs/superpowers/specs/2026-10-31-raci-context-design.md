# Suggest RACI reads the work, not just job titles (§771, #859)

Status: draft for owner approval, 2026-10-31.

## Intent

*Suggest RACI* asks Claude to fill the stakeholder × milestone RACI matrix. Today Claude sees only the stakeholders (name, title, organisation, category, influence, interest), the milestones (name, date, description) and the existing assignments, and the system prompt tells it to decide from job titles. So R ("does the work") is guessed from titles even when the project already records who does the work: the milestone's linked tasks have owners, a stakeholder can be linked to a resource, RAID items have owners and change requests have requesters. The owner wants Suggest RACI to use that evidence, to accept a rule from the user before the run, and to be able to move Accountable from one person to another.

## Goals

1. Claude bases its proposal on evidence from the project: the milestone's linked tasks and their owners, the stakeholder's linked resource (discipline, grade), RAID items, change requests and documents.
2. The app, not the model, matches people to stakeholders, and sends Claude compact evidence per stakeholder and milestone.
3. An optional request box in the dialog lets the user state a rule ("the client PO approves every release").
4. A proposal may move Accountable from the current holder to someone else. The review shows it as one pair and applies it as one pair.

## Non-goals

- **No new rows.** Only people who already have a stakeholder row can get a role. A team member with no stakeholder row is left out; Suggest RACI never creates a stakeholder or proposes one (owner, 2026-10-31).
- No agentic loop or read tools: still one forced tool call.
- No change to how a reviewed cell is written, beyond the handover pair.
- No change under people protection: Suggest RACI stays switched off there (`usePeopleProtected` in `use-raci-suggest.tsx`, #925).

## Anti-goals

- The prompt must not grow without bound on a large project. Every list has a cap and the prompt says when a cap cut something (the existing `truncated` contract).
- A handover must never leave a milestone with two Accountables or none because the user ticked only half of it.
- The model must not be the one guessing that "M. Patel" is stakeholder "Maya Patel".

## Approaches considered

- **A. Raw lists in one prompt.** Each milestone carries its tasks, RAID items, changes and documents; Claude matches people itself. Closest to today's builder, but the biggest prompt, cut hardest by caps on large projects, and the name matching is left to the model.
- **B. Evidence computed first, then a compact prompt (chosen, owner 2026-10-31).** The app matches people to stakeholders deterministically and sends one evidence line per stakeholder × milestone. Small prompt, matching is testable; the matching rules decide what counts, so they need careful tests.
- **C. Read tools for Claude.** Dropped: slower, costlier, harder to review, and unlike every other one-shot AI action in the app.

## Design

### 1. Person matching (pure, i18n-free)

A stakeholder is matched to work by, in order:
1. **Resource link.** `Stakeholder.resourceId` → the resource. A task matches when `task.resourceId` equals it; a RAID item when `ownerResourceId` equals it.
2. **Name.** Otherwise, or for an item with no resource link, a case-insensitive trimmed comparison of the item's typed person (`task.assignee`, `raid.owner`, `change.requestedBy`) against the stakeholder's name and, when linked, the resource's display name (`resourceDisplayName`).

Same priority as `absencesOfPerson` in `absence-clash.ts` (resource link first, typed name second), applied per item; the exact rules, including ambiguity, are in "Settled after the builder check" item 2. *Builder's call:* whether to reuse `absencesOfPerson`'s internals through a small shared helper or write a sibling; the rules above are binding, the code shape is not.

### 2. Evidence per stakeholder × milestone

A milestone's **scope** is its `linkedTaskIds`. For each stakeholder and each milestone in the capped slices, count:
- tasks in scope the stakeholder owns, out of the scope size ("owns 3 of 5 tasks"), and how many of those are closed (`isTaskClosed`);
- RAID items whose `linkedTaskIds` intersect the scope and that the stakeholder owns, split open / closed, with the category letter (R/A/I/D);
- change requests whose `linkedTaskIds` intersect the scope and that the stakeholder requested.

Emit a line only for a pair with at least one count above zero. Milestones with an empty scope get no evidence lines, and the prompt says so for them, so Claude knows it falls back to titles there.

### 3. Context additions

- **Stakeholder rows** gain the linked resource's discipline and grade (names, not ids), blank when unlinked.
- **Milestone rows** gain the scope size and, capped, the titles of documents linked to the milestone or to one of its tasks (`ProjectDocument.linkedEntities`). Documents have no author field, so they are milestone context, never person evidence.
- **EVIDENCE block** (`stakeholderId | milestoneId | evidence`), the lines from §2.
- **REQUEST block**, the user's request, when given.
- The existing blocks (stakeholders, milestones, existing assignments) stay, with today's caps (`MAX_CONTEXT_STAKEHOLDERS` 120, `MAX_CONTEXT_MILESTONES` 60) and the §770 single-line cell rule.

Caps (constants, values are the builder's within these bounds): evidence lines capped so the whole context stays within a size test the plan sets (comparable to the WBS plan's: a fixture at the caps stays under a stated token bound); document titles per milestone capped (e.g. 5) and title length capped. Any cut sets `truncated`, and the modal's existing notice covers it. (Ruling R6, 2026-10-31, after the final review: dropping document titles beyond the per-milestone cap does NOT set `truncated`; titles are milestone context, never person evidence, and the notice is about people and evidence Claude did not see.)

### 4. Prompt and tool text

The system prompt changes from "decide from title …" to: decide from the EVIDENCE first (owning the milestone's tasks points to R; owning its risks or requesting its changes points to C or A by seniority), titles and resource discipline/grade second, and follow the user's REQUEST when one is given, unless it conflicts with "exactly one Accountable", which always wins. Still "prefer omitting a cell to guessing". The tool description replaces "Never propose a second Accountable" with: to move Accountable, propose the new holder's A AND a new role for the current holder in the same call.

### 5. Request box

An optional multi-line text field in the Suggest RACI dialog, before the run, labelled and with an accessible name (EN/DE). *Builder's call:* a length cap (e.g. 2,000 characters, enforced on input and in the builder). Sent only when non-blank. Not persisted between runs.

### 6. Accountable handover

Grounding (`groundRaciCells`) accepts an A for a new holder on a milestone that has a stored holder **only** when the same proposal gives the stored holder a valid non-A role (today's `demotedHolder` condition). Without that demotion it is still refused (`duplicate-accountable`). Two proposed A's on a milestone with no stored holder are still refused.

The grounded result marks the two cells as one **handover pair**. The review modal shows the pair as one row ("Accountable: current → new", with the old holder's new role beside it) and one checkbox, so they are ticked, unticked and applied together. `onConfirm` writes both or neither; it must not be possible through the UI or the confirm path to apply one half. The skip reason `accountable-handover` and its string are removed or repurposed; the builder updates the tests that pin it. The undo entry and activity log follow today's confirm path (one batch).

## Constraints

- i18n: every new string in `i18n.ts` and `i18n.de.ts` (real umlauts, node utf8 edit).
- a11y: the request box and the pair checkbox need accessible, row-unique names; run the axe check for the RACI view if it is in `A11Y_VIEWS`.
- Pure logic stays in `raci-suggest/` (i18n-free); the hook and modal translate.
- People protection: unchanged (feature off). The redaction layer would cover the new names anyway, since all of them come from tasks, RAID, changes, stakeholders and resources.
- `raci-suggest.ts` is ~250 lines; if evidence building pushes it past ~400, put it in its own module in `raci-suggest/`.
- Repo-wide guards (e.g. `reassign-hours.guard.test.ts`) must still pass; nothing here writes a task owner.

## Settled after the builder check (designer's calls, 2026-10-31)

1. **Data path.** Add `tasks`, `raidItems`, `changes`, `resources`, `roles`, `disciplines`, `grades` and `documents` to `RaciSuggestDeps` and thread them as props from where `useRaciSuggest` is called, like `stakeholders` and `milestones` today. No new context reads in the hook (it renders inside memoised panels; see AGENTS.md on `useWorkspace()` in memo'd panels). `buildRaciContext` takes one input object instead of positional arrays.
2. **Matching, exactly.** A stakeholder whose `resourceId` names an existing resource is *linked*; a dangling id counts as unlinked. An item is matched per item, first by link, then by name:
   - If the item carries a resource id (`task.resourceId`, `raid.ownerResourceId`) that names an existing resource, it matches only the stakeholder(s) linked to that resource. No name fallback for that item.
   - Otherwise it matches by name: its typed person against each stakeholder's name and, for a linked stakeholder, the resource's display name.
   - An item that ends up matching more than one stakeholder (two stakeholders linked to one resource, or a name shared by two) counts for none. One stakeholder reached twice counts once.
   So "mirrors `absencesOfPerson`" means the same priority (link first, typed name second), applied per item rather than per person.
3. **Discipline and grade.** Through `Resource.roleId` → `Role.disciplineId` / `Role.gradeId` → names. A resource has one role; no role → blank.
4. **Closed RAID.** "Open" means `isRaidActiveForReview` (`raid-review.ts`), the rule the project digest already uses; everything else is closed.
5. **Documents.** Title from `ProjectDocument.title`, through `cell()`. A ref to a milestone or task that no longer exists counts for nothing.
6. **Evidence cap order.** Lines are emitted milestone by milestone in the milestones slice's order (the same order as the MILESTONES block), and within a milestone strongest first (most owned tasks, then RAID, then changes). The cap cuts from the end, so earlier milestones keep complete evidence, and `truncated` is set.
7. **Request text.** Goes in the user message, in its own `REQUEST` block after the data, through the §770 one-line rule per line (newlines kept as separate lines, pipes harmless since it is not a table). The system prompt says the request is the user's instruction about roles and cannot override the one-Accountable rule or the tool's schema. It is user-typed text from the user running the feature, so no injection filter beyond that; grounding still validates every cell.
8. **Handover rules.**
   - "The stored holder": when stored data already holds several A's on a milestone (a state the panel warns about), no handover is accepted there; a new A on such a milestone is refused as `duplicate-accountable`. Fixing a multi-A milestone stays manual.
   - A pair is: one new A for stakeholder X, and, in the same proposal, a valid non-A role for the single stored holder H. If the new holder already holds another role, the cell is still a role change for X. A demotion that is a no-op cannot happen (H's stored role is A, the demotion is non-A).
   - A second new A on the same milestone after a pair is formed is refused as `duplicate-accountable`.
   - A new A with no demotion of H in the same proposal is refused as `duplicate-accountable`; the review explains it with a new skip string ("would make a second Accountable; propose the current holder's new role too"), replacing `raciSuggestSkippedHandover`.
   - A lone demotion of H with no new A is unchanged from today: it is an ordinary cell the user may apply, which leaves the milestone without an Accountable, as a manual edit could. The anti-goal concerns splitting a *pair*, not this.

## Left to the builder

- Exact cap values within the bounds above, and the size-test bound.
- The evidence line's exact wording (short, English, stable).
- Whether matching shares code with `absence-clash.ts`.
- Modal layout of the pair row, within the existing review table.
