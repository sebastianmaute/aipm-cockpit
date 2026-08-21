# Two-way calendar sync SP5 — Auto-pull + deletion-semantics — Implementation Plan

> Final slice of the two-way pull roadmap. SP1–SP4 shipped MANUAL "Pull from Outlook" per entity. SP5 adds
> (a) an opt-in BACKGROUND auto-pull runner and (b) deletion-semantics (prune the stale `outlookEventId` +
> baseline entry when an event is definitively gone, so a cancelled event stops re-appearing every pull).

## Decisions (user-chosen)
- **Gating = REUSE the existing per-entity `.auto` flag → BIDIRECTIONAL.** Turning on an entity's `auto` (today =
  auto-push) now ALSO auto-pulls. No new settings field, no new UI toggle. Scope = the 4 `CalendarEntityType`
  entities that HAVE this flag: **task · raid · change · absence**. Milestone uses the older list-based push (NOT
  in `CalendarEntityType`), so milestone stays MANUAL-pull only (it still gets the shared engine deletion fix).
- **Background conflicts = SILENT SKIP + COUNT TOAST.** Auto-pull auto-applies safe moves silently, prunes
  definitive deletions, and SKIPS conflicts — surfacing ONE unobtrusive toast `"{0} calendar conflicts — open Pull
  to resolve"`. The summary modal opens ONLY on a MANUAL pull. Never pop a modal from the background.
- **Deletion-semantics = auto-prune DEFINITIVE deletions only.** A deletion (prune the `outlookEventId` +
  `removeBaselineEntry`) fires ONLY when the event is MISSING from the list or `isCancelled`. A present event with a
  null/unreadable date is TRANSIENT → skipped (no row, no prune) — this also fixes SP4-review minor #1.
  ★ Known limitation (document, don't fix): with auto-PUSH also on (same `.auto` flag), a pruned event whose entity
  is still pushable is RE-CREATED on the next push — matching the existing write-back self-heal. A permanent
  per-item calendar opt-out is future work, out of SP5 scope.

## Execution order
T1 (engine: definitive-deletion) → T2 (generic hook: background mode + prune + conflict toast) → T3 (milestone
manual hook: prune loop) → T4 (auto-pull runner + task-manager wiring) → T5 (release 0.164.0).

---

### Task 1: Engine — deletions are DEFINITIVE only

**Files:** `src/app/calendar-pull.ts`, `src/app/calendar-pull.test.ts`.

Current deletion guard: `if (!ev || ev.isCancelled || ev.date === null || (hasEnd && ev.endDate === null))`. Split it:
- DEFINITIVE (deletion): `!ev || ev.isCancelled` → `plan.deletions.push({id, eventId})`.
- TRANSIENT (skip, no row): `ev` present but `ev.date === null` OR `(hasEnd && ev.endDate === null)` → `continue` (do
  nothing — neither in-sync nor a deletion; the next pull with a readable date reconciles it).

```ts
const ev = byId.get(eventId);
if (!ev || ev.isCancelled) { plan.deletions.push({ id: ent.id, eventId }); continue; }
if (ev.date === null || (ent.endDate !== undefined && ev.endDate === null)) continue; // transient/unreadable — skip
// ...existing startMatch/endMatch/entKey apply/conflict logic unchanged...
```
- [ ] Tests: missing event → deletion; cancelled → deletion; present + `date===null` → NO row (was a deletion before —
  UPDATE that existing assertion); range present + `endDate===null` (valid start) → NO row (was deletion in SP4 — update).
- [ ] Verify: `npx tsc --noEmit`; `npm run test:run -- calendar-pull.test.ts`; `npm run lint`.
- [ ] Commit `feat(calendar): pull deletions are definitive (missing/cancelled) only; skip transient null dates (two-way SP5)`.

---

### Task 2: Generic hook — background mode + deletion prune + conflict-count toast

**Files:** `src/app/use-entity-calendar-pull.ts`, `src/app/use-entity-calendar-pull.test.tsx`, plus one new i18n key
in `src/app/i18n.ts` (EN) and `src/app/i18n.de.ts` (DE — node utf8 write).

- New i18n key `calendarPullConflictsPending`: EN `"{0} calendar conflicts — open Pull to resolve"`;
  DE `"{0} Kalenderkonflikte — im Pull auflösen"` (real ö in `auflösen`; node write; verify bytes).
- `Args<T>` gains `background?: boolean` (default false). Import `removeBaselineEntry` from `./calendar-sync-baseline`.
- Add a `prune(id, eventId)` (or inline loop) — clears the entity's link + baseline:
```ts
const prune = useCallback((id: number, eventId: string) => {
  setItems((prev) => prev.map((i) => (i.id === id ? { ...i, outlookEventId: undefined } : i)));
  removeBaselineEntry(projectId, entityType, eventId);
}, [setItems, projectId, entityType]);
```
- In `pull`, replace the token acquisition + result handling to branch on `background`:
  - token: `acquireToken(CALENDAR_READWRITE_SCOPE, { interactive: !background })`. On no token: background → silent
    `return` (NO error toast); manual → existing `calendarPushNoAccess` error toast.
  - after building the plan: auto-apply `plan.applies` (unchanged); self-heal (unchanged); **prune EVERY
    `plan.deletions`** (both modes) via `prune(d.id, d.eventId)`.
  - result surfacing:
    - background: `if (plan.conflicts.length > 0) showToast("info", t(lang, "calendarPullConflictsPending", plan.conflicts.length));`
      NEVER `setResult`. No in-sync toast. (Applies + deletions already acted on silently.)
    - manual (unchanged): `hasRows ? setResult({ plan }) : showToast("info", t(lang,"calendarPullInSync"))` — the modal
      still LISTS the deletions (informational) even though they were just pruned.
  - the top-level `catch`: background → silent (`return`/swallow with a `console.warn`); manual → existing error toast.
- Add `background` + `prune` to the `pull` `useCallback` deps (satisfy exhaustive-deps; no `obj.member` in the array).
- Return shape unchanged (the runner calls `pull`).
- [ ] Tests (extend the existing suite; keep manual cases green): (a) background apply auto-applies + writes baseline,
  NO `setResult`; (b) background with a conflict fires the `calendarPullConflictsPending` toast and does NOT setResult;
  (c) a DEFINITIVE deletion prunes — `setItems` clears `outlookEventId` AND `removeBaselineEntry` is called — in BOTH
  background and manual; (d) manual still `setResult`s the plan (modal path) and prunes.
- [ ] Verify: `npx tsc --noEmit` (i18n EN/DE parity); `npm run test:run -- use-entity-calendar-pull.test.tsx`; `npm run lint`.
- [ ] Commit `feat(calendar): background auto-pull mode + deletion prune on the generic pull hook (two-way SP5)`.

---

### Task 3: Milestone manual hook — deletion prune loop

**Files:** `src/app/use-milestone-calendar-pull.ts`, `src/app/use-milestone-calendar-pull.test.tsx`.

Milestone is NOT in the `.auto` system (no auto-pull), but its MANUAL pull should also stop phantom deletion rows.
Add a prune loop mirroring T2 (no background mode). Import `removeBaselineEntry`. After the applies loop + self-heal,
before the `hasRows` surface:
```ts
for (const d of plan.deletions) {
  setMilestones((prev) => prev.map((m) => (m.id === d.id ? { ...m, outlookEventId: undefined } : m)));
  removeBaselineEntry(projectId, "milestone", d.eventId);
}
```
The modal still lists deletions (informational). Manual milestone pull is unchanged otherwise.
- [ ] Test: a manual milestone pull with a definitive deletion clears the milestone's `outlookEventId` + calls
  `removeBaselineEntry`, and still opens the modal.
- [ ] Verify: `npx tsc --noEmit`; `npm run test:run -- use-milestone-calendar-pull.test.tsx`; `npm run lint`.
- [ ] Commit `feat(calendar): prune stale event link on milestone manual pull deletions (two-way SP5)`.

---

### Task 4: Auto-pull runner + task-manager wiring (task/raid/change/absence)

**Files:** create `src/app/use-calendar-auto-pull.ts` + `src/app/use-calendar-auto-pull.test.tsx`; modify
`src/app/task-manager.tsx`.

**`use-calendar-auto-pull.ts`** — a time-triggered runner mirroring `use-scheduled-job-runner.ts`'s ref-stable pattern
(NOT the content-key `useCalendarAutoSync`): runs on mount, on tab re-focus (`visibilitychange`→visible), and every
`AUTO_PULL_INTERVAL_MS` (15 min). Overlap-guarded. Each pull SELF-gates (its hook early-returns when `!enabled`), so the
runner just calls them all.
```ts
export function useCalendarAutoPull({ enabled, pulls }: {
  enabled: boolean;                    // m365 && !isPopout (mount gate)
  pulls: readonly (() => Promise<void>)[]; // per-entity background pulls (each self-gates on its .auto)
}): void
```
- Mirror the scheduled-job-runner exactly: `enabledRef`/`pullsRef` refs updated in `useEffect([arg])`; an
  `isRunningRef` overlap guard; the subscribe effect has `[]` deps (listener/interval attach ONCE); `tick` reads refs,
  early-returns on `!enabledRef.current` or `isRunningRef.current`, then `for (const p of pullsRef.current) await p()`
  SERIALLY inside try/finally. Fire `void tick()` on mount + on visible + on interval. `AUTO_PULL_INTERVAL_MS = 15*60*1000`.
  NO render-phase setState (respects the banned react-hooks rule — it owns no state).

**`task-manager.tsx`** — for EACH of task/raid/change/absence, add a BACKGROUND generic pull instance (reusing the
EXISTING pushable list + `setXForCalendar`/`setTasksForAuto` setter + `toGraphEvent` + `<entity>AutoSyncActive` flag
already computed for auto-PUSH), then mount ONE runner. Example (task; the pushable list `pushableTasks`,
`setTasksForAuto`, `taskAutoSyncActive` already exist ~1782-1809):
```ts
const { pull: autoPullTasks } = useEntityCalendarPull<Task>({
  items: pushableTasks, entityType: "task", projectId: calendarProjectId,
  getDate: (x) => x.dueDate, withDate: (x, date) => ({ ...x, dueDate: date }),
  toGraphEvent: taskToGraphEvent, setItems: setTasksForAuto,
  isPullable: (x) => !x.jiraKey,   // same Jira exclusion as the manual task pull
  isPopout, lang, enabled: taskAutoSyncActive, background: true,
});
```
Mirror for raid (`pushableRaid`/`setRaidForCalendar`/`raidToGraphEvent`/`getDate: r=>r.targetDate`/`raidAutoSyncActive`),
change (`pushableChanges`/`setChangeForCalendar`/`changeToGraphEvent`/`c=>c.decisionDate`/`changeAutoSyncActive`), and
absence (`pushableAbsences`/`setAbsenceForCalendar`/`absenceToGraphEvent`/`getDate: a=>a.startDate`, `getEndDate: a=>a.endDate`,
`withDate: (a,s,e)=>({...a,startDate:s,endDate:e ?? a.endDate})`/`absenceAutoSyncActive`, `background: true`). Then:
```ts
useCalendarAutoPull({
  enabled: m365Enabled && !isPopout,
  pulls: [autoPullTasks, autoPullRaid, autoPullChange, autoPullAbsence],
});
```
★ Each `<entity>AutoSyncActive` (= `sync.auto && m365Enabled && !isPopout`) already exists for auto-PUSH — REUSE it as
the pull hook's `enabled`. No new settings, no workspaceProps changes, no pane changes (auto-pull is invisible/background).
★ The `pulls` array literal is fine as a hook arg (the runner refs it); to satisfy exhaustive-deps in the runner it is
read via a ref, so an inline array does not re-subscribe.

- [ ] Tests: `use-calendar-auto-pull.test.tsx` — with `enabled:true`, on mount each pull in `pulls` is called once;
  `enabled:false` → none called; a `visibilitychange`→visible re-invokes; the overlap guard prevents a concurrent
  second tick (a still-pending pull blocks the next tick). Use fake timers for the interval + a manual
  `document.dispatchEvent(new Event("visibilitychange"))`. (task-manager wiring is integration-covered by tsc + the
  existing task-manager test suite; no new task-manager test required.)
- [ ] Verify: `npx tsc --noEmit`; `npm run test:run -- use-calendar-auto-pull.test.tsx`; `npm run lint`. Auto-pull is
  background-only (no UI) → no axe impact.
- [ ] Commit `feat(calendar): opt-in background auto-pull runner for task/raid/change/absence (two-way SP5)`.

---

### Task 5: Release 0.164.0

- [ ] `version.ts`: `APP_VERSION="0.164.0"`, `APP_BUILD_DATE`, `APP_MILESTONE` (fresh UNUSED sci-fi/fantasy author —
  grep-verify against CHANGELOG), append `"versionHighlightCalendarAutoPull"` to `APP_HIGHLIGHT_KEYS`.
- [ ] `package.json` → 0.164.0.
- [ ] i18n `versionHighlightCalendarAutoPull` EN `"Optional background auto-pull of Outlook reschedules"` / DE (node
  write) `"Optionales automatisches Zurückspielen von Outlook-Terminverschiebungen"` (real ü in `Zurückspielen`; verify bytes).
- [ ] `CHANGELOG.md` `## [0.164.0]` entry: opt-in bidirectional auto-sync (the `.auto` flag now also auto-pulls
  task/raid/change/absence, 15-min background poll, silent apply + conflict-count toast, modal only on manual);
  deletion-semantics (definitive deletions prune the stale link + baseline; note the re-create-on-push limitation);
  ROADMAP COMPLETE.
- [ ] `AGENTS.md`: extend the two-way section — SP5 auto-pull (bidirectional `.auto`, 15-min runner
  `use-calendar-auto-pull.ts` mirroring the scheduled-job runner, task/raid/change/absence only, milestone manual-only),
  deletion-semantics (definitive-only prune + the re-create limitation). Mark the two-way roadmap COMPLETE.
- [ ] Memory — update `calendar-twoway-roadmap.md` (SP5 done, roadmap COMPLETE) + `MEMORY.md` pointer.
- [ ] `npx tsc --noEmit`, `npm run test:run` (full), `npm run lint`; commit
  `chore(release): 0.164.0 "<Codename>" — auto-pull + deletion-semantics (two-way SP5)`.
- [ ] Full release chain ONLY on the "release" trigger.

---

## Self-review
- Reuses SP1–SP4 engine/hook/baseline/modal; the only shared-engine change is the definitive-deletion split (T1).
- Background mode is additive to the generic hook (default false → manual behavior unchanged); milestone gets only the
  prune loop (no auto), keeping its shipped manual pull intact.
- Auto-pull reuses every existing pushable-list/setter/toGraphEvent/`.auto`-active flag — zero new settings, UI, props,
  or persisted fields; runner mirrors the proven scheduled-job-runner pattern (ref-stable, overlap-guarded, no set-state-in-effect).
- Deletion prune is definitive-only (fixes SP4-review minor #1); the re-create-on-push interaction is documented, not silently shipped.
- Only new i18n keys: one conflict-count toast + one release highlight (EN/DE). No golden fixtures.
