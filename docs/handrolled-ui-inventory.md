# Hand-rolled UI inventory

Snapshot taken 2026-08-07, on `63e4d768` (branch `feat/ui-batch-slice-1`, release 0.221.0).
**Audit only — nothing here is scheduled.** Producing the list and acting on it are separate jobs.

★★ **Fact-checked 2026-08-07 against a later commit on the same branch.** Every count below was
re-run and is unchanged between `63e4d768` and that checkout, so the snapshot commit still stands —
but **15 prose claims did not survive**, including this document's own ★★★ headline about
`raid-panel-rows.tsx`. Each is corrected in place and the error is left visible rather than
overwritten; see "Sanity check" at the foot for what the failures had in common.

Scope: all of `src/app`, `*.tsx`, excluding `*.test.tsx`. 313 non-test `.tsx` files were scanned.

★★ **Every tag below is a PROPOSAL derived from the element's own attributes, children and class
string — not from the file's surrounding logic.** A grep line shows an element, never its role in the
component. Six rows were opened and read (see "Sanity check" at the foot); the rest were not. Re-read
the call site before converting anything.

---

## Counts — reproduce, do not trust

```bash
grep -rho "<button" src/app --include=*.tsx --exclude="*.test.tsx" | wc -l
grep -rl "<button" src/app --include=*.tsx | grep -v "\.test\.tsx" | wc -l
```

| measure | this run (2026-08-07, `63e4d768`) | plan baseline |
|---|---|---|
| `<button` occurrences, non-test `.tsx` | **341** | 345 |
| files containing one | **152** | 152 |
| `<input` / `<select` / `<textarea` / `<table` | 115 / 37 / 10 / 17 | not quoted |
| `role="dialog"｜"tooltip"｜"listbox"` | 32 lines / 28 files | not quoted |

★ **The 4-button delta is fully explained and is this release's own work.** `git diff -U0
4dd13660..HEAD -- src/app` removes exactly four `<button` lines, all in `budget-panel.tsx`, and adds
four `<Button` lines in the same file. Nothing else in the tree moved. 345 − 4 = 341.

### ★★★ The plan's GLYPH baseline is not reproducible under the filter the plan's own command states

The plan quotes, "measured 2026-08-07, comment lines excluded", over
`src/app --include=*.tsx --exclude="*.test.tsx"`. Run under that filter, every number is far lower.
Run over `src/app` **including `.ts` files and including `*.test.tsx`**, **11 of the 13 match to the
digit** — enough to identify the filter as the cause, but the two that miss are the two the plan
leans on hardest:

Reproduce one row (`$G` is a single glyph; the `grep -v` is the comment-first-token heuristic):

```bash
D='^[^:]+:[0-9]+:[[:space:]]*(//|\*|/\*|\{/\*)'
grep -rnF "$G" src/app --include=*.tsx --exclude=*.test.tsx | grep -vE "$D" | wc -l   # col 3
grep -rnF "$G" src/app --include=*.ts  --include=*.tsx      | grep -vE "$D" | wc -l   # col 4
```

| glyph | plan baseline | non-test `.tsx` (the stated filter) | `src/app` all `.ts`+`.tsx`, tests included |
|---|---|---|---|
| `✓` | 17 | 10 | **17** |
| `⚠` | 9 | 8 | **9** |
| `✕` | 47 | **19** | **42** ✗ |
| `×` | 75 | **20** | **73** ✗ |
| `⋮` | 9 | 2 | **9** |
| `▸` | 4 | 4 | **4** |
| `▾` | 3 | 3 | **3** |
| `▼` | 17 | 14 | **17** |
| `▲` | 17 | 14 | **17** |
| `↑` | 12 | 5 | **12** |
| `↓` | 9 | 4 | **9** |
| `•` | 21 | 7 | **21** |
| `🗒` | 2 | 0 | **2** |

★★★ **`grep` IS THE WRONG TOOL FOR `🗒` AND FAILS IN BOTH DIRECTIONS — SILENTLY.** `🗒` is U+1F5D2,
outside the BMP, and this environment's grep mishandles it: `grep -rlF '🗒' .` reports **no files at
all** (the glyph is really in nine, including the `src/app` one below), while a bracket expression
containing it matches **every** non-BMP emoji — `printf 'a 📎\nb 🚀\nc 🗒\n' | grep -c '[✓🗒★]'`
returns **3**, not 1. That is how the Part 2 total below first came out six lines too high. The
`🗒` row above was confirmed with node (`fs.readFileSync(f,'utf8').includes('\u{1F5D2}')`), not grep,
and it is **correct at 2**. Keep every non-BMP glyph out of any grep you attach to a number here.

So the tree did **not** move for glyphs — the baseline was measured with the `--include` /
`--exclude` filters not in effect. ★ The two misses are not drift either: `✕` and `×` are simply 5
and 2 lower than the plan recorded, in both columns alike, so the *shape* of the finding holds and
only the magnitudes shift. Three consequences worth carrying forward:

- ★★ The `🗒` count of 2 is not UI at all. Both hits are in
  `src/app/operating-guide-builtin.generated.ts`, a generated help-content data file. There is **no
  `🗒` glyph anywhere in the app's markup** — the notes badge renders a `DocumentTextIcon`
  (`notes-badge-button.tsx:32`; `:25` is the `<button` that wraps it), so the "🗒 N badge" wording
  elsewhere in the docs describes an icon, not a literal glyph.
- ★★ The inflation is heaviest exactly where the plan warns the manual work is. `×` drops 73 → 20
  once tests and `.ts` files are excluded, because test files are full of arithmetic in comments
  (`100h×150`, `22 workdays × 8h`). The multiplication problem is real but a third the size the
  baseline implies. Of those 20 real `×` lines, **6 are multiplication or prose and 14 are close
  glyphs** — enumerate with the `grep -rnF '×' … | grep -vE "$D"` above and read each hit.
- ★★ `✕` and `×` are the two rows that do not reproduce, and they are also the two the close-glyph
  sweep is sized from. Quote 42 / 73 (or 19 / 20 under the stated filter), never the plan's 47 / 75.

**All glyph figures in Part 2 below are the non-test `.tsx` figures**, i.e. the filter the plan's
command describes.

### The counts include lines that are not elements

★ 8 of the **323** (341 minus the 18 primitive-internal lines below) `<button` hits are the word
`<button>` inside a comment that the first-non-space-token heuristic **does** catch —
★★ Stated over 341 the figure is **11**, not 8: three more comment lines
(`button.tsx:43` · `info-tooltip.tsx:40` · `popover-panel.tsx:120`) sit inside the 18 and are
already excluded there. Either denominator is defensible; mixing them is not. — `action-popover-trigger.tsx:5` ·
`calendar-chip.tsx:7` · `entity-link-picker.tsx:303` · `file-picker-button.tsx:14` ·
`gantt-view-menu.tsx:12` · `influence-interest-matrix.tsx:4` · `resource-calendar-band.tsx:218` ·
`resource-calendar.tsx:222`. Four more are prose the heuristic **misses**, because the mention sits
on a JSX-comment continuation line whose first token is a backtick:
`change-edit-modal.tsx:276` · `milestone-edit-modal.tsx:149` · `raid-edit-modal.tsx:399` ·
`stakeholder-edit-modal.tsx:177`. **12 of 341 are prose; 311 are elements.** This is the plan's
warning about the comment filter being a heuristic rather than a parser, measured.

★★ Do not read "its children start with a comment" as "it is a comment". `task-form-fields.tsx:632`,
`node-graph.tsx:246`, `resource-picker.tsx:219` and `text-button.tsx:44` all open with a JSX comment
or a bare `return <button`, and a first pass through this inventory mis-filed all four as prose. They
are real elements and are tagged as such below.

---

## Part 1 — hand-rolled elements

| Tag | Meaning |
|---|---|
| **convertible** | Reimplements a primitive; should adopt it (names the primitive and variant) |
| **IconButton candidate** | Icon-only action; should become `IconButton` |
| **correctly hand-rolled** | Not modelled by any primitive — drag handle, sortable header, chip, popover trigger, menu item, a primitive's own internals |
| **converted** | Already migrated; names the release |

### Distribution

`button.tsx` · `icon-button.tsx` · `toggle-button.tsx` · `form-controls.tsx` · `modal-header.tsx` ·
`popover-panel.tsx` · `combobox-shared.tsx` · `report-table.tsx` · `empty-state.tsx` ·
`add-first-item-button.tsx` · `info-tooltip.tsx` · `clearable-search-input.tsx` ·
`filter-multiselect.tsx` hold **18** `<button` OCCURRENCES between them — of which **15** are
internals and **3** are comment prose (`button.tsx:43` · `info-tooltip.tsx:40` ·
`popover-panel.tsx:120`). ★ The 311 headline is unaffected either way: those 3 are subtracted
exactly once whichever bucket they are counted in (341−18−12 = 341−15−15 = 311). The whole block is
excluded from the offender tally, exactly as `form-controls.tsx` is the legitimate
home of the raw `<input>`/`<select>`/`<textarea>` and `data-table.tsx` / `report-table.tsx` of the
raw `<table>`.

That leaves **323** sites, of which **311** are real elements:

| Tag | sites | share of 311 |
|---|---|---|
| convertible | **141** | 45% |
| correctly hand-rolled | **134** | 43% |
| IconButton candidate | **36** | 12% |
| (prose, not an element) | 12 | — |

**converted in 0.221.0: 17 call sites across 6 files** — these no longer appear in a `<button>` scan
at all, which is why the total fell by 4 while eleven more sites changed variant.

---

### converted — 0.221.0

| File | Line | Element | Current look | Tag | Primitive | Reason |
|---|---|---|---|---|---|---|
| `budget-panel.tsx` | 380 | 1 × `<button>` | bordered, `border-ui-dark-blue bg-surface px-2.5 py-1.5` | **converted** | `Button variant="secondary"` | The add-bucket action. Verified against `git show 4dd13660:src/app/budget-panel.tsx` — a real bordered surface button, so `secondary` matches what it already looked like. |
| `budget-panel.tsx` | 668, 675, 689 | 3 × `<button>` | **`border-transparent`**, border only on hover | **converted** | `Button` — `secondary` ×2, **`destructive`** ×1 | ★★ **Remove bucket takes `destructive`**, not `secondary` like its two neighbours: it is the only irreversible action in the row and previously looked identical to Edit and Close. Its `--ui-pink-strong` text is AA-safe on `--surface` **by construction** — `scheme-tokens.ts:119` derives it through `nudgeToAa(…, surface)`, which iterates until the ratio clears 4.5 in every scheme, so this needs no per-scheme contrast check. ★★ **The other two are the worked example for the variant rule, and they went the other way.** At `4dd13660` all three read `rounded-md border border-transparent px-2 py-0.5 text-xs text-muted-foreground hover:border-ui-dark-blue hover:bg-surface-muted` — a *ghost*-looking control that only grows a border on hover. Converting them to `secondary` gives them a permanent border they did not have, so this is a deliberate look CHANGE, not a like-for-like adoption — requested, so the rule does not govern here, but the rule stands for the other 141 candidates. **Eye-verify.** ★★ If the always-on border proves unwanted, the fix is **another `Button` VARIANT — never a return to hand-rolled markup**. `ghost` is the CLOSEST, not a match: the old markup was `text-muted-foreground` with a dark-blue border on hover, while `ghost` is `bg-transparent text-foreground hover:bg-surface-muted` — no border in any state and full-strength text. If no variant fits, the answer is to extend the primitive, not to reopen a `<button>` here. |
| `insights-panel.tsx` | 225, 237, 247, 257 | 4 × `Button` | ghost → secondary | **converted** | `Button variant="secondary"` | Row actions read as flat text at ghost; secondary gives them the bordered affordance the rest of the app uses. |
| `insight-recommendation-controls.tsx` | 3 sites | 3 × `Button` | ghost → secondary | **converted** | `Button variant="secondary"` | Same family as above; kept in step so a recommendation's controls match the panel's. |
| `dashboard-sections/insights-card.tsx` | 4 sites | 4 × `Button` | ghost → secondary | **converted** | `Button variant="secondary"` | Same family, on the dashboard card. |
| `milestones-panel.tsx` | 508 | achieved checkbox | `<input type="checkbox">` → toggle | **converted** | `ToggleButton` | Binary per-row state. Label is pinned to what pressed=true means and qualified per row (`… – ${m.name}`), so N rows do not share one name. |
| `milestone-edit-modal.tsx` | 235 | achieved checkbox | `<input type="checkbox">` → toggle | **converted** | `ToggleButton` | Same field in the modal; kept in step with the table so the two surfaces announce identically. |

★ `budget-panel.tsx:364` also renders a `ToggleButton`, but that is **pre-existing**, not this
release — the diff against `main` adds no `ToggleButton` line in that file. Do not credit it to
0.221.0.

---

### correctly hand-rolled — 134 sites

Grouped by family rather than listed per site: the members of a family are byte-similar and a
134-row table of identical reasons adds no information a reader can act on. Every family carries its
reason, and the line lists keep each site addressable. Family counts are computed, not hand-tallied:
sort-header 33 · popover-trigger 23 · list-option/one-off 22 · inline-cell-editor 20 · toggle-chip 13
· menu-tab-radio 11 · chip 8 · drag 4. **Line lists inside a family are illustrative, not
exhaustive** — the counts are the measured figures.

| Family | sites | Current look | Tag | Reason |
|---|---|---|---|---|
| **Sortable table headers** — `change-panel.tsx` 479-528 (7) · `raid-panel-rows.tsx` 108-157 (7) · `resource-directory.tsx` 334-370 (7) · `stakeholders-panel.tsx` 358-434 (5) · `roles-editor.tsx` 196-220 (4) · `activity-log-panel.tsx` 271-301 (3) | 33 | text + `▲`/`▼`/`↑`/`↓` indicator | **correctly hand-rolled** | A sortable header is a `<th>` carrying a sort control — `Button` models neither half. The shared `SortResizeTh` already covers this shape and these six files are the raw-`<th>` holdouts — folding them in is a real follow-up, but it is a move to `SortResizeTh`, **not** to `Button`. ★★ **The six split two ways on `aria-sort`, and that split decides what a glyph sweep may touch** (`grep -c aria-sort src/app/<file>.tsx`): `change-panel` **7** · `raid-panel-rows` **7** · `stakeholders-panel` **5** set it, so the glyph is a duplicate channel there; `activity-log-panel` · `resource-directory` · `roles-editor` return **0**, so the glyph is the only channel. ★ **None of the six is test-pinned on its glyph** — `grep -lE '[▲▼↑↓]' src/app/{change-panel,raid-panel,resource-directory,roles-editor,stakeholders-panel,activity-log-panel}*.test.tsx` returns `raid-panel.test.tsx` alone, and its three hits are an *optional*-group locator (see Part 2). |
| **Popover / menu triggers** (`aria-expanded`) — incl. `export-menu.tsx:82` · `help-menu.tsx:95` · `settings-menu.tsx:59` · `version-menu.tsx:16` · `template-menus.tsx` 70, 203 · `column-config-popover.tsx:34` · `tasks-section.tsx:728` · `task-row.tsx:662` · `sidebar-nav.tsx:104` · `sidebar.tsx:62` · `timelog-panel.tsx:591` · `workspace-section-chrome.tsx:165` · `jira-settings.tsx:204` · `project-switcher.tsx:145` · `raci-chip-picker.tsx:76` · `resource-workload-triage.tsx:44` · `undo/undo-control.tsx:61` · `action-cta-controls.tsx` 90, 141 · `action-popover-trigger.tsx:45` · `action-reasons.tsx:24` · `actions-panel.tsx:191` | 23 | varies | **correctly hand-rolled** | The trigger owns `aria-expanded`/`aria-haspopup` and a ref the dismissal protocol reads. `Button` forwards neither, and `docs/AGENTS/ui-shell.md` owns that protocol — routing a trigger through a primitive that does not thread the ref is how the Escape/Tab contract breaks silently. |
| **Inline cell editors** — reveal-on-click table cells: `task-row.tsx` 292, 412, 463, 506, 557 · `resource-workload.tsx` 177, 212, 352 · `gantt-rows.tsx` 170, 461 · `milestones-panel.tsx:478` · `stakeholders-panel.tsx:498` · `resource-calendar-rows.tsx:105` · `resources-panel-rows.tsx:128` · `resource-directory.tsx:390` · `task-kanban-card.tsx:84` · `dashboard-panel.tsx:493` · plus 3 more | 20 | `border-transparent`, borders on hover | **correctly hand-rolled** | A transparent-until-hover cell that swaps itself for an input is a table affordance, not a button. Giving these a `Button` border would draw a grid of boxes across every row. |
| **Toggle / segmented chips** (`aria-pressed`) — `create-project-wizard.tsx` 305, 333 · `task-form-fields.tsx` 547, 560 · `knowledge-panel.tsx:210` · `step0-import-panel.tsx:301` · `raci-chip-picker.tsx:102` · `influence-interest-matrix.tsx:77` · `comm-templates-section.tsx` 332, 354 · `dictation-mic.tsx:71` · `voice-button.tsx:98` · `rich-text-editor.tsx:88` | 13 | pressed-state chip / card | **correctly hand-rolled — but see below** | These are pressed-state controls that `ToggleButton` may model. ★★ **Not tagged convertible on purpose:** `ToggleButton` renders a trailing `data-pressed-marker` check glyph and pins the label to what pressed=true enables. A card-sized wizard tile or an editor toolbar chip does not want that glyph, and several here (`create-project-wizard`, `step0-import-panel`) are radio-semantics in disguise, where `aria-pressed` is arguably already the wrong role. Each needs its own decision; none is a mechanical swap. |
| **Chips / pills** — `chat-prompt-chips.tsx:36` · `dashboard-delta-strip.tsx:81` · `milestone-horizon-strip.tsx` 50, 78 · `knowledge-panel.tsx:536` · `stakeholder-map-panel.tsx:172` · plus 2 | 8 | `rounded-full` pill | **correctly hand-rolled** | Pill-shaped, often carrying a `Dot`/`Badge` child. No primitive models a chip; `Badge` is presentational and not focusable. ★ A chip's own **remove ✕** is a different thing and is an `IconButton` candidate — `raci-chip-picker.tsx:119`, `saved-views-menu.tsx:118`, `labels-input.tsx:115` and `stakeholder-recipient-input.tsx:154` are counted there, not here. |
| **Menu items / tabs / radio options** (`role="menuitem"｜"tab"｜"radio"`) — `task-row.tsx` 682-711 (4) · `project-switcher.tsx` 173, 208, 221 · `sidebar-nav.tsx` 133, 241 · `help-view.tsx:114` · `task-manager-ui.tsx:39` · `segmented-control.tsx:131` | 11 | full-width list row | **correctly hand-rolled** | The ARIA role is the point. A `Button` inside `role="menu"` breaks the menu's own keyboard model, and `segmented-control.tsx` is itself a primitive. |
| **List-option rows in pickers** — `sharepoint-picker-modal.tsx` 241, 257 · `resource-picker.tsx` 219, 289 · `change-edit-modal.tsx:670` · `jira-settings.tsx:606` · `export-menu.tsx:111` · `comm-templates-section.tsx:208` · `version-diff-view.tsx:142` · `tour-catalog.tsx:26` · `undo/undo-control.tsx:48` | 10 | full-width, multi-line composite | **correctly hand-rolled** | Multi-line composite content (name + secondary line + count) inside a scrolling result list. `Button` centres a single label and would fight the layout. |
| **Add-row affordances** — `tasks-section.tsx:1027` · `raid-panel-rows.tsx:369` | 2 | dashed-underline full-width row | **correctly hand-rolled** | The last row of a table, styled as a dashed continuation of the grid. `AddFirstItemButton` covers the empty-state case, not this one. |
| **Drag handles** — `budget-panel.tsx:455` · `reports.tsx:535` · `workspace-section.tsx:959` · `resource-calendar-rows.tsx:158` | 4 | `⠿` grip, `cursor-grab` | **correctly hand-rolled** | Carries `draggable`, `onDragStart`/`onDragEnd` and arrow-key reordering — but ★★ **the LIFECYCLE is no longer inline on the reorder grips.** `budget-panel.tsx` and `reports.tsx` (and both `roles-editor.tsx` grips, not listed at left) now spread `handleProps` from `useListReorderDnd`, which owns `draggable`, both drag callbacks and the ArrowUp/ArrowDown `onKeyDown`; the calendar grip is still a hand-written handler. So the row's earlier "read and confirmed: `draggable` + drag lifecycle + an `onKeyDown`" reading of the budget handle describes what the HOOK supplies, not what the JSX spells. What stays hand-rolled is the ELEMENT — a `<button>` carrying the grip glyph, a row-unique `aria-label` and `cursor-grab`. `Button` forwards none of the drag props, and the `DragHandle` primitive exists but does not own the keyboard reorder these need, so this is still not a mechanical swap. ★ The site list at left is NOT re-verified by this correction — one entry no longer resolves to a handle. ★ `dashboard-tile.tsx`'s tile-reorder grip is a FIFTH site on the same rationale, deliberately spelled like the `reports.tsx` one rather than reaching for `DragHandle`, which forwards neither `onDragEnd` nor `onKeyDown`. It is named here WITHOUT a line number and the count at left is left alone on purpose: that 4 is an audit measurement, and bumping it by hand would claim a re-run of the scan that produced it. |
| **Other one-offs** — `node-graph.tsx:246` (graph node) · `raid-risk-matrix.tsx:69` (matrix cell) · `text-button.tsx:44` (its own primitive) · `documents-list.tsx:127` (link-styled title) · `portfolio-health-panel.tsx:173` (link-styled name) · `settings-view.tsx:216` (nav item) · `help-content-pane.tsx:125` · plus 3 | 10 | varies | **correctly hand-rolled** | Each is a shape no primitive models — a positioned graph node, a coloured matrix cell, an inline text link. |

★ **`milestone-edit-modal.tsx`'s `linkedTasks` checkboxes (line 262) stay a real `<input
type="checkbox">` and must not become `ToggleButton`s.** A multi-select list is not a binary toggle:
`aria-pressed` would announce each row as a pressed/unpressed button rather than a checked item in a
set, which is the wrong semantic and loses the group relationship. This is the one place in the
milestone slice where the checkbox→toggle conversion was deliberately not applied.

---

### IconButton candidate — 36 sites

Icon-only or glyph-only actions with an `aria-label` and a hand-written `rounded-md p-2`-family
class. `IconButton` already supplies the padding, focus ring, hover tint and required label.

| File | Line | Element | Current look | Tag | Primitive | Reason |
|---|---|---|---|---|---|---|
| `app-header.tsx` | 105, 115, 127 | `<button>` + heroicon | `rounded-md p-2 text-muted-foreground hover:…` | **IconButton candidate** | `IconButton` | **Read and confirmed**: three icon-only header actions, each `aria-label` + `title`, each repeating an identical 6-class hover/focus string. The classic header's three-icon cluster. |
| `top-bar.tsx` | 36, 55, 66 | `<button>` + heroicon | same class string as above | **IconButton candidate** | `IconButton` | The modern shell's copy of the same cluster. ★ Any change here must land in **both** files — a top-bar control lives in two independent places (`AppHeader` and the `ModernShell` slot) and modern is the default, so it is the easy miss. |
| `help-menu.tsx` · `notes-window.tsx` · `version-info.tsx` | 140 · 104 · 37 | `<button>` + `XMarkIcon` | `rounded p-1` | **IconButton candidate** | `IconButton` | Floating-window close buttons, identical shape in three files. |
| `view-callout.tsx` · `task-kanban-swimlanes.tsx` · `settings-sections/removable-chip-row.tsx` · `labels-input.tsx` · `stakeholder-recipient-input.tsx` | 47 · 133 · 25 · 115 · 154 | `<button>` + `XMarkIcon` | `rounded-full` / `rounded p-0.5` | **IconButton candidate** | `IconButton` | Dismiss/remove actions already using the heroicon; only the chrome is hand-written. |
| `task-row.tsx` · `task-kanban-card.tsx` · `inline-ai-edit-button.tsx` | 386 · 128 · 20 | `<button>` + `SparklesIcon` | `opacity-0 group-hover:opacity-100` | **IconButton candidate** | `IconButton` | Three copies of the same reveal-on-hover inline-AI trigger. ★ The `group-hover` opacity is caller styling and must survive the swap — check `IconButton` accepts it via `className` before converting. |
| `project-switcher.tsx` · `task-manager-ui.tsx` | 237 · 55 | `<button>` + heroicon | `h-8 w-8` / `px-1.5 py-2` | **IconButton candidate** | `IconButton` | Refresh and pop-out affordances. |
| `use-tasks-dedup.tsx` · `sidebar-nav.tsx` · `entity-link-picker.tsx` | 177 · 218 · 204 | `<button>` + icon (+ conditional text) | varies | **IconButton candidate**, needs a read first | `IconButton` | ★ Each renders text **conditionally** (collapsed sidebar, dedup phase, link-picker open affordance). `IconButton` is icon-only by contract, so these are candidates only in their icon-only state. Read before converting. |
| **`×`/`✕`/`&times;` glyph closes** — `actions-panel.tsx:155` · `change-edit-modal.tsx:645` · `dashboard-tip-card.tsx:83` · `entity-link-picker.tsx:233` · `inline-ai-edit-popover.tsx:49` · `knowledge-links-field.tsx:58` · `raci-panel.tsx:224` · `raci-chip-picker.tsx:119` · `resource-edit-modal.tsx:292` · `resource-workload.tsx:318` · `timelog-people-table.tsx:142` · `saved-views-menu.tsx:118` | 12 sites | `<button>` with a bare glyph child | text glyph, no SVG | **IconButton candidate** | `IconButton` + `XMarkIcon` | These are the overlap between Part 1 and Part 2: converting the element and replacing the glyph is one edit, not two. All twelve already carry an `aria-label`, so the glyph is decorative and safe to swap — **except** where a test reads it (none of these twelve; see Part 2). ★ `roles-editor.tsx` 299 and 403 are already `IconButton` but still pass a literal `×` as the child — glyph-only work, the element is done. |
| `resources-panel-toolbar.tsx` | 155, 169 (`<button`; the `◀`/`▶` are at 162, 176) | `<button>` with `◀` / `▶` | bordered `px-2.5 py-1.5` | **IconButton candidate** | `IconButton` + chevron heroicons | **Read and confirmed**: previous/next period stepper flanking a date label, each `aria-label` (`calendarPrev`/`calendarNext`) + `title`, glyph is the only child. |

---

### convertible — 141 sites

Per-file distribution, computed: **2** files with 7 sites (14) · **1** with 5 (5) · **5** with 4 (20)
· **6** with 3 (18) · **21** with 2 (42) · **42** with 1 (42) = 141 across 77 files.

Text-labelled actions repeating one of two class strings that `Button` already emits:
`rounded-md border border-line bg-surface px-3 py-1.5 text-sm …` (→ `variant="secondary"`) or a
filled `bg-ui-*` variant (→ `variant="primary"` / `"destructive"`). ★ `ButtonVariant` is
`"primary" | "secondary" | "ghost" | "destructive"` (`button.tsx:15`) — there is **no `danger`** on
`Button`; `danger` belongs to `IconButtonVariant` (`icon-button.tsx:14`), so writing it here does not
compile. Listed per file so every site stays
addressable; the reason is the same for all of them and is stated once per file only where it
differs.

| File | Lines | Sites | Primitive | Reason |
|---|---|---|---|---|
| `settings-sections/ai-section.tsx` | 252, 260, 477, 489, 730, 739, 765 | 7 | `Button` secondary | Guide/passphrase CRUD actions, all bordered-surface. |
| `settings-sections/next-actions-section.tsx` | 142, 151, 181, 214, 246, 300, 309 | 7 | `Button` secondary | Weight-suggestion and learning-reset actions. |
| `diagnostics-panel.tsx` | 71, 78, 85, 92 | 4 | `Button` secondary | **Read and confirmed**: four siblings in one `flex flex-wrap gap-2`, each repeating the identical class string byte-for-byte. The single cleanest conversion in the tree. |
| `note-log-panel.tsx` | 113, 127, 135, 242 | 4 | `Button` secondary / primary | Note composer + per-entry edit/delete. |
| `settings-sections/mode-section.tsx` | 78, 86, 154, 162 | 4 | `Button` secondary / primary | Preset picks and save/discard. |
| `timelog-panel.tsx` | 643, 650, 714, 743 | 4 | `Button` secondary | Selection and apply/cancel actions. |
| `tasks-section.tsx` | 606, 833, 843, 850 | 4 | `Button` secondary / destructive | Jira sync + the bulk-selection bar. |
| `action-cta-controls.tsx` | 80, 110, 112, 114, 135 | 5 | `Button` | Action-row CTAs. ★ These already share `BTN_CLASS`-style constants; converting means retiring the constant too, or the two drift. |
| `saved-views-menu.tsx` · `sharepoint-picker-modal.tsx` | 80, 94, 106 · 48, 57, 66 | 3 + 3 | `Button` | Save/cancel pairs and picker actions. |
| `calendar-pull-summary-modal.tsx` · `settings-sections/scheduled-jobs-section.tsx` · `task-editor-actions.tsx` · `timelog-panel-toolbar.tsx` | 75, 122, 137 · 102, 172, 258 · 38, 46, 102 · 73, 81, 97 | 3 each | `Button` | Modal footers and toolbar actions. |
| 21 files with 2 sites each — `chat-panel.tsx` 835/923 · `confirm-dialog.tsx` 135/143 · `dashboard-panel.tsx` 395/552 · `dashboard-sections/digest-card.tsx` 44/53 · `help-content-pane.tsx` 217/229 · `notifications.tsx` 42/46 · `raid-panel-rows.tsx` 294/325 · `raid-panel-toolbar.tsx` 146/156 · `rebaseline-popover.tsx` 94/108 · `resource-directory.tsx` 304/420 · `resources-panel-toolbar.tsx` 178/211 · `settings-sections/dictation-section.tsx` 150/162 · `settings-sections/templates-section.tsx` 95/155 · `settings-view.tsx` 216/409 · `task-form-fields.tsx` 264/632 · `task-manager.tsx` 2435/2501 · `template-menus.tsx` 114/258 · `timelog-projects-table.tsx` 69/128 · `trends-panel.tsx` 195/262 · `type-to-confirm-dialog.tsx` 69/76 · `version-diff-view.tsx` 88/151 | 2 each | 42 | `Button` | Same two class strings. |
| 42 files with one site each — `action-chips.tsx` · `actions-panel.tsx` · `activity-log-panel.tsx` · `ai-action-row.tsx` · `app-modals.tsx` · `ask-claude-menu.tsx` · `bulk-edit-bar.tsx` · `change-panel.tsx` · `color-scheme-editor.tsx` · `dashboard-coaching-card.tsx` · `dashboard-sections/registers-band.tsx` · `dashboard-tip-card.tsx` · `documents-list.tsx` · `documents-panel.tsx` · `escalate-popover.tsx` · `gantt-chrome.tsx` · `global-error.tsx` · `insights/insight-digest-card.tsx` · `integration-disclaimer.tsx` · `knowledge-links-field.tsx` · `learning-insights.tsx` · `portfolio-health-panel.tsx` · `project-form-fields.tsx` · `raci-panel.tsx` · `raid-edit-fields.tsx` · `raid-edit-modal.tsx` · `raid-risk-matrix.tsx` · `recovery-banner.tsx` · `reschedule-popover.tsx` · `resource-edit-modal.tsx` · `resource-workload.tsx` · `resources-panel-rows.tsx` · `resources-panel.tsx` · `settings-sections/general-section.tsx` · `sidebar-footer.tsx` · `sidebar.tsx` · `step0-import-panel.tsx` · `task-editor-raid-mini.tsx` · `task-raid-badge.tsx` · `timelog-people-table.tsx` · `timelog-settings.tsx` · `view-callout.tsx` | 1 each | 42 | `Button` | Same two class strings. |

★★ **A conversion here is not free, and the 0.221.0 insights work is the evidence.** Those panes did
not gain `Button` in this release — they already had it — and the change was `variant="ghost"` →
`"secondary"`, i.e. adopting the primitive is step one and picking the right variant is step two.
Converting a bordered-surface `<button>` to `Button variant="ghost"` would silently delete its
border. Match the variant to the current look, and eye-verify.

★ `global-error.tsx:72` renders outside the app shell (it is the top-level error boundary). Importing
a primitive there risks the import graph that failed being the reason the boundary rendered. Leave it.

---

### Non-`<button>` hand-rolled elements

★ Every count in this table is **lines**, and each is a total minus the primitive that legitimately
owns the element. Reproduce — the per-file counts are what make the subtraction checkable:

```bash
NT='--include=*.tsx --exclude=*.test.tsx'
grep -rc "<textarea"     src/app $NT | grep -v ":0$"   # 10 total; form-controls.tsx 3  → 7
grep -rc "<table"        src/app $NT | grep -v ":0$"   # 17 total; data-table.tsx 5, report-table.tsx 0 → 12
grep -rc 'role="dialog"' src/app $NT | grep -v ":0$"   # 26 lines / 22 files; modal.tsx 2 → 24 / 21
grep -rn 'role="listbox"' src/app $NT                  # 5
```

| Family | sites | Tag | Reason |
|---|---|---|---|
| Raw `<input>` outside `form-controls.tsx` | 115 lines / 48 files | **convertible**, mostly | Heaviest: `project-form-fields.tsx` (19) · `jira-settings.tsx` (11) · `budget-bucket-modal.tsx` (9) · `settings-sections/notifications-section.tsx` (8) · `bulk-edit-modal.tsx` (5). `Input` and `Checkbox` cover the plain cases. ★★ **Check the accessible name before each swap** — a `placeholder` is not a label, and folding an unlabelled `<select>` into an axe-scanned view is exactly how a pre-existing violation becomes a gate failure. |
| Raw `<select>` outside `form-controls.tsx` | 37 lines / 23 files, of which **~15 are comment mentions** | **convertible** | Real sites cluster in `budget-bucket-modal.tsx` (4) · `project-form-fields.tsx` (4) · `bulk-edit-modal.tsx` (3) · `roles-editor.tsx` (2). ★ `task-status-select.tsx:21` is the shared inline status select — that one is a primitive in its own right, **keep**. |
| Raw `<textarea>` outside `form-controls.tsx` | **7** lines / 4 files | **convertible** | 10 lines total − 3 in `form-controls.tsx`. `bulk-edit-modal.tsx` (2) · `project-form-fields.tsx` (3) · `chat-panel.tsx:809` · `task-row.tsx:323` — which sums to 7, as it should. ★ `chat-panel.tsx` and `task-row.tsx` are auto-growing composers with their own key handling — read first. |
| Raw `<table>` outside `data-table.tsx` / `report-table.tsx` | **12** lines / 10 files | **correctly hand-rolled** | 17 lines total − 5 in `data-table.tsx`; `report-table.tsx` holds **no** `<table` at all, so it subtracts nothing. `raid-report-panel.tsx` (2) · `markdown.tsx` (2, at 391 and one more) · `add-first-item-button.tsx` · `change-report-panel.tsx` · `learning-insights.tsx` · `panel-table-scaffold.tsx` · `resource-calendar-band.tsx` · `resource-calendar.tsx:524` · `resources-panel-rows.tsx:94` · `tasks-section.tsx:958`. Each carries panel-specific geometry — sticky columns placed by arithmetic, `w-max`, a `<tbody>` band interleaved with other rows. `markdown.tsx` renders user markdown and cannot use a typed table at all. |
| `role="dialog"` outside `modal.tsx` / `popover-panel.tsx` | **24** lines / **21** files | **correctly hand-rolled** | 26 lines / 22 files total − the 2 in `modal.tsx` (`popover-panel.tsx` has none). ★ Every other row in this document counts LINES; the "21" this row used to carry was the FILE count. Every one is a popover panel or floating window that already routes through `PopoverPanel` or owns its own drag/dismiss wiring. No hand-rolled modal was found that should be `Modal` — this was the cleanest result in the audit. |
| `role="listbox"` | **5** lines / 5 files — `combobox-shared.tsx:116` · `entity-link-picker.tsx:299` · `global-search-box.tsx:278` · `resource-picker.tsx:260` · `stakeholder-recipient-input.tsx:193` | **correctly hand-rolled** | Real combobox listboxes; `combobox-shared.tsx` is the primitive and the rest are its peers with divergent option shapes. ★ The row said "4 sites" while naming five files — all five are real. |
| `role="tooltip"` | 1 — `info-tooltip.tsx:61` | **correctly hand-rolled** | The primitive itself. |

---

## Part 2 — glyph → heroicon candidates

| Tag | Meaning |
|---|---|
| **replace** | Decorative icon with a heroicon equivalent; swap and keep it out of the a11y tree |
| **keep — semantic text** | Part of the accessible name, or of `textContent` an existing test reads |
| **keep — not an icon** | Multiplication sign, bullet in prose, `★` doc marker |

Counts over non-test `.tsx`, comment-first-token lines dropped, over the full glyph set this section
actually discusses (the plan's 13 plus `★ ⠿ ◀ ▶ ↩ → ←`): **142 glyph-carrying lines**, of which
**28 are `★`** — this repo's own documentation marker, on JSX-comment *continuation* lines that the
first-token heuristic does not catch. Excluding those leaves **114 lines** carrying a real glyph.

```bash
D='^[0-9]+:[[:space:]]*(//|\*|/\*|\{/\*)'
G='[✓⚠✕×⋮▸▾▼▲↑↓•★⠿◀▶↩→←]'
grep -rhn --include=*.tsx --exclude=*.test.tsx -E "$G" src/app | grep -vE "$D" | wc -l      # 142
grep -rhn --include=*.tsx --exclude=*.test.tsx -E "$G" src/app | grep -vE "$D" | grep -c  ★ # 28
grep -rhn --include=*.tsx --exclude=*.test.tsx -E "$G" src/app | grep -vE "$D" | grep -vc ★ # 114
```

★★★ **`🗒` is deliberately absent from `$G` and removing it is what makes the command reproduce.**
It is non-BMP, and including it in the bracket expression made the class match every other emoji in
the tree, inflating 142 to 148 (see the grep landmine in Part 1). It costs nothing to drop: `🗒`
occurs **0** times in non-test `.tsx`. Restricted to the plan's own 13 glyphs plus `★`
(`G='[✓⚠✕×⋮▸▾▼▲↑↓•★]'`, again with `🗒` dropped), the same command reads **116 / 28 / 88** — quote
whichever set you mean, but say which.

★★★ **That second figure was written as 122 / 28 / 94 first, and 122 was this exact bug reappearing
one paragraph after it was documented** — the narrower class had been measured with `🗒` still in
it, over-matching by the same 6 emoji lines. It was caught only by running the command as published.
**Run the reproduce command you attach**, and run it in the form you attach it in.

★★ **The previously-recorded 188 / 65 / 123 is not reproducible under any filter and should not be
re-quoted.** Sweeping four glyph sets × four comment heuristics × four file scopes produces nothing
near it; the closest shape is 170 / 68 / 102. Its internal arithmetic was self-consistent
(188 − 65 = 123), which is exactly why it survived — a number can be *consistent* and still be
*unmeasured*. It was the one count in this document with no reproduce command beside it.

### ★★★ Test-pinned glyphs — the plan named 2 of these; there are 6, and RAID is **not** one

The plan flags `report-table.test.tsx` and `calendar-series-list.test.tsx` and says to check for
others rather than assume those are the only two. **They are not.** Grepping every `*.test.tsx` in
`src/app` for each glyph and then reading each hit to separate a real assertion from a mention in an
`it(...)` title turns up four more. ★★ A fifth candidate — `raid-panel-rows.tsx` — was listed here
as pinned and is **not**; it is kept in the table below with that finding, because the reason it
looked pinned is the trap:

| Source site | Glyph | Pinned by | Assertion | Tag |
|---|---|---|---|---|
| `report-table.tsx:148` | `↑` `↓` | `report-table.test.tsx` 25, 39, 40, 104 | `btn.textContent` contains / does not contain the glyph | **keep — semantic text** |
| `report-table.tsx:148` (via `SortResizeTh`) | `↑` `↓` | `calendar-series-list.test.tsx` 168, 194, 196, 198 | strips `[↑↓]` from `textContent`, then asserts presence | **keep — semantic text** |
| ~~`raid-panel-rows.tsx` 109-158~~ | `▲` `▼` | `raid-panel.test.tsx` 115, 122, 131 | `getByRole("button", { name: /^Severity( [▲▼])?$/ })` — the glyph is an **optional** group, so `"Severity"` alone matches too | **NOT PINNED** — see below |
| `task-status-glyph.tsx` 54, 56 | `✓` `✕` | `task-row.test.tsx` 573, 574, 581, 582 | `container.textContent` toContain / not.toContain | **keep — semantic text** |
| `dashboard-panel.tsx:364` | `✕` | `dashboard-panel.test.tsx:919` | `expect(value?.textContent).toBe(\`000✕${label}2\`)` | **keep — semantic text** |
| `entity-link-picker.tsx:222` | `↩` | `entity-link-picker.test.tsx:157` | `chip.textContent` toContain | **keep — semantic text** |
| `milestone-horizon-strip.tsx:46` | `⚠` | `milestone-horizon-strip.test.tsx:38` | `getByText(/⚠/)` | **keep — semantic text** |

★★★ **`raid-panel-rows.tsx` was written up here as the worst of the set. Both halves of that were
wrong, and correcting them flips the conclusion: RAID is an argument FOR the glyph sweep, not a
hazard against it.**

- **It is not test-pinned.** `raid-panel.test.tsx` matches the header with
  `/^Severity( [▲▼])?$/` — the glyph sits in an **optional** group, so the accessible name
  `"Severity"` matches just as well. Blanking the glyph does not fail that test. It is a locator
  written to *tolerate* the glyph, not an assertion that *requires* it, and reading a tolerant
  locator as a pin is the trap: a `getByRole` name regex containing a glyph looks identical to one
  asserting it. Check whether the glyph is inside a `?`/`*` group before calling anything pinned.
- **The `<th>`s are not missing `aria-sort` — all seven set it** (`raid-panel-rows.tsx` 107, 115,
  123, 131, 140, 148, 156; `grep -c aria-sort src/app/raid-panel-rows.tsx` → **7**). `AGENTS.md:965`
  already recorded this: "`change-panel.tsx` + `raid-panel-rows.tsx` + `stakeholders-panel.tsx` set
  aria-sort AND keep a ▲/▼ inside the button's name." So sort direction has a channel that does not
  depend on the glyph at all.

★★ **The truth INVERTS the old conclusion.** RAID sets `aria-sort` *and* duplicates that state in the
accessible name — the exact **double announcement** `SortResizeTh` was changed to eliminate ("the
double announcement this removed from the shared component", `AGENTS.md`). Six of the seven headers
have the glyph in their name; the seventh, `id` (button at `:108`), carries
`aria-label={t(lang,"id")}`, which overrides content, so its glyph is in `textContent` only.
Blanking the glyph on the other six *removes* a redundant announcement and leaves `aria-sort` as the
surviving channel — which is the improvement, not the regression.

★★★ **The "no channel at all" warning is real, but it belongs to three OTHER files**, which set no
`aria-sort` whatsoever (`grep -c aria-sort` → **0** each): `activity-log-panel.tsx`,
`resource-directory.tsx`, `roles-editor.tsx`. There the glyph *is* the only sort-state channel, and
replacing it with an `aria-hidden` SVG genuinely removes the information. Read the `<th>` — not the
`<button>` — before touching any sort indicator.

★★ `dashboard-panel.tsx:364` is pinned by an **exact-string** `toBe`, the most brittle form here —
any change to that glyph fails the test with a diff that looks like a count regression rather than a
glyph swap. The glyph is already `aria-hidden` with an `sr-only` companion, so it is correct as it
stands; the test is simply reading the visible string.

★ **Mentioned in test titles or comments only — NOT assertions, so not a blocker.** Do not
re-litigate these as pinned: `knowledge-panel.test.tsx` 108, 155 · `timelog-panel.test.tsx` 703, 723
· `global-search-box.test.tsx:150` · `project-empty-state.test.tsx:82` · `report-table.test.tsx`
250-330 (the `✕` there is prose about the clear button; only its `↑`/`↓` lines assert) ·
`stakeholder-recipient-input.test.tsx:78` · `resource-workload.test.tsx:75` ·
`budget-panel.test.tsx` (all five `×` are arithmetic in comments) · `icon-button.test.tsx:7` (the `✕`
is the test's own fixture child, not a source glyph).

### replace

| File | Line | Glyph | Context | Tag | Proposed heroicon | Reason |
|---|---|---|---|---|---|---|
| `resources-panel-toolbar.tsx` | **162, 176** (glyph lines; the `<button` are 155, 169) | `◀` `▶` | prev/next period stepper | **replace** | ChevronLeftIcon / ChevronRightIcon | **Read and confirmed**: each button carries its own `aria-label` + `title`, and the glyph is the sole child. Purely decorative once the label is there. ★ Neither icon name exists in the tree yet — both would be new imports. |
| `actions-panel.tsx` · `change-edit-modal.tsx` · `dashboard-tip-card.tsx` · `entity-link-picker.tsx` · `inline-ai-edit-popover.tsx` · `knowledge-links-field.tsx` · `raci-panel.tsx` · `raci-chip-picker.tsx` · `resource-edit-modal.tsx` · `resource-workload.tsx` · `timelog-people-table.tsx` · `saved-views-menu.tsx` · `history-panel.tsx` (×2) · `chat-panel.tsx` (×2) · `project-form-fields.tsx` · `raid-panel-toolbar.tsx` · `reports.tsx` · `knowledge-panel.tsx` (×2) · `roles-editor.tsx` (×2) | 155 · 645 · 83/90 · 233/251 · 49 · 58/64 · 224 · 119/128 · 292/297 · 318/328 · 142/149 · 118/131 · 242, 370 · 766, 789 · 691/697 · 146/152 · 558/565 · 451, 517 · 299, 403 | `×` `✕` `&times;` | close / remove / clear | **replace** | `XMarkIcon` | ~26 sites, all already carrying an `aria-label`, so the glyph is decorative and the a11y tree is unchanged by the swap. ★★ Three spellings of the same idea are in use (`×` U+00D7, `✕` U+2715, `&times;`) — the inconsistency alone is a reason to converge. `XMarkIcon` is already imported in **13** files (`grep -rl XMarkIcon src/app \| wc -l`), so this adds no dependency. ★ Those 13 do NOT overlap the ~19 listed here — the swap adds the import to each of these, it does not merely reuse an existing one. |
| `action-cta-controls.tsx` · `task-row.tsx` | 145 · 672 | `⋮` | overflow-menu trigger | **replace** | `EllipsisVerticalIcon` | Both triggers carry a row-unique `aria-label`; `task-row.test.tsx:797` mentions `⋮` in a test **title** only, with no assertion on it. ★ Confirmed by reading `task-row.tsx:656-672`. |
| `action-reasons.tsx` · `actions-panel.tsx` · `documents-history-modal.tsx` · `jira-settings.tsx` · `notifications.tsx` · `chat-tool-block.tsx` | grep `▸`/`▾` | `▸` `▾` | disclosure caret | **replace** | `ChevronDownIcon` (rotated) | ★★ **THREE** of the six already wrap the glyph in `<span aria-hidden>` (`action-reasons.tsx`, `actions-panel.tsx`, `documents-history-modal.tsx`), so the swap is an AT no-op at those three ONLY. The other three (`jira-settings.tsx`, `notifications.tsx`, and `chat-tool-block.tsx`'s tool-call `<summary>`) render the caret as BARE text inside the control, so it is currently part of the accessible name — swapping in an `aria-hidden` heroicon there SHORTENS the name and must be checked against any test or duplicate-name concern first. An earlier revision of this row said "three" and called the swap a blanket no-op; that would have licensed exactly the unchecked edit this column exists to prevent. `ChevronDownIcon` with a rotation class is what `sidebar.tsx` and `timelog-panel.tsx` already do (grep the icon name) — this converges on the existing pattern. ★★★ **This row carried SEVEN line numbers on 2026-08-09 and FIVE of them were wrong**, while the CLAIM they supported was still true at every site: `actions-panel` was 3 lines off, `notifications` 6, `sidebar` and `timelog-panel` 8 each, and the caret attributed to `chat-panel.tsx` had moved into `chat-tool-block.tsx` entirely. `docs:claims:check` caught exactly ONE — the only one that ran past EOF. That ratio is the argument for the Line column reading as a grep. ★★★ AND FIXING THE COLUMN IMMEDIATELY FOUND A SIXTH FILE: the original `` grep `▸` `` returned `documents-history-modal.tsx` while MISSING `notifications.tsx` (which carries only `▾`), so the row's own file list had been wrong in BOTH directions at once. Widening it to `` `▸`/`▾` `` returns six files against a five-file row — which is how the count moved from two-of-five to three-of-six. ★★ A repair command is a CLAIM: run it and reconcile its output against the row, or the fix leaves the row wrong in a new way. |
| `integration-disclaimer.tsx` · `notifications.tsx` (×2) · `jira-settings.tsx` · `color-scheme-editor.tsx` | 56 · 83, 100 · 343 · 294 | `⚠` | warning marker | **replace** | `ExclamationTriangleIcon` | `integration-disclaimer.tsx:56` is already `<span aria-hidden="true">⚠</span>`. ★★ The two `notifications.tsx` sites pass `icon="⚠"` as a **string prop** to a banner component — that is an API change, not a glyph swap, and would need the prop to accept a node. Larger than it looks. |
| `jira-settings.tsx` · `settings-sections/ai-section.tsx` · `storage-config.tsx` (×2) · `tour-catalog.tsx` (×2) | 338, 591 · 534 · 185, 315 · 39, 46 | `✓` | success/done marker | **replace** | `CheckIcon` | Status confirmations beside their own text. ★★ **Not the same as `✓` in `task-status-glyph.tsx` or `milestones-panel.tsx:498`** — those are keeps (see below). Check which `✓` you are looking at. |
| `raid-panel-rows.tsx` | 335 | `↩` | parent-link chip | **replace**, blocked | `ArrowUturnLeftIcon` | Decorative next to `#{pid}`. ★ **Blocked**: the sibling site `entity-link-picker.tsx:222` carries the same glyph and IS test-pinned, so converge both or neither — replacing one leaves two spellings of the same affordance. |

### keep — semantic text

| File | Line | Glyph | Context | Tag | Reason |
|---|---|---|---|---|---|
| the six sites in the test-pinned table above | — | `↑↓✓✕↩⚠` | sort state, status, chip | **keep — semantic text** | See above: `textContent` assertions. (RAID is listed there as **not** pinned and is not one of the six.) |
| `activity-log-panel.tsx` · `resource-directory.tsx` · `roles-editor.tsx` | 160 · 196 · 197-221 | `↑` `↓` `▲` `▼` | sort indicator | **keep — semantic text** | The three raw-`<th>` families with **`aria-sort` count 0**, so the glyph is the only sort-state channel. Removing it removes the information. **Not safe to blank.** |
| `change-panel.tsx` · `raid-panel-rows.tsx` · `stakeholders-panel.tsx` | 349 · 109-158 · 256 | `▲` `▼` | sort indicator | **candidate — redundant** | The three raw-`<th>` families that DO set `aria-sort` (**7** · **7** · **5**) *and* repeat the state in the accessible name — the double announcement `SortResizeTh` was changed to drop. Blanking the glyph here is a net a11y improvement, not a loss. ★ The real follow-up for all six is a move to `SortResizeTh`, which resolves the glyph question as a side effect. |
| `trend-arrow.tsx` | 15 | `↑` `↓` `→` | `GLYPH` direction map | **keep — semantic text** | A pure data map consumed as visible text — the glyph IS the rendered content, with no adjacent label carrying the direction. ★★ NOT test-pinned, despite an earlier revision of this row saying so: every assertion in `trend-arrow.test.tsx` reads `className` or a numeric `textContent` ("−2", "+5%"), and the only `→` occurrences are inside `test(…)` TITLES. Blanking the arrow would not fail that suite. The keep stands on the glyph being the sole visible signal, not on test coverage. |
| `task-status-glyph.tsx` | 54, 56 | `✓` `✕` | `role="img"` + `aria-label` | **keep — semantic text** | **Read and confirmed**: the glyph is the visible half of a labelled `role="img"`. Swapping it for an `aria-hidden` heroicon inside a `role="img"` leaves an image with a name and no content. |
| `milestones-panel.tsx` | 498 | `✓` `⚠` | status cell prefix | **keep — semantic text** | Prefixed into the status **text**, not a separate node — an SVG cannot be string-concatenated into it without restructuring the cell. |
| `chat-panel.tsx` | 962 | `⚠` `▸` | tool-call status prefix | **keep — semantic text** | Same shape: built into a template literal, not a node. |
| `history-panel.tsx` | 273 | `★` | manual-snapshot marker | **keep — semantic text** | Concatenated into the trigger label string. |
| `trends-panel.tsx` | 258 | `★` | baseline marker in a `<td>` | **keep** | The cell's entire content. ★ Not test-pinned — no `trends-panel` test references `★`. It is a keep because a bare marker cell with an `aria-hidden` SVG would announce as empty; giving it a StarIcon needs an `sr-only` companion first, which is a change, not a swap. |
| `raid-risk-matrix.tsx` · `stakeholder-map-panel.tsx` | 43, 87 · 149, 203 | `←` `→` `↑` | axis direction labels | **keep — semantic text** | Part of the axis caption ("← Impact →"). The arrows carry the low/high direction; nothing else does. |

### keep — not an icon

| File | Line | Glyph | Context | Tag | Reason |
|---|---|---|---|---|---|
| `budget-panel.tsx` · `budget-report-panel.tsx` | 481 · 220 | `×` | `(×${rate})` | **keep — not an icon** | A currency rate multiplier. |
| `insights-panel.tsx` | 213 | `×` | `${occurrences}×` | **keep — not an icon** | "seen 3×". |
| `raid-edit-modal.tsx` · `raid-panel-rows.tsx` | 504 · 250 | `×` | `probability × impact` | **keep — not an icon** | Severity arithmetic shown to the user. |
| `stakeholder-map-panel.tsx` · `stakeholder-report-panel.tsx` · `task-form-fields.tsx` | 154 · 107 · 232 | `×` | "2×2 grid", prose | **keep — not an icon** | JSX comments. |
| `chat-panel.tsx` · `version-info.tsx` · `settings-sections/appearance-section.tsx` (×2) · `gantt-rows.tsx` (×3) | 898 · 70 · 253, 258 · 343-345 | `•` | separator / comment bullet | **keep — not an icon** | Four are bullets inside JSX comments; the two rendered ones are inline separators between text runs, where an SVG would break the line box. |
| `★` on comment continuation lines | 26 of 28 lines | `★` | doc marker | **keep — not an icon** | This repo's own landmine convention. `★` was not in the plan's combined grep and should stay out of any future one — it is **28 of 142 glyph-carrying lines (20%)** and pure noise for this purpose. ★★ The figure here used to read "65 lines … 53%", which was 65/123 — the ★ count divided by the total that **excludes** ★. Whichever number you quote, divide by the total that **includes** it. ★ The other 2 of the 28 are real rendered `★` markers (`history-panel.tsx:273`, `trends-panel.tsx:258`) and have their own rows above. |
| `budget-panel.tsx` · `reports.tsx` · `workspace-section.tsx` | 473 · 554 · 959 | `⠿` | drag grip | **keep — not an icon** | Braille-pattern grip, `aria-hidden`, on a `draggable` handle. ★ Not in the plan's glyph list at all. Heroicons has no grip glyph, so there is nothing to swap to. |

★ **Glyphs the plan's list missed entirely**, found by widening the scan: `⠿` (3, drag grips) ·
`◀`/`▶` (2, the period stepper) · `↩` (2, one of them test-pinned) · `→` (the largest family in the
tree by far, almost all of it prose and arrow-in-a-sentence). A future sweep should start from the
glyph inventory, not from a fixed list.

---

## Sanity check — 6 rows re-read at their line

The plan asks for 5, at least one per tag. Six were opened and read in full context:

| Row | Tag claimed | Outcome |
|---|---|---|
| `diagnostics-panel.tsx:71` | convertible | **Confirmed.** Four siblings in one flex row, identical class strings, plain `{t(lang, …)}` children. |
| `app-header.tsx:105` | IconButton candidate | **Confirmed.** Icon-only, `aria-label` + `title`, hand-written `rounded-md p-2 …` chrome. |
| `budget-panel.tsx:455` | correctly hand-rolled (drag) | **Confirmed.** `draggable` + `onDragStart`/`onDragEnd` + `onKeyDown` ArrowUp/ArrowDown reorder. |
| `budget-panel.tsx` 380/668/675/684 | converted (0.221.0) | **Confirmed** against the diff: 4 `<button` removed, 4 `<Button variant="secondary">` added. Also **corrected** a would-be error — the `ToggleButton` at line 364 is pre-existing, not this release. ★ A later fact-check found the row's *reason* wrong too — see the split rows in "converted". |
| `raid-panel-rows.tsx:109` | keep — semantic text | ★★★ **Wrong in both directions, and it was this document's ★★★ headline.** It was first written up as "confirmed and upgraded" (glyph in the accessible name, test-pinned, no `aria-sort`). All seven `<th>` DO set `aria-sort`, and the test regex makes the glyph optional. See the inverted finding in Part 2. |
| `resources-panel-toolbar.tsx:155` | replace | **Confirmed.** `aria-label` + `title` present, glyph is the sole child, so it is decorative. ★ Line numbers off by one element: `:155` is the `<button`, the glyph is at `:162`. |

★★★ **Six things this document asserted were wrong before they were checked — and one of them was
its own ★★★ headline**, all recorded above rather than silently fixed, because the point of the
sample is to say how the method fails, not just how often. ★ The count itself was understated twice
(first "three", then "four") by a reviewer counting only the items listed below and missing the
converted-row *reason* error and the `trend-arrow` citation, which are recorded in their own rows.
Every one of the six is a claim that something is GUARDED, PINNED or ABSENT — never a count:

1. one tag (`raid-panel-rows.tsx:109`, wrong until the file was opened),
2. one provenance fact (`budget-panel.tsx:364`, wrong until the diff was read),
3. one classification (four elements mis-filed as prose because their children open with a JSX
   comment) — this moved four numbers: the element total, the convertible count, the
   correctly-hand-rolled count and the prose count,
4. and the **`raid-panel-rows` a11y conclusion itself** — the loudest, most-starred claim in the
   document, restated in `open-followups.md` §102, and contradicted by a line of `AGENTS.md` that
   was already correct. A single `grep -c aria-sort` would have caught it at any point.

★★★ **The lesson is not the rate, it is WHICH claims failed.** All four survived because they were
*plausible*, and three of them survived a re-read: #1 and #4 were the SAME row, re-read once and
"upgraded" in the wrong direction — a second look confirmed the story rather than testing it. The
claims that failed are the ones asserting something is *guarded*, *pinned*, or *absent* — exactly
the shape `AGENTS.md` warns is ungated. Counts, by contrast, held up well: 11 of 13 glyph rows and
every Part 1 headline count reproduced.

★★ **Do not read the above as an error RATE.** Six rows were sampled out of 311 and the sample was
not random — it was drawn one-per-tag, which over-weights unusual rows. n=6 supports "this method
produces wrong claims of an identifiable kind", not a percentage, and the earlier wording ("assume
the remaining 305 unread rows carry the same error rate") inferred one from six. Treat every unread
row as **unverified** rather than as carrying some estimated error probability, and re-measure any
specific claim before relying on it — which is the same instruction the head of this file gives.
