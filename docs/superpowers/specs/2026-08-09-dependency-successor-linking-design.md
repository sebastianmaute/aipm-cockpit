# Dependency search and successor linking — design

Date: 2026-08-09
Supersedes: §3.4 of `docs/superpowers/specs/2026-08-07-ui-batch-undo-budget-people-dependencies-design.md`
Baseline: `main` @ `5cf49651` (0.226.0 "Emshwiller"). Target release: 0.227.0.

## Why this document exists

§3.4 of the parent spec was written against an assumed interface. Four of its claims were
measured false before this design was drafted:

1. **`DependenciesEditor` has two call sites, not one.** `task-form-fields.tsx:465` (modal,
   draft-staged, Save/Cancel) and `task-row.tsx:808` (inline row popover, live write-through via
   `onInlinePatch`, `tasks-section.tsx:444`). The parent's "staged in the draft, Cancel discards"
   applies only to the modal; the popover has no draft to stage into.
2. **The searchable picker already exists as a shared primitive.** `EntityLinkPicker`
   (`entity-link-picker.tsx`) is the chips-plus-search-dropdown control, entity-agnostic, already
   driving tasks through `TaskLinkPicker`. The parent proposed building on `combobox-shared.tsx`,
   but `ComboboxOptions` takes `filtered: string[]` and cannot render an object option — which is
   why `global-search-box.tsx` and `entity-link-picker.tsx` each hand-rolled their own
   `<ul role="listbox">`. A third hand-roll was not warranted.
3. **A new `task-search-match.ts` would duplicate live code.** `picker-filter.ts` +
   `wildcard-match.ts` + `use-task-picker-options.ts` already provide case-insensitive substring
   matching on `taskName`, `*` globbing with every other metacharacter escaped, id matching,
   empty-query-matches-all, a 20-item cap, and an `extraFilter` predicate whose documented purpose
   is "self / cycle exclusion". Only the `#42` spelling of an id query is missing.
4. **"The whole save is one undo entry" is false today.** `use-task-submit.ts:211` calls
   `captureFieldChanges` with `TASK_UNDO_GROUPS`, which emits one entry per changed field group or
   key. The create path (`:229`–`:273`) takes no undo capture at all.

Everything below is grounded in the code as it stands at the baseline commit.

## Scope

Successor linking lives in the **task modal only**. The inline row popover is removed and the
relations cell becomes read-only.

Out of scope: hydrating existing successors into the editor, per-chip type tooltips, restoring
browse-without-typing, any change to `sanitizeInlinePatch`, any fix to the create path's missing
undo capture.

## 1. Modal structure

The existing single `Field` labelled "Dependencies" becomes two, both inside the existing
`isVisible("dependencies")` gate:

```
Field "Predecessors"   group  sm:col-span-2
Field "Successors"     group  sm:col-span-2
```

No new field-visibility key — adding one would ripple into the modal-field-visibility settings for
no user-visible gain.

Each group renders, top to bottom: chips, search box, type `<Select>`. Controls sit below the
search because `EntityLinkPicker` renders chips-then-search as one unit; placing them last keeps
"what the next add does" adjacent to where the task is picked.

★ `depHelp` moves **out** of the editor and renders once in `task-form-fields.tsx`, below both
groups. It sits inside the sub-component today (`dependencies-editor.tsx:169`), so rendering the
sub-component twice would print it twice. Its text is also reworded — it currently opens "Link this
task to a predecessor", which is false for the successor group; the four type explanations that
follow are direction-neutral and stay.

★ `group` stays on both `Field`s. The trap documented at `task-form-fields.tsx:457` — a chip's
remove ✕ rendering above the group's first form control, so a plain caption adopts the ✕ and
clicking the label fires a removal — applies unchanged, because `EntityLinkPicker` also renders a
remove ✕ per chip.

★★ Both groups are rendered by **one** internal sub-component taking a `direction` prop, invoked
twice. Two hand-copied picker blocks in one file is a `dup:check` clone, and that gate is blocking.

`DependenciesEditor` gains no `ToggleButton`. Direction is structural, so it needs no toggle, no
glyph and no colour — which is also what makes it announce correctly (see §6).

### Accepted losses

- **Per-chip type tooltip.** Today each chip carries `title={t(lang, depTypeHelpKey(dep.type))}`
  (`dependencies-editor.tsx:108`). `LinkPickerEntry` is `{id, code, label}` with no title slot, and
  extending the shared primitive was rejected. The type `<Select>`'s option labels already read
  `FS — Finish→Start`, and the standing `depHelp` line stays below both groups.
- **Browsing without typing.** `EntityLinkPicker` opens its dropdown only on a non-blank query
  (`entity-link-picker.tsx:108`), where today's `<Select>` lists every eligible task unprompted.
  Restoring it would mean relaxing `hasQuery` in a primitive shared by two other callers.

## 2. Draft shape

`TaskFormDraft` gains one field beside `dependencies`:

```ts
successorLinks: { taskId: number; type: DependencyType }[]
```

`emptyForm()` seeds `[]`. `openEditModal` seeds `[]`. Cancel discards it with the rest of the
draft, exactly like every other field.

★ Deliberately **not** hydrated from the live graph. Listing existing successors would mix stored
predecessors with derived successors in one chip list, and removing a derived chip is a write to
another task with no staging story at modal-open. Staged successors are additive-only within one
modal session: they can be added and un-staged, but the editor never shows a successor link that
already exists in storage.

## 3. Matching

No new module. `picker-filter.ts` gains one behaviour: a leading `#` is stripped **for the id
comparison only**, so `#42` matches task 42 the way `42` already does. The text matcher still sees
the raw query, so a `#` typed inside a task name keeps matching by name. A query of `#` alone
therefore compares an empty string against every id (no match) and falls through to the text
matcher, which matches names containing `#` — it does not become an empty query. Everything else —
the `*` wildcard via
`wildcard-match.ts`, the escaping of all other metacharacters, case-insensitive unanchored
substring matching, empty-query-matches-all, the 20-item cap — is already implemented and stays as
is.

Both groups call `useTaskPickerOptions(tasks, selectedIds, query, extraFilter)`. The `extraFilter`
is direction-aware:

```
predecessors: task.id !== ownId && !wouldCreateDependencyCycle(ownId, task.id, taskById)
successors:   task.id !== ownId && !wouldCreateDependencyCycle(task.id, ownId, taskById)
```

★★★ The reversed argument order in the successor arm is the single highest-risk line in this
feature. Adding successor `S` means `S` gains a dependency on this task, so the walk starts at `S`.
A fixture with no existing chain returns `false` for both orders, so the naive test cannot tell a
correct guard from a reversed one — the test must seed the collision explicitly and assert that the
two argument orders give **different** verdicts on the same fixture.

★ On the create path `ownTaskId` is `null` and no cycle is possible in either direction: nothing
can depend on a task that does not exist yet. Both arms skip the guard, as the current code already
does for predecessors (`dependencies-editor.tsx:62`, `:66`).

★ Links stay id-unique. `referencedIds.has(tid)` (`dependencies-editor.tsx:86`) already forbids the
same task appearing twice, and the reversed guard makes "predecessor and successor of the same
task" a cycle by construction. That is what makes `EntityLinkPicker`'s id-keyed `onAdd`/`onRemove`
a correct fit.

## 4. Apply on save

New pure, i18n-free `successor-links.ts`:

```ts
resolveSuccessorLinks({ ownId, links, tasks })
  -> { edits: Map<number, { before: TaskDependency[]; after: TaskDependency[] }>, skipped: number }
```

For each staged link `{ taskId: S, type }`:

1. Target absent from `tasks` (deleted between staging and Save) → `skipped++`.
2. `wouldCreateDependencyCycle(S, ownId, taskById)` → `skipped++`.
3. `next = sanitizeDependencies([...(target.dependencies ?? []), { taskId: ownId, type }], knownIds, S)`.
4. `next.length` equal to the target's prior length → `skipped++` (target at the 20-link cap, or
   already linked).
5. Otherwise record `{ before: target.dependencies ?? [], after: next }`.

★★ Step 3 routes through the real `sanitizeDependencies` rather than re-implementing the cap or the
dangling-ref check. `task-dependency-write.ts:167` takes the same approach for the AI write path,
for the same reason: the 20-link cap has exactly one owner.

★ Step 1 mirrors the `setRaid` guard already at `use-task-submit.ts:255` — check membership, leave
the array untouched when the target is gone, never throw.

**Update path.** Fold into the one existing functional setter (`use-task-submit.ts:191`):

```ts
setTasks((prev) => prev.map((row) => {
  if (row.id === editingId) {
    return applyStatusChange({ ...row, ...payload, localModifiedAt: stamp }, form.status, today);
  }
  const edit = edits.get(row.id);
  return edit ? { ...row, dependencies: edit.after, localModifiedAt: stamp } : row;
}));
```

**★★★ Create path — resolution must run AFTER the id mint, against `nextList`.** The new task's id
is minted at save (`mintId("task", tasks)`, `:232`), and step 3 validates against `knownIds`.
Resolving against the pre-mint array makes the new task's id a dangling reference, so
`sanitizeDependencies` drops every staged link and the feature silently no-ops on create — green
tests, no error, no links. Resolve against `nextList` (which contains the new task), and patch the
targets **before** the `tasksRef.current = nextList` assignment at `:247` so ref and state agree.

When `skipped > 0`, show `showToast("info", t(lang, "depSuccessorsSkipped", skipped))`, beside the
existing `fieldsAdjusted` toast at `:181`.

Jira-synced tasks remain eligible successor targets. The modal already permits dependency edits on
them — only assignee changes are blocked (`use-task-submit.ts:131`) — so excluding them here would
contradict the surface the feature lives on.

## 5. Undo

One `captureFieldEdit` per entry in `edits`:

```ts
captureFieldEdit?.({
  setter: setTasks,
  kind: "task.updated",
  id: targetId,
  before: { dependencies: edit.before },
  after: { dependencies: edit.after },
  stampField: "localModifiedAt",
  name: targetTaskName,
});
```

★★ `captureFieldEdit` **merges** `before`/`after` onto the live row by id rather than replacing the
whole row (`use-undo-stack.ts:135`), so these entries cannot revert a field the save never touched.
The whole-row alternative — `capture({ edited, fromArray })` — would produce the single entry the
parent spec asked for, at the cost of inheriting the still-open defect in `docs/open-followups.md`
§50, where a whole-row undo restores a stale row and reverts note logs added since.

★ Pushed **after** the own-task captures, so the target entries sit on top of the stack. A bare
`undo()` then peels the successor links first — the most recently-intended act — and `undoThrough`
from the own-task's oldest entry unwinds the entire save as one commit. A modal save already emits
several entries today, and 0.226.0 shipped `undoThrough`/`redoThrough`, so multi-entry saves are one
gesture to unwind.

★ Honest gap, not fixed here: the create path takes no undo capture for the new task itself, so a
create-with-successors produces entries for the targets only. Undoing them removes the links and
leaves the new task in place. Pre-existing behaviour.

## 6. Inline relations cell

`DepRelationsCellImpl` (`task-row.tsx:769`) reduces to `<DependencyChips deps={deps} />`.

Removed: the `editable` prop and its call-site argument, `useTaskLookup` at `:771`, the
`EMPTY_TASKS` memo at `:779`, the `EMPTY_TASKS` module const at `:92` if nothing else uses it, the
`open`/`btnRef`/`close` state, the `PopoverPanel` wrapper, and the `DependenciesEditor` /
`PencilIcon` / `IconButton` imports where they become unused. `eslint --max-warnings=0` is fatal on
a stranded import, so this must be swept in the same commit.

★ `useTaskLookup` at `:733` (`DependencyChipsImpl`) survives, so the `RowLookupContext` split that
exists to bound dependency-chip re-renders stays justified.

`depEditRelations` is deleted from `i18n.ts` and `i18n.de.ts` together (key parity is a tsc gate).

★ `task-inline-patch.ts` is left untouched. Its `dependencies` branch (`:53`) loses its only caller,
but the file is allowlist-style — "Only keys PRESENT in `patch` are emitted" — so a future inline
dependency patch would silently drop the field rather than write it unsanitized. Deleting the branch
would force `ownTaskId` and `knownTaskIds` out of `InlinePatchContext` and its caller, which is
churn inside a guard for no behavioural gain. Recorded as a dead-branch follow-up, not slice work.

## 7. i18n

New keys, EN and DE:

`depPredecessors` · `depSuccessors` · `depSearchPredecessors` · `depSearchSuccessors` ·
`depSearchPlaceholder` · `depTypePredecessor` · `depTypeSuccessor` · `depUnlinkPredecessor` ·
`depUnlinkSuccessor` · `depSuccessorsSkipped` (one `{0}` count placeholder) ·
`taskHintSuccessors`.

Reworded: `depHelp` — drop the leading "Link this task to a predecessor" sentence, keep the four
direction-neutral type explanations.

Removed — each verified to have exactly the uses listed, and no others outside the two dictionaries:

| Key | Sole use today | Why it goes |
|---|---|---|
| `depDependencies` | `task-form-fields.tsx:464` | replaced by `depPredecessors` + `depSuccessors` |
| `depEditRelations` | `task-row.tsx:788`, `:789`, `:804` | the popover is deleted |
| `depRemove` | `dependencies-editor.tsx:119`, `:120` | replaced by the two direction-specific unlink labels |
| `depAdd` | `dependencies-editor.tsx:165` | `EntityLinkPicker` adds on selection; there is no Add button |
| `depType` | `dependencies-editor.tsx:139` | one name for two selects is a duplicate-name failure; replaced by the two direction-specific labels |
| `depPickTask` | `dependencies-editor.tsx:154` | the task `<Select>` is gone |
| `depPickTaskPlaceholder` | `dependencies-editor.tsx:157` | as above |

★ `depMissing` **stays** — `task-row.tsx:739` uses it independently of this editor, and it is also
what the picker passes as a dangling chip's `label`. `taskHintDependencies` stays as the
Predecessors hint; `taskHintSuccessors` is its counterpart.

DE must use real umlauts. `i18n.de.ts` is CRLF and the Edit tool corrupts umlauts and curls double
quotes there — patch via a node utf8 write anchored on `\r\n`, then re-verify the bytes.

## 8. Accessibility

Two pickers on one modal means two search boxes, two clear buttons and two type `<Select>`s. All six
need distinct accessible names. Clear buttons follow the `TaskLinkPicker:69` precedent —
`` `${t(lang, "clear")} – ${label}` `` — so each inherits its group's unique label.

★★★ **axe cannot detect duplicate accessible names, at any seed size, in any view.** Measured
against the installed axe-core 4.12.1: of its 105 rules, 69 carry one of the four tags
`e2e/a11y.spec.ts` requests, and none of them flags two controls sharing a name. Separately, the
task modal opens only on interaction and is therefore not reached by the view scan at all. A unit
test rendering the modal and asserting all six names are distinct is the **only** detector, in
either layer.

Removing the row pencil deletes N `Edit relations – <task>` buttons from a scanned view — strictly
fewer controls, no new risk on that surface.

## 9. Tests

1. Reversed cycle guard, **collision seeded explicitly**, asserting the two argument orders return
   different verdicts on the same fixture. A chain-free fixture passes either way.
2. Target already at the 20-link cap → counted in `skipped`, target unchanged.
3. Target deleted between staging and Save → counted in `skipped`, no throw, other links still
   applied.
4. Create path: the link resolves against the **minted** id — assert the target's new dependency
   carries the new task's id, not that "a link exists".
5. `captureFieldEdit` called once per touched target, with `{dependencies}` and nothing else in
   `before`/`after`.
6. Cancel discards staged successors — no target is written.
7. `#42` matches task 42 in `picker-filter`; `#` alone matches only tasks whose **name** contains
   `#`, not every task — proving the strip did not turn it into an empty query.
8. Six-distinct-accessible-names test across the two rendered groups.

Coverage: `successor-links.ts` is a new pure `.ts` and therefore coverage-gated — it carries its own
tests. `picker-filter.ts` extends its existing suite.

## 10. Gates and release

Per-slice: `npx tsc --noEmit` · `npx eslint --max-warnings=0 src/app` · `npm run test:run` ·
`npm run test:shuffle` · `npm run size:check` · `npm run dup:check` · `npm run docs:symbols:check`.

★★★ Never read a gate's exit code through a pipe — redirect to a file, echo `$?` unpiped, then read
the file.

`size:check` counts `split("\n").length`, one more than `wc -l`. `dependencies-editor.tsx` (211) and
`task-form-fields.tsx` grow; `task-row.tsx` shrinks. Read real numbers with
`node -e "console.log(require('fs').readFileSync('<file>','utf8').split('\n').length)"` before
budgeting.

`dup:check` compares the total duplicated-**line** percentage across all formats against the
`--threshold` in `package.json`. The single-sub-component decision in §1 exists to keep this green.

Release 0.227.0 with a new codename. Bump `src/app/version.ts` (APP_VERSION, APP_BUILD_DATE,
milestone), add a `CHANGELOG.md` entry, append any new `versionHighlight*` key to
`APP_HIGHLIGHT_KEYS` with EN and DE strings, and update the five ungated version sites:
`package.json`, both `package-lock.json` occurrences, the README shields badge (version **and**
codename), and the generated header on all five `docs/CODEMAPS/*.md`.

★ Codename uniqueness needs **two** greps of `CHANGELOG.md` — older entries separate the version and
codename with an em-dash, so a used name reads as free under a single quote-form search.
