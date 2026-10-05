# Row-name scanner: DATA leg adjudication

> **Dated record, 2026-10-05, taken on `fix/issues-batch8`.** Line numbers are the
> ones `npm run rownames:check` printed before this branch's edits, so they drift as
> the files change. Re-run the scanner rather than trusting a line here.

Register §316 asked for a verdict on every site the scanner sorts into the `DATA`
leg: a per-row control whose accessible name carries some value from the row. That
value collides when it repeats within one rendered list, which is the WCAG 2.4.6
failure that no axe rule detects.

The test for each site was one question: **can this value repeat in one rendered
list?** A React key, an id, an index or a fixed label cannot. Free text (a name, a
title, a date) can, and needs a row token (`buildRowTokens` / `useRowTokens`).

## Totals

198 sites: **136 fine**, **36 fixed on this branch**, **26 filed as §669**.

- **fine**: the value cannot repeat, for the reason given.
- **fixed**: free text that repeats in ordinary use. Each fix has a test that seeds
  the collision, and a mutant that disables the fix turns that test red.
- **§669**: free text that can repeat, but rarely does. These are recorded in §669
  rather than fixed here, to keep this branch reviewable.

The scanner's two known blind spots were checked as part of this pass. A control
rendered for one row only (under `isSelected`) is listed as `SINGLE` above. A
`COVERED` marker was never taken as proof. The scanner listed all 13 fixed files as
covered (8 by their own test, 5 through a parent), and four of them already called
`expectRowUniqueNames` (chat threads, calendar series, steering committee, budget
bucket) over fixtures that never repeated the value fixed here. The budget bucket
tests did seed repeated role names, but rendered no resources at all.

**The scanner cannot confirm the fixes.** It recognises a token only by certain
names, so most fixed sites stay in `DATA`. Before this branch it printed `DATA 198 |
TOKENIZED 72`; after it, `DATA 186 | TOKENIZED 77`. The fixes are proved by their
tests and mutants, not by that count, and this table is the record of which `DATA`
sites have been judged.

## Every site

| # | File | Line | Element | Verdict | Reason |
|---|---|---|---|---|---|
| 1 | `action-chips.tsx` | 60 | `button` | §669 | action titles embed entity names, which can repeat |
| 2 | `actions-panel.tsx` | 267 | `button` | fine | renders once per surface, or once per uniquely named group |
| 3 | `actions-panel.tsx` | 295 | `TextButton` | fine | fixed key or enum label; one entry per key |
| 4 | `alloc-plan-modal.tsx` | 147 | `Checkbox` | fine | qualified by an id or other unique value in the name |
| 5 | `app-modals.tsx` | 315 | `button` | fine | renders once per surface, or once per uniquely named group |
| 6 | `arrangement-shelf.tsx` | 76 | `button` | fine | renders once per surface, or once per uniquely named group |
| 7 | `ask-claude-menu.tsx` | 35 | `button` | fine | fixed key or enum label; one entry per key |
| 8 | `budget-bucket-modal.tsx` | 475 | `select` | fine | renders once per surface, or once per uniquely named group |
| 9 | `budget-bucket-modal.tsx` | 710 | `Checkbox` | fixed | each checkbox is named by person, then allocation block, both as row tokens |
| 10 | `budget-bucket-modal.tsx` | 789 | `Checkbox` | fixed | each checkbox is named by person, then allocation block, both as row tokens |
| 11 | `bulk-edit-modal.tsx` | 355 | `select` | fine | renders once per surface, or once per uniquely named group |
| 12 | `bulk-edit-modal.tsx` | 383 | `Button` | fine | renders once per surface, or once per uniquely named group |
| 13 | `bulk-edit-panel.tsx` | 143 | `input` | fine | fixed key or enum label; one entry per key |
| 14 | `bullets-block-editor.tsx` | 107 | `Input` | fine | qualified by the row's position |
| 15 | `bullets-block-editor.tsx` | 121 | `Button` | fine | qualified by the row's position |
| 16 | `bullets-block-editor.tsx` | 131 | `Button` | fine | qualified by the row's position |
| 17 | `bullets-block-editor.tsx` | 141 | `Button` | fine | qualified by the row's position |
| 18 | `calendar-event-modal.tsx` | 292 | `Checkbox` | fine | fixed key or enum label; one entry per key |
| 19 | `calendar-pull-summary-modal.tsx` | 128 | `button` | fixed | Keep and Take carry a row token of the conflicting item's name |
| 20 | `calendar-pull-summary-modal.tsx` | 143 | `button` | fixed | Keep and Take carry a row token of the conflicting item's name |
| 21 | `calendar-series-list.tsx` | 123 | `summary` | fine | renders once per surface, or once per uniquely named group |
| 22 | `calendar-series-list.tsx` | 161 | `Button` | fixed | Edit carries a row token of the series title |
| 23 | `change-edit-modal.tsx` | 463 | `Button` | fine | renders once per surface, or once per uniquely named group |
| 24 | `change-edit-modal.tsx` | 774 | `button` | fine | qualified by an id or other unique value in the name |
| 25 | `chat-panel.tsx` | 1593 | `IconButton` | fixed | Remove carries a row token of the file name |
| 26 | `chat-prompt-chips.tsx` | 36 | `button` | fine | fixed key or enum label; one entry per key |
| 27 | `chat-thread-list.tsx` | 153 | `Input` | fixed | every thread control carries a row token; untitled threads all read alike |
| 28 | `chat-thread-list.tsx` | 174 | `button` | fixed | every thread control carries a row token; untitled threads all read alike |
| 29 | `chat-thread-list.tsx` | 190 | `IconButton` | fixed | every thread control carries a row token; untitled threads all read alike |
| 30 | `chat-thread-list.tsx` | 193 | `IconButton` | fixed | every thread control carries a row token; untitled threads all read alike |
| 31 | `column-config-popover.tsx` | 65 | `Checkbox` | fine | fixed key or enum label; one entry per key |
| 32 | `combobox-shared.tsx` | 121 | `li` | fine | the values are the list's React keys, so they cannot repeat |
| 33 | `combobox-shared.tsx` | 122 | `button` | fine | the values are the list's React keys, so they cannot repeat |
| 34 | `create-project-wizard.tsx` | 480 | `ToggleButton` | §669 | template names are free text |
| 35 | `create-project-wizard.tsx` | 561 | `Checkbox` | fine | fixed key or enum label; one entry per key |
| 36 | `dashboard-coaching-card.tsx` | 22 | `button` | fine | fixed key or enum label; one entry per key |
| 37 | `dashboard-delta-strip.tsx` | 83 | `button` | fine | fixed key or enum label; one entry per key |
| 38 | `dashboard-sections/insights-card.tsx` | 110 | `Button` | fine | already routed through a row token |
| 39 | `dashboard-sections/insights-card.tsx` | 125 | `Button` | fine | already routed through a row token |
| 40 | `dashboard-sections/insights-card.tsx` | 135 | `Button` | fine | already routed through a row token |
| 41 | `dashboard-sections/insights-card.tsx` | 146 | `Button` | fine | already routed through a row token |
| 42 | `dashboard-sections/insights-card.tsx` | 156 | `Button` | fine | already routed through a row token |
| 43 | `dashboard-tile-bodies.tsx` | 226 | `button` | fixed | the row button carries a row token of the change title |
| 44 | `diagnostics-panel.tsx` | 112 | `input` | fine | fixed key or enum label; one entry per key |
| 45 | `document-block-gutter.tsx` | 196 | `Button` | fine | fixed key or enum label; one entry per key |
| 46 | `document-table-editor.tsx` | 139 | `Input` | fine | qualified by the row's position |
| 47 | `document-table-editor.tsx` | 146 | `Button` | fine | qualified by the row's position |
| 48 | `document-table-editor.tsx` | 182 | `Input` | fine | qualified by the row's position |
| 49 | `document-table-editor.tsx` | 192 | `Button` | fine | qualified by the row's position |
| 50 | `documents-deleted-section.tsx` | 81 | `Button` | fine | qualified by an id or other unique value in the name |
| 51 | `edit-modal-chrome.tsx` | 203 | `Checkbox` | §669 | stakeholder names can repeat |
| 52 | `empty-state.tsx` | 36 | `button` | fine | fixed key or enum label; one entry per key |
| 53 | `entity-combobox-list.tsx` | 72 | `li` | fine | qualified by an id or other unique value in the name |
| 54 | `entity-link-picker.tsx` | 150 | `button` | fine | qualified by an id or other unique value in the name |
| 55 | `entity-link-picker.tsx` | 179 | `IconButton` | fine | qualified by an id or other unique value in the name |
| 56 | `export-menu.tsx` | 99 | `button` | fine | fixed key or enum label; one entry per key |
| 57 | `filter-multiselect.tsx` | 105 | `Checkbox` | fine | the values are the list's React keys, so they cannot repeat |
| 58 | `global-search-box.tsx` | 281 | `li` | fixed | each option carries a row token of its type and title |
| 59 | `help-content-pane.tsx` | 111 | `button` | fine | fixed key or enum label; one entry per key |
| 60 | `help-content-pane.tsx` | 191 | `button` | fine | fixed key or enum label; one entry per key |
| 61 | `help-content-pane.tsx` | 203 | `button` | fine | fixed key or enum label; one entry per key |
| 62 | `help-view.tsx` | 115 | `button` | fine | fixed key or enum label; one entry per key |
| 63 | `influence-interest-matrix.tsx` | 77 | `button` | fine | fixed key or enum label; one entry per key |
| 64 | `insights-panel.tsx` | 233 | `Button` | fine | already routed through a row token |
| 65 | `insights-panel.tsx` | 248 | `Button` | fine | already routed through a row token |
| 66 | `insights-panel.tsx` | 259 | `Button` | fine | already routed through a row token |
| 67 | `insights-panel.tsx` | 270 | `Button` | fine | already routed through a row token |
| 68 | `insights-panel.tsx` | 281 | `Button` | fine | already routed through a row token |
| 69 | `insights/insight-digest-card.tsx` | 88 | `button` | fine | the digest card adds a qualifier exactly when two labels collide |
| 70 | `jira-settings.tsx` | 238 | `button` | fine | renders once per surface, or once per uniquely named group |
| 71 | `jira-settings.tsx` | 471 | `input` | fine | qualified by an id or other unique value in the name |
| 72 | `jira-settings.tsx` | 500 | `input` | fine | qualified by an id or other unique value in the name |
| 73 | `jira-settings.tsx` | 546 | `input` | fine | qualified by an id or other unique value in the name |
| 74 | `jira-settings.tsx` | 563 | `TextButton` | fine | qualified by an id or other unique value in the name |
| 75 | `jira-settings.tsx` | 597 | `input` | fine | Jira issue-type names are unique within a project |
| 76 | `jira-settings.tsx` | 621 | `input` | fine | fixed key or enum label; one entry per key |
| 77 | `jira-settings.tsx` | 671 | `button` | fine | the user's email is part of the button content |
| 78 | `knowledge-panel.tsx` | 576 | `IconButton` | fixed | one token map over both card grids names Remove and the link |
| 79 | `knowledge-panel.tsx` | 588 | `a` | fixed | one token map over both card grids names Remove and the link |
| 80 | `knowledge-panel.tsx` | 609 | `TaskLinkPicker` | fine | qualified by an id or other unique value in the name |
| 81 | `knowledge-panel.tsx` | 642 | `IconButton` | fixed | one token map over both card grids names Remove and the link |
| 82 | `knowledge-panel.tsx` | 656 | `a` | fixed | one token map over both card grids names Remove and the link |
| 83 | `knowledge-panel.tsx` | 668 | `button` | fixed | the source button also names the card's document, since two source items can share a name |
| 84 | `labels-input.tsx` | 116 | `IconButton` | fine | the input refuses a label already present, case-insensitively |
| 85 | `meeting-report-panel.tsx` | 150 | `summary` | fine | renders once per surface, or once per uniquely named group |
| 86 | `meeting-report-panel.tsx` | 160 | `Button` | §669 | two report versions can carry the same capture time |
| 87 | `meeting-report-panel.tsx` | 170 | `Button` | §669 | two report versions can carry the same capture time |
| 88 | `milestone-edit-modal.tsx` | 306 | `input` | fine | qualified by an id or other unique value in the name |
| 89 | `milestone-horizon-strip.tsx` | 50 | `button` | §669 | two milestones can share a name and a date |
| 90 | `milestone-horizon-strip.tsx` | 78 | `button` | fine | repeats only where the target is the same, so the names agree with the purpose |
| 91 | `modal-field-controls.tsx` | 109 | `Checkbox` | fine | fixed key or enum label; one entry per key |
| 92 | `node-graph.tsx` | 246 | `button` | fine | fixed key or enum label; one entry per key |
| 93 | `notifications.tsx` | 233 | `Button` | fine | the journal labels are numbered when two dates collide |
| 94 | `notifications.tsx` | 238 | `Button` | fine | the journal labels are numbered when two dates collide |
| 95 | `notifications.tsx` | 243 | `Button` | fine | the journal labels are numbered when two dates collide |
| 96 | `outlook-calendar-import-modal.tsx` | 100 | `Checkbox` | fixed | subject and dates together, as a row token; the type select used the subject alone |
| 97 | `outlook-calendar-import-modal.tsx` | 107 | `select` | fixed | subject and dates together, as a row token; the type select used the subject alone |
| 98 | `outlook-import-modal.tsx` | 64 | `Checkbox` | §669 | two contacts can share a display name |
| 99 | `panel-table-scaffold.tsx` | 97 | `AddFirstItemButton` | fine | renders once per surface, or once per uniquely named group |
| 100 | `portfolio-health-panel.tsx` | 184 | `button` | §669 | project names can repeat |
| 101 | `project-form-fields.tsx` | 316 | `input` | fine | fixed key or enum label; one entry per key |
| 102 | `project-form-fields.tsx` | 386 | `input` | fine | fixed key or enum label; one entry per key |
| 103 | `project-switcher.tsx` | 194 | `button` | §669 | project names can repeat |
| 104 | `projects-panel.tsx` | 498 | `Button` | fine | fixed key or enum label; one entry per key |
| 105 | `raci-chip-picker.tsx` | 264 | `button` | fine | fixed key or enum label; one entry per key |
| 106 | `raci-panel.tsx` | 228 | `IconButton` | §669 | stakeholder names can repeat |
| 107 | `raci-suggest-modal.tsx` | 239 | `Checkbox` | fine | qualified by an id or other unique value in the name |
| 108 | `raid-edit-fields.tsx` | 130 | `button` | fine | qualified by an id or other unique value in the name |
| 109 | `raid-edit-modal.tsx` | 524 | `Button` | fine | renders once per surface, or once per uniquely named group |
| 110 | `raid-panel-rows.tsx` | 214 | `Checkbox` | fine | already routed through a row token |
| 111 | `raid-panel-rows.tsx` | 242 | `InlineAiEditButton` | fine | already routed through a row token |
| 112 | `raid-panel-rows.tsx` | 304 | `button` | fine | qualified by an id or other unique value in the name |
| 113 | `raid-panel-rows.tsx` | 335 | `button` | fine | qualified by an id or other unique value in the name |
| 114 | `raid-risk-matrix.tsx` | 69 | `button` | fine | fixed key or enum label; one entry per key |
| 115 | `resource-calendar-band.tsx` | 513 | `CalendarChip` | fine | a chip whose name repeats gets its occurrence date appended |
| 116 | `resource-calendar-rows.tsx` | 109 | `button` | fine | rows are keyed by the normalised name, so two rows cannot share it |
| 117 | `resource-calendar-rows.tsx` | 170 | `button` | §669 | every day cell of one absence reads the same type and range, and the person is not in it |
| 118 | `resource-directory.tsx` | 505 | `button` | fine | the address list is de-duplicated case-insensitively before render |
| 119 | `resource-edit-modal.tsx` | 352 | `Input` | fine | qualified by the row's position |
| 120 | `resource-edit-modal.tsx` | 363 | `IconButton` | fine | qualified by the row's position |
| 121 | `resource-picker.tsx` | 282 | `li` | §669 | two resources with no email can share a name |
| 122 | `resource-picker.tsx` | 289 | `button` | §669 | two resources with no email can share a name |
| 123 | `resource-workload-triage.tsx` | 85 | `select` | fine | qualified by an id or other unique value in the name |
| 124 | `resource-workload-triage.tsx` | 108 | `input` | fine | qualified by an id or other unique value in the name |
| 125 | `rich-text-editor.tsx` | 462 | `Button` | fine | fixed key or enum label; one entry per key |
| 126 | `rich-text-toolbar.tsx` | 439 | `button` | fine | fixed key or enum label; one entry per key |
| 127 | `rich-text-toolbar.tsx` | 460 | `ToolbarButton` | fine | fixed key or enum label; one entry per key |
| 128 | `roles-editor.tsx` | 317 | `DragHandle` | §669 | two rate-card roles can sit on one discipline and grade |
| 129 | `roles-editor.tsx` | 346 | `IconButton` | §669 | two rate-card roles can sit on one discipline and grade |
| 130 | `roles-editor.tsx` | 359 | `select` | fine | renders once per surface, or once per uniquely named group |
| 131 | `roles-editor.tsx` | 364 | `select` | fine | renders once per surface, or once per uniquely named group |
| 132 | `roles-editor.tsx` | 441 | `DragHandle` | §669 | discipline and grade names have no uniqueness rule |
| 133 | `roles-editor.tsx` | 455 | `IconButton` | §669 | discipline and grade names have no uniqueness rule |
| 134 | `segmented-control.tsx` | 90 | `button` | fine | fixed key or enum label; one entry per key |
| 135 | `settings-sections/ai-guides-section.tsx` | 147 | `Checkbox` | fine | fixed key or enum label; one entry per key |
| 136 | `settings-sections/ai-guides-section.tsx` | 162 | `Checkbox` | fine | fixed key or enum label; one entry per key |
| 137 | `settings-sections/ai-guides-section.tsx` | 177 | `Checkbox` | fine | fixed key or enum label; one entry per key |
| 138 | `settings-sections/ai-guides-section.tsx` | 308 | `Checkbox` | §669 | a custom AI guide can reuse a built-in guide's name |
| 139 | `settings-sections/ai-guides-section.tsx` | 318 | `Button` | §669 | a custom AI guide can reuse a built-in guide's name |
| 140 | `settings-sections/ai-guides-section.tsx` | 327 | `Button` | §669 | a custom AI guide can reuse a built-in guide's name |
| 141 | `settings-sections/comm-templates-section.tsx` | 187 | `input` | fine | fixed key or enum label; one entry per key |
| 142 | `settings-sections/comm-templates-section.tsx` | 268 | `button` | fine | already routed through a row token |
| 143 | `settings-sections/comm-templates-section.tsx` | 440 | `ToggleButton` | fine | already routed through a row token |
| 144 | `settings-sections/comm-templates-section.tsx` | 454 | `Button` | fine | already routed through a row token |
| 145 | `settings-sections/export-section.tsx` | 39 | `input` | fine | fixed key or enum label; one entry per key |
| 146 | `settings-sections/integrations-section.tsx` | 919 | `Checkbox` | fine | fixed key or enum label; one entry per key |
| 147 | `settings-sections/next-actions-section.tsx` | 218 | `button` | fine | fixed key or enum label; one entry per key |
| 148 | `settings-sections/next-actions-section.tsx` | 228 | `Input` | fine | fixed key or enum label; one entry per key |
| 149 | `settings-sections/notifications-section.tsx` | 228 | `input` | fine | fixed key or enum label; one entry per key |
| 150 | `settings-sections/scheduled-jobs-section.tsx` | 92 | `Input` | fixed | every job control carries a row token; new jobs share a default name |
| 151 | `settings-sections/scheduled-jobs-section.tsx` | 102 | `input` | fixed | every job control carries a row token; new jobs share a default name |
| 152 | `settings-sections/scheduled-jobs-section.tsx` | 111 | `button` | fixed | every job control carries a row token; new jobs share a default name |
| 153 | `settings-sections/scheduled-jobs-section.tsx` | 123 | `Select` | fixed | every job control carries a row token; new jobs share a default name |
| 154 | `settings-sections/scheduled-jobs-section.tsx` | 135 | `Input` | fixed | every job control carries a row token; new jobs share a default name |
| 155 | `settings-sections/scheduled-jobs-section.tsx` | 147 | `Select` | fixed | every job control carries a row token; new jobs share a default name |
| 156 | `settings-sections/scheduled-jobs-section.tsx` | 181 | `button` | fixed | every job control carries a row token; new jobs share a default name |
| 157 | `sharepoint-picker-modal.tsx` | 241 | `button` | §669 | SharePoint site and drive names can repeat |
| 158 | `sharepoint-picker-modal.tsx` | 257 | `button` | §669 | SharePoint site and drive names can repeat |
| 159 | `shift-edit-modal.tsx` | 251 | `input` | fine | fixed key or enum label; one entry per key |
| 160 | `sidebar-nav.tsx` | 156 | `button` | fine | fixed key or enum label; one entry per key |
| 161 | `sidebar-nav.tsx` | 241 | `button` | fine | fixed key or enum label; one entry per key |
| 162 | `sidebar-nav.tsx` | 264 | `button` | fine | fixed key or enum label; one entry per key |
| 163 | `stakeholder-edit-modal.tsx` | 223 | `button` | fine | renders once per surface, or once per uniquely named group |
| 164 | `stakeholder-edit-modal.tsx` | 276 | `Input` | fine | renders once per surface, or once per uniquely named group |
| 165 | `stakeholder-edit-modal.tsx` | 305 | `Input` | fine | renders once per surface, or once per uniquely named group |
| 166 | `stakeholder-edit-modal.tsx` | 328 | `Input` | fine | renders once per surface, or once per uniquely named group |
| 167 | `stakeholder-edit-modal.tsx` | 449 | `Select` | fixed | each RACI select carries a row token of the milestone name |
| 168 | `stakeholder-map-panel.tsx` | 195 | `button` | §669 | stakeholder names can repeat |
| 169 | `steering-committee-panel.tsx` | 281 | `Button` | fixed | member, meeting and schedule controls carry row tokens |
| 170 | `steering-committee-panel.tsx` | 335 | `Input` | fixed | member, meeting and schedule controls carry row tokens |
| 171 | `steering-committee-panel.tsx` | 344 | `Input` | fixed | member, meeting and schedule controls carry row tokens |
| 172 | `steering-committee-panel.tsx` | 355 | `Input` | fixed | member, meeting and schedule controls carry row tokens |
| 173 | `steering-committee-panel.tsx` | 367 | `Button` | fixed | member, meeting and schedule controls carry row tokens |
| 174 | `steering-committee-panel.tsx` | 449 | `Input` | fixed | member, meeting and schedule controls carry row tokens |
| 175 | `steering-committee-panel.tsx` | 460 | `Input` | fixed | member, meeting and schedule controls carry row tokens |
| 176 | `steering-committee-panel.tsx` | 545 | `Button` | fine | renders once per surface, or once per uniquely named group |
| 177 | `task-dedup-modal.tsx` | 67 | `input` | §669 | two kept tasks can share a title |
| 178 | `task-form-fields.tsx` | 486 | `button` | fine | fixed key or enum label; one entry per key |
| 179 | `task-form-fields.tsx` | 541 | `summary` | fine | renders once per surface, or once per uniquely named group |
| 180 | `task-form-fields.tsx` | 548 | `summary` | fine | renders once per surface, or once per uniquely named group |
| 181 | `task-form-fields.tsx` | 675 | `Select` | fine | renders once per surface, or once per uniquely named group |
| 182 | `task-row.tsx` | 297 | `input` | fine | qualified by an id or other unique value in the name |
| 183 | `task-row.tsx` | 311 | `button` | fine | qualified by an id or other unique value in the name |
| 184 | `tasks-section-toolbar.tsx` | 181 | `Select` | fine | renders once per surface, or once per uniquely named group |
| 185 | `tasks-section-toolbar.tsx` | 193 | `Select` | fine | renders once per surface, or once per uniquely named group |
| 186 | `tasks-section-toolbar.tsx` | 207 | `Select` | fine | renders once per surface, or once per uniquely named group |
| 187 | `theme-gallery.tsx` | 87 | `Button` | §669 | colour scheme names are free text |
| 188 | `timelog-people-table.tsx` | 111 | `Checkbox` | fine | already routed through a row token |
| 189 | `timelog-people-table.tsx` | 126 | `Select` | fine | already routed through a row token |
| 190 | `timelog-people-table.tsx` | 155 | `button` | fine | already routed through a row token |
| 191 | `timelog-people-table.tsx` | 174 | `IconButton` | fine | already routed through a row token |
| 192 | `timelog-project-scope.tsx` | 104 | `input` | fine | qualified by an id or other unique value in the name |
| 193 | `timelog-projects-table.tsx` | 101 | `Select` | fixed | select and Clear carry the project name and number, as a row token |
| 194 | `timelog-projects-table.tsx` | 129 | `button` | fixed | select and Clear carry the project name and number, as a row token |
| 195 | `tour-catalog.tsx` | 26 | `button` | fine | fixed key or enum label; one entry per key |
| 196 | `turso-project-picker.tsx` | 132 | `Button` | §669 | project names can repeat |
| 197 | `undo/undo-control.tsx` | 319 | `li` | fine | qualified by the row's position |
| 198 | `workspace-section-chrome.tsx` | 201 | `TabButton` | fine | fixed key or enum label; one entry per key |
