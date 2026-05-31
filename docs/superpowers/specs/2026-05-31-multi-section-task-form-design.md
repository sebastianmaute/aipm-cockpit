# Multi-Section Task Form — Design

**Date:** 2026-05-31
**Status:** Design approved, ready for implementation plan
**Context:** The optional item deferred from Phase 4 of the modern sidebar layout.

## Goal

Split the monolithic 18-field task form into **5 stacked, numbered sections** so it
is easier to scan and edit. The grouping is defined **once** in the shared field
component and therefore appears identically in **both** surfaces that render it: the
modern full-page edit view and the classic modal dialog.

## Background

`task-form-fields.tsx` (`TaskFormFields`) renders all 18 fields in a single flat
`grid grid-cols-1 sm:grid-cols-2` list. It is consumed by BOTH:

- **`task-edit-view.tsx`** (`TaskEditView`) — the modern full-page editor; wraps the
  fields in a `<form id={TASK_EDIT_FORM_ID}>` and currently adds its own outer
  `<h2>` reading `1. {taskEditDetailsHeading}` plus a `grid ... sm:grid-cols-2`. The
  leading `1.` is a vestige of an intended-but-never-built sectioning.
- **`task-form-modal.tsx`** (`TaskFormModal`) — the classic overlay dialog; wraps the
  same `TaskFormFields` in its own grid inside a scrollable, resizable modal.

Both currently impose their own two-column grid around the flat field list.

## Decisions (from brainstorming)

1. **Shape:** stacked sections (all visible, one scrolling form) — NOT tabs/wizard.
2. **Scope:** **both surfaces** sectioned (the modal IS changed this round — a
   deliberate departure from the Phases 2–4 "classic stays untouched" rule, made so
   the two surfaces share one section definition and cannot drift).
3. **Grouping:** 5 sections (below).
4. **Chrome:** identical on both surfaces — numbered dark-blue heading + divider,
   fields always visible (no collapse/accordion).

## The 5 sections (field order preserved within each)

1. **Details** — ID, Priority, Task name*, Assignee*, Email
2. **Scheduling** — Start date, Due date*, Last update date
3. **Effort & Classification** — Group, Original estimate, Time spent, Effort
   progress bar, Labels
4. **Relationships** — Dependencies, Blockers
5. **Status & Notes** — Health, Notes, then the error alert, then the new-task-only
   "create in Jira" checkbox

(* = required, unchanged.) This is exactly the current field set and order, only
partitioned — no field is added, removed, reordered across group boundaries, or
rewired.

## Architecture

### New `TaskFormSection` (in `task-form-fields.tsx`)

A small presentational wrapper:

```tsx
function TaskFormSection({
  index, title, className, children,
}: {
  index: number;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={className}>
      <h3 className="mb-3 border-b border-line pb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
        {index}. {title}
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}
```

- Heading style reuses the existing edit-view palette tokens (`text-AIPM-dark-blue
  dark:text-AIPM-light-grey`) — no new colors, no shadows/gradients.
- Each section owns its own two-column grid, so the `sm:col-span-2` already on wide
  fields (Task name, Dependencies, Blockers, Health, Notes, error, Jira checkbox)
  keeps working unchanged.

### `TaskFormFields` refactor

`TaskFormFields` returns 5 `<TaskFormSection>` blocks instead of one flat fragment.
The fields move verbatim into their section (same JSX, same `useTaskForm()` reads,
same handlers). The error `<p role="alert">` and the Jira-create `<label>` go inside
section 5. No prop, type, or context change.

### Parent simplification (both surfaces)

Each parent stops imposing a grid and instead stacks the sections vertically:

- **`task-edit-view.tsx`:** remove the outer `<h2>1. …</h2>` (now redundant — section
  1 supplies the heading) and change the `<form>` className from
  `grid grid-cols-1 gap-4 p-6 sm:grid-cols-2` to `space-y-6 p-6`. Keep the outer
  `<section>` card, `TASK_EDIT_FORM_ID`, and `onSubmit`. The vestigial `1.` prefix
  disappears with the `<h2>`.
- **`task-form-modal.tsx`:** change the field-wrapping container from its
  two-column grid to `space-y-6` so the sections stack. The modal stays scrollable +
  resizable (already is), so extra height is fine. Header, footer (Save/Cancel),
  draggable behavior, and submit wiring unchanged.

Because the sections are defined inside `TaskFormFields`, both parents now render the
identical 5-section layout for free.

## Data Flow & Error Handling

No new data paths. `useTaskForm()` context, validation, `onSubmit`,
`TASK_EDIT_FORM_ID` form-association (top-bar Save submits the page form), and the
Save/Cancel buttons are all untouched. The error alert still renders on validation
failure; with no section hiding it is always visible.

## i18n

Five new heading keys in BOTH `i18n.ts` (en) and `i18n.de.ts`:

- `taskFormSectionDetails` → "Details" / "Details"
- `taskFormSectionScheduling` → "Scheduling" / "Terminplanung"
- `taskFormSectionEffort` → "Effort & Classification" / "Aufwand & Klassifizierung"
- `taskFormSectionRelationships` → "Relationships" / "Beziehungen"
- `taskFormSectionStatus` → "Status & Notes" / "Status & Notizen"

The old `taskEditDetailsHeading` key is superseded by `taskFormSectionDetails`;
remove it (and its de entry) if no other reference remains after the refactor.

⚠️ **`i18n.de.ts` hazard:** the Edit tool is known to corrupt ASCII `"` delimiters
into curly quotes in that file. The plan MUST grep-verify ASCII quotes after the de
edit (prefer a byte-safe insertion) per [[i18n-de-edit-corruption]].

## Testing

- **`task-form-fields.test.tsx`:** assert all 5 section headings render; assert a
  representative field appears under the correct heading (e.g. "Due date" within
  Scheduling, "Notes" within Status & Notes).
- **`task-edit-view.test.tsx`:** assert the edit view shows all 5 section headings
  and no longer shows a literal leading `1.` outside section 1.
- **`task-form-modal.test.tsx`:** assert the modal shows all 5 section headings
  (parity with the edit view — the guarantee they can't drift).
- Full `tsc --noEmit` + `vitest run` green before release.

## Release

- Version **0.36.0**, codename **"Hurley"** (Kameron Hurley) — verify no CHANGELOG
  collision at the release task; fallbacks: Kowal, Valente, Nagata.
- Branch: `multi-section-edit-view`; merge to `main` locally; push only on request.
- `README.md` / `public/*.png` are pre-existing uncommitted user changes — never
  touched or staged (scoped `git add` only).

## Out of Scope

- Collapsible/accordion sections, tabs, wizard/stepper, drag-reorder, per-section
  save.
- Any field addition, removal, or validation change.
- Any change to the Gantt edit affordances or popout read-only behavior.
