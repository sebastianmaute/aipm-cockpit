# Two-way calendar sync SP4 — Absence pull (multi-day range) — Implementation Plan

> Sibling of SP1 (milestones) / SP2 (tasks) / SP3 (RAID+Change). Absence is the FINAL entity and the ONLY
> multi-day one: it spans `startDate..endDate`, pushed as a single all-day Graph event `start=startDate`,
> `end=nextDay(endDate)` (Graph all-day end is EXCLUSIVE). Pull must reconcile BOTH ends.

**Design decision (user-chosen): FAITHFUL start+end.** An Outlook move OR resize is reflected — the pull reads
the event's start AND end and maps both back (`start=eventStart`, `end=eventEnd−1day` inclusive). This requires
extending the SHARED single-date engine/read-helper/modal used by 4 shipped entities (milestone/task/RAID/change).

**★★ HARD INVARIANT — single-date entities must stay byte-identical.** Every new end-date field is OPTIONAL and
only populated for absences. When an entity provides NO end (`endDate === undefined`), the engine, hook, baseline
serialization, and modal behave EXACTLY as today (baseline value `"D"`, no `newEndDate`/`appEndDate` keys). The
engine/read/hook/modal tests MUST include an explicit "single-date path unchanged" assertion.

**Anchor facts:**
- `Absence` fields: `startDate`, `endDate` (both inclusive YYYY-MM-DD), `type`, `assignee`, `note`, `outlookEventId?`.
- `pushableAbsences` (task-manager ~1918): `type !== "sick" && startDate && endDate && endDate >= today`.
- `absenceToGraphEvent(absence, projectId)` already builds `start=startDate`, `end=nextDay(endDate)`,
  `categories=[AIPM:<pid>:absence, absence.type]`, `showAs` — used unchanged for the keep-app convergence push.
- Absence is a THIN pane (Resources / `resources-panel.tsx`) → ALL pull logic lives in `task-manager.tsx` and
  threads `workspace-section-types → workspace-section → resources-panel` (mirrors RAID/Change SP3 exactly).
- No new persisted field (`Absence.outlookEventId` exists from write-back SP4). Baseline is per-device localStorage.
  No six-write-path / golden-fixture / sample changes. No new summary i18n keys (reuse `calendarPull*`).

**Execution order:** T1 (shared engine + read helper) → T2 (generic hook + summary modal) → T3 (absence wiring) → T4 (release).

---

### Task 1: Extend the pure engine + read helper for an OPTIONAL event end date

**Files:** `src/app/calendar-pull.ts`, `src/app/outlook-calendar-read.ts`, `src/app/calendar-pull.test.ts`,
`src/app/outlook-calendar-read.test.ts`. Baseline module (`calendar-sync-baseline.ts`) is UNCHANGED (it stores an
opaque string; the hook passes `"D"` for single-date or `"D1|D2"` for a range — see T2).

**`calendar-pull.ts` (additive):**
- `PulledEvent` gains `endDate: string | null` (INCLUSIVE end = exclusive-end − 1 day; null if missing/malformed).
- `PullEntity` gains `endDate?: string` (present only for range entities).
- `PullPlan.applies[]` gains `newEndDate?: string`; `PullPlan.conflicts[]` gains `appEndDate?: string` +
  `outlookEndDate?: string`. `deletions` unchanged.
- Engine loop per entity (replace the in-sync/apply/conflict block):
```ts
const hasEnd = ent.endDate !== undefined;
if (!ev || ev.isCancelled || ev.date === null || (hasEnd && ev.endDate === null)) {
  plan.deletions.push({ id: ent.id, eventId });
  continue;
}
const startMatch = ev.date === ent.date;
const endMatch = !hasEnd || ev.endDate === ent.endDate;
if (startMatch && endMatch) continue; // in sync
const entKey = hasEnd ? `${ent.date}|${ent.endDate}` : ent.date;
if (baseline[eventId] === entKey) {
  plan.applies.push({ id: ent.id, eventId, newDate: ev.date, ...(hasEnd ? { newEndDate: ev.endDate! } : {}) });
} else {
  plan.conflicts.push({
    id: ent.id, eventId, appDate: ent.date, outlookDate: ev.date,
    ...(hasEnd ? { appEndDate: ent.endDate, outlookEndDate: ev.endDate! } : {}),
  });
}
```
  ★ Single-date entity (`hasEnd===false`): `entKey===ent.date` (baseline byte-identical), and the spread adds NO
  keys → applies/conflicts objects are byte-identical to today. Preserve this in a test.

**`outlook-calendar-read.ts` (additive):**
- `$select=id,start,end,isCancelled` (add `end`). `RawEvent` gains `end: { dateTime?: string } | null`.
- Add a pure `prevDay(iso: string): string` (UTC −1 day, mirror the write side's `nextDay`), and a
  `toEndDate(raw): string | null` (parse `end.dateTime` slice(0,10); valid → `prevDay(it)` to convert Graph's
  EXCLUSIVE all-day end back to INCLUSIVE; else null).
- Push `{ id, date: toDate(e), endDate: toEndDate(e), isCancelled }`.
  ★ Single-date callers ignore `PulledEvent.endDate` (the engine only reads it when the entity has `endDate`), so
  milestone/task/RAID/change behavior is unchanged — assert an existing case still returns the same start date.

**Tests:**
- `calendar-pull.test.ts` — ADD: (a) single-date path unchanged (existing cases still produce apply/conflict/
  deletion with NO `newEndDate`/`appEndDate` keys); (b) absence in-sync when both dates match; (c) start-only move
  with matching baseline → apply carries `newEndDate`; (d) end-only resize with matching baseline → apply; (e)
  both changed with MISMATCHED baseline → conflict carries `appEndDate`+`outlookEndDate`; (f) `ev.endDate===null`
  on a range entity → deletion. Baseline strings for range cases are `"start|end"`.
- `outlook-calendar-read.test.ts` — ADD: an event with `end.dateTime` a day AFTER its start yields
  `endDate === start` (exclusive→inclusive); `$select` now includes `end`. Existing bare/type-scoped cases still pass.
- [ ] Verify: `npx tsc --noEmit`; `npm run test:run -- calendar-pull.test.ts outlook-calendar-read.test.ts`; `npm run lint`.
- [ ] Commit `feat(calendar): engine + read helper carry an optional event end date (two-way SP4)`.

---

### Task 2: Generic hook end support + summary modal optional range

**Files:** `src/app/use-entity-calendar-pull.ts`, `src/app/calendar-pull-summary-modal.tsx`,
`src/app/use-entity-calendar-pull.test.tsx`, `src/app/calendar-pull-summary-modal.test.tsx` (if present; else add).

**`use-entity-calendar-pull.ts` (additive — single-date callers pass none of the new bits):**
- `Args<T>` gains `getEndDate?: (item: T) => string | undefined;`. Widen `withDate` to
  `(item: T, date: string, endDate?: string) => T` (existing single-date closures ignore the 3rd arg).
- Build entities: `{ id: i.id, date: getDate(i) ?? "", endDate: getEndDate?.(i), outlookEventId: i.outlookEventId }`
  then `.filter((e) => e.date)`.
- `applyMove(id, eventId, newDate, newEndDate?)`:
  `setItems(prev => prev.map(i => i.id===id ? withDate(i, newDate, newEndDate) : i))` and
  `writeBaselineDate(projectId, entityType, eventId, newEndDate !== undefined ? `${newDate}|${newEndDate}` : newDate)`.
- applies loop: `applyMove(a.id, a.eventId, a.newDate, a.newEndDate)`.
- `keepApp` arg gains `appEndDate?: string`: converge pushes `toGraphEvent(item, projectId)` (the item already
  carries the kept app start+end) then `writeBaselineDate(..., appEndDate !== undefined ? `${c.appDate}|${appEndDate}` : c.appDate)`;
  on `updateEvent` failure do NOT write baseline (unchanged rule).
- self-heal: `const end = getEndDate?.(i); const inSync = ev && d && ev.date === d && (end === undefined || ev.endDate === end);`
  and `const entKey = end !== undefined ? `${d}|${end}` : d;` → write baseline `entKey` when `inSync && baseline[id] !== entKey`.
- Return shape UNCHANGED (`{ pull, busy, result, clearResult, keepApp, applyMove }`). ★ Hoist any `obj.member` out of
  dep arrays (`getEndDate` is a stable prop → include it in the relevant `useCallback` deps).

**`calendar-pull-summary-modal.tsx` (additive):**
- `AppliedRow` gains `newEndDate?: string`; `ConflictRow` gains `appEndDate?: string` + `outlookEndDate?: string`.
- Render a range only when the end is present: applied `{a.name} → {a.newDate}{a.newEndDate ? ` – ${a.newEndDate}` : ""}`;
  conflict `{c.appDate}{c.appEndDate ? ` – ${c.appEndDate}` : ""}` and likewise the Outlook side.
- `onKeepApp` arg gains `appEndDate?: string`; `onTakeOutlook` arg gains `outlookEndDate?: string`; pass them from the
  row (`appEndDate: c.appEndDate`, `outlookEndDate: c.outlookEndDate`). Single-date callers pass rows without the end
  keys → identical render + callbacks.

**Tests:**
- `use-entity-calendar-pull.test.tsx` — ADD a range case: an apply with `getEndDate`+`newEndDate` sets BOTH item
  dates via `withDate` and writes baseline `"start|end"`; keepApp with `appEndDate` writes `"start|end"`. Keep the
  existing single-date cases (they must still pass untouched — no `getEndDate`).
- modal test (add if none): a row WITH `newEndDate` renders `start – end`; a row WITHOUT renders just `start`;
  `onTakeOutlook` receives `outlookEndDate` when present.
- [ ] Verify: `npx tsc --noEmit`; `npm run test:run -- use-entity-calendar-pull.test.tsx calendar-pull-summary-modal.test.tsx`; `npm run lint`.
- [ ] Commit `feat(calendar): generic pull hook + summary modal support an optional date range (two-way SP4)`.

---

### Task 3: Wire absence Pull-from-Outlook (task-manager → resources pane)

**Files:** `task-manager.tsx`, `workspace-section-types.ts`, `workspace-section.tsx`, `resources-panel.tsx`,
`resources-panel.test.tsx`.

- [ ] Step 1 — task-manager: after the absence PUSH block (~1942, before the `workspaceProps`), add the pull hook
  (mirrors `changePull`, +`getEndDate`/range `withDate`):
```ts
// Manual "Pull from Outlook" for Absence (two-way SP4) — the only multi-day entity (start+end).
const absencePull = useEntityCalendarPull<Absence>({
  items: pushableAbsences,
  entityType: "absence",
  projectId: calendarProjectId,
  getDate: (a) => a.startDate,
  getEndDate: (a) => a.endDate,
  withDate: (a, start, end) => ({ ...a, startDate: start, endDate: end ?? a.endDate }),
  toGraphEvent: absenceToGraphEvent,
  setItems: setAbsenceForCalendar,
  isPopout,
  lang,
  enabled: calendarAbsenceEnabled,
});
```
- [ ] Step 2 — task-manager `workspaceProps` (beside `pushAbsenceToOutlook`/`calendarAbsencePushBusy`, ~1990):
```ts
pullAbsenceFromOutlook: calendarAbsenceEnabled ? absencePull.pull : undefined,
calendarAbsencePullBusy: calendarAbsenceEnabled ? absencePull.busy : undefined,
```
- [ ] Step 3 — task-manager `modalsBlock`: add a 4th `CalendarPullSummaryModal` (after the change one, ~2448),
  passing the range fields. Absence has NO title → display name = `${a.assignee} (${a.type})`:
```tsx
{(() => {
  const plan = absencePull.result?.plan;
  if (!plan) return null;
  const rec = (id: number) => pushableAbsences.find((x) => x.id === id);
  const nameOf = (id: number) => { const a = rec(id); return a ? `${a.assignee} (${a.type})` : String(id); };
  return (
    <CalendarPullSummaryModal
      lang={lang}
      open={!!absencePull.result}
      onClose={absencePull.clearResult}
      applied={plan.applies.map((a) => ({ id: a.id, name: nameOf(a.id), newDate: a.newDate, newEndDate: a.newEndDate }))}
      conflicts={plan.conflicts.map((c) => ({ id: c.id, eventId: c.eventId, name: nameOf(c.id), appDate: c.appDate, outlookDate: c.outlookDate, appEndDate: c.appEndDate, outlookEndDate: c.outlookEndDate }))}
      deletions={plan.deletions.map((d) => ({ id: d.id, name: nameOf(d.id) }))}
      onKeepApp={absencePull.keepApp}
      onTakeOutlook={(c) => absencePull.applyMove(c.id, c.eventId, c.outlookDate, c.outlookEndDate)}
    />
  );
})()}
```
  (`onKeepApp` receives `{id,eventId,appDate,appEndDate}` from the modal → hook converges + writes `"start|end"`.)
- [ ] Step 4 — `workspace-section-types.ts`: add to `WorkspaceSectionProps`:
```ts
pullAbsenceFromOutlook?: () => void;
calendarAbsencePullBusy?: boolean;
```
- [ ] Step 5 — `workspace-section.tsx`: destructure the 2 new props; pass to the resources pane (~634, beside the
  absence push props): `onPullCalendar={pullAbsenceFromOutlook}` + `calendarPullBusy={calendarAbsencePullBusy}`.
- [ ] Step 6 — `resources-panel.tsx`: add props `onPullCalendar?: () => void;` + `calendarPullBusy?: boolean;` to the
  Props interface + destructure; render a pull button DIRECTLY AFTER the push button (inside the same
  `calendarEnabled && ...` block), gated `onPullCalendar`, neutral secondary style (border-line, mirrors RAID/Change):
```tsx
{onPullCalendar && (
  <button
    type="button"
    onClick={onPullCalendar}
    disabled={calendarPullBusy}
    aria-label={t(lang, "calendarPull")}
    title={t(lang, "calendarPull")}
    className={`rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
  >
    {calendarPullBusy ? t(lang, "calendarPulling") : t(lang, "calendarPull")}
  </button>
)}
```
- [ ] Step 7 — `resources-panel.test.tsx`: pull button renders when `calendarEnabled` + `onPullCalendar` + m365, absent
  otherwise, click fires the handler. Mirror the existing push-button test.
- [ ] Step 8 — verify: `npx tsc --noEmit`; `npm run test:run -- resources-panel.test.tsx`; `npm run lint`; the Resources
  axe gate `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Resources"` (Resources IS axe-scanned; the pull
  button carries `aria-label`). All PASS.
- [ ] Step 9 — commit `feat(calendar): wire absence Pull-from-Outlook + summary modal (two-way SP4)`.

---

### Task 4: Release 0.163.0

- [ ] `version.ts`: `APP_VERSION="0.163.0"`, `APP_BUILD_DATE`, `APP_MILESTONE`, a fresh UNUSED sci-fi-author codename
  (grep-verify against CHANGELOG + prior milestones — e.g. "Chiang"), append `"versionHighlightCalendarPullAbsence"` to
  `APP_HIGHLIGHT_KEYS`.
- [ ] `package.json` → 0.163.0.
- [ ] i18n `versionHighlightCalendarPullAbsence` EN "Outlook date reschedules pull back into absences" / DE (node utf8
  write, REAL umlauts) "Outlook-Terminverschiebungen werden in Abwesenheiten zurückgespielt" — `zurückgespielt` with ü;
  verify bytes (i18n-encoding test bans ASCII subs).
- [ ] `CHANGELOG.md` `## [0.163.0]` entry (absence two-way pull, SP4; faithful start+end range; ROADMAP pull SP1–SP4 done).
- [ ] `AGENTS.md`: extend the two-way section — SP4 absence (`startDate`+`endDate` RANGE, faithful start+end via optional
  engine/read/hook/modal end fields; single-date entities byte-identical; thin-pane threading via task-manager; Resources
  axe-scanned). Note SP5 (auto-pull + deletion-semantics) is the only remaining slice.
- [ ] Memory — update `calendar-twoway-roadmap.md` (SP4 done, faithful-range design + the byte-identical invariant) +
  `MEMORY.md` pointer.
- [ ] `npx tsc --noEmit`, `npm run test:run` (full), `npm run lint`; commit
  `chore(release): 0.163.0 "<Codename>" — absence two-way calendar pull (SP4)`.
- [ ] Full release chain ONLY on the "release" trigger.

---

## Self-review
- Faithful start+end (user-chosen richer option): pull reflects an Outlook move AND a resize.
- Every end-date field is OPTIONAL → single-date entities (milestone/task/RAID/change) stay byte-identical; the
  engine/read/hook/modal tests each assert the unchanged path. Baseline module is untouched (opaque string; `"D"` vs `"D1|D2"`).
- Absence = thin pane → all logic in task-manager, threaded through workspace-section(-types) to resources-panel (mirrors SP3).
- No persisted field, no new summary i18n keys, no golden fixtures.
- RAID/Change SP3 conflict + convergence semantics inherited unchanged; keep-app pushes the app's start+end back to Outlook.
