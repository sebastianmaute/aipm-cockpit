# Two-way calendar sync SP2 — Task due-date pull — Implementation Plan

> Sibling of SP1 (`2026-07-01-calendar-twoway-sp1-milestone-pull.md`). Reuses SP1's pure engine
> (`calendar-pull.ts`), baseline store (`calendar-sync-baseline.ts`), graph leaf (`outlook-graph.ts`),
> and summary modal (`calendar-pull-summary-modal.tsx`) unchanged.

**Goal:** Add a manual "Pull from Outlook" action to the Tasks (Open Points) view that applies Outlook
date reschedules onto task `dueDate`, with the same app-wins conflict + deletion semantics as milestones.
Tasks ONLY. Manual button (auto-pull is SP5).

**Key deltas from SP1 (tasks vs milestones):**
- Tasks use the TYPE-SCOPED Outlook category `categoryFor(projectId,"task")` (= `AIPM:<pid>:task`), NOT the
  bare milestone category → the read helper must be generalized to take an `entityType`.
- Task anchor date = `dueDate`; pushable = `!isTaskFinished && !!dueDate`.
- ★★ Jira-synced tasks (`!!task.jiraKey`) are READ-ONLY (Jira owns their dates) → EXCLUDE from pull entities.
- `tasks-section.tsx` is the FAT pane — it already instantiates its own `useEntityCalendarPush<Task>` (manual
  push button). SP2 pull lives ENTIRELY inside tasks-section (hook + button + summary modal); NO task-manager
  threading, NO workspace-section, NO new props.
- No new persisted field (`Task.outlookEventId` exists from write-back SP1). No new i18n keys (reuse
  `calendarPull`/`calendarPulling` + the `calendarPull*` summary keys). No golden-fixture / sample changes.
- Tasks view ("Open Points") IS in axe `A11Y_VIEWS` — the pull button needs an accessible name (mirror the
  push button's `aria-label`/`title` = `calendarPush`; pull uses `calendarPull`).

**Execution order:** T1 (read-helper generalize) → T2 (generic pull hook) → T3 (tasks-section wiring) → T4 (release).

---

### Task 1: Generalize the read helper for a type-scoped category

**Files:** Modify `src/app/outlook-calendar-read.ts`, `src/app/outlook-calendar-read.test.ts`.

Add an optional `entityType` param to `fetchProjectEventDates`; when present it filters by the type-scoped
`categoryFor(projectId, entityType)`, when absent it keeps the bare `categoryFor(projectId)` (milestone —
back-compatible; SP1's milestone hook call `fetchProjectEventDates(token, projectId)` stays valid).

- [ ] Step 1: Update the signature to `fetchProjectEventDates(token: string, projectId: string, entityType?: string)`.
  Change the category line to `const cat = categoryFor(projectId, entityType).replace(/'/g, "''");`
  (`categoryFor`'s 2nd arg is already optional → bare when undefined). Everything else unchanged.
- [ ] Step 2: Add a test case: calling with `entityType: "task"` builds a `$filter` on `AIPM:proj-1:task`
  (assert via the URL passed to the mocked `graphGet` — capture `graphGet.mock.calls[0][1]` and assert it
  contains the encoded `AIPM:proj-1:task`). Keep the existing two cases (they call the 2-arg form → bare).
- [ ] Step 3: `npm run test:run -- outlook-calendar-read.test.ts` PASS; `npx tsc --noEmit` PASS; `npm run lint` PASS.
- [ ] Step 4: Commit `feat(calendar): read helper accepts an entityType for type-scoped pull (two-way SP2)`.

---

### Task 2: Generic entity pull hook `use-entity-calendar-pull.ts`

**Files:** Create `src/app/use-entity-calendar-pull.ts`, `src/app/use-entity-calendar-pull.test.tsx`.

A parameterized clone of `use-milestone-calendar-pull.ts` (which stays as-is), generic over an entity
`T extends { id: number; outlookEventId?: string }`, mirroring how `use-entity-calendar-push` generalizes the
push hook. It reuses the pure `planCalendarPull`, `calendar-sync-baseline`, the generalized
`fetchProjectEventDates(token, projectId, entityType)`, and `updateEvent` for the keep-app convergence.

Args:
```ts
interface Args<T> {
  items: readonly T[];
  entityType: string;                       // "task"
  projectId: string;
  getDate: (item: T) => string | undefined;  // task -> dueDate
  withDate: (item: T, date: string) => T;    // task -> { ...t, dueDate: date }
  toGraphEvent: (item: T, projectId: string) => GraphEvent; // taskToGraphEvent (keep-app push-back)
  setItems: (updater: (prev: T[]) => T[]) => void;
  isPullable?: (item: T) => boolean;         // exclude Jira-synced tasks: t => !t.jiraKey
  isPopout: boolean;
  lang: Lang;
  enabled: boolean;
}
```
Behaviour (identical semantics to the milestone hook, generalized):
- `pull()`: early-return `isPopout || !enabled`; acquire token (`CALENDAR_READWRITE_SCOPE`, interactive) →
  no token ⇒ `calendarPushNoAccess` error toast; `events = await fetchProjectEventDates(token, projectId, entityType)`;
  `baseline = loadBaseline(projectId, entityType)`; build `entities` from `items.filter(isPullable ?? ()=>true)`
  mapped to `{ id, date: getDate(item) ?? "", outlookEventId }` and dropped when `!date`; `plan = planCalendarPull(...)`;
  auto-apply `plan.applies` via `applyMove`; self-heal in-sync baselines; open result only when rows exist else
  `calendarPullInSync` info toast.
- `applyMove(id, eventId, newDate)`: `setItems(prev => prev.map(i => i.id===id ? withDate(i, newDate) : i))` +
  `writeBaselineDate(projectId, entityType, eventId, newDate)`.
- `keepApp({id, eventId, appDate})` (async, convergence — the SP1 landmine fix): find item by id; acquire token;
  `await updateEvent(token, eventId, toGraphEvent(item, projectId))` (item already carries appDate) → on success
  `writeBaselineDate(projectId, entityType, eventId, appDate)` + info toast; on failure do NOT write baseline +
  error toast.
- Returns `{ pull, busy, result: { plan } | null, clearResult, keepApp, applyMove }`.

- [ ] Step 1: Write the failing test `use-entity-calendar-pull.test.tsx` (model on `use-milestone-calendar-pull.test.tsx`
  and `use-outlook-calendar-push.test.tsx`): mock `useMsAuth`/`useToastContext`/`updateEvent`/`fetchProjectEventDates`/
  `calendar-sync-baseline`. Cases: (a) an apply auto-writes the item date + baseline; (b) `isPullable` excludes an
  item (e.g. a `jiraKey` task never appears in applies/conflicts/deletions); (c) keepApp success calls `updateEvent`
  + writes baseline=appDate; (d) keepApp on `updateEvent` reject does NOT write baseline.
- [ ] Step 2: run → FAIL. Step 3: implement. Step 4: run → PASS; `npx tsc --noEmit`; `npm run lint` (exhaustive-deps
  complete — hoist any `obj.member`). 
- [ ] Step 5: Commit `feat(calendar): generic use-entity-calendar-pull hook (two-way SP2)`.

---

### Task 3: Wire task pull inside `tasks-section.tsx`

**Files:** Modify `src/app/tasks-section.tsx`, `src/app/tasks-section.test.tsx`.

Anchor: `tasks-section.tsx` already has `setTasksForPush` (line ~220), instantiates `useEntityCalendarPush<Task>`
(line ~224) and renders the manual push button gated on `calendarTaskEnabled` (line ~530-541).

- [ ] Step 1: After the push-hook instantiation, add the pull hook:
```ts
const taskPull = useEntityCalendarPull<Task>({
  items: pushableTasks,
  entityType: "task",
  projectId: projectId ?? "default",
  getDate: (x) => x.dueDate,
  withDate: (x, date) => ({ ...x, dueDate: date }),
  toGraphEvent: taskToGraphEvent,
  setItems: setTasksForPush,
  isPullable: (x) => !x.jiraKey,     // Jira-synced tasks are read-only (Jira owns dates)
  isPopout: !!isPopout,
  lang,
  enabled: !!m365Configured && !isPopout,
});
```
- [ ] Step 2: Render a "Pull from Outlook" button DIRECTLY AFTER the push button (still inside the
  `calendarTaskEnabled &&` block), mirroring the push button's classes + `aria-label`/`title`, using
  `t(lang, taskPull.busy ? "calendarPulling" : "calendarPull")` and `onClick={() => void taskPull.pull()}`,
  `disabled={taskPull.busy}`.
- [ ] Step 3: Render the summary modal locally (tasks-section can host it — `Modal` is an overlay):
```tsx
{taskPull.result && (() => {
  const plan = taskPull.result.plan;
  const nameOf = (id: number) => pushableTasks.find((x) => x.id === id)?.taskName ?? String(id);
  return (
    <CalendarPullSummaryModal
      lang={lang}
      open
      onClose={taskPull.clearResult}
      applied={plan.applies.map((a) => ({ id: a.id, name: nameOf(a.id), newDate: a.newDate }))}
      conflicts={plan.conflicts.map((c) => ({ id: c.id, eventId: c.eventId, name: nameOf(c.id), appDate: c.appDate, outlookDate: c.outlookDate }))}
      deletions={plan.deletions.map((d) => ({ id: d.id, name: nameOf(d.id) }))}
      onKeepApp={taskPull.keepApp}
      onTakeOutlook={(c) => taskPull.applyMove(c.id, c.eventId, c.outlookDate)}
    />
  );
})()}
```
  NOTE: the task's display name is `taskName` (verify the field on `Task`). The modal is only reachable
  non-popout (hook early-returns on isPopout → result stays null in popout).
- [ ] Step 4: `tasks-section.test.tsx` — add: pull button renders when `calendarTaskEnabled` + m365 (mirror the
  push-button test's setup), hidden otherwise, click fires the pull. (If the existing test mocks
  `useEntityCalendarPush`, also mock `useEntityCalendarPull` similarly.)
- [ ] Step 5: `npx tsc --noEmit`; `npm run test:run -- tasks-section.test.tsx`; `npm run lint`; the tasks axe gate:
  `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Open Points"` (or the exact tasks view name — check
  `A11Y_VIEWS`). All PASS.
- [ ] Step 6: Commit `feat(calendar): wire task Pull-from-Outlook + summary modal (two-way SP2)`.

---

### Task 4: Release 0.161.0

**Files:** `src/app/version.ts`, `package.json`, `CHANGELOG.md`, i18n highlight key, `AGENTS.md`, memory.

- [ ] Bump `APP_VERSION="0.161.0"`, new unused codename (grep-verify), `APP_BUILD_DATE`/`APP_MILESTONE`,
  append `"versionHighlightCalendarPullTask"` to `APP_HIGHLIGHT_KEYS`.
- [ ] `package.json` → 0.161.0.
- [ ] i18n `versionHighlightCalendarPullTask` EN "Outlook date reschedules pull back into tasks" / DE (node write)
  "Outlook-Terminverschiebungen werden in Aufgaben zurückgespielt".
- [ ] `CHANGELOG.md` `## [0.161.0]` entry (task two-way pull, SP2; tasks only; Jira-synced excluded).
- [ ] `AGENTS.md` — extend the two-way bullet: SP2 tasks (type-scoped category via generalized
  `fetchProjectEventDates`, generic `use-entity-calendar-pull`, Jira-synced excluded, all in the fat tasks-section).
- [ ] Memory — update `calendar-twoway-roadmap.md` (SP2 done) + `MEMORY.md` pointer.
- [ ] `npx tsc --noEmit`, `npm run test:run` (full), `npm run lint`; commit `chore(release): 0.161.0 "<Codename>" — task two-way calendar pull (SP2)`.
- [ ] Full release chain only on the "release" trigger.

---

## Self-review
- Reuses SP1 engine/baseline/modal/leaf unchanged; only the read helper gains an optional `entityType`.
- Generic hook mirrors the milestone hook's semantics incl. the keep-app convergence fix.
- Jira-synced exclusion via `isPullable` is the one task-specific correctness rule.
- All wiring inside the fat tasks-section → zero task-manager/workspace-section churn.
- No persisted field, no i18n key churn (except the release highlight), no golden fixtures.
