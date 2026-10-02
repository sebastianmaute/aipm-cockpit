# Undo — the in-memory undo/redo stack

Owns `src/app/undo/`: the pure engine `undo-stack.ts`, the hook `use-undo-stack.ts`
(`useUndoStack`, `UndoStackApi`), the field-patch helpers (`field-groups.ts`,
`merge-field-value.ts`, `append-patch.ts`, `capture-field-changes.ts`,
`write-through-fields.ts`) and the top-bar `UndoControl` / `RedoControl` (`undo-control.tsx`).
Also the two modules that sit just outside it: `use-undo-hotkey.ts` (`useUndoHotkey`) and
`use-undo-batch.ts` (`useUndoBatch`, `collapseCaptures`).

Does NOT own the `status` ⟺ `completedDate` pair (`docs/AGENTS/task-status.md` — the undo
RESTORE is one of its five writers), the `undo`/`redo` activity rows and what the completion trend
reads from them (`docs/AGENTS/activity-log.md`), the note-log registers (`docs/AGENTS/rich-text.md`)
or the load hold (`docs/AGENTS/platform.md`). One fact, one doc.

★★★ **THE ENGINE CANNOT REVERSE A CREATE, AND CAPTURING ONE IS WORSE THAN NOT CAPTURING IT.** See
"Creates" below before adding undo to any write that adds a row.

## What is undoable

- **Entities.** `UndoEntityKey` in `use-undo-stack.ts` lists every entity an undo label can name —
  read the union rather than a copy of it here. A capture whose kind resolves to none of them still
  undoes; it just gets the generic label (next section).
- **Human writes.** Single-row edits, deletes, bulk edits, bulk deletes, clear-all and cascade deletes,
  each through one of the four capture methods on `UndoStackApi` (`capture`, `captureFieldEdit`,
  `captureComposite`, `captureFieldRows`).
- **AI writes: updates, deletes and the RAID escalation only.** The chat tool handlers that capture
  do so with one `captureComposite` entry each. Enumerate them by kind, one line per site:
  `grep -n 'kind: "' src/app/use-chat-dispatcher.ts src/app/use-register-tools.ts`.
  No `create_*` handler captures, and `use-document-tools.ts` captures at none of its sites
  (`grep -c captureComposite src/app/use-document-tools.ts` prints 0). An APPLIED staged plan
  collapses all of its captures into ONE entry through `useUndoBatch` / `collapseCaptures`, with a
  `primaryCount` summed from the captures that reversed something.
  ★ The AI allocation plan (`useAllocPlan`, logged `ai.allocationPlan`) is undoable too, but not
  through a chat tool handler: it records one `capture` with `kind: "bulk.edit"` and
  `entityKey: "resource"`.
- **Not undoable:** creates (below), `send_inquiry` (an AI update: its handler in
  `use-chat-dispatcher.ts` bumps `Task.inquiriesSent` with no capture — see the `shouldStage`
  docstring in `chat-proposal.ts`), project delete (`handleDeleteProject` takes no capture — §6 (a)),
  anything done in a popout (below), and anything across a reload — the stack is React state and
  dies with the page.
- **Retention:** `UNDO_CAP` entries on each stack (`grep -n "UNDO_CAP = " src/app/undo/use-undo-stack.ts`).

## Creates

`UndoOp` is `"delete" | "edit"`, nothing else, and the undo direction never removes a row.
★★★ A create captured as `removed: [newRow]` is still LIVE at undo time, so
`applyUndoRestoreWithRemap` sees its id as present and takes the id-REUSE branch: it mints
`max + 1` and splices in a SECOND copy of the row. Read the delete loop in
`applyUndoRestoreWithRemap` — the `present.has(item.id)` test is the whole mechanism.
★★ In a fragment that also carries a real delete it is worse again: `buildBeforeImages` resolves
every image's index against ONE `fromArray` and clamps a miss to 0. The created row is absent from
the pre-op array and the deleted row from the post-op one, so whichever the fragment passes, one of
the two lands at index 0 — pass post-op and the create misplaces its sibling delete. As the PRIMARY fragment
it additionally publishes its phantom re-mint as the id-remap every `fkRemapField` cascade follows.
The rule: capture updates and deletes only; exclude created rows from the images entirely and count
only the rows the entry can reverse. `commitBuckets` (`use-budget-buckets.ts`) is the worked example
— its kind can be `budget.created`, but it builds its images from `deleted` and `editedBefore` alone.
★ An activity kind ending `.created` is NOT a counter-example: `ActivityKind` and `UndoOp` are
different vocabularies (the `imagesRemoveRows` docstring says the same).

## Two registrations for a new undoable entity

★★★ A NEW UNDOABLE ENTITY NEEDS **TWO** REGISTRATIONS, not one. Adding the `ActivityKind`s buys the
activity log; the undo LABEL needs the kind's prefix added to `UndoEntityKey`, `ENTITY_SINGULAR` and
`ENTITY_KEY_SET` (`use-undo-stack.ts`), plus an `undoEntity*` EN/DE string (and an `ENTITY_PLURAL`
entry if the entity is ever counted). tsc forces `ENTITY_SINGULAR` once the union grows, because it
is a `Record` over it; `ENTITY_KEY_SET` is a plain `Set` and forces nothing. Miss it and
`entityKeyFromKind` returns `null`, so `buildUndoLabel` returns its generic "Edited/Deleted N
item(s)" fallback **without ever using `opts.name`** (it trims the name one line earlier, then
returns without it) — the capture site's title is silently dropped from every undo/redo label while
restore itself still works. That is invisible to functional tests; calendarEvent shipped exactly
that way (the `ENTITY_KEY_SET` comment records it). The lockstep is now pinned by a sweep test in
`undo/use-undo-stack.test.tsx` that walks every `.created`/`.updated`/`.deleted` prefix in
`ACTIVITY_KIND_TO_KEY` and fails on any that resolves to the generic label — `settings` is the one
exemption (a singleton config write, no row to name).
★ `bulk.edit` names no entity by construction, so a `bulk.edit` capture must pass `entityKey`
(`grep -rn 'kind: "bulk.edit"' src/app` and read each site; they do today). A
staged AI plan that touched two entities deliberately gets the generic label — see the "MIXED PLAN"
comment in `collapseCaptures`.

## Four capture shapes — pick by what the op wrote

| Method | Images | Restore |
|---|---|---|
| `capture` | whole rows (`removed` / `edited`) | `applyUndoRestoreWithRemap` |
| `captureComposite` + `capturePart` | whole rows, N arrays | same, per fragment, with an id-remap |
| `captureComposite` + `captureFieldPart`, or `captureFieldRows` | field patches, N rows | `mergeFieldPatch` (three-way, per key) |
| `captureFieldEdit` (usually via `captureFieldChanges`) | one field group, one row | `{ ...row, ...patch }` spread |

★★★ **WHOLE ROWS REVERT CONCURRENT WRITES; PATCHES DO NOT.** A whole-row image restores every field
as it stood at capture, so it also reverts whatever a different writer changed meanwhile (a note
added through the notes window, a background calendar stamp — §50). Use a field patch whenever the op
edited FIELDS; `capturePart` only when it removed or replaced whole rows. `buildBulkFieldEdits`
(`field-groups.ts`) builds the patches for a bulk edit and completes coupled groups (§180).
★★ `WRITE_THROUGH_FIELDS` (`write-through-fields.ts`) is the BACKSTOP for the whole-row paths that
remain: the engine's restore and redo let the LIVE row win on those keys of an edit-image
(`applyPreserved`), and `buildBulkFieldEdits`
excludes them from a patch through the derived `WRITE_THROUGH_KEYS`. Membership rule: a field belongs
there iff a writer other than the entity's own save handler can change it on a row nobody is editing.
A new such field that is not added there is silently reverted by a whole-row undo. The remaining
whole-row paths are §177.
★★ **The task blocker pair (`blockers` + `blockerLog`) is a member AND is never undoable from any
writer** (spec: no undo for blocker writes, like notes). The single-row capture paths never see the
pair change: the task editor has no blockers field and its submit carries the pair from the STORED
row (`use-task-submit.ts`), and the inline cell cannot write it (`sanitizeInlinePatch` drops the
key). The AI `update_task` site (`use-chat-dispatcher.ts`) captures a whole row, so undo keeps the
live pair, and it skips the capture outright when only write-through keys (plus `localModifiedAt`)
changed — otherwise Ctrl+Z would spend a step reverting nothing. ★ That skip also covers an AI update that changes nothing at all (deliberate: an identical-row undo step is equally dead). ★ The bulk edit derives its WRITE
set from `rowChanged`, not from the captured patches, because a row whose only change is its
blockers yields no patch and must still be written.
★★ **THE SINGLE-ROW PATH IS NOT THE THREE-WAY MERGE.** `mergeFieldPatch`'s docstring says it
"Replaces the `{ ...row, ...patch }` spread the undo runner used to do" — true for `captureFieldPart`,
the only caller (`grep -rn "mergeFieldPatch(" src/app --include=*.ts | grep -v "\.test\."`).
`captureFieldEdit`'s own `merge` still spreads the patch, so a single-row field undo writes the
captured group's values wholesale.
★★★ **NEVER pass a `captureFieldPart` as the first fragment of a composite that also holds a
`capturePart` cascade** without flagging the cascade `isPrimary: true`. `compositeUndoRunner` falls
back to fragment 0 when nothing is flagged, a field part publishes no remap, and every
`fkRemapField` cascade then points at stale ids with no error. `use-task-submit.ts` rides that
fallback today, harmlessly, because its composite has no cascade (§134). The `captureFieldPart`
docstring carries the call-site grep — it needs all three call shapes. It prints one line per
composite capture site, so its count grows with every new site and is not quoted here.
★ `captureFieldPart` requires DISTINCT ids and nothing on the path enforces it: a repeated id
collapses to its last patch, and `captureFieldRows` over-counts its toast.

## Field groups

`changedFieldGroups` turns one row's diff into one entry per changed logical field; a changed key in
a multi-key group drags its partners into the same entry, so they revert together. The groups live
in `field-groups.ts`:
- `TASK_UNDO_GROUPS` — `status` + `completedDate` (why, and which capture routes consult it:
  `docs/AGENTS/task-status.md`), and the assignee identity triple.
- `CHANGE_UNDO_GROUPS` — `status` + `decisionDate`.
- `CALENDAR_EVENT_UNDO_GROUPS` — `startDate` + `recurrence` + `exceptions`; the sanitizer coupling
  that forces it is in `docs/AGENTS/features.md` ("Meeting CRUD logs + undoes").
- The RAID, milestone, stakeholder and resource groups are empty, so every changed key is its own
  entry — which is why `docs/AGENTS/rich-text.md` requires a RAID save to carry the STORED `noteLog`:
  a stale one would otherwise be captured as an undoable entry of its own.

★★ A group is only as good as the capture routes that pass it; a route that builds its own patch
without the groups can split a pair.

## The runners — undo, redo, and what must stay out of an updater

Each entry holds a `Runner`: applying it mutates state and returns its inverse, so undo↔redo
alternates indefinitely. Redo images are built INSIDE the undo's setter updater from `prev`, which
is idempotent under StrictMode's double invoke (same `prev`, same images).
★★ **Side effects run OUTSIDE every updater.** `commitUndo` runs the entry's runner before its
`setStack`/`setRedoStack` and the toast; putting a restore inside an updater would apply it twice
under StrictMode.
★★ **`undoThrough` is NOT a loop over `undo()`.** The stack ref is refreshed by an effect, so N calls
in one tick read the same stale stack and undo the top entry N times. It reads the ref ONCE and
commits as one batch; `redoThrough` mirrors it.
★ A new capture clears the redo stack, and so does `undoById` on an entry that is not on top (the
capture toast's Undo button calls it), because that redo can no longer stay coherent.
★★★ **A REDO THAT RE-REMOVES ROWS MUST ARM THE DESTRUCTIVE-SAVE BYPASS, OR THE SAVE IS REFUSED (§295).**
`fragmentUndoRunner` and `capturePart`'s redo call `arm` when `imagesRemoveRows` is true;
`compositeUndoRunner` only forwards it. `captureFieldEdit`, `fieldRowsRunner` and the undo direction
never arm, deliberately: none of them can remove a row (the first two map over existing rows; undo
only re-inserts or reverts), and an arm nobody spends leaks to the next unrelated save. `task-manager.tsx` wires `allowDestructiveSave` through a
ref, and it is armed in the same synchronous block as the setter.
★★ **Redo removes a row only if it still matches the recovered image** (`rowsEqualExcept`, ignoring
the write-through keys at the top level only) — so a redo cannot destroy an unrelated row that
reused a freed id. §179 is why it ignores those keys: whole-row equality let a note added after the
undo block the redo, and the next undo then spliced in a second copy.

## Gates on the stack

- **Popouts record nothing (§91).** `isReadOnly` is read lazily on every capture and every restore
  entry point: in a popout, captures push nothing and toast nothing, and undo/redo return without
  running a runner or logging. `UndoControl`/`RedoControl` are not rendered there.
- **The load hold.** `useUndoHotkey`'s document keydown listener is the one undo path that does not
  unmount during `loadPending`, so `task-manager.tsx` guards both callbacks on it (see the §548
  comment beside the call). The hotkey skips inputs, textareas, selects and contenteditable, so
  native field undo still wins there.
- **The history panel reads `activeIndex` through `clamp` everywhere** — the entry list can shrink
  while the panel is open (a Ctrl+Z from the focused list), and a raw read over-counts and throws on
  Enter. See the `undo-control.tsx` header.
- ★★★ **EVERY ENTRY IS SCOPE-STAMPED, BECAUSE THE STACK OUTLIVES A PROJECT SWITCH (§628, closed).**
  `useUndoStack` lives in `TaskManagerInner`, which an in-place switch does not remount, and every
  runner closes over the workspace's stable setters — so before §628 an undo after a switch
  re-inserted the old project's deleted rows into the new one and overwrote its same-id rows. Three
  mechanisms in `use-undo-stack.ts` / `use-undo-batch.ts` now hold it:
  - `pushEntry` stamps each entry with `getScopeEpoch()`, and the stamp travels with it across
    stacks (an undo's push onto the redo stack, `redo`'s push back, and the `undoThrough` /
    `redoThrough` inverses). `undo`, `redo`, `undoById`,
    `undoThrough` and `redoThrough` DROP a stale entry (`dropStaleScopeWrite`, no toast) instead of
    running it; when the entry the user picked was stale, the call stops rather than running an
    older one in its place.
  - `useUndoBatch.runBatched` pushes after `await fn()`, so it reads the epoch when the batch OPENS
    and passes it as `readEpoch`; `pushEntry` refuses a push whose stamp is already stale. ★ The
    refusal is whole-batch: rows the batch wrote into the new project after a mid-batch switch get no
    undo either. That they land there at all is the proposal-apply gap, §600 (open).
  - `usePruneUndoOnScopeChange(loadPending, pruneStale)`, a render-time reconcile called after
    `useStorageBackend`, removes the stale entries from BOTH stacks on each falling edge of the load
    hold, and only those. The epoch moves only on a real scope change, so history survives Save-As, a
    cancelled Open or Save-As, a same-project reload and a declined or failed migrate-to-Turso. A
    SUCCESSFUL migrate ends in `window.location.reload()` (`use-storage-turso-ops.ts`), which empties
    the in-memory history anyway. ★★ Do not "simplify" this to clearing on every rise of the hold —
    that was the first cut, and it threw away history across every one of those ops.

## Open entries

- §6 — undo residuals (project delete, no cross-reload undo).
- §132 — a multi-target successor fan-out labels as "Edited N item(s)".
- §133 — a redo-created dangling dependency is repaired on only two of six backends.
- §134 — `use-task-submit.ts` rides the positional-primary fallback.
- §177 — the whole-row capture paths still revert unlisted concurrent writes.
- §299 — an undo/redo that flips a task's delivered-ness writes no completion or reopening entry.
- §600 — the staged proposal-apply path has no scope guard (the rows a batch refused at push still
  land in the new project; see "Gates on the stack").
