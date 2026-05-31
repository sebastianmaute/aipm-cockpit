# UI Polish Batch — Design Spec

**Date:** 2026-05-31
**Target version:** 0.37.0 (codename TBD at implementation, verified unused via `git grep`)
**Status:** Approved

## Goal

Resolve a batch of ~11 UI fixes/improvements reported against the lop-app modern
layout, grouped into seven workstreams (A–G).

## Scope decision

- Layout/styling fixes target the **modern** layout. The view panels are shared
  components, so styling improvements naturally appear wherever the component
  renders (modern and classic); no classic-specific variants are built.
- The **one explicit classic change** is the viewport-fit/footer fix (Group B),
  which the user requested for both layouts.
- Shared-component fixes (version label, print scoping, gantt z-index, activity
  print button) affect both layouts by nature.

## Constraints (carried, still in force)

- AIPM 9-color palette only — no gradients, no drop shadows, no off-palette colors.
- `i18n.de.ts`: the Edit tool corrupts ASCII `"` into curly quotes — verify/grep
  after every edit to that file; prefer Write/byte-patch.
- README.md and public/*.png are pre-existing uncommitted user changes that must
  NEVER be touched or staged. Use scoped `git add <paths>`, never `git add -A`/`.`.
- Full `vitest run` + `tsc` must be green in the same turn before any commit.

---

## Group A — Gantt export dropdown z-index (item 1)

**Problem:** `export-menu.tsx` dropdown is `z-20`; the Gantt sticky date row
(`gantt.tsx`) is `z-20` and its frozen left column `z-30`, so the Gantt header
paints over the export menu.

**Fix:** raise the export dropdown stacking context above the Gantt frozen
column. Change the export dropdown container from `z-20` to `z-40`.

**Files:** `src/app/export-menu.tsx` (the `role="dialog"` dropdown container).

**Test:** assert the export dropdown container className contains `z-40`.

---

## Group B — Viewport height & footer (items 2, 5)

### B1 — Modern open-points fills available height (item 5)

**Problem:** `tasks-section.tsx` renders a fixed `h-[560px] min-h-[300px] resize`
box that does not fill the viewport and must be manually resized.

**Fix:** add a `fillHeight?: boolean` prop to `TasksSection`.
- When `fillHeight` is true (modern), the root pane uses `h-full` and drops the
  `h-[560px] min-h-[300px] resize` triple (fills `<main>` which is
  `flex-1 min-h-0 overflow-auto`).
- When `fillHeight` is false/absent (classic), the current resizable box is kept.

The inner table already uses `flex-1 min-h-0 overflow-auto`, so it scrolls
inside the pane in both modes.

**Files:** `src/app/tasks-section.tsx` (root `<section>` className, new prop),
`src/app/task-manager.tsx` (pass `fillHeight` only in the modern tree's
`tasksSectionEl`).

**Test:** TasksSection with `fillHeight` renders `h-full` and omits `resize`;
without it, renders the resizable box.

### B2 — Classic layout fits the viewport (item 2)

**Problem:** the classic `legacyTree` is a normal scrolling document, so the
footer requires scrolling.

**Fix:** wrap the classic `legacyTree` content in a viewport-height flex column:
- outer: `h-screen flex flex-col` (non-popout only),
- header region: `shrink-0`,
- content region (workspace + tasks): `flex-1 min-h-0 overflow-auto`,
- footer: `shrink-0`.

Only the content area scrolls; the footer is always visible. Popout trees are
unchanged (`isPopout` keeps the existing flow).

**Files:** `src/app/task-manager.tsx` (legacyTree wrapper), and the footer in
`src/app/app-modals.tsx` if footer placement needs to move out of the scroll
region. Keep changes minimal and behind the `!isPopout` guard.

**Test:** classic tree root carries the viewport-height flex-column classes
(non-popout); popout tree unchanged.

---

## Group C — Pane consistency (items 4, 10, 11)

**Reference:** the open-points pane class
`rounded-xl border border-line bg-surface`.

**Fix:** extract a shared `VIEW_PANE_CLASS` constant in `src/app/view-styles.ts`
(new file) equal to `"rounded-xl border border-line bg-surface"`.

- **item 4:** wrap the paneless views — Reports (`reports.tsx`), RAID
  (`raid-panel.tsx`), Budget (`budget-panel.tsx`) — in `VIEW_PANE_CLASS`
  (with the existing per-panel padding, e.g. `p-6`/`p-4`). **Gantt stays
  full-bleed** — a bordered pane breaks its horizontal scroll; documented
  exception, not swept.
- **item 10 (chat):** wrap `chat-panel.tsx` content in `VIEW_PANE_CLASS` with
  `p-6` so the inner scroller gets breathing room instead of touching the pane
  edge (mirrors the task table inside its pane).
- **item 11 (resources):** the resources inner table wrappers
  (`resources-panel.tsx`, `resource-directory.tsx`, `resource-workload.tsx`)
  use a divergent `rounded-md border` inset-card look. Align them to the tasks
  inner-table treatment (`rounded-xl border border-line bg-surface`) so
  resources matches open-points. Extract `INNER_TABLE_CLASS` in `view-styles.ts`
  if it reduces duplication across resources sub-views.

**Sweep guard:** `src/app/view-pane-sweep.test.ts` — assert the swept view files
import and use `VIEW_PANE_CLASS` and do not carry the legacy divergent pane
strings (mirrors the `TABLE_HEAD_CLASS`/`FORBIDDEN_HEADS` guard pattern, using
`process.cwd()` not `import.meta.url`).

---

## Group D — Scoped printing (items 6, 8)

**Problem:** `window.print()` prints the whole shell (sidebar + top bar + view)
because nothing isolates the report node.

**Fix:** CSS-isolated print.
- Add a `print-root` class to each printable report container: Reports
  (`reports.tsx`), RAID Report (`raid-report-panel.tsx`), Resources Report
  (`resources-report.tsx`), and Activity (`activity-log-panel.tsx`).
- Add `@media print` rules in `globals.css`:
  - `body * { visibility: hidden; }`
  - `.print-root, .print-root * { visibility: visible; }`
  - `.print-root { position: absolute; inset: 0; width: 100%; }`
  - Keep the existing A4/@page, ink-strip, and sticky-reset rules.

Using `visibility` (not `display`) preserves layout of the visible subtree.

- **item 8:** add a `PrintButton` to the Activity panel header (reuses the
  existing `printHint` i18n string). Activity gets the `print-root` class so it
  prints scoped.

**Files:** `globals.css`, `reports.tsx`, `raid-report-panel.tsx`,
`resources-report.tsx`, `activity-log-panel.tsx`.

**Test:** each printable container has the `print-root` class; Activity header
renders a PrintButton.

---

## Group E — Jira always open in modern (item 7)

**Problem:** `JiraSettingsSection` (`jira-settings.tsx`) is collapsible
(`open/setOpen`); in the modern full-page settings view it should always be open.

**Fix:** add `alwaysOpen?: boolean` to `JiraSettingsSection`. When true, render
the body expanded and hide the collapse toggle. The modern settings view
(`settings-view.tsx` / `settings-sections/integrations-section.tsx`) passes
`alwaysOpen`; the classic settings popover keeps the collapsible behavior
(prop absent → current behavior).

**Files:** `src/app/jira-settings.tsx`, the modern settings wiring
(`settings-view.tsx` and/or `settings-sections/integrations-section.tsx`).

**Test:** with `alwaysOpen`, the section body is visible and no collapse toggle
renders; without it, the section starts collapsed.

---

## Group F — Outlook sync button (item 9)

**Problem:** there is a one-way Outlook contacts import (preview-and-pick) but no
button in the address book to trigger it manually.

**Fix:** add a toolbar button in the resource directory / address book
(`resource-directory.tsx`) that opens the **existing** Outlook contacts import
flow (`outlook-import-modal.tsx` + `use-outlook-contacts`). Reuses proven code;
no new sync engine. Gated on M365 integrations being enabled, mirroring the
existing import entry point.

**i18n:** at most one new EN+DE string for the button label (or reuse the
existing import label if it reads correctly). Verify `i18n.de.ts` for quote
corruption after editing.

**Files:** `src/app/resource-directory.tsx` (toolbar button + wiring to the
import modal trigger). Reuse the existing modal-open mechanism.

**Test:** the button renders when M365 is enabled and invokes the import-open
handler when clicked.

---

## Group G — Version label (item 3)

**Problem:** the version renders bare (e.g. `0.37.0`) where it should read
`Version 0.37.0`.

**Fix:** prefix the rendered version with the existing `versionVersion` label
where it shows bare — the sidebar (brand/footer) and the Version popover row.
Uses the existing i18n label; no new strings.

**Files:** `src/app/sidebar.tsx` (and/or `sidebar-footer.tsx`),
`src/app/version-menu.tsx`.

**Test:** the sidebar version display includes the "Version" label prefix.

---

## Testing & delivery

- Component tests per group as listed; the Group C sweep guard.
- Full `vitest run` + `tsc --noEmit` green in the same turn before any commit.
- One spec → one plan, executed in grouped tasks.
- Version bump to 0.37.0 in `version.ts` + `CHANGELOG.md`, fresh codename
  verified unused via `git grep -i` at implementation time.
- Update memory `modern-layout-roadmap.md` + `MEMORY.md` index after merge.
