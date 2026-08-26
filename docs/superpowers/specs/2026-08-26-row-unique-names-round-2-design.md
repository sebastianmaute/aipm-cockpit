# Row-unique accessible names, round 2 — the Tasks surface and the stragglers

_Opened 2026-08-26 against 0.261.0 "Leckie" (main `5a864d3e`). Closes `docs/open-followups.md`
**§247** and **§248**, and translates the hardcoded English accessible names that grounding turned up
(§5). Opens one new entry for what that sweep deliberately excludes. Target release
**0.262.0 "Swainston"** (spare codename: Marske — both verified absent from `CHANGELOG.md`)._

Round 1 was the row-unique-accessible-names slice (`2026-08-25-row-unique-accessible-names-design.md`,
shipped 0.259.0). It closed what it could reach and filed §245–§248 for what it could not. This slice
takes §247 and §248. **§246 is deliberately NOT in scope** — see §8.

---

## 0. Grounding against 0.261.0

Verified by command on 2026-08-26, not assumed. Every row below was re-checked against the tree at
`5a864d3e`; the register entries were filed one day earlier and all their surfaces are intact.

| Fact | State | How |
|---|---|---|
| `buildRowTokens` / `rowLabel` / `TokenRow` | live in `src/app/row-tokens.ts` | `grep -n "export " src/app/row-tokens.ts` |
| `expectRowUniqueNames` + `RowUniqueOptions` | live in `src/test/row-unique-names.ts`; `roles` **defaults to `["button"]`**; `requireCollisionSeed` is opt-in | read the file's own docstring |
| `raid-panel-rows.tsx` | already converted (`rowTitleToken`) — the precedent for this shape | `grep -rn '"selectItem"' src/app --include=*.tsx \| grep -v test` |
| Raw-argument `selectItem` sites | **five**: `change-panel.tsx` (`item.title`) · `milestones-panel.tsx` (`m.name`) · `resource-directory.tsx` (`resourceDisplayName(r)`) · `stakeholders-panel.tsx` (`item.name`) · `timelog-people-table.tsx` (`displayId`) | same grep |
| `TaskStatusSelect` | names itself `` `${t(lang,"colTaskStatus")} – ${task.taskName}` `` from the task ALONE | `grep -n "aria-label" src/app/task-status-select.tsx` |
| Kanban card callers | `task-kanban-board.tsx` and `task-kanban-swimlanes.tsx` render `<TaskKanbanCard>`. ★★ `tasks-section.tsx` also matches the grep but only inside a COMMENT | `grep -rln "<TaskKanbanCard" src/app --include=*.tsx \| grep -v '\.test\.'` then `grep -n "TaskKanbanCard" src/app/tasks-section.tsx` |
| Table caller | `tasks-section.tsx` renders `<TaskRow>` over `visibleRows` | `grep -n "<TaskRow" src/app/tasks-section.tsx` |
| Both Kanban views take ONE array | `tasks={healthFilteredTasks}`, passed to board and swimlanes alike | `grep -n "healthFilteredTasks" src/app/tasks-section.tsx` |
| `task-row.tsx` name sites | **11** `aria-label`/`label`/`entityTitle`/`entityName` sites keying on raw `task.taskName`, **plus the name button, whose accessible name is its CONTENT and carries no `aria-label`** (§3.5) | `grep -cE "(aria-label\|label\|entityTitle\|entityName)=.*task\.taskName" src/app/task-row.tsx` |
| **`task-row.tsx` size** | **793** lines, **no baseline entry** → the hard 800 cap applies | node metric below |
| `budget-panel.tsx` size | **796**, no baseline entry | node metric below |
| `tasks-section.tsx` size | 1050 against a 1081 baseline — room to grow | node metric below |
| `budgetReorderHandle` | referenced only by `budget-panel.tsx` and the two i18n dicts — **no test anywhere** | `grep -rln "budgetReorderHandle" src e2e` |
| `learning-insights.tsx` rows | keyed on `kind`; the header cell and the per-row `<select>` share `learningColOverride` | `grep -n 'learningColOverride' src/app/learning-insights.tsx` |
| `templates-section.tsx` rows | keyed on `tpl.id`, displayed as free-text `tpl.name` | `grep -n 'templatesRename' src/app/settings-sections/templates-section.tsx` |
| `knowledge-links-field.tsx` | anchor is bare `aria-label={t(lang,"documentsOpen")}`; the SIBLING Remove button is already row-qualified, with a comment reasoning about exactly this failure | `grep -n 'documentsOpen' src/app/knowledge-links-field.tsx` |
| Axe | flags duplicate accessible names in NO view, at NO seed size, under the four tags the gate requests | measurement recorded in AGENTS.md's a11y bullet |
| `docs/superpowers` | in `SKIP_DIRS` — this file's line citations do not move the doc-claims ratchet | `grep -n "SKIP_DIRS" scripts/doc-claims-lib.mjs` |

★ Read a file's size with the ratchet's OWN metric, never `wc -l` — `check-file-sizes.mjs` measures
`readFileSync().split("\n").length`, one MORE than `wc -l` for a newline-terminated file:

```bash
node -e "console.log(require('fs').readFileSync('src/app/task-row.tsx','utf8').split('\n').length)"
```

`LIMIT = 800` in `scripts/check-file-sizes.mjs`, and a file over it with **no baseline entry** fails
as a NEW oversized file. `task-row.tsx` therefore has **7 lines of headroom** and `budget-panel.tsx`
has **4**.

---

## 1. The problem, stated once

WCAG 2.4.6 is a property of the **rendered list**, not of a row. A per-item component handed one task
cannot know that another rendered task shares its name, so it cannot disambiguate itself at any cost.
Interpolating a row field proves the name DIFFERS when the field differs; it proves nothing when the
field REPEATS — and a repeating field is the entire premise of this defect class.

That is §248's durable lesson (`t(lang, "selectItem", item.title)` was dismissed at triage as a scan
false positive; `selectItem` is `"Select {0}"`, so two rows titled "Alpha" render two controls named
"Select Alpha"), and it is §247's structural reason. Both entries reduce to one rule:

> **Uniqueness can only be established by whoever can see the list.**

---

## 2. Architecture — one mechanism

Whoever renders a list builds the token map; per-item components receive their own token as a
**required** prop. No new abstraction: `buildRowTokens(rows)` returns `Map<Id, string>` and
`rowLabel(verb, token)` composes `` `${verb} – ${token}` `` (EN DASH U+2013).

Two row shapes are handled differently, and the distinction is the part worth carrying forward:

- **Free-text names** (`task.taskName`, `tpl.name`, `link.name`, `item.title`, `m.name`) — the field
  can repeat, so they need `buildRowTokens`.
- **Structurally-unique keys** (`learning-insights`' `kind`, `timelog`'s `userId`) — the value IS the
  React key, so it cannot repeat within one render. A plain qualifier suffices and a token map would
  be ceremony. ★ The discriminator is "can this value repeat in one rendered list", NOT the call form.

★ `tokens.get(id)` is `string | undefined`. Every call site falls back `?? <raw name>`, which is
exactly today's behaviour — a missing entry degrades to the current bare name rather than rendering
`undefined`.

★ Token maps are memoized on the RENDERED array, so occurrence indices follow the sorted/filtered
order on screen. `row-tokens.ts` documents that as a requirement: "Callers pass rows in the order the
USER navigates (sorted/filtered as rendered), not the raw entity order".

---

## 3. §247 — the Tasks surface

### 3.1 The extraction, and why it comes first

`task-row.tsx` is at 793/800. Threading a `rowToken` prop into `TaskRowProps`, destructuring it, and
passing it to `TaskActionsImpl` costs more than 7 lines. The file must shrink before it can grow.

**New file `src/app/task-row-context.tsx`** takes the context block out of `task-row.tsx`:
`RowContextValue`, `RowContext`, `RowContextProvider`, `useTaskRowContext`, the separate
`RowLookupContext`, and `useTaskLookup` — roughly 98 lines. `task-row.tsx` lands ≈ 701.

★★★ **`task-row.tsx` MUST RE-EXPORT the moved names, and an earlier revision of this spec said the
opposite.** It read: "Re-exporting the moved names from `task-row.tsx` for compatibility is
deliberately NOT done — that is the shape that produced the live `document-table-editor` cycle;
update the importers instead." That was reasoned from a general rule and is wrong here, for a reason
only measurement finds:

```bash
sed -n '18,31p' src/app/tasks-section.test.tsx
```

`tasks-section.test.tsx` carries `vi.mock("./task-row", () => ({ RowContextProvider, TaskRow }))` — a
**full factory mock with no `importOriginal`** — to capture the provider's `value` prop so tests can
drive `onInlinePatch` directly. Point `tasks-section.tsx` at a new module path and that mock stops
intercepting the provider, the real one renders, `capturedRowContext.current` stays null, and those
tests fail. The "update the importers instead" instruction would have produced exactly that.

**So:** `task-row.tsx` ends with

```ts
export { RowContextProvider, useTaskRowContext, useTaskLookup, type RowContextValue } from "./task-row-context";
```

and `tasks-section.tsx`'s import line is **unchanged**. One line spent; the move stays pure.

★ **No cycle results.** The `document-table-editor` cycle exists because the re-exported module
imports BACK from its re-exporter. `task-row-context.tsx` imports only `react`, `./i18n`,
`./settings-types` and `./types` — none of which reach `task-row.tsx`. The rule worth carrying is "a
re-export is a cycle only when the target imports back", not "never re-export".

★ `task-row-context.tsx` is a `.tsx` file, so it is outside the coverage gate — the extraction cannot
move a coverage floor.

★★ **The extraction is a PURE MOVE and its proof is that nothing else changes.** If any existing test
needs editing to keep passing, the move was not pure and the diff is wrong. Do the extraction as its
own commit, green, before any label work.

### 3.2 The list owner

`tasks-section.tsx` owns both arrays, so it builds both maps:

```ts
const tableTokens = useMemo(
  () => buildRowTokens(visibleRows.map((task) => ({ id: task.id, name: task.taskName }))),
  [visibleRows],
);
const boardTokens = useMemo(
  () => buildRowTokens(healthFilteredTasks.map((task) => ({ id: task.id, name: task.taskName }))),
  [healthFilteredTasks],
);
```

★★ **TWO maps, not one, and this is not redundancy.** The table renders `visibleRows`
(`visibleTaskRows(...)`, which also applies `hideFinished`) while both Kanban views render
`healthFilteredTasks`. A token's occurrence index is only meaningful over the array actually on
screen, so a shared map would number the table's rows against tasks the table is not showing.

★ Board and swimlanes share `boardTokens` — both render the whole array on one page, so uniqueness has
to span lanes and columns, not sit inside one of them.

### 3.3 The threading

| Component | Change |
|---|---|
| `TaskRow` (`task-row.tsx`) | `rowToken: string` on `TaskRowProps`; threaded to `TaskActionsImpl` (whose props become `{ task, isPushing, rowToken }`) |
| `TaskKanban` / `TaskKanbanSwimlanes` | `tokens: ReadonlyMap<number, string>` prop; pass `rowToken` per card. ★ The board component is exported as **`TaskKanban`**, not `TaskKanbanBoard` — the FILE is `task-kanban-board.tsx`. An earlier revision of this table used the file name as the symbol; verify with `grep -n "^export function" src/app/task-kanban-board.tsx` |
| `TaskKanbanCard` | `rowToken: string` prop. ★ Its own header comment already says "PROPS, never context: the board renders cards OUTSIDE RowContextProvider" — this follows that rule rather than fighting it |
| `TaskStatusSelect` | `rowToken: string`, **required**. Label becomes `rowLabel(t(lang, "colTaskStatus"), rowToken)` |

★★ **`rowToken` is REQUIRED on every one of these, deliberately.** An optional prop with a
`?? task.taskName` default inside the component would compile at a call site that forgot it and ship
the collision silently. Required means `tsc` enumerates the misses. The `??` fallback lives at the
LIST owner, where the map lookup happens, not in the leaf.

### 3.4 The rewrites

Replace `task.taskName` with `rowToken` in every accessible-name position:

- `task-status-select.tsx` — 1 site.
- `task-kanban-card.tsx` — 4 sites: the **task-name button** (see below), `entityTitle` on
  `DocumentBadge`, `inlineAiEdit`, and `assignPersonLabel` (positional-interpolated).
  ★★ **NOT `changesLabel`** — the register's §247 list does not name it and neither should an
  implementer. It is `t(lang, "taskRowChangesBadge", changeRefs.length)`, keys on nothing per-task,
  and rides a non-interactive `<span>` with no role. It is not a control and not a 2.4.6 site. An
  earlier draft of this spec listed it; the correction is recorded because "rewrite `changesLabel`"
  would have produced a wrong diff that every test still passed.
- `task-row.tsx` — 11 sites matching
  `grep -cE "(aria-label|label|entityTitle|entityName)=.*task\.taskName" src/app/task-row.tsx`, plus
  the name button below. Includes the inline-edit labels, the assignee and priority selects, the
  `entityTitle`/`entityName` props, and `TaskActionsImpl`'s `sendInquiry` + `actionMoreActions`.

★★ `DocumentBadge` composes its own name as `` `${t(lang,"documentsLinkedBadge",count)} – ${entityTitle}` ``,
so passing the token as `entityTitle` is the whole fix there. The primitive is shared with other
entities and needs no change.

### 3.5 The task-name button — a collision NEITHER register entry records

★★★ **Found while grounding this spec, not taken from §247.** On BOTH surfaces the task-name control
is a `<button>` with no `aria-label`, so its accessible name is its CONTENT — `{task.taskName}`. Two
tasks named "Alpha" therefore render two buttons whose accessible names are byte-identical, which is
the same 2.4.6 failure as every other site here, on the most prominent control in the view.

- `task-row.tsx` — the read-mode name button; `title` is `` `${task.taskName} — ${clickToEdit}` `` and
  the content is bare `{task.taskName}`.
- `task-kanban-card.tsx` — the same shape.

**Fix:** `aria-label={rowToken}` on both. ★ 2.5.3 holds by containment — the visible text is `"Alpha"`
and the token is `"Alpha (1)"`, which contains it. ★ With no collision the token IS the bare name, so
the attribute is a redundant restatement of the content rather than a behaviour change; that is why
it is set unconditionally instead of behind a `token !== taskName` branch.

★★ Because it is unrecorded, it has no follow-up number and no prior analysis. Treat it as part of
§247's surface (the entry's own scope is "the Tasks surface") rather than minting a number for
something closed in the same slice that found it.

★ **The VISIBLE task name stays `task.taskName`.** Only the accessible NAME takes the token. The
name button's visible text and its `title` are unchanged — a user reads what they typed.

★★ **2.5.3 still holds after this**, and by containment rather than by prefix: the visible cell text
is `"Alpha"` and the accessible name becomes `"Send inquiry – Alpha (1)"`, which CONTAINS it.
Understanding SC 2.5.3 is case-insensitive and position-independent; a prefix rule is stricter than
the SC and would flag conformant code.

---

## 4. §248 — the stragglers

| File | Row identity | Change |
|---|---|---|
| `change-panel.tsx` | `item.title` — free text | `buildRowTokens` over the rendered array; token feeds `selectItem` **and every other per-row control in the file** |
| `milestones-panel.tsx` | `m.name` — free text | same |
| `stakeholders-panel.tsx` | `item.name` — free text | same |
| `resource-directory.tsx` | `resourceDisplayName(r)` — free text | same |
| `knowledge-links-field.tsx` | `link.name` — free text | token feeds the anchor AND the Remove button |
| `settings-sections/templates-section.tsx` | `tpl.name` — free text | token qualifies the rename `<Input>` |
| `learning-insights.tsx` | `kind` — unique by construction | plain qualifier: `rowLabel(t(lang, "learningColOverride"), sourceLabel(lang, kind))` |
| `timelog-people-table.tsx` | `userId` — unique by construction | token map keyed on `userId`, name `displayId` |
| `budget-panel.tsx` | — | **TEST ONLY**, no source edit |

★★ **Fix every per-row control in a file you touch, not only the `selectItem` one.** The map is free
once built, and this is exactly what round 1 did in `raid-panel-rows.tsx` — one token map fixed the
Ask-Claude, Send-inquiry and Notes-log trio together. Leaving a sibling control bare in a file that
now has a token map in scope is the shape §248 exists to record.

### 4.1 `knowledge-links-field.tsx` — two SCs, one fix

The anchor is `<a aria-label={t(lang, "documentsOpen")}>{link.name}</a>`. That is a 2.4.6 failure (N
links yield N controls named "Open in new tab") **and** a 2.5.3 failure (the visible text `link.name`
is not contained in the accessible name).

`rowLabel(t(lang, "documentsOpen"), token)` closes both: `"Open in new tab – Alpha"` contains the
visible `"Alpha"`. ★ For a colliding pair the token is `"Alpha (1)"`, and `"Open in new tab – Alpha (1)"`
still contains `"Alpha"` — containment survives the escalation.

★★ The file's own comment already reasons about this failure **for the sibling Remove button** and
qualifies that one while leaving the anchor bare. The analysis was done, on the same rows, and simply
not applied one line up. Switch the Remove button to the token too — its current
`` `${documentsRemove} – ${link.name}` `` is row-QUALIFIED but not row-UNIQUE.

### 4.2 `timelog-people-table.tsx` — decided

`displayId` is `u.email || String(u.userId)`. `userId` is the React key, so it cannot repeat; `email`
is free text arriving from an external system and two Timelog users sharing one is not excluded by
anything this repo controls. **Four labels ride `displayId`** (`timelogMatchPeople`,
`timelogMatchClear`, `selectItem`, `remove`), so one duplicate email collides all four at once.

**Decision: build a token map** keyed on `userId` with `name: displayId`. Cheap, and correct
regardless of what the external system sends. ★ The alternative — arguing the data is safe — buys
nothing and rests on a system we do not own.

### 4.3 `budget-panel.tsx` DragHandle — decided, test-only

The bucket reorder handle IS bucket-qualified. The defect is that its comment claimed "pinned by a
unit test" when nothing referenced `budgetReorderHandle` anywhere in `src` or `e2e` — a **false claim
of coverage**, which reads as protection and stops the next audit. A revert to the bare label ships
green through every gate.

**Change: add the missing test** (≥2 buckets, `roles: ["button"]`, `requireCollisionSeed: true`), and
correct the comment to say what the test actually pins. **No edit to `budget-panel.tsx` source**, which
keeps its 796/800 untouched.

★ **The `ManualPercentCell` residual in the same file is NOT closed here.** `br.name` is
bucket-QUALIFIED but never bucket-UNIQUE, so two identically-named buckets still collide. Closing it
needs `buildRowTokens` inside `budget-panel.tsx` — a source edit with 4 lines of headroom, which
forces a split. It belongs with §246, which touches that file anyway. Recorded in §8.

### 4.4 `add-first-item-button.tsx` — decided, no change

The two-line variant renders `<span>{text}</span>` and `<span>{addLabel}</span>` inside ONE `<button>`,
so axe's whole-node visible-text computation makes containment fail against the category-qualified
`ariaLabel`.

**Decision: record the reasoning, change nothing.** WCAG 2.5.3 concerns the text presented to
*identify* the control; the CTA line is that label and the sentence above it is supplementary
description. axe's whole-node computation is a tool implementation, not the SC — and
`label-content-name-mismatch` is `experimental`, so the gate never runs it in any view regardless.

★ The two rejected alternatives, and why:
- **Move the description out of the button** — containment then holds under any reading, but it
  shrinks the click target (today the whole dashed box is clickable, sentence included) and changes
  the empty state for all eight panels that use the primitive.
- **Widen `ariaLabel` to contain both** — mechanically conformant, and a very long spoken name on
  every empty state. A usability regression for exactly the users 2.5.3 protects.

The decision goes in a comment on the component, next to the `text` prop, so the next reader finds the
reasoning rather than re-deriving it. It binds every caller that passes `text`.

---

## 5. i18n

★★★ **SUPERSEDED 2026-08-26, and the original text is kept because it explains what the change
COSTS.** This section read: "**Zero new keys.** `rowLabel` composes an existing verb with the token
… That is a deliberate design constraint, not a coincidence: it keeps `i18n.de.ts` out of the branch
entirely, and with it the CRLF + umlaut-corruption hazard that file carries."

The 2.4.6 work still needs no keys — that half stands. What changed is scope: grounding §4 turned up
`resource-directory.tsx`'s role select carrying `` aria-label={`Role for ${resourceDisplayName(resource)}`} ``
— row-keyed **and hardcoded English**, on the exact line the token fix touches. Leaving the
untranslated half is the "the analysis was done, on the same rows, and simply not applied" pattern
§248 exists to record, so the slice now also **translates the hardcoded accessible names**, swept
repo-wide.

**The sweep is ENUMERATED, not open-ended** — 10 sites, **7 new keys**. The list, the four exclusion
classes and their reasons live in the plan's Task 15; reproduce it with the two greps there before
starting, and if they return more than the listed set, stop and report rather than widening.

★★ **The cost is real and is exactly what the superseded text named.** `i18n.de.ts` is back in the
branch, and three of the seven German strings carry umlauts ("Rolle für", "Auslastung für",
"Abwesenheits-Überschreibung"). It is CRLF (`i/lf w/crlf`), the Edit tool corrupts umlauts and curls
double quotes there, and the `i18n-encoding` test BANS both `\u00XX` escapes and ASCII substitutions
like `fuer`. Every edit goes through an anchored node utf8 write matching `\r\n` — the procedure is
the plan's Task 16, and its Step 3 verifies the umlauts survived AND that the file was not re-lined.

★ `tsc` enforces EN/DE key-set parity, so a key added to one dictionary and not the other fails the
typecheck rather than shipping.

---

## 6. Testing

Axe is structurally blind to this defect class in every view at every seed size, so **unit tests are
the only detector that can exist.** No gate will catch a regression in any of it.

### 6.1 The shape of every test

`expectRowUniqueNames` (`src/test/row-unique-names.ts`) with:

- **`requireCollisionSeed: true`** on every test claiming to cover a collision. `minControls` alone
  proves only that the scope is non-empty — it counts CONTROLS over the whole document by default, so
  a panel toolbar satisfies any plausible floor. A `documents-panel` test with `minControls: 2` was
  measured still PASSING with its fixture cut to ONE document and to ZERO.
- **`roles` stated explicitly at every call site.** ★★★ The default is `["button"]`, and half of what
  this slice touches is not a button: `TaskStatusSelect` and the learning override are `combobox`; the
  template rename is `textbox`; the timelog picker is `combobox`. Taking the default there produces a
  test that scans the wrong controls and passes for nothing.
- **`scope`** set to the rendered panel, so the assertion is about that surface rather than the
  document.
- A fixture of **≥2 rows seeded with a genuine collision** — two entities sharing a name.

### 6.2 Mutation proof, per fix

For each converted call site: revert that site's qualifier to the raw field, confirm the new test goes
RED, revert the mutant, confirm `git diff --stat` is empty.

★★ Record the **mutant's token span** with the result. "The test failed" is not a proof another reader
can check; "deleting `rowToken` and restoring `task.taskName` at `task-status-select.tsx`'s
`aria-label` turned test X red" is. A surviving mutant is a QUESTION — find the input that separates
"equivalent mutant" from "missing test" rather than writing a comment that says "unpinned".

★ `git checkout -- <file>` is deny-blocked in this environment. Revert a mutant with an inverse
anchored write plus a uniqueness assertion, then prove the diff empty.

### 6.3 The tests this slice owes

| Test | Fixture | Roles | Pins |
|---|---|---|---|
| Tasks table | 2 tasks named "Alpha", rendered via `tasks-section` | `button`, `combobox`, `textbox` | the whole table row's controls, incl. the **name button** (§3.5), `TaskActionsImpl`, `DocumentBadge` and `TaskStatusSelect` |
| Kanban board | same 2 tasks | `button`, `combobox` | card controls across columns, incl. the **name button** |
| Kanban swimlanes | same 2 tasks, 2 lanes | `button`, `combobox` | that uniqueness spans LANES, not just columns |
| `change-panel` · `milestones-panel` · `stakeholders-panel` · `resource-directory` | 2 rows sharing a name | per file | `selectItem` + the file's other per-row controls |
| `knowledge-links-field` | 2 links sharing a name, different URLs | `link`, `button` | anchor + Remove |
| `templates-section` | 2 templates sharing a name | `textbox` | rename input |
| `learning-insights` | ≥2 kinds | `combobox` | the per-row override select |
| `timelog-people-table` | 2 users sharing an email | `button`, `combobox` | all four labels |
| `budget-panel` | 2 buckets sharing a name | `button` | the reorder handle — the false-coverage claim |
| `task-row-context` extraction | — | — | proved by existing suites passing UNCHANGED |

★★ The **cross-surface** tests (table + both Kanban views) are the only ones that can fail the
three-caller threading. A per-file test cannot see a caller that forgot to pass `tokens`.

★ Every new test file must be reachable — vitest **exits 0 on a missing test path**, a false-green
shape. Confirm each new file appears in the run's file count.

---

## 7. Gates and release

- **`size:check`** is the tight one. `task-row.tsx` must land under 800 by the script's own metric.
  Verify with the node one-liner in §0, never `wc -l`.
- **`npx tsc --noEmit`** — the required `rowToken` props make this the enumerator of missed call sites.
  It exits **2** on diagnostics, not 1.
- **`npx eslint --max-warnings=0 src scripts e2e`** — `npm run lint` exits 1 locally from gitignored
  `.demo-tmp/` and `.worktrees/` leftovers, so it is not the truthful local check.
- `dup:check` excludes test files, so the new tests cannot move it.
- `npm run docs:symbols:check` if any doc gains a backticked symbol.
- **Never read a gate's exit code through a pipe.** Redirect, check unpiped, then read the file.
- **Never run two vitest processes at once**, and shard the full suite (`--shard=1/3`…) — it exceeds
  the 10-minute tool timeout and its child survives the kill.
- Release: a11y behaviour change → minor bump to **0.262.0 "Swainston"**. `npm run version:sync`
  propagates all eight satellites; `version:check` is blocking and exits **1 on drift, 2 when it could
  not do its job**.

---

## 8. Out of scope — and what stays open

**§246 is not in this slice.** Two shared primitives collide app-wide:

- `InfoTooltip` — **139 call sites across 34 non-test files**. The FIX set is small (`budget-panel.tsx`,
  `budget-panel-totals.tsx`, `roles-editor.tsx`), but any new prop is a contract every future caller
  inherits, and `budget-panel.tsx` has 4 lines of headroom, forcing a second panel split.
- `SortResizeTh` — `reports.tsx` embeds three tables sharing `"Open"`, `"Cancelled"`, `"Overdue"`,
  `"Total ↓"`, `"Inquiries"` column labels.
- It also carries an **undecided design question**: the `roles-editor.tsx` rate-card header shares one
  hint across three columns. If the hint genuinely applies to all three they are same-purpose controls
  and 2.4.6 permits the shared name; if each column deserves its own explanation the shared hint is a
  content gap. Deciding that on a branch also holding finished Tasks work would stall the lot.

Two mechanisms, two forced splits and an open design question is a second slice, not a section.

**§245 stays open.** It records the sweep's boundary — round 1's population came from grepping test
NAMES, and a property-based scan of the whole surface would find more. This slice does not perform
that scan. Closing §245 would be exactly the false claim of coverage that §248's budget-DragHandle
bullet is about.

**The `ManualPercentCell` residual** (§4.3) goes to the §246 slice with the rest of `budget-panel.tsx`.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| The extraction is not a pure move and quietly changes behaviour | It ships as its own commit; any test edit needed to keep it green means the diff is wrong |
| `task-row.tsx` still lands over 800 after threading | Measure with the node metric after the extraction commit, before the label work. If short, extract `TaskActionsImpl` too (~112 lines) |
| A test takes the default `roles: ["button"]` and scans nothing relevant | Every call site states roles; the table above is the checklist |
| A test passes for a second, independent reason after a narrowing | Round 1's own lesson: after narrowing any guard, re-mutate the part you KEPT |
| Two same-named tasks in one lane vs across lanes behave differently | The swimlanes test seeds the pair in DIFFERENT lanes on purpose |
| The token changes a VISIBLE label by accident | Only accessible-name positions take the token; the name cell's text and `title` are asserted unchanged |
| The i18n sweep grows without bound | Its set is ENUMERATED in the plan's Task 15 with four stated exclusion classes; the two reproduce greps run first, and more hits than the listed set stops the task rather than widening it |
| A German umlaut is corrupted writing `i18n.de.ts` | Anchored node utf8 write matching `\r\n`, never the Edit tool; Task 16 Step 3 asserts the three umlaut strings round-trip AND that `git ls-files --eol` still reports `w/crlf` |
