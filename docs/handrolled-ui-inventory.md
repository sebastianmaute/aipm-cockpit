# Hand-rolled UI inventory

Snapshot taken 2026-08-07, on `63e4d768` (branch `feat/ui-batch-slice-1`, release 0.221.0).
**Audit only — nothing here is scheduled.** Producing the list and acting on it are separate jobs.

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
Run over `src/app` **including `.ts` files and including `*.test.tsx`**, every number matches to the
digit:

| glyph | plan baseline | non-test `.tsx` (the stated filter) | `src/app` all `.ts`+`.tsx`, tests included |
|---|---|---|---|
| `✓` | 17 | 10 | **17** |
| `⚠` | 9 | 8 | **9** |
| `✕` | 47 | 24 | **47** |
| `×` | 75 | 22 | **75** |
| `⋮` | 9 | 2 | **9** |
| `▸` | 4 | 4 | **4** |
| `▾` | 3 | 3 | **3** |
| `▼` | 17 | 14 | **17** |
| `▲` | 17 | 14 | **17** |
| `↑` | 12 | 5 | **12** |
| `↓` | 9 | 4 | **9** |
| `•` | 21 | 7 | **21** |
| `🗒` | 2 | 0 | **2** |

So the tree did **not** move for glyphs — the baseline was measured with the `--include` /
`--exclude` filters not in effect. Two consequences worth carrying forward:

- ★★ The `🗒` count of 2 is not UI at all. Both hits are in
  `src/app/operating-guide-builtin.generated.ts`, a generated help-content data file. There is **no
  `🗒` glyph anywhere in the app's markup** — the notes badge renders a `DocumentTextIcon`
  (`notes-badge-button.tsx:25`), so the "🗒 N badge" wording elsewhere in the docs describes an icon,
  not a literal glyph.
- ★★ The inflation is heaviest exactly where the plan warns the manual work is. `×` drops 75 → 22
  once tests and `.ts` files are excluded, because test files are full of arithmetic in comments
  (`100h×150`, `22 workdays × 8h`). The multiplication problem is real but a third the size the
  baseline implies.

**All glyph figures in Part 2 below are the non-test `.tsx` figures**, i.e. the filter the plan's
command describes.

### The counts include lines that are not elements

★ 8 of the 341 `<button` hits are the word `<button>` inside a comment that the
first-non-space-token heuristic **does** catch — `action-popover-trigger.tsx:5` ·
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
`filter-multiselect.tsx` hold **18** `<button>` sites between them. Those are the primitives' own
internals and are excluded from the offender tally, exactly as `form-controls.tsx` is the legitimate
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
| `budget-panel.tsx` | 380, 668, 675, 684 | 4 × `<button>` | bordered surface button | **converted** | `Button variant="secondary"` | Four bucket/rate-card actions carried the `rounded-md border border-line bg-surface px-…` string verbatim. Verified: the diff against `main` removes exactly 4 `<button` lines here and adds 4 `<Button`. |
| `insights-panel.tsx` | 225, 237, 247, 257 | 4 × `Button` | ghost → secondary | **converted** | `Button variant="secondary"` | Row actions read as flat text at ghost; secondary gives them the bordered affordance the rest of the app uses. |
| `insight-recommendation-controls.tsx` | 3 sites | 3 × `Button` | ghost → secondary | **converted** | `Button variant="secondary"` | Same family as above; kept in step so a recommendation's controls match the panel's. |
| `dashboard-sections/insights-card.tsx` | 4 sites | 4 × `Button` | ghost → secondary | **converted** | `Button variant="secondary"` | Same family, on the dashboard card. |
| `milestones-panel.tsx` | 507 | achieved checkbox | `<input type="checkbox">` → toggle | **converted** | `ToggleButton` | Binary per-row state. Label is pinned to what pressed=true means and qualified per row (`… – ${m.name}`), so N rows do not share one name. |
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
| **Sortable table headers** — `change-panel.tsx` 479-528 (7) · `raid-panel-rows.tsx` 108-157 (7) · `resource-directory.tsx` 334-370 (7) · `stakeholders-panel.tsx` 358-434 (5) · `roles-editor.tsx` 196-220 (4) · `activity-log-panel.tsx` 271-301 (3) | 33 | text + `▲`/`▼`/`↑`/`↓` indicator | **correctly hand-rolled** | A sortable header is a button whose accessible NAME encodes sort state. `Button` models neither. The shared `SortResizeTh` already covers this shape and these six files are the raw-`<th>` holdouts — folding them in is a real follow-up, but it is a move to `SortResizeTh`, **not** to `Button`. ★ Three of them are pinned by tests that read the glyph out of the name — see Part 2. |
| **Popover / menu triggers** (`aria-expanded`) — incl. `export-menu.tsx:82` · `help-menu.tsx:95` · `settings-menu.tsx:59` · `version-menu.tsx:16` · `template-menus.tsx` 70, 203 · `column-config-popover.tsx:34` · `tasks-section.tsx:728` · `task-row.tsx:662` · `sidebar-nav.tsx:104` · `sidebar.tsx:62` · `timelog-panel.tsx:591` · `workspace-section-chrome.tsx:165` · `jira-settings.tsx:204` · `project-switcher.tsx:145` · `raci-chip-picker.tsx:76` · `resource-workload-triage.tsx:44` · `undo/undo-control.tsx:61` · `action-cta-controls.tsx` 90, 141 · `action-popover-trigger.tsx:45` · `action-reasons.tsx:24` · `actions-panel.tsx:191` | 23 | varies | **correctly hand-rolled** | The trigger owns `aria-expanded`/`aria-haspopup` and a ref the dismissal protocol reads. `Button` forwards neither, and `docs/AGENTS/ui-shell.md` owns that protocol — routing a trigger through a primitive that does not thread the ref is how the Escape/Tab contract breaks silently. |
| **Inline cell editors** — reveal-on-click table cells: `task-row.tsx` 292, 412, 463, 506, 557 · `resource-workload.tsx` 177, 212, 352 · `gantt-rows.tsx` 170, 461 · `milestones-panel.tsx:478` · `stakeholders-panel.tsx:498` · `resource-calendar-rows.tsx:105` · `resources-panel-rows.tsx:128` · `resource-directory.tsx:390` · `task-kanban-card.tsx:84` · `dashboard-panel.tsx:493` · plus 3 more | 20 | `border-transparent`, borders on hover | **correctly hand-rolled** | A transparent-until-hover cell that swaps itself for an input is a table affordance, not a button. Giving these a `Button` border would draw a grid of boxes across every row. |
| **Toggle / segmented chips** (`aria-pressed`) — `create-project-wizard.tsx` 305, 333 · `task-form-fields.tsx` 547, 560 · `knowledge-panel.tsx:210` · `step0-import-panel.tsx:301` · `raci-chip-picker.tsx:102` · `influence-interest-matrix.tsx:77` · `comm-templates-section.tsx` 332, 354 · `dictation-mic.tsx:71` · `voice-button.tsx:98` · `rich-text-editor.tsx:88` | 13 | pressed-state chip / card | **correctly hand-rolled — but see below** | These are pressed-state controls that `ToggleButton` may model. ★★ **Not tagged convertible on purpose:** `ToggleButton` renders a trailing `data-pressed-marker` check glyph and pins the label to what pressed=true enables. A card-sized wizard tile or an editor toolbar chip does not want that glyph, and several here (`create-project-wizard`, `step0-import-panel`) are radio-semantics in disguise, where `aria-pressed` is arguably already the wrong role. Each needs its own decision; none is a mechanical swap. |
| **Chips / pills** — `chat-prompt-chips.tsx:36` · `dashboard-delta-strip.tsx:81` · `milestone-horizon-strip.tsx` 50, 78 · `knowledge-panel.tsx:536` · `stakeholder-map-panel.tsx:172` · plus 2 | 8 | `rounded-full` pill | **correctly hand-rolled** | Pill-shaped, often carrying a `Dot`/`Badge` child. No primitive models a chip; `Badge` is presentational and not focusable. ★ A chip's own **remove ✕** is a different thing and is an `IconButton` candidate — `raci-chip-picker.tsx:119`, `saved-views-menu.tsx:118`, `labels-input.tsx:115` and `stakeholder-recipient-input.tsx:154` are counted there, not here. |
| **Menu items / tabs / radio options** (`role="menuitem"｜"tab"｜"radio"`) — `task-row.tsx` 682-711 (4) · `project-switcher.tsx` 173, 208, 221 · `sidebar-nav.tsx` 133, 241 · `help-view.tsx:114` · `task-manager-ui.tsx:39` · `segmented-control.tsx:131` | 11 | full-width list row | **correctly hand-rolled** | The ARIA role is the point. A `Button` inside `role="menu"` breaks the menu's own keyboard model, and `segmented-control.tsx` is itself a primitive. |
| **List-option rows in pickers** — `sharepoint-picker-modal.tsx` 241, 257 · `resource-picker.tsx` 219, 289 · `change-edit-modal.tsx:670` · `jira-settings.tsx:606` · `export-menu.tsx:111` · `comm-templates-section.tsx:208` · `version-diff-view.tsx:142` · `tour-catalog.tsx:26` · `undo/undo-control.tsx:48` | 10 | full-width, multi-line composite | **correctly hand-rolled** | Multi-line composite content (name + secondary line + count) inside a scrolling result list. `Button` centres a single label and would fight the layout. |
| **Add-row affordances** — `tasks-section.tsx:1027` · `raid-panel-rows.tsx:369` | 2 | dashed-underline full-width row | **correctly hand-rolled** | The last row of a table, styled as a dashed continuation of the grid. `AddFirstItemButton` covers the empty-state case, not this one. |
| **Drag handles** — `budget-panel.tsx:455` · `reports.tsx:535` · `workspace-section.tsx:959` · `resource-calendar-rows.tsx:158` | 4 | `⠿` grip, `cursor-grab` | **correctly hand-rolled** | Carries `draggable`, `onDragStart`/`onDragEnd` and arrow-key reordering. **Read and confirmed** at `budget-panel.tsx:455-470`: `draggable` + drag lifecycle + an `onKeyDown` implementing ArrowUp/ArrowDown reorder. `Button` forwards none of the drag props, and a `DragHandle` primitive exists but does not own the keyboard reorder these need. |
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
| `resources-panel-toolbar.tsx` | 155, 169 | `<button>` with `◀` / `▶` | bordered `px-2.5 py-1.5` | **IconButton candidate** | `IconButton` + chevron heroicons | **Read and confirmed**: previous/next period stepper flanking a date label, each `aria-label` + `title`, glyph is the only child. |

---

### convertible — 141 sites

Per-file distribution, computed: **2** files with 7 sites (14) · **1** with 5 (5) · **5** with 4 (20)
· **6** with 3 (18) · **21** with 2 (42) · **42** with 1 (42) = 141 across 77 files.

Text-labelled actions repeating one of two class strings that `Button` already emits:
`rounded-md border border-line bg-surface px-3 py-1.5 text-sm …` (→ `variant="secondary"`) or a
filled `bg-ui-*` variant (→ `variant="primary"` / `"danger"`). Listed per file so every site stays
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
| `tasks-section.tsx` | 606, 833, 843, 850 | 4 | `Button` secondary / danger | Jira sync + the bulk-selection bar. |
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

| Family | sites | Tag | Reason |
|---|---|---|---|
| Raw `<input>` outside `form-controls.tsx` | 115 lines / 48 files | **convertible**, mostly | Heaviest: `project-form-fields.tsx` (19) · `jira-settings.tsx` (11) · `budget-bucket-modal.tsx` (9) · `settings-sections/notifications-section.tsx` (8) · `bulk-edit-modal.tsx` (5). `Input` and `Checkbox` cover the plain cases. ★★ **Check the accessible name before each swap** — a `placeholder` is not a label, and folding an unlabelled `<select>` into an axe-scanned view is exactly how a pre-existing violation becomes a gate failure. |
| Raw `<select>` outside `form-controls.tsx` | 37 lines / 23 files, of which **~15 are comment mentions** | **convertible** | Real sites cluster in `budget-bucket-modal.tsx` (4) · `project-form-fields.tsx` (4) · `bulk-edit-modal.tsx` (3) · `roles-editor.tsx` (2). ★ `task-status-select.tsx:21` is the shared inline status select — that one is a primitive in its own right, **keep**. |
| Raw `<textarea>` outside `form-controls.tsx` | 8 sites | **convertible** | `bulk-edit-modal.tsx` (2) · `project-form-fields.tsx` (3) · `chat-panel.tsx:809` · `task-row.tsx:323`. ★ `chat-panel.tsx` and `task-row.tsx` are auto-growing composers with their own key handling — read first. |
| Raw `<table>` outside `data-table.tsx` / `report-table.tsx` | 8 sites | **correctly hand-rolled** | `raid-report-panel.tsx` (2) · `change-report-panel.tsx` · `learning-insights.tsx` · `markdown.tsx:391` · `resource-calendar.tsx:524` · `resources-panel-rows.tsx:94` · `tasks-section.tsx:958`. Each carries panel-specific geometry — sticky columns placed by arithmetic, `w-max`, a `<tbody>` band interleaved with other rows. `markdown.tsx` renders user markdown and cannot use a typed table at all. |
| `role="dialog"` outside `modal.tsx` / `popover-panel.tsx` | 21 sites | **correctly hand-rolled** | Every one is a popover panel or floating window that already routes through `PopoverPanel` or owns its own drag/dismiss wiring. No hand-rolled modal was found that should be `Modal` — this was the cleanest result in the audit. |
| `role="listbox"` | 4 sites — `combobox-shared.tsx:116` · `entity-link-picker.tsx:299` · `global-search-box.tsx:278` · `resource-picker.tsx:260` · `stakeholder-recipient-input.tsx:193` | **correctly hand-rolled** | Real combobox listboxes; `combobox-shared.tsx` is the primitive and the rest are its peers with divergent option shapes. |
| `role="tooltip"` | 1 — `info-tooltip.tsx:61` | **correctly hand-rolled** | The primitive itself. |

---

## Part 2 — glyph → heroicon candidates

| Tag | Meaning |
|---|---|
| **replace** | Decorative icon with a heroicon equivalent; swap and keep it out of the a11y tree |
| **keep — semantic text** | Part of the accessible name, or of `textContent` an existing test reads |
| **keep — not an icon** | Multiplication sign, bullet in prose, `★` doc marker |

Counts over non-test `.tsx`, comment-first-token lines dropped: **188 glyph-carrying lines**, of
which **65 are `★`** — this repo's own documentation marker, appearing in JSX comments that the
first-token heuristic does not catch. Excluding those leaves **123 lines** carrying a real glyph.

### ★★★ Test-pinned glyphs — the plan named 2 of these; there are 7

The plan flags `report-table.test.tsx` and `calendar-series-list.test.tsx` and says to check for
others rather than assume those are the only two. **They are not.** Grepping every `*.test.tsx` in
`src/app` for each glyph and then reading each hit to separate a real assertion from a mention in an
`it(...)` title turns up five more:

| Source site | Glyph | Pinned by | Assertion | Tag |
|---|---|---|---|---|
| `report-table.tsx:148` | `↑` `↓` | `report-table.test.tsx` 25, 39, 40, 104 | `btn.textContent` contains / does not contain the glyph | **keep — semantic text** |
| `report-table.tsx:148` (via `SortResizeTh`) | `↑` `↓` | `calendar-series-list.test.tsx` 168, 194, 196, 198 | strips `[↑↓]` from `textContent`, then asserts presence | **keep — semantic text** |
| `raid-panel-rows.tsx` 109-158 (7 headers) | `▲` `▼` | `raid-panel.test.tsx` 115, 122, 131 | `getByRole("button", { name: /^Severity( [▲▼])?$/ })` | **keep — semantic text, and IN THE ACCESSIBLE NAME** |
| `task-status-glyph.tsx` 54, 56 | `✓` `✕` | `task-row.test.tsx` 573, 574, 581, 582 | `container.textContent` toContain / not.toContain | **keep — semantic text** |
| `dashboard-panel.tsx:364` | `✕` | `dashboard-panel.test.tsx:919` | `expect(value?.textContent).toBe(\`000✕${label}2\`)` | **keep — semantic text** |
| `entity-link-picker.tsx:222` | `↩` | `entity-link-picker.test.tsx:157` | `chip.textContent` toContain | **keep — semantic text** |
| `milestone-horizon-strip.tsx:46` | `⚠` | `milestone-horizon-strip.test.tsx:38` | `getByText(/⚠/)` | **keep — semantic text** |

★★★ **`raid-panel-rows.tsx` is the worst of the seven and the one the plan did not name.** The glyph
is appended to the header's own text, so it is inside the button's **accessible name**, not merely
its `textContent`. Replacing it with an `aria-hidden` SVG would make all seven RAID headers announce
as bare column titles — and since sort direction would then reach assistive tech through nothing at
all (these are raw `<th>`s with no `aria-sort`, unlike `SortResizeTh`), it removes the only channel
that state has. That is the WCAG 2.4.6 trap the plan warns about, present and live.

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
| `resources-panel-toolbar.tsx` | 155, 169 | `◀` `▶` | prev/next period stepper | **replace** | ChevronLeftIcon / ChevronRightIcon | **Read and confirmed**: each button carries its own `aria-label` + `title`, and the glyph is the sole child. Purely decorative once the label is there. ★ Neither icon name exists in the tree yet — both would be new imports. |
| `actions-panel.tsx` · `change-edit-modal.tsx` · `dashboard-tip-card.tsx` · `entity-link-picker.tsx` · `inline-ai-edit-popover.tsx` · `knowledge-links-field.tsx` · `raci-panel.tsx` · `raci-chip-picker.tsx` · `resource-edit-modal.tsx` · `resource-workload.tsx` · `timelog-people-table.tsx` · `saved-views-menu.tsx` · `history-panel.tsx` (×2) · `chat-panel.tsx` (×2) · `project-form-fields.tsx` · `raid-panel-toolbar.tsx` · `reports.tsx` · `knowledge-panel.tsx` (×2) · `roles-editor.tsx` (×2) | 155 · 645 · 83/90 · 233/251 · 49 · 58/64 · 224 · 119/128 · 292/297 · 318/328 · 142/149 · 118/131 · 242, 370 · 766, 789 · 691/697 · 146/152 · 558/565 · 451, 517 · 299, 403 | `×` `✕` `&times;` | close / remove / clear | **replace** | `XMarkIcon` | ~26 sites, all already carrying an `aria-label`, so the glyph is decorative and the a11y tree is unchanged by the swap. ★★ Three spellings of the same idea are in use (`×` U+00D7, `✕` U+2715, `&times;`) — the inconsistency alone is a reason to converge. `XMarkIcon` is already imported in eight files, so this adds no dependency. |
| `action-cta-controls.tsx` · `task-row.tsx` | 145 · 672 | `⋮` | overflow-menu trigger | **replace** | `EllipsisVerticalIcon` | Both triggers carry a row-unique `aria-label`; `task-row.test.tsx:797` mentions `⋮` in a test **title** only, with no assertion on it. ★ Confirmed by reading `task-row.tsx:656-672`. |
| `action-reasons.tsx` · `actions-panel.tsx` · `jira-settings.tsx` · `notifications.tsx` · `chat-panel.tsx` | 32 · 199 · 219 · 39 · 962 | `▸` `▾` | disclosure caret | **replace** | `ChevronDownIcon` (rotated) | Three of the five already wrap the glyph in `<span aria-hidden>`, so they are explicitly decorative and the swap is a no-op for AT. `ChevronDownIcon` with a rotation class is what `sidebar.tsx:62` and `timelog-panel.tsx:591` already do — this converges on the existing pattern. |
| `integration-disclaimer.tsx` · `notifications.tsx` (×2) · `jira-settings.tsx` · `color-scheme-editor.tsx` | 56 · 83, 100 · 343 · 294 | `⚠` | warning marker | **replace** | `ExclamationTriangleIcon` | `integration-disclaimer.tsx:56` is already `<span aria-hidden="true">⚠</span>`. ★★ The two `notifications.tsx` sites pass `icon="⚠"` as a **string prop** to a banner component — that is an API change, not a glyph swap, and would need the prop to accept a node. Larger than it looks. |
| `jira-settings.tsx` · `settings-sections/ai-section.tsx` · `storage-config.tsx` (×2) · `tour-catalog.tsx` (×2) | 338, 591 · 534 · 185, 315 · 39, 46 | `✓` | success/done marker | **replace** | `CheckIcon` | Status confirmations beside their own text. ★★ **Not the same as `✓` in `task-status-glyph.tsx` or `milestones-panel.tsx:498`** — those are keeps (see below). Check which `✓` you are looking at. |
| `raid-panel-rows.tsx` | 335 | `↩` | parent-link chip | **replace**, blocked | `ArrowUturnLeftIcon` | Decorative next to `#{pid}`. ★ **Blocked**: the sibling site `entity-link-picker.tsx:222` carries the same glyph and IS test-pinned, so converge both or neither — replacing one leaves two spellings of the same affordance. |

### keep — semantic text

| File | Line | Glyph | Context | Tag | Reason |
|---|---|---|---|---|---|
| the seven sites in the test-pinned table above | — | `↑↓▲▼✓✕↩⚠` | sort state, status, chip | **keep — semantic text** | See above: `textContent` assertions, and for RAID the accessible name. |
| `activity-log-panel.tsx` | 160 | `↑` `↓` | sort indicator | **keep — semantic text** | Same shape as `report-table.tsx:148` but with **no** `aria-sort` on the `<th>`, so the glyph is the only sort-state channel. Removing it removes the information. |
| `change-panel.tsx` · `resource-directory.tsx` · `roles-editor.tsx` · `stakeholders-panel.tsx` | 349 · 196 · 197-221 · 256 | `▲` `▼` | sort indicator | **keep — semantic text** | Four more raw-`<th>` sort families. `change-panel` and `stakeholders-panel` set `aria-sort` **and** keep the glyph in the name; `resource-directory` and `roles-editor` have the glyph only. None is safe to blank. |
| `trend-arrow.tsx` | 15 | `↑` `↓` `→` | `GLYPH` direction map | **keep — semantic text** | A pure data map consumed as visible text; `trend-arrow.test.tsx` asserts on the rendered output. |
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
| every `★` in a JSX comment | 65 lines | `★` | doc marker | **keep — not an icon** | This repo's own landmine convention. `★` was not in the plan's combined grep and should stay out of any future one — it is 53% of all glyph-carrying lines and pure noise for this purpose. |
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
| `budget-panel.tsx` 380/668/675/684 | converted (0.221.0) | **Confirmed** against the diff: 4 `<button` removed, 4 `<Button variant="secondary">` added. Also **corrected** a would-be error — the `ToggleButton` at line 364 is pre-existing, not this release. |
| `raid-panel-rows.tsx:109` | keep — semantic text | **Confirmed and upgraded.** The glyph is inside the accessible NAME, not just `textContent`; `raid-panel.test.tsx` matches it with a `getByRole` name regex. Would have been mis-tagged **replace** on the grep line alone. |
| `resources-panel-toolbar.tsx:155` | replace | **Confirmed.** `aria-label` + `title` present, glyph is the sole child, so it is decorative. |

★★ **Three things this document asserted were wrong before they were checked**, all recorded above
rather than silently fixed, because the point of the sample is to say how often the method fails:
one tag (`raid-panel-rows.tsx:109`, wrong until the file was opened), one provenance fact
(`budget-panel.tsx:364`, wrong until the diff was read), and one classification (four elements
mis-filed as prose because their children open with a JSX comment, wrong until the two
comment-mention groups were enumerated separately). The last one moved four numbers — the element
total, the convertible count, the correctly-hand-rolled count and the prose count. **Assume the
remaining 305 unread rows carry the same error rate.**
