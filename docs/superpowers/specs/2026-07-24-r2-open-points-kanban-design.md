# Release 2 — Open Points & Kanban (design)

**Date:** 2026-07-24
**Roadmap:** slice 2 of the 6-release multi-surface roadmap (`2026-07-24-multi-surface-feature-roadmap-design.md`). R1 shipped as 0.198.0 "Abraham".
**Requests covered:** 11 (task created timestamp), 10 (filter out externals), 15 (Kanban person swimlanes).
**Target version:** 0.199.0.

## Grounding notes (corrections to the roadmap spec)

The roadmap spec was written from AGENTS.md and drifted from the code in two places. Ground truth as of `664469ad`:

- `Task.createdDate` genuinely does not exist. `lastUpdateDate` is required. Roadmap correct.
- `Resource.isExternal?` exists (`types.ts:537`); `effectiveAssignee` / `effectivePersonName` live in `resource-foundation.ts`. Roadmap correct.
- **Correction:** the filter derivation the roadmap attributes to `task-filters.ts` lives in `workspace-context.tsx` (`uniqueAssignees` :167, `filteredSortedTasks` :240). `task-filters.ts` is only the 78-line orphan-filter reconcile engine.
- **Correction:** `useColumnManager` seeds `hiddenCols` with `["estimate","spent"]` on first run only and persists per-device under `aipm-cockpit:hidden-cols`. Existing users hold a stored array, so a new column defaults to *visible* for them unless migrated.
- `task-kanban-board.tsx` is 131 lines: 1-D `groupByStatus`, native HTML5 DnD, drop → `onStatusChange`.
- `WorkspaceProvider` takes `{ children }` only and is mounted in `task-manager.tsx:2886` *above* the component holding settings, so settings cannot be threaded in as a prop from there.

## Decisions taken

| Fork | Decision |
|---|---|
| Swimlane activation | Third view mode — `tasksViewMode` widens to `table \| board \| swimlane` |
| Lane roster | Assignees present in the filtered set + Unassigned, plus a session-only add-lane picker |
| `createdDate` precision | Date-only `YYYY-MM-DD`, matching every other `Task` date field |
| "Created" column default | Hidden, with a storage migration so existing users also get it hidden |
| Hide-externals state | Per-device setting, applied once in `workspace-context` |
| AI reach | `hideExternalTasks` joins the `update_settings` safe subset |

---

## 1. `Task.createdDate`

### Model

`createdDate?: string` on `Task`, format `YYYY-MM-DD`. Optional so no existing literal-`Task` fixture or cast site breaks.

### Six write paths

- Add `"createdDate"` to `CSV_COLUMNS` (`csv-codecs-core.ts:43`) — this covers CSV **and** Turso single + tenant, whose DDL/insert derive from it. The generic `fieldToString` / `build*FromObj` arms already handle a plain string field.
- Add to `MD_COLUMNS` (`markdown-codecs-core.ts:343`), label `Created`.
- JSON and IndexedDB pass the whole object through — no edit.
- `turso-migrate.ts` PRAGMA-diffs and `ALTER ADD COLUMN`s existing DBs on its own — no edit.

### Set and backfill

- **Create:** stamped in the task-submit create path with the timezone-effective today.
- **Load:** the existing per-task load migrator `migrateTaskStatus` already runs on all six load paths (`workspace.ts`, `browser-backend.ts`, `csv-codecs-decode.ts`, `markdown-codecs-decode.ts`, `templates.ts`). It is renamed to `migrateTask` and gains the backfill: `createdDate ?? lastUpdateDate ?? ""`. An empty result stays empty and renders `—`; the migrator never invents a date. Rename touches the six call sites plus its tests.

### Table column

New column key `createdDate`, placed left of `lastUpdateDate`:

- `ALL_TASK_COLS` (`tasks-section.tsx:60`) and the `TaskCol` union (`filters-context.tsx:35`)
- `DEFAULT_COL_WIDTHS` (`use-column-manager.ts:18`) — 110, matching the other date columns
- header `SortResizeTh` + sort arm + `task-row.tsx` cell
- i18n `colCreatedDate` (EN/DE)

Sorts as a plain string, which is chronological for `YYYY-MM-DD`.

### Default-hidden migration

`useColumnManager` storage shape becomes `{ v: 2, hidden: string[] }`. A legacy bare array reads as v1 and has `NEW_HIDDEN_IN_V2 = ["createdDate"]` unioned in once. This keeps every existing hide choice while hiding the new column for everyone, and the mechanism is reusable for the next column added. The read stays try/caught with the fresh-install seed as fallback.

**Accepted quirk:** a saved view stored before this release lists `hiddenCols` without `createdDate`, so applying it reveals the column. Versioning `SavedViewPayload` is not worth it — the user hides it once and re-saves.

### Fixtures

Regenerate `__fixtures__/golden-*` (a legitimate new-column format change). `createdDate` is synthesized into `sample-workspace-small.json` by `scripts/generate-sample-workspace.ts`, then `-big` / `-huge` are regenerated from the master.

### Acceptance

New tasks record a creation date; existing tasks backfill from `lastUpdateDate`; the column renders and sorts; the column is hidden by default for both new and existing users; workspaces round-trip byte-stable after golden regen.

---

## 2. Hide externals

### State

`settings.hideExternalTasks?: boolean`, per-device, default `false` — mirroring `hideFinishedTasks` in every respect: field + default in `settings-types.ts`, `=== true` parse in the `use-settings.ts` load merge, and a toolbar checkbox beside "Hide finished" with i18n key `hideExternalTasks` (EN/DE).

### Classification is link-only

A task is external iff `t.resourceId != null` **and** `resourcesById.get(t.resourceId)?.isExternal === true`.

A free-string assignee with no link stays visible even when the string equals an external's name. `resource-workload` does name-match through `nameToId`, but there a miss only misroutes a row into "Unlinked"; here a name collision would hide real work. Link-only fails in the safe direction.

### Application point

`WorkspaceProvider` gains a `useSettings()` call — the 24th consumer; the module-listener sync between instances is already solved. One derived list:

```ts
const visibleTasks = hideExternalTasks
  ? tasks.filter((t) => !isExternalTask(t, resourcesById))
  : tasks;
```

`visibleTasks` feeds **four** derivations: `uniqueAssignees`, `uniqueGroups`, `uniqueLabels`, `filteredSortedTasks`.

All three option lists, not only assignees: if a hidden external's task were the sole carrier of group "X", pruning only people would leave a group option matching no row — the exact orphan-filter state `task-filters.ts` exists to prevent.

**Stays on the full `tasks` list:** `tasksById` (a dependency chip pointing at a hidden external's task must still resolve — a hidden row is still a real task) and `taskSearchIndex` (keyed lookup; filtered rows never reach it).

### Toggle-time behavior (documented, not fixed)

Turning the toggle on while the assignee filter points at an external removes that name from `uniqueAssignees`, so `resolveEffectiveFilters` resolves the filter to `All` and the table goes from one person to everyone-minus-externals. Untoggling restores the filter, because the raw filter state is deliberately never written back. The alternative — an empty table beside a control reading "All" — is the failure mode that machinery exists to prevent.

### Reach

The board and the swimlane view consume `filteredSortedTasks`, so both obey the toggle with no extra wiring. Exports, Gantt, dashboard and next-actions are untouched: this is a pane-level view filter, not a data filter.

### AI `update_settings`

`hideExternalTasks` joins the safe subset. Four edit sites in lockstep:

1. `chat-tool-defs.ts` — `hideExternalTasks: { type: "boolean" }` property, **and** the tool `description` sentence extended (it enumerates what is reachable; a stale description misleads the model).
2. `chat-tools.ts` — `hideExternalTasks?: boolean` on `SettingsUpdateInput`.
3. `use-chat-dispatcher.ts` — a `typeof patch.hideExternalTasks === "boolean"` arm feeding both `changes` and `applied` (the case throws when nothing recognized applied, so `applied` must be fed).
4. `chat-tools.test.ts` — allowlist guard row.

Popout writes are refused by the existing `isReadOnly` guard; the value persists through the normal `writeSettings` effect. Secrets, storage and integration config remain unreachable.

### Acceptance

Toggling hides external-owned tasks in table, board and swimlane views; the assignee, group and label dropdowns stop offering values only those rows carried; untoggling restores rows and options; dependency chips on hidden tasks still resolve; the AI can flip the toggle on request and cannot reach anything else new.

---

## 3. Kanban person swimlanes

### View mode

`tasksViewMode` widens to `"table" | "board" | "swimlane"`. Edit sites in lockstep:

- `settings-types.ts` — type + sanitizer
- `project-appearance-prefs.ts:49` — validator arm (an unrecognized value falls through and is silently dropped, so a missed edit here loses a per-project override on reload with no error)
- `tasks-section.tsx` — three-segment control, reusing the existing scope-aware writer (project override vs device) unchanged
- `chat-tool-defs.ts` enum and the `use-chat-dispatcher.ts:414` guard

`settings-effective.ts` needs no change (appearance is whole-replace).

### Component split

`task-kanban-board.tsx` stays the 1-D status board. Swimlanes get a sibling `task-kanban-swimlanes.tsx` rather than a mode branch: the two differ in grid structure, drop payload and headers, and merging them would produce a props union with half the props dead in either mode. Both reuse `TaskKanbanCard` and the pure `task-kanban.ts` engine, which gains:

```ts
groupByStatusAndPerson(tasks, resourcesById, extraLaneIds)
  → { lanes: Lane[]; cells: Record<LaneKey, Record<TaskStatus, Task[]>> }
```

### Lane identity

Lane key is `resourceId` when linked, else the raw assignee string, else the `UNASSIGNED` sentinel. Lanes sort by display name — `effectivePersonName` for linked lanes, so a renamed resource shows its live name, never the stored cache — with Unassigned last. Lanes derive from the *filtered* task list, so search, filters and hide-externals narrow them for free.

### Add-lane picker

A toolbar control backed by the shared `ResourcePicker`, holding extra lane ids in pane-local `useState` (session-only, not persisted). Adding an already-present person is a no-op; each added empty lane carries a remove ✕. This was reversed after review: externals are now excluded from both this picker and the per-card assign picker while hide-externals is on, because leaving them pickable let a user assign work into a lane the same toggle then hid, making the card silently vanish. The extra-lane ids fed to the swimlane grid are filtered by the same externality check, so a lane added before the toggle went on stops rendering once it's on — the raw `useState` is left untouched, so the lane reappears if the toggle flips back off.

### Drag

The cell `(lane, status)` is the drop target. A drop writes both fields in one functional `setTasks(prev => …)`, skipping the write when neither changed.

- linked lane → `resourceId` set + `assignee` set to the live name
- free-string lane → `assignee` string, `resourceId` cleared
- Unassigned → both cleared, the same shape the `ResourcePicker` ✕ produces, so "cleared assignment" means one thing app-wide

Status changes route through `applyStatusChange` so the `status === "Done" ⟺ completedDate set` invariant holds. Jira-synced cards (`!!task.jiraKey`) are `draggable={false}` and their drops are refused.

### Keyboard path

Each card keeps its `TaskStatusSelect` and gains a person `<select>` in swimlane mode with a row-unique label (`Assign – <task>`), so every drag has a keyboard equivalent. The board renders outside `RowContextProvider`, so the card takes everything as props and never calls `useTaskRowContext()`.

### Layout and a11y

Sticky left lane-header column and sticky status-header row; the outer container scrolls horizontally and carries the existing `containerRef` for deep-link flash. Each lane is a `<section aria-label="<person>">` and each cell carries `aria-label="<person> – <status>"`. No `role="grid"`: drag is a mouse enhancement and the selects are the real interaction path. The view is not added to axe `A11Y_VIEWS` (the gate scans the table view) — eye-verified, same as the existing board.

### Size

`tasks-section.tsx` is 960 lines and baselined by the ratchet, so the swimlane toolbar block (mode segment + lane picker) is extracted to `task-swimlane-toolbar.tsx`.

### Acceptance

The third segment switches to the swimlane view; status columns are retained; dragging a card into a person's cell reassigns and sets status in one write; the add-lane picker makes an empty lane droppable; Jira-synced cards cannot be dragged or reassigned; the per-card person select assigns without a mouse.

---

## Cross-cutting

### Build order

1 → 2 → 3, serialized. Slices 2 and 3 both edit the Open Points toolbar, so they land in sequence rather than in parallel.

### Tests

**Pure (coverage-gated):**
- `groupByStatusAndPerson` — lane ordering, Unassigned last, extra empty lanes, free-string vs linked keys
- `isExternalTask` and the `visibleTasks` derivation — link-only classification, unlinked-stays-visible
- `migrateTask` — backfill precedence (`createdDate` wins, else `lastUpdateDate`, else empty)

**Regression-shaped:**
- an assignee filter pointing at an external resolves to `All` when the toggle flips (pins the self-healing behavior)
- `tasksById` stays complete under the toggle — a dep chip on a hidden external's task still resolves
- hidden-cols v1 → v2 migration keeps existing hides and adds `createdDate`

**Component:**
- swimlane drop writes both fields in one functional setter
- a Jira-synced card refuses the drop
- the person `<select>` assigns without drag

**Registry / fixtures:** `entity-persistence-registry.test.ts` gains the `createdDate` row (codec-scoped CSV + MD); golden fixtures regenerated from the JSON master, then `-big` / `-huge`.

**Fixture traps to avoid:** a swimlane fixture whose assignees are all linked never exercises the free-string lane key; a hide-externals fixture with no external owning work passes vacuously. Both fixtures carry the awkward case.

### Gates

- `npx tsc --noEmit` after every test edit — it enforces i18n EN/DE parity and catches test-only type errors vitest never sees.
- New i18n keys: `colCreatedDate`, `hideExternalTasks`, `tasksViewModeSwimlane`, `swimlaneAddLane`, `swimlaneRemoveLane`, `swimlaneUnassigned`, `assignPersonLabel`. German written via a node utf8 write with real umlauts (the Edit tool corrupts `i18n.de.ts`, which is CRLF), then grep-verified.
- Open Points is axe-scanned: the new checkbox, mode segment and lane picker each need a real accessible name; the axe run happens on a fresh isolated port before push.
- `dup:check`: shared card markup stays in `TaskKanbanCard`, never copy-pasted between the two board components.
- `size:check`: the swimlane toolbar is extracted so `tasks-section.tsx` does not grow past its baseline.

### Risks

1. **`tasksViewMode` union widening with a missed validator site.** `project-appearance-prefs.ts` silently drops an unrecognized value, so a per-project "swimlane" override would vanish on reload with no error. Grep the union members; do not trust the type to find them.
2. **Golden regen masking a real format change.** Regenerate only after the new column is confirmed correct in the CSV and MD encoders — never to turn a red test green.
3. **`WorkspaceProvider` consuming `useSettings()`.** Settings changes now re-render the provider and its consumers. Only the one boolean is extracted and it joins the existing context-value memo deps; settings edits already re-render broadly, so this widens an existing cost rather than introducing a new class.
4. **Hidden-cols v2 migration on a corrupt payload.** The read stays try/caught and falls back to the fresh-install seed; worst case the user re-hides columns.

### Release

`0.199.0`, codename verified unused by grepping CHANGELOG at release time. Bump `src/app/version.ts` (APP_VERSION + milestone), add the CHANGELOG entry, append the new `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` with EN/DE strings. Superpowers code review before push; merge only on a green pipeline.

### Out of scope (named)

- The R3 assignee-filter request channel (consumes this release's filter work, ships next)
- Lane grouping by any dimension other than person
- Per-lane collapse
- Adding the swimlane view to axe `A11Y_VIEWS`
