# Edit-task modal rework — design

**Date:** 2026-09-05
**Branch:** to be cut from `origin/main` (`03df1445`, 0.282.0 "Zamyatin")
**Register range:** mint from **§383**. §368–369 are mine and unused; §370–382 are a peer's, unlanded, and by our own rule not reserved — but renumbering into a reused number means sweeping every citation, so the gap is left deliberately.

## Goal

Rework the edit-task modal: reorder its sections, pair its relationship pickers, replace the
standalone *Time spent* field with a Jira-style Time tracking dialog opened from the existing
progress bar, and move Budget bucket into the effort section.

## Scope — six items

1. Section order: `5. Status & Notes` moves to third position, behind `2. Scheduling`.
2. The task-name dictation mic moves beside the field's caption.
3. `4. Relationships`: predecessors and successors share one row, half each.
4. A Time tracking dialog replaces the *Time spent* field, opened by clicking the progress bar.
5. Group and Labels share a row below the estimate row.
6. Budget bucket moves into the effort section, on its own row between the other two.

## Non-goals

- No change to how time is *reported* — `evm.ts`, `snapshot.ts` and the Gantt read
  `originalEstimateMinutes`/`timeSpentMinutes` and keep reading exactly those.
- No worklog history. Jira's dialog is backed by individual worklog entries; this stores only the
  three totals. Adding a worklog register would be its own slice with its own persistence.
- No change to the other eight modals in `MODAL_IDS`, even though several would suit the same
  section treatment.

---

## Section order

New order and visible numbering:

| # | Section | i18n key |
|---|---|---|
| 1 | Details | `taskFormSectionDetails` |
| 2 | Scheduling | `taskFormSectionScheduling` |
| 3 | Status & Notes | `taskFormSectionStatus` |
| 4 | Effort & Classification | `taskFormSectionEffort` |
| 5 | Relationships | `taskFormSectionRelationships` |

A JSX block move plus five `index` literals in `task-form-fields.tsx`. The keys and their DE strings
are untouched, so EN/DE parity cannot move.

**Verified:** `TaskFormSection` is rendered from exactly one file. Reproduce:

```bash
grep -rn "taskFormSection" src e2e --include=*.ts --include=*.tsx | grep -v "^src/app/i18n"
```

returns five lines, all in `task-form-fields.tsx`. Nothing in `e2e/`, the help content or the tour
keys off a section number, so renumbering is contained.

## Effort & Classification layout

Three rows in the section's existing `grid-cols-1 sm:grid-cols-2`:

```
[ Original estimate       ] [ Time tracking (button)  ]
[ Budget bucket (select)  ] [                         ]
[ Group                   ] [ Labels                  ]
```

Budget bucket is half width in the left column — matching every other select in the modal — with the
right cell empty. The standalone *Time spent* `EffortField` is **deleted**; spent is edited only
through the dialog.

Budget bucket's existing guard travels with it unchanged:
`budgetLink !== undefined && isVisible("budgetBucket")`.

### The visibility tier, and why it moves

`modal-fields.ts` registers `{ id: "estimate", tier: "advanced" }` and
`{ id: "timeSpent", tier: "full" }`. Leaving that split would give an *advanced*-tier user an
estimate with an empty cell beside it. So `timeSpent` moves to `tier: "advanced"` and the pair
appears and disappears together.

★★ **The `id` stays `"timeSpent"` and only its `labelKey` changes.** That id *is* the key under which
each user's cog-checklist choice is persisted, so renaming it to `"timeTracking"` would silently
reset the preference for everyone who had set it. A label change is invisible to the stored key.

## The Time tracking widget

One `<button>` filling the cell beside Original estimate, containing the coloured track, the
`spent / estimate · N%` line and a caption.

- The track goes `aria-hidden`; today's `role="progressbar"` is dropped. `EffortProgressBar` has
  exactly ONE non-test call site (`task-form-fields.tsx`), so dropping it strands nothing.
  ★ `role="progressbar"` does survive elsewhere in the app — `settings-sections/ai-usage-panel.tsx`
  renders its own, on a different component this slice does not touch. The claim is about this
  component's role, not about the role app-wide.
- The accessible name spells the state out rather than saying "Time tracking" alone, so a screen
  reader user learns the figures without opening the dialog.
- With **no estimate set** it still renders and is still clickable — time can be logged against an
  unestimated task. The muted empty-state track and `taskEffortNoEstimate` copy are reused.

`effort-progress-bar.test.tsx` currently asserts the progressbar role. It moves deliberately, as part
of this change, not as collateral.

## The dialog

Mirrors the reference in `docs/patterns/timetracking.png`:

- Title, progress bar, "*N* logged".
- A sentence naming the original estimate.
- **Time spent** and **Time remaining** side by side.
- The `2w 4d 6h 45m` format hint with the w/d/h/m legend.
- Save / Cancel.

Both inputs reuse the existing `EffortField`, so `parseDuration`/`formatDuration` and the
invalid-input notice come for free — `duration.ts` already exports both and already handles w/d/h/m.

**Save writes to form state, not to storage.** The task may be unsaved and have no id yet, so the
dialog cannot persist independently. Values land on the task at the task form's own Save; Cancel
discards them.

**Remaining shows the derived figure until overridden.** An empty box shows
`max(0, estimate − spent)` as its placeholder; typing pins a value; clearing it returns to derived.
That is what makes the override semantics visible rather than implicit.

★★ It **stacks** over `TaskFormModal`. `Modal` stacks, but the Escape/Tab protocol is owned by
`docs/AGENTS/ui-shell.md`'s dismissal section and `isTopmostOfKind`. Read that section before writing
the implementation, not after. A dismissal test asserting on FINAL focus is structurally blind here:
both traps are `document` keydown listeners firing in registration order, so whichever surface opened
last silently corrects the other. The shape that actually kills the mutant is a NON-EDGE Tab inside
the layered-above dialog.

## Data model — `remainingEstimateMinutes`

New optional field on `Task`, canonically in MINUTES, matching its two siblings.

**Semantics:** absent ⇒ derived `max(0, estimate − spent)`. Present ⇒ the user's pinned value,
which no estimate edit overwrites. Clearing the box stores `undefined`, never `0` — a stored zero
means "no work left", which is a different claim from "not overridden".

### The write paths — derived by following `timeSpentMinutes`, not from prose

Reproduce the touch list:

```bash
grep -rn "timeSpentMinutes" src/app --include=*.ts | grep -v "\.test\."
```

| File | What changes |
|---|---|
| `types.ts` | the `Task` field |
| `csv-codecs-core.ts` | `CSV_COLUMNS` (the TASK constant is unprefixed — **not** `TASK_CSV_COLUMNS`, which does not exist) and `fieldToString` |
| `csv-codecs-decode.ts` | `buildTaskFromObj` → `sanitizeOptionalMinutes` |
| `markdown-columns.ts` | a `{ key, label }` row beside `TimeSpentMin` |
| `markdown-codecs-decode.ts` | the `colMap` entry and the decode object |
| `sanitize-core.ts` | the optional-minutes admission |
| `templates.ts` | template task sanitising |
| `use-task-submit.ts` | form → task |
| `__fixtures__/golden-*` | regenerated — a legitimate new-column format change |

Turso needs no hand-written code: `turso-schema.ts`'s task spec takes `columns: CSV_COLUMNS` and
`fromObj: buildTaskFromObj`, so DDL and inserts derive for both the single and tenant layouts. An
existing database self-heals through `turso-migrate.ts`'s PRAGMA diff.

★ `idKind` is not in play — `Task.id` is numeric and the spec keeps the default `"integer"`.

★★ **Sweep prose in the same commit.** `sanitize-core.ts` and `snapshot.ts` both carry comments
naming the effort fields as a pair. A third field makes those comments wrong, and no gate can see it.

## Relationships

Predecessors and Successors drop `sm:col-span-2` and take one grid cell each. The shared `depHelp`
legend keeps `sm:col-span-2` beneath them.

★★ Both `Field`s keep `group`. Their first labelable descendant is a chip's remove ✕, so the default
`<label>` branch would bind the caption to it and clicking "Predecessors" would delete a link. That is
the mis-binding trap the file's own comment records; do not "simplify" it away while moving the
elements.

## The dictation mic

New `captionAction?: React.ReactNode` prop on `Field` (`task-form-layout.tsx`).

★★★ **Passing `captionAction` FORCES `group` mode.** `Field`'s default branch wraps caption and
children in a `<label>`; a `<label>` with no `for` binds to its first labelable descendant, and a
button is labelable — so a mic in the caption would make clicking the words "Task name" start
dictation instead of focusing the input. Forcing `group` makes that unreachable for every future
caller, rather than fixing it once at this call site.

Consequence: the Task name input needs its own explicit `aria-label`. A named `role="group"` does not
give its input an accessible name, and an unlabeled form control is an axe-critical failure.

The dictation status line stays below the input, where it is today.

## Testing

The gates are close to blind here, so the unit tests are the whole safety net:

- axe cannot see two controls sharing an accessible name — measured: none of the 69 rules carrying
  the four tags `e2e/a11y.spec.ts` requests flags it, at any seed size, in any view.
- `label-content-name-mismatch` carries `wcag21a` but is also `experimental`, and axe's default
  `tagExclude` drops it, so a tag-only `runOnly` never runs it.

What gets written:

1. **Caption binding.** Clicking the "Task name" caption focuses the input and does **not** start
   dictation. Mutation-proved by reverting the forced `group` — the test must go red.
2. **Tracking button name.** Its accessible name contains its visible text (WCAG 2.5.3 is
   containment, case-insensitive and position-independent — not prefix).
3. **Round-trip.** `remainingEstimateMinutes` survives all six write paths.
4. **Byte-stability.** A task carrying no remaining value serialises byte-identically to today. This
   is the test that catches a codec change masquerading as a new column.
5. **Override semantics.** Clearing the remaining box stores `undefined`, not `0`, and the widget
   returns to the derived figure.
6. **Section order.** The five headings render in the new order with the new numbers.

★★ Every guard mutation-proved by reading WHICH cases fail, not the exit code — a record of
`N failed / M passed` whose sum equals the file's runtime test count. `git checkout --` is
deny-blocked, so a mutant is reverted by an inverse anchored write with uniqueness asserted in both
directions, ending on an empty `git diff --stat`.

## Gates

`npx tsc --noEmit` (exits **2** on diagnostics) · `npx eslint --max-warnings=0` on touched files ·
touched vitest files, then `npm run test:run` · `npm run test:shuffle` (new tests are added) ·
`npm run size:check`. Never two vitest processes at once.

★ `src/app/*.ts(x)` are CRLF. Edit tool only — never Write, never `sed -i`. `i18n.de.ts` takes an
anchored node utf8 write with `\r\n` anchors and real umlauts.

## Owed

An eye-verify of the stacked dialog in a real browser. jsdom has no layout, so nothing in the unit
suite can see the half-width cells, the empty cell beside Budget bucket, or whether the tracking
button's hit area covers the cell. `npm run e2e:crossengine` is the only layer that can see the
Escape-ordering behaviour in real Chromium and real Firefox.

## Risks

- **The new column is the only irreversible part.** Everything else is layout. If the column proves
  wrong it has to be removed from six paths and the fixtures regenerated again.
- **The peer's unlanded branch edits `i18n.ts`, `i18n.de.ts` and `task-manager.tsx`.** This slice adds
  i18n keys to both dictionaries. That merge is adjudicated per row, not per file — a resolution
  taking one side wholesale loses the other's keys and every gate stays green afterwards.
