<!-- Generated: 2026-05-16 | Status: draft, not yet implemented -->

# Resource Planner — Implementation Plan

A new **Resources** tab in lop-app giving per-assignee workload + absence visibility, persisted as part of the workspace alongside tasks and RAID. Inspired by Microsoft Teams Shifts but scoped to what a single-page task tracker actually needs.

## Decisions made

| Question | Decision |
|---|---|
| Persistence | Workspace data — IndexedDB record store + CSV/MD sections + JSON envelope. Schema bump v2 → v3. |
| Shifts | **Out of scope** for v1 (user said "shifts optional"). Deferred to Phase 4. |
| When | Multi-session build. Phases 1+2 are the "v1 done" line. |

## Goal

A "Resources" tab where the user can see, per assignee:
- Open / overdue task counts
- Upcoming absences (next 60 days)
- A way to create/edit/delete absences
- A way to see who's away when (Phase 3 calendar)

The Resources tab makes the existing free-text `assignee` field of `Task` into a first-class concept for the first time. Absences become a third workspace entity alongside `tasks` and `raid`.

## Non-goals (v1)

Explicitly OUT of v1; revisit only if user asks:

- **Shift definitions** (per-weekday hours per assignee) — Phase 4
- **Capacity vs demand charts / graphs**
- **Drag-to-create absences** on the calendar — Phase 3 might add click-cell-to-create, but not drag
- **Conflict detection** when a task is assigned to someone during their absence — Phase 5
- **Avatars / photos / colors per assignee**
- **Recurring absences** (e.g., "every Tuesday afternoon")
- **Approval workflows** (Teams Shifts has these; we don't need them)

## Data model

### New entity: Absence

```ts
type AbsenceType = "vacation" | "sick" | "training" | "other";

interface Absence {
  /** positive int, monotonic */
  id: number;
  /** Joins on Task.assignee (free-text string today; see Open question #1) */
  assignee: string;
  /** Optional; populated from contacts.ts when available */
  assigneeEmail?: string;
  /** "YYYY-MM-DD", inclusive */
  startDate: string;
  /** "YYYY-MM-DD", inclusive, must be >= startDate */
  endDate: string;
  type: AbsenceType;
  note?: string;
  /** ISO 8601 — set on every save for sync/conflict detection */
  localModifiedAt?: string;
}
```

### Workspace extension

`src/app/storage.ts` `Workspace` type gains a third array:

```ts
export type Workspace = {
  tasks: Task[];
  raid: RaidItem[];
  absences: Absence[]; // NEW
};
```

All consumers of `Workspace` must default `absences` to `[]` when reading legacy data (CSV files without an `# ABSENCES` section, JSON files at schemaVersion 2).

## Storage architecture

### IndexedDB v3 migration

`storage.ts`:
- Bump `IDB_VERSION` from `2` to `3`
- Add `IDB_ABSENCES_STORE = "absences"` with `keyPath: "id"`
- Update `onupgradeneeded` handler to add the store idempotently
- `BrowserBackend.load` reads absences via `idbGetAll<Absence>(IDB_ABSENCES_STORE)`; defaults to `[]` if store is empty or absent
- `BrowserBackend.save` diffs absences against `absencesBaseline` (same reference-equality pattern as `tasksBaseline` / `raidBaseline`)
- `idbBulkUpdate` is generic over `<T extends { id: number }>` — already supports `Absence`

No legacy localStorage migration needed — absences is a brand-new entity, never stored in the old format.

### CSV format

After the `# RAID` section, add `# ABSENCES`:

```
# ABSENCES
id,assignee,assigneeEmail,startDate,endDate,type,note,localModifiedAt
1,Alex Example,Sample.Dummy@example.com,2026-06-01,2026-06-14,vacation,Family trip,
```

Implementation steps in `storage.ts`:
- Add `ABSENCES_CSV_COLUMNS: Array<keyof Absence>`
- Add `absencesToCsv(items)` and `csvToAbsences(text)`
- Add `CSV_SECTION_ABSENCES = "# ABSENCES"` constant
- Update `workspaceToCsv` to emit the section when `ws.absences.length > 0`
- Update `splitCsvSections` to recognize the new marker (third mode: `"tasks" | "raid" | "absences"`)
- Update `csvToWorkspace` to populate `absences` from the parsed text
- Add `buildAbsenceFromObj(obj)` with the same defensive parsing pattern as `buildRaidItemFromObj`

### Markdown format

After the `# RAID Log` heading, add `# Absences`:

```markdown
# Absences

| ID | Assignee | Email | Start | End | Type | Note | LocalModified |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Alex Example | Sample.Dummy@example.com | 2026-06-01 | 2026-06-14 | vacation | Family trip |  |
```

Implementation steps:
- Add `ABSENCES_MD_COLUMNS: Array<{ key: keyof Absence; label: string }>`
- Add `absencesToMarkdown(items)` and `markdownToAbsences(md)`
- Update `splitMarkdownSections` to recognize `# Absences` (case-insensitive)
- Update `workspaceToMarkdown` / `markdownToWorkspace`

### JSON envelope

Bump `SCHEMA_VERSION` from `2` to `3`:

```json
{
  "schemaVersion": 3,
  "tasks": [...],
  "raid": [...],
  "absences": [...]
}
```

JSON parser must accept v2 files (no `absences` field) gracefully — default to `[]`.

### Sanitization

`sanitize.ts` additions:
- `sanitizeAbsenceType(s)`: returns valid `AbsenceType` or fallback to `"other"`
- `sanitizeAbsenceNote(s)`: reuse existing `TEXTAREA_MAX`
- `sanitizeAbsence(input)`: full record sanitizer for chat-tool / import paths
- Reuse `sanitizeAssignee`, `sanitizeEmail`, `sanitizeIsoDate`

## UI design

### Tab placement

Between RAID and Activity:

```
Chat | Reports | Gantt | RAID | Resources | Activity
```

Extend `TopTab` union: `"chat" | "reports" | "gantt" | "raid" | "resources" | "activity"`.

### Resources panel layout (Phase 1)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Resources (5 assignees)                          [+ Add absence]     │
├──────────────────────────────────────────────────────────────────────┤
│ Assignee  Email              Open  Overdue  Upcoming absences        │
│ Sample     Sample@Acme…   4      1      Jun 01–14 (vacation)    │
│ Fictional    Fictional@Acme…  6      2      —                       │
│ Aria      aria@Acme…    3      0      Jun 23 (sick)           │
│ Invented    Invented@Acme…  2      0      —                       │
└──────────────────────────────────────────────────────────────────────┘
```

- Sortable column headers (id-asc default)
- Optional: search box to filter by assignee name/email
- "Upcoming absences" cell shows up to 2 nearest; click → opens absence list for that assignee

### Absence edit modal (Phase 2)

Same shape as `RaidEditModal`:
- **Assignee picker** — `ContactInput` (existing component, reads from contacts.ts + task assignees)
- **Start date / End date** — date inputs side by side
- **Type** — `SegmentedControl` (vacation / sick / training / other)
- **Note** — textarea (optional)
- Footer: **Save** + **Delete** (when editing) + **Cancel**

Validations:
- assignee + start + end required
- `endDate >= startDate`

### Calendar grid (Phase 3)

Rows = assignees, cols = next 30 days:

```
              May 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 Jun 1 ...
Sample         .  .  .  V  V  V  V  V  V  V  V  V  V  V  V  .   .   ...
Fictional        .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .   .
Aria          .  .  .  .  .  .  S  .  .  .  .  .  .  .  .  .   .
```

Visual treatment:
- `V` = vacation (blue), `S` = sick (red), `T` = training (amber), `O` = other (gray)
- Weekend columns greyed
- Public-holiday columns marked with a vertical line
- Today column highlighted
- Click an empty cell → opens absence modal pre-filled with assignee + that date

Could be toggleable: list view vs calendar view (radio at top of panel).

## Computation: utilization

### Phase 1 (simple, derived from tasks alone)

Per assignee (matched by exact-string `Task.assignee`):
- `openTaskCount` = `tasks.filter(t => t.assignee === a && !t.completedDate).length`
- `overdueTaskCount` = `tasks.filter(t => t.assignee === a && !t.completedDate && t.dueDate < today).length`
- `upcomingAbsences` = `absences.filter(x => x.assignee === a && x.endDate >= today && x.startDate <= today + 60d).sort(by startDate).slice(0, 2)`

### Phase 2+ (refined, with absences subtracted)

- Window = next 14 working days
- `workingDays(a)` = 14 minus weekends minus public holidays minus absence days for `a`
- `taskDays(a)` = sum over `a`'s open tasks of `min(dueDate, windowEnd) - max(startDate, windowStart) + 1` working days
- `utilization(a)` = `taskDays(a) / workingDays(a)`, capped at 2.0

This stays purely client-side — no external API. Reuses `holidaysForCountries` (already lazy-loaded).

## Integration points

### Activity log

Add 3 (or 4) `ActivityKind` values:
- `absence.created` — args: `[id, assignee, startDate, endDate]`
- `absence.updated`
- `absence.deleted`
- (Optionally) `absence.bulkImported` — fires when a file import brings absences in

Add matching i18n keys (en-US + de) and the `ACTIVITY_KIND_TO_KEY` map entry. Instrument `handleSaveAbsence` / `handleDeleteAbsence` in `task-manager.tsx`.

### Gantt overlay (Phase 5, optional)

For each task's row in `gantt.tsx`, render a faded band behind the task bar for each day in `absences[assignee=this row's assignee]`. Visually communicates "this task crosses an absence."

Risks: visual clutter; needs careful styling. Skip unless user asks.

### Task assignment validation (Phase 5, optional)

In the task modal, when the form's `dueDate` falls inside any absence for `form.assignee`, show an inline warning ("Note: Sample is on vacation Jun 1–14"). Non-blocking — user can still save. Skip unless asked.

## i18n surface

Roughly 30 new keys per locale, grouped:

| Group | Keys |
|---|---|
| Tab + headers | `tabResources`, `resourcesAssignee`, `resourcesOpenTasks`, `resourcesOverdueTasks`, `resourcesUpcomingAbsences`, `resourcesUtilization` |
| Empty state | `resourcesEmpty` |
| Actions | `resourcesAddAbsence`, `resourcesEditAbsence`, `resourcesDeleteAbsence`, `resourcesAbsenceCount` |
| Form labels | `absenceAssignee`, `absenceStart`, `absenceEnd`, `absenceType`, `absenceNote` |
| Type labels | `absenceTypeVacation`, `absenceTypeSick`, `absenceTypeTraining`, `absenceTypeOther` |
| Errors | `absenceErrorRequired`, `absenceErrorEndBeforeStart`, `absenceConfirmDelete` |
| Calendar | `resourcesViewList`, `resourcesViewCalendar`, `resourcesToday` |
| Activity (3-4) | `activityAbsenceCreated`, `activityAbsenceUpdated`, `activityAbsenceDeleted` |

Both `i18n.ts` (en-US) and `i18n.de.ts` (de) need the same keys.

## Sample data

Update `sample-workspace.csv` and `sample-workspace.md` to demonstrate. Add e.g. 3-4 absences spanning the existing assignees:

```
# ABSENCES
id,assignee,assigneeEmail,startDate,endDate,type,note,localModifiedAt
1,Alex Example,Sample.Dummy@example.com,2026-06-01,2026-06-14,vacation,Family trip,
2,Sam Placeholder,Fictional.Jordan@example.com,2026-05-28,2026-05-28,sick,,
3,Taylor Specimen,aria.patel@example.com,2026-06-23,2026-06-25,training,Kubernetes cert,
```

## Phased build plan

Each phase is independently shippable. After each, `tsc --noEmit` is clean and the user has a usable subset.

### Phase 1 — Foundation: data + read-only stats

**Files (~6, ~600 lines):**
1. `types.ts` — add `Absence`, `AbsenceType`, update `Workspace`
2. `sanitize.ts` — `sanitizeAbsenceType`, `sanitizeAbsenceNote`, `sanitizeAbsence`
3. `storage.ts` — IDB v3 migration, absences store, CSV/MD sections, JSON envelope, parsers
4. `resources-panel.tsx` (NEW) — read-only stats table
5. `task-manager.tsx` — extend Workspace state with `absences`, hydrate/save, Resources tab button, panel render
6. `i18n.ts` + `i18n.de.ts` — 6 keys (tab, columns, empty state)

**Sample data:** add 3 absences to `sample-workspace.csv`/`.md`.

**Checkpoint:** Resources tab shows all distinct assignees with open/overdue counts and "upcoming absences" cell populated from any absences imported via file. No way to create absences yet — but sample data + import works.

### Phase 2 — Absence CRUD

**Files (~4, ~500 lines):**
1. `absence-edit-modal.tsx` (NEW) — modal mirroring `RaidEditModal`'s structure
2. `resources-panel.tsx` — "+ Add absence" button, per-assignee expand to absence list, edit/delete
3. `task-manager.tsx` — `handleSaveAbsence` + `handleDeleteAbsence` + instrumentation
4. `activity-log.ts` — add 3 new ActivityKind values + map entries
5. `i18n.ts` + `i18n.de.ts` — ~18 more keys (form, errors, activity)

**Checkpoint: this is "v1 done."** User can create / edit / delete absences via UI; they persist across reloads, sync to file backends, appear in activity log, included in CSV/MD/JSON exports.

### Phase 3 — Calendar grid (optional)

**Files (~2, ~400 lines):**
1. `resources-panel.tsx` — add calendar grid view + toggle
2. New CSS / Tailwind grid utilities if needed

**Checkpoint:** user toggles between list and calendar; calendar shows next 30 days color-coded by absence type.

### Phase 4 — Shifts (optional)

**Files (~3, ~400 lines):**
1. `types.ts` — add `Shift` (per-weekday hours per assignee)
2. `storage.ts` — optional shifts store (v4 migration, OR embed inside an extended `settings.workingHours`)
3. `resources-panel.tsx` — shift editor; utilization computed against shift hours

**Checkpoint:** user can define per-weekday hours per assignee; utilization respects.

### Phase 5 — Cross-cutting integrations (optional)

**Files (~2, ~200 lines):**
1. `gantt.tsx` — overlay absence bands
2. `task-manager.tsx` — task-modal warning when dueDate falls in absence

## Open questions for the user

To resolve at the start of Phase 1:

1. **Assignee identity** — today `Task.assignee` is free-text. Two tasks with `"Alex Example"` and `"Alex Example"` are different assignees. Should the Resources tab case-fold for grouping? Should `assignee` become a first-class entity with an id, or stay as a normalized string key? **Recommendation:** trim + lowercase for grouping, keep the original casing for display.
2. **Absence types** — vacation / sick / training / other sufficient? Other candidates: conference, parental_leave, jury_duty, holiday. **Recommendation:** start with the four; add more if asked.
3. **Default working week** — assume Mon-Fri 8h, OR add a setting? **Recommendation:** Mon-Fri 8h default; add to Settings only in Phase 4 (alongside shifts).
4. **Calendar grid window** — 30 days fixed, or selectable (1w / 2w / 4w / 90d)? **Recommendation:** 30 days fixed in Phase 3; revisit if user asks.
5. **Sample data** — include absences in `sample-workspace.{csv,md}` immediately so v1 has something to show? **Recommendation:** yes — keeps the demo coherent.

## Risks

- **Schema migration**: bumping IDB v2 → v3 is straightforward (additive only — no existing store modified) but the upgrade path must be tested with an existing v2 database.
- **Assignee identity drift**: if we don't normalize, Resources can show duplicate rows for the same person (see Open #1).
- **Workspace export size**: absences will typically be a small list (10s, not 1000s); no perf concern.
- **Backward compatibility**: existing CSV / MD / JSON files without an `# ABSENCES` / `# Absences` section / `absences` field must still load — parsers must default `absences = []`.

## Acceptance criteria — "v1 done" (Phases 1 + 2)

- [ ] Resources tab visible after RAID and before Activity
- [ ] All distinct assignees (from tasks + absences + contacts) listed with open / overdue counts
- [ ] Absences can be created, edited, and deleted via modal
- [ ] Absences persist across reloads (IndexedDB v3)
- [ ] Absences round-trip cleanly through CSV + Markdown + JSON export/import
- [ ] Legacy CSV/MD/JSON files (no absences section) still load without error
- [ ] Activity log captures absence create/update/delete
- [ ] `npx tsc --noEmit` clean
- [ ] `sample-workspace.csv` / `.md` include example absences
- [ ] i18n complete for en-US and de
- [ ] No regressions in existing tabs (Chat, Reports, Gantt, RAID, Activity)

## Cross-references

- Current data model: [docs/CODEMAPS/data.md](CODEMAPS/data.md)
- Current frontend layout: [docs/CODEMAPS/frontend.md](CODEMAPS/frontend.md)
- Lazy-load pattern (relevant for Phase 4 if shifts grow into something heavy): `lop-app-memory-optimization` memory file
- Storage layer reference: `src/app/storage.ts` (the `BrowserBackend`, `LocalFileBackend`, IDB helpers and CSV/MD/JSON parsers all need extending)
