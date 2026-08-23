# Shared-primitive adoption — design

**Date:** 2026-08-23
**Branch:** `refactor/shared-primitive-adoption`, cut from `origin/main` at `0993d04e` (0.255.1 "Bisson")
**Status:** design approved, unimplemented

## Goal

Adopt three primitives this repo already owns, at the call sites that never took them up. One
theme: *use the primitive that exists*. The by-products are a real a11y gap closed, the top
empirical duplication cluster reduced, and both zero-headroom files moved down.

★★★ **The duplication by-product did NOT materialise, measured 2026-08-23 after Task 3.**
`dup:check` moved 1.18% → 1.20% (1844 → 1870 duplicated lines), apples-to-apples on one commit.
The gate compares duplicated **lines**, and collapsing four per-column props into one `{...th}`
spread removes ~814 tokens while ADDING 15 lines — so tokens-per-line falls, jscpd's
`--min-tokens 50` window spans MORE lines for the same token count, and every pre-existing clone
in those files got LONGER in lines. A token-denominated metric would have fallen; the one the
gate actually reads rose. The a11y gap and the two zero-headroom files are unaffected and remain
the real justification for this slice. Do not "fix" this by re-baselining anything: the gate
passes at 1.75 with wide margin, and the rise is an artifact of the metric, not new duplication.

★ One GENUINE new clone did appear and is worth a follow-up: `CountHead` (change-report-panel)
and `RaidCountHead` (raid-report-panel) converged into near-identical bodies once their
per-column props collapsed. Consolidating them is out of scope here.

★ A second follow-up, found in review and PRE-EXISTING (not caused by this slice):
`CountTableBody` in `change-report-panel.tsx` is a pure pass-through that declares the same
four-prop signature as `CountHead` beside it and reads none of them. Collapsing it removes a
whole duplicated prop-list layer. Worth doing BEFORE the pattern is copied into more panels.

★★ The canonical adoption pattern, pinned here because nothing in the code enforces it:
import `useSortHeaderProps` alongside `SortResizeTh`; call it ONCE, immediately after `w`/`sr`
are derived and BEFORE any early return (a hook after a conditional return is a real bug tests
may not catch); spread `{...th}` FIRST, then the per-column props in the order all 50 Task-3
call sites already use — `label`, `sortCol`, `resizeCol`, `width`, `align`, `hint`. The bag's
four field names collide with none of those, so nothing relies on prop-clobber order.

★★ **Every number below was measured on 2026-08-23 against `0993d04e` and rots.** Each carries the
command that reproduces it. Run the command; never quote the number.

## Why these three

`docs/handrolled-ui-inventory.md` is a dated audit whose per-site rows were last verified
2026-08-07 and explicitly **not** re-checked since. It was a starting point only — every claim
here was re-measured.

Two other clusters were surveyed and **rejected**, recorded so they are not re-surveyed:

- **`role="dialog"` outside `modal.tsx` (25 files).** Not a slice. `notes-window.tsx` *is* the
  shared floating-window primitive — `note-log-panel.tsx`'s only match is a comment saying it
  delegates window chrome to it. `tour-overlay.tsx` and `modern-shell.tsx` are one-offs.
  Everything else already sits on `PopoverPanel` / `usePopoverDismiss`.
- **Combobox (`resource-picker`, `entity-link-picker`, `stakeholder-recipient-input`).** Genuine
  duplication of what `useCombobox` provides, but the initial highlight differs across the three
  (`-1` / `0` / `0`-with-clamp) and each divergence carries a reasoned comment. Conversion would
  change keyboard behaviour. Deferred deliberately, not overlooked.

## Part C — stop 82 call sites repeating four props

`SortResizeTh<K>` takes eight props, of which `sortKey`, `sortDir`, `onSort` and `onResize` are
identical for every column in a given table. That repetition is the top tsx clone cluster.

Reproduce the adoption count and the clone ranking:

```bash
grep -ro "<SortResizeTh" src/app --include="*.tsx" | grep -v "\.test\.tsx:" | wc -l
npm run dup:check > /tmp/dup.log 2>&1; echo "EXIT=$?"
grep -oE 'app.[a-zA-Z0-9/_-]+\.tsx' /tmp/dup.log | sed 's/^app.//' | sort | uniq -c | sort -rn | head
```

At time of writing: 82 invocations across 12 files; `change-report-panel` appears in 17 clones,
`raid-report-panel` 13, `change-panel` 12. The highest-fanout single clone is a four-column header
block repeated into `raid-report-panel` x3 and `resources-report` x1.

**Design.** A new export in `report-table.tsx`:

```
useSortHeaderProps<K extends string>(sortKey, sortDir, onSort, onResize?)
  -> { sortKey, sortDir, onSort, onResize }   // one memoized object
```

Call sites become `<SortResizeTh {...th} label={...} sortCol="id" width={w.id} />`.

★ Rejected alternatives, with the reason, so they are not re-proposed:

- **A bound component returned from a hook** (`const Th = useSortHeader(...)`). Rejected: a new
  component identity per render remounts every header on every render.
- **A declarative `SortHeaderRow` taking an array of column descriptors.** Bigger cut, but it
  rewrites all 82 working call sites to buy it, and `stickyLeft`'s width-clamp coupling
  (documented on the prop itself) is exactly the detail an array flattening loses. Reconsider only
  if the prop bag proves insufficient.

**Constraint:** the rendered DOM must be byte-identical. Reports is axe-scanned.

## Part B — six files still hand-roll the header `SortResizeTh` encapsulates

Each hand-rolls the `<th class="relative px-3 py-2 font-medium">` plus sort `<button>` plus
`ColumnResizeHandle` trio — precisely what the primitive wraps.

```bash
for f in change-panel raid-panel-rows stakeholders-panel activity-log-panel resource-directory roles-editor; do
  echo "$f th=$(grep -c '<th' src/app/$f.tsx) aria-sort=$(grep -c 'aria-sort' src/app/$f.tsx)"
done
```

★★ **`activity-log-panel`'s two `aria-sort` matches are prose inside a JSX comment** — the file
contains zero real attributes. Read the `<th>`; do not count the string. The same trap is already
recorded for `<button` in the inventory doc.

Two defects, not one:

★★★ **CORRECTED 2026-08-23 (measured, after Task 6).** The split below originally put
`roles-editor` in the second group. It belongs in the FIRST: it has four sortable headers and
**zero** `aria-sort` attributes. Three panels announce nothing, not two. Reproduce per panel with
`grep -c aria-sort src/app/<panel>.tsx`, then READ the hits — `activity-log-panel`'s two are prose
inside a JSX comment (its own follow-up note), not attributes.

- **`activity-log-panel`, `resource-directory` and `roles-editor` announce no sort state at all**
  (zero real `aria-sort`). axe has **no rule** for a missing `aria-sort`, so the gate is
  permanently silent here and unit tests are the only possible coverage. Their conversions close
  a real a11y gap; the test must assert state appears where there was none.
- **`change-panel`, `stakeholders-panel` and `raid-panel-rows` already set `aria-sort`** but keep
  the sort glyph inside the button's accessible name — the double announcement the primitive
  removes. For these three the `aria-sort` half of the conversion is a behavioural NO-OP; what
  changes for a user is the glyph leaving the name, plus any label-in-name fix. Do not describe
  these conversions as adding `aria-sort` — it is already there, hand-rolled.

### Two families, two adapters

★★ Classify by the **sort state's shape**, not by the file's type aliases. An earlier cut of this
design put `roles-editor` in family 2 by reading its `type SortKey` alone; its `setSort` holds a
nullable object, so it is family 1.

| family | shape | files |
|---|---|---|
| 1 — nullable object | `{ key, dir }` or `null` | `change-panel`, `stakeholders-panel`, `raid-panel-rows`, `roles-editor` |
| 2 — split state | separate `sortKey` and 2-state `sortDir` | `activity-log-panel`, `resource-directory` |

- `fromNullableSort` — `null` maps to `"off"`.
- `fromSplitSort` — an empty or absent key maps to `"off"`. `resource-directory` encodes unsorted
  as `sortKey: ""`; `activity-log-panel` has no unsorted state, so `"off"` is unreachable there —
  the adapter must still be correct for it rather than silently relying on that.

★ `raid-panel-rows` types its direction as a bare `string` (`type SortState` holds `key: string`
and `dir: string`). Tighten it to the real union **first**, as its own commit — it is a latent bug
independent of this work.

### Accessible names change in every converted file — deliberately

`SortHeaderButton` renders `label` as the button's content and sets **no** `aria-label`, so the
accessible name becomes the visible text.

**Rule: `label` is the visible text; extra intent goes in `title`.** This is not a mechanical port
of each existing `aria-label`.

- `resource-directory` today: visible `Assignee`, name `Sort by Assignee`. Conformant now — WCAG
  2.5.3 is **containment, not prefix**. After conversion the name is `Assignee` and the "Sort by"
  wording moves to `title`. Still conformant; still a change.
- `change-panel` today: visible `#`, name `ID`. The visible text is **not contained** in the name —
  a label-in-name gap today, in an axe-scanned view, which the gate cannot see (the relevant axe
  rule is `experimental` and excluded by default, and does not apply to this role in any case).
  Convert to `label="#"` plus `title={t(lang, "id")}`. Fix it; do not carry it forward.

  ★★ **`title` is not the only vehicle, and it is the WEAKER one — pick deliberately.** `title`
  becomes the accessible DESCRIPTION and is hover-only: not keyboard-focusable, not reachable on
  touch. `SortResizeTh`s existing `hint` prop renders an `InfoTooltip`, which is `tabIndex={0}`
  with `onFocus` and `onClick` handlers, so it IS keyboard- and tap-reachable. It costs a visible
  "i" badge. `title` was the right call for `#`→`ID` (two-character column, guessable meaning, and
  2.5.3 is satisfied by the NAME matching the visible label wherever the extra meaning lives), but
  a less guessable abbreviation wants `hint`. Do not default to `title` because this row did.
- `roles-editor` sets no `aria-label` at all, so conversion is name-neutral there. Its per-header
  `InfoTooltip` maps onto the primitive's existing `hint` prop.

★★ **The `font-medium` change is NOT panel-wide — it splits a single header ROW.** Measured in
`change-panel` during Task 6: the primitive emits `font-medium` (500) while Tailwind preflight
leaves an unstyled `<th>` at the UA `bold` (700), so converted headers render LIGHTER than any
hand-rolled `<th>` left beside them in the same row. Wherever a panel keeps non-sortable raw
headers (a select-all checkbox, a notes column), add `font-medium` to them in the same commit so
the row stays uniform.

★★ The CASCADE is measured, not inferred (checked against the installed files during Task 6):
`node_modules/tailwindcss/preflight.css` resets `font-weight` on `h1`-`h6` ONLY - there is no `th`
rule - `globals.css` declares no `font-weight` at all, and `TABLE_HEAD_CLASS` sets only size and
colour. So an unstyled `<th>` genuinely keeps the UA `bold`. What is NOT measured is the rendered
result in a browser: jsdom has no layout, so no unit test can see it either way. **The eye-verify
is therefore to confirm the row READS uniform - not to confirm the cascade, which is settled.**

★★ **Known loss, not a free win:** dropping the glyph from the announced name means
VoiceOver/Safari, which does not announce `aria-sort`, goes from "Title up-arrow" to "Title".
Standard-correct and already recorded in `AGENTS.md`. Do not re-litigate it as pure gain.

★★ **FOUR panels change hover colour, not one** (measured 2026-08-23 with
`grep -c hover:text-ui-green src/app/<panel>.tsx`): `stakeholders-panel` (5 sites),
`resource-directory` (7), `roles-editor` (4) and `activity-log-panel` (3) all hover
`text-ui-green`, where the primitive uses the shared `--table-head-accent` token — and the
primitive ALSO paints the ACTIVE column in that token, which none of them did. `change-panel` and
`raid-panel-rows` already used the accent, so they are unaffected. Both tokens are sanctioned, so
this is normalisation, not a palette break — but it is a visible colour change on four panels and
belongs on the eye-verify list, not just the one panel this line used to name.

★ `activity-log-panel`'s fourth header is deliberately non-sortable *because* a fourth hand-rolled
sort button would deepen this debt (its own comment says so, and names this conversion as the
follow-up). Making it sortable is in scope once the reason is gone.

★★ `activity-log-panel` carries a comparator that **threw on first render** under the default
`timestamp` sort with two or more entries. Conversion must not disturb that guard.

## Part A — `tasks-section` duplicates `ColumnConfigPopover`

The primitive's own docstring reads *"Mirrors the tasks-view column manager."* It was extracted
**from** `tasks-section` and the original was never converted. Four panels adopted it
(`change-panel`, `milestones-panel`, `raid-panel-toolbar`, `stakeholders-panel`).

Three real divergences in the inline copy:

- **Not portaled.** It renders `absolute` inside the toolbar, so it is subject to the toolbar's
  `overflow` clip. `PopoverPanel` portals to `<body>` for exactly this reason.
- **A raw checkbox input** where the primitive uses the `Checkbox` primitive.
- **`hover:text-muted-foreground`** — hovering changes nothing. The primitive hovers to
  `text-foreground`.

★ Dismissal is **not** a divergence: `use-column-manager.ts` wires `usePopoverDismiss`. An earlier
reading of this slice guessed it was missing; it is not.

**Design.** `ColumnConfigPopover` owns its own open state, so the conversion deletes the inline
block *and* the plumbing behind it: `colConfigOpen`, `setColConfigOpen` and `colConfigRef` leave
`TasksSectionProps`, `task-manager.tsx`'s threading, and `useColumnManager`'s return type, along
with its `usePopoverDismiss` call. `hiddenCols` and `setHiddenCols` stay — they are the persisted
state and have other consumers.

## Testing

- **Per converted file:** assert `aria-sort` on every header across all three states, `"off"`
  included. This is the property nothing else can catch — axe has no rule for it.
- ★★★ **Per converted file: a SWAPPED-`sortCol` test.** The explicit generic stops a garbage key
  but NOT a swap between two REAL columns — paste `sortCol="influence"` onto the Interest header
  and it typechecks, missorts silently, and no gate sees it. With five to eleven near-identical
  call sites written by copy-paste, this is the live risk of the whole slice. The detector falls
  out of the primitive's own `active` computation (`sortKey === sortCol && sortDir !== "off"`):
  two headers sharing a `sortCol` both light up on one click. So **after clicking a column's
  button, exactly ONE header must report a non-`none` `aria-sort`, and it must be that column's**.
  Assert both halves — the count AND the identity; the count alone misses a swap onto a hidden
  column, the identity alone misses the duplicate. Mutation-prove it by putting one real column's
  key on another's header and confirming the test reddens.
  ★ This is also what makes per-column claims MEASURED rather than inferred: without it only the
  one column a test happens to click has any coverage of its own wiring.

  ★★★ **THE BLINDNESS IS MEASURED, not argued** (Task 8, 2026-08-23): with `sortCol="status"`
  changed to `"severity"` on the RAID Status header, **`npx tsc --noEmit` exits 0** and all 46
  other tests in that file stay green — including three that match the severity header by name.
  Only the swap test reddens (`expected [...] to have a length of 1 but got 2`). So no typechecker,
  no existing test and no gate in this repo can see a swapped column; this test is the sole
  detector, and it must be mutation-proved on every panel or it is decoration.

  ★★ **It is a DUAL detector, and the second half is free.** Looking each column up by an EXACT
  button name (RTL treats a string `name` as a full-string match) also pins that column+s i18n
  LABEL key: a swapped label throws not-found. Nothing else in the suite checks that a header
  renders the string it is supposed to. So one test covers both `sortCol` wiring and `label`
  correctness — use an exact string name, never a loose regex, or you give up the second half.

  *** IT DETECTS A PASTE, NOT AN EXCHANGE - this section overclaimed and is corrected here.**
  Everything above says the test catches a swap between two real columns. That is true only of a
  DUPLICATE: one real key pasted onto a second header, which is the realistic copy-paste error and
  is what every mutation in Tasks 8-10 exercised. A full EXCHANGE - header A takes Bs key while B
  takes As - creates no duplicate, so exactly one header still lights up and it is still the one
  the label lookup finds. **Count and identity both pass.** Reasoned through in Task 10 and not
  refuted: clicking A calls onSort(B), sortKey becomes B, and the only header whose sortCol is B
  is A itself.

  * Catching an exchange needs an ORDERING observable - a fixture where the two columns sort to
  DIFFERENT row orders, asserted on the rows rather than on the header. roles-editor has none: its
  single-role fixture cannot order anything, and in its two-role fixture all four columns happen to
  sort identically. Not built anywhere in this slice; recorded so nobody reads the existing tests
  as covering it.
- **Adapters:** mutation-check both. Flip `null` to `"asc"` in `fromNullableSort` and confirm the
  suite reddens. A surviving mutant is a question, not a pass.
- **Part C:** assert byte-identical rendered DOM on one existing report panel before and after.
- **Part A:** assert the three deleted props are gone from the prop contract, and that the
  checklist renders through the primitive.
- Any table gaining a per-row control gets a two-row test for row-unique naming. axe cannot see a
  duplicate accessible name at any seed size, in any view.

## Gates

- `size:check` — all six B files and `tasks-section` shrink. `tasks-section.tsx` (TD-7) and
  `task-manager.tsx` (TD-5) are both at their baselines with zero headroom, so this moves the only
  direction available. The gate metric is `wc -l` **+ 1**; measure it with a node one-liner that
  splits the file on newlines and reports the array length.
- `dup:check` — measured 1.20% against a 1.75 threshold after Task 3, UP from 1.18%. See the
  duplication note under "Goal": the gate counts LINES, so this refactor inflates it by design.
  Headroom is wide either way; the requirement is that it stay UNDER the threshold, not that it fall.
- **axe** — `change-panel`, `stakeholders-panel`, `raid-panel-rows`, `resource-directory`
  (Resources defaults to the directory) and Reports are all scanned. Use `--workers=1` for any
  multi-view run: local defaults to CPU-count while CI runs serially, and the contention failure
  prints as a timeout with no violation text.
- `npx tsc --noEmit` after every test edit — vitest never typechecks.

## Out of scope

- The combobox and dialog clusters (rejected above, with reasons).
- Any new i18n key. The labels already exist, and staying out of `i18n.ts` keeps this branch
  conflict-free against the unshipped `feat/documents-s3c2-ooxml-media`, which edits both
  dictionaries. If a key turns out to be needed, that is a deliberate decision, not a drive-by.
- Splitting any file. Extraction here only removes lines.

## Relationship to unshipped work

`feat/documents-s3c2-ooxml-media` (0.256.0 "Khaw") is built, green and unpushed. Measured
2026-08-23: **zero source-file overlap** with this slice. Reproduce by diffing that branch's
`src/app` file list against the file list in the plan:

```bash
git diff --name-only origin/main..feat/documents-s3c2-ooxml-media -- src/app | sort
```

The only contended files at release time are `version.ts` and `CHANGELOG.md`, which is a release
ordering question, not a development one.
