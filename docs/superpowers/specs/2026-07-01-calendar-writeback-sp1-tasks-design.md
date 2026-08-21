# Calendar Write-back — SP1: Shared Engine + Tasks (Design)

**Date:** 2026-07-01
**Status:** Approved (design)
**Roadmap:** SP1 (this) → SP2 RAID review dates → SP3 Change decision dates → SP4 Resource absences.

## Goal

Extend Outlook calendar write-back — today only milestones (`use-outlook-calendar-push.ts`) and steering-committee meetings (`use-committee-outlook-push.ts`) — to more app-created entities. SP1 builds the **reusable engine** and proves it end-to-end on **Tasks**, plus the **two-level toggle** (per-pane + central Settings) and **manual + optional auto** push model. SP2–SP4 reuse the engine for RAID / Changes / Absences.

## Background (existing, unchanged by SP1)

- `outlook-calendar-write.ts` — Graph event CRUD given a token. `categoryFor(projectId) = "AIPM:${projectId}"`. `milestoneToGraphEvent`, `listProjectEvents` (list by that category), `createEvent`/`updateEvent`/`deleteEvent`, `GraphCalendarError` (404-on-PATCH throws → caller clears stale id + re-creates; 404-on-DELETE tolerated).
- `calendar-reconcile.ts` `planCalendarReconcile(milestones, existing)` — list-based: `outlookEventId` present → update; absent → create; existing ids not kept → delete.
- `use-outlook-calendar-push.ts` — milestone manual push hook (token → list → reconcile → CRUD → write back new/stale ids → toast).
- `Milestone.outlookEventId?: string` persists across all 6 backends (`MILESTONE_CSV_COLUMNS` in `csv-codecs-core.ts`, MD in `markdown-codecs-core.ts`, Turso derived from CSV cols, IDB/JSON via full object, `sanitizeMilestone` in `sanitize-records.ts`).

## Key architecture decision — type-scoped categories

Milestone/committee events are tagged with the **project-only** category `AIPM:${projectId}` and milestone push is **list-based** (`listProjectEvents` deletes anything with that category not in its kept set). If new entity types reused that tag, a milestone push would **cross-delete** task events (and vice-versa).

**Decision:** new entity types use a **type-scoped** category `AIPM:${projectId}:${entityType}` (e.g. `AIPM:p1:task`). Graph `$filter` uses exact equality (`c eq '…'`), so the four new types + the bare milestone/committee tag never match each other's lists. Milestones/committee are **untouched** (keep the bare tag) — zero calendar migration.

`categoryFor` gains an optional second param:
```ts
export const categoryFor = (projectId: string, entityType?: string): string =>
  entityType ? `AIPM:${projectId}:${entityType}` : `AIPM:${projectId}`;
```
Back-compatible: existing single-arg calls (milestone/committee) are byte-identical.

## Components

### 1. Generic reconcile (extend `calendar-reconcile.ts`, i18n-free)

Generalize the milestone planner to any entity carrying an `outlookEventId`:
```ts
export interface HasEventLink { id: number; outlookEventId?: string; }
export interface GenericReconcilePlan<T> {
  create: T[];
  update: { item: T; eventId: string }[];
  delete: string[];
}
export function planEntityReconcile<T extends HasEventLink>(
  items: readonly T[], existing: readonly ExistingEvent[],
): GenericReconcilePlan<T> { /* same logic as planCalendarReconcile, generic */ }
```
`planCalendarReconcile` (milestones) stays as-is (or becomes a thin `planEntityReconcile` wrapper — keep the existing export + tests green).

### 2. Typed list + generic event builder (extend `outlook-calendar-write.ts`)

- `listEntityEvents(token, projectId, entityType)` — same as `listProjectEvents` but `categoryFor(projectId, entityType)`.
- `taskToGraphEvent(task, projectId): GraphEvent` — all-day on `task.dueDate`, subject = `task.taskName`, `categories: [categoryFor(projectId, "task")]`, body notes owner/status. (SP2–4 add `raidToGraphEvent`, `changeToGraphEvent`, `absenceToGraphEvent` here.)

### 3. Generic push hook `use-entity-calendar-push.ts` (React)

A parameterized clone of `useOutlookCalendarPush`:
```ts
useEntityCalendarPush<T extends HasEventLink>({
  items,            // already-FILTERED list (caller applies the per-entity filter)
  entityType,       // "task"
  projectId,
  toGraphEvent,     // (item, projectId) => GraphEvent
  setItems,         // functional updater to write back new/cleared outlookEventId
  isPopout, lang, enabled,
}): { pushToOutlook: () => Promise<void>; busy: boolean }
```
Body mirrors `useOutlookCalendarPush` exactly: popout no-op; acquire `CALENDAR_READWRITE_SCOPE`; `listEntityEvents`; `planEntityReconcile`; create/update/delete with the **same** 404-on-PATCH self-heal (clear stale id → re-create next push); write back new/stale ids via `setItems`; result + partial-failure toasts; never logs token/body. `useOutlookCalendarPush` (milestones) is left as-is OR refactored to call the generic hook — refactor only if trivial and all milestone tests stay green; otherwise leave it.

### 4. Persistence — `Task.outlookEventId`

Add `outlookEventId?: string` to `Task` (`types.ts`). Then the **6 write paths + column** (mirror `Milestone.outlookEventId`):
- `CSV_COLUMNS` (`csv-codecs-core.ts:42`, the `Array<keyof Task>`) — append `"outlookEventId"`. `fieldToString` (`:440`) already handles arbitrary string fields via its default arm (verify); `buildTaskFromObj` (`csv-codecs-decode.ts:474`) — copy `obj.outlookEventId` when present. Turso single+tenant derive from `CSV_COLUMNS` (DDL/insert) automatically; `turso-migrate.ts` ALTER-adds the column to existing DBs.
- MD: the task table codec in `markdown-codecs-core.ts` — add the column + decode arm (mirror milestone `OutlookEventId`).
- IDB (`BrowserBackend`) + JSON — persist the full object; no per-field wiring, but confirm no field allowlist drops it.
- `sanitize.ts` (task validation path) — accept/cap `outlookEventId` (string, ≤1024) if a task sanitizer exists; tasks currently validate via `buildTaskFromObj` — ensure the field survives a round-trip. App-managed field: decoders copy it verbatim, users never enter it.
- **Golden fixtures:** regenerate `__fixtures__/golden-*` (legit new-column format change). Append the empty column to the curated `sample-workspace-small.csv` and `.md` task rows (or regenerate via the sample generator). No new sample *data* — the column is empty for all sample tasks.

### 5. Settings model — two-level toggle (per-device)

```ts
export type CalendarEntityType = "task" | "raid" | "change" | "absence";
// settings.ts
outlookCalendar?: Partial<Record<CalendarEntityType, { enabled: boolean; auto: boolean }>>;
```
- Persisted via the `writeSettings` spread (no allowlist edit; mirrors `dashboardDensity`/`tasksViewMode`). Default: absent ⇒ all off. `sanitizeSettings` coerces each entry to `{enabled: v===true, auto: v===true}`.
- Helper `calendarSyncFor(settings, type): { enabled: boolean; auto: boolean }` (pure) — SP1 defines `"task"`; SP2–4 add their keys.

### 6. Central Settings UI — Settings → Integrations (M365 area)

A new sub-section listing each `CalendarEntityType` with an **Enable** switch + an **Auto** switch (auto disabled/greyed until enabled). SP1 renders the framework + the **task** row (SP2–4 add rows). M365-gated (only shown when M365 is configured, like other calendar UI). Uses `SegmentedControl`/checkbox atoms already in Settings; row-unique `aria-label`s (Settings is axe-scanned). Writes `settings.outlookCalendar.task` via `setSettings`→`writeSettings`.

### 7. Tasks pane wiring (`tasks-section.tsx` header, the new single toolbar row)

- **Per-pane enable toggle** (required — the user wants it toggleable both in the pane and centrally): a small labelled switch/checkbox in the tasks toolbar writing `settings.outlookCalendar.task.enabled` via `setSettings`→`writeSettings` — the SAME setting the central Settings row writes, so the two stay in lockstep. M365-gated (hidden when M365 not configured). Row-unique `aria-label` (Open Points is axe-scanned).
- When enabled, render a **"Push to Outlook"** button beside it (mirrors the milestone panel button; `iconOnly` to match the compact bar) wired to `useEntityCalendarPush({ items: pushableTasks, entityType:"task", … })`.
- **Task filter** (`pushableTasks`): `tasks.filter(x => !isTaskFinished(x) && !!x.dueDate)`. Finishing/cancelling or clearing a due date drops the task from `items` → next push deletes its event.
- **Auto** stays a central-Settings-only switch (see Open decision) — the pane carries enable + the push button, not the auto switch, to avoid overcrowding the already-dense toolbar.

### 8. Auto-sync runner (when `auto` on)

`use-calendar-auto-sync.ts` — a per-entity effect (SP1: tasks), mounted where the entity list + setter live:
- Gated on `enabled && auto && M365 configured && !isPopout`.
- Keyed on a **content hash** of the filtered `pushableTasks` (ids + dueDate + name + status) so it fires on a *meaningful* change, **debounced** (~4s, like `use-landing-delta`).
- Calls the same `pushToOutlook` **silently** (status-only, no interactive token prompt — background acquire; on no-token, no-op and try again next change). **Fail-once-per-change** (a failed run doesn't retry-spam; next change re-arms). Never logs token/body.
- Popout = no-op. Purity: `new Date()`/debounce only inside the effect/timeout, never render body.

## Data flow

manual: click → `pushToOutlook` → token → `listEntityEvents(projectId,"task")` → `planEntityReconcile(pushableTasks, existing)` → CRUD → `setTasks` writes back `outlookEventId` (new) / clears (stale 404) → toast.
auto: filtered-list content-hash change → debounced effect → same `pushToOutlook` silently.

## Error handling

- No token / not consented → manual: error toast; auto: silent no-op, re-arm.
- 404 on PATCH → clear stale `outlookEventId` → re-create next push (existing self-heal).
- Partial failures → count + partial-failure toast (manual); status-only warn (auto).
- Invalid/absent `dueDate` → task not in `pushableTasks` (filter), never reaches the event builder.
- Popout → all writes no-op.

## Testing

- **`calendar-reconcile.test.ts`** — `planEntityReconcile` generic: create/update/delete + kept-set correctness (parity with existing milestone reconcile cases).
- **`outlook-calendar-write.test.ts`** — `categoryFor(projectId,"task")` shape; `taskToGraphEvent` (all-day, subject, typed category, date→next-day end); back-compat `categoryFor(projectId)` unchanged.
- **`use-entity-calendar-push.test.tsx`** — mocked Graph: create writes back id; 404-on-PATCH clears id; delete of stale; popout no-op; partial-failure toast.
- **Persistence round-trip** — a task with `outlookEventId` survives CSV/MD/JSON/IDB/Turso round-trip (extend the storage round-trip tests); golden fixtures regenerated (byte diff = the new empty column only).
- **Settings** — `sanitizeSettings` coerces `outlookCalendar.task`; `calendarSyncFor` defaults off.
- **Auto runner** — fires on filtered-list change when enabled+auto; no-op when disabled/popout; debounced (fake timers); fail-once.
- **Settings section axe** — the new Integrations sub-section keeps row-unique labels (Settings is axe-scanned).
- Run `npx tsc --noEmit` after any test edit (i18n parity + test-only type errors fail CI).

## i18n (EN + DE)

New keys: central section title + per-entity row labels, the pane button (reuse `calendarPush`/`calendarPushing`/`calendarPushResult`/`calendarPushPartial`/`calendarPushNoAccess` where possible), auto-switch label, enable-switch label. DE via node utf8 write (CRLF/umlaut landmine), real umlauts.

## Open decision (resolve at plan time, low-risk default)

**Pane auto toggle vs central-only auto:** default = the pane shows only the *button* (gated on `enabled`); the **auto** switch lives in **central Settings only** (avoids a second control in the already-dense tasks toolbar). The pane still reflects `enabled` (button present/absent). If a pane-level auto toggle is wanted, add it as a small switch next to the button — same setting. Chosen default: **central-only auto**, pane shows the button.

## Out of scope (SP1)

- SP2–4 entities (RAID/Change/Absence) — separate specs; SP1 only stubs their `CalendarEntityType` union members (no rows/fields yet), or adds them lazily per-SP (plan decides).
- Changing the milestone/committee mechanism or their bare category.
- Two-way calendar *read* (import already exists separately); this is write-back only.
- Per-task manual "add to calendar" (row-level) — the toggle is per entity-type, not per row.
