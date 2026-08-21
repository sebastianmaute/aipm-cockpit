# Two-way calendar sync SP3 — RAID + Change pull — Implementation Plan

> Sibling of SP1 (milestones) / SP2 (tasks). Reuses the generic hook `use-entity-calendar-pull.ts`, the
> `entityType`-aware `fetchProjectEventDates`, pure `calendar-pull.ts`, `calendar-sync-baseline.ts`, and the
> shared `calendar-pull-summary-modal.tsx` — ALL unchanged.

**Goal:** Add manual "Pull from Outlook" to the RAID and Change panes: apply Outlook date reschedules onto
RAID `targetDate` and Change `decisionDate`, with the same app-wins conflict + deletion + convergence
semantics. RAID + Change only. Manual buttons (auto-pull is SP5).

**Key facts (thin panes — UNLIKE tasks):** RAID (`RaidPanel`) and the Change pane are THIN callback-prop panes;
ALL calendar logic lives in `task-manager.tsx` and threads through `workspace-section-types.ts` →
`workspace-section.tsx` → the pane (mirrors the write-back RAID/Change push wiring). So SP3 = 2 pull hooks in
task-manager + 2 summary modals in `modalsBlock` + 4 new props threaded + a pull button in each pane.

Existing anchors (task-manager.tsx):
- RAID (~1816-1849): `pushableRaid` (`isRaidActiveForReview` && `targetDate`), `setRaidForCalendar` bridge,
  `raidToGraphEvent`, `calendarRaidEnabled`, push hook `pushRaidToOutlook`/`calendarRaidPushBusy`.
- Change (~1851-1885): `pushableChanges` (`!!decisionDate`), `setChangeForCalendar`, `changeToGraphEvent`,
  `calendarChangeEnabled`, push hook `pushChangeToOutlook`/`calendarChangePushBusy`.
- The milestone pull's summary-modal render + `useMilestoneCalendarPull` instantiation are the pattern to mirror
  (grep `CalendarPullSummaryModal` / `useMilestoneCalendarPull` in task-manager).

Pane anchors: `raid-panel.tsx` props `calendarEnabled`/`onPushCalendar`/`calendarPushBusy` (~133-136), push
button gated `calendarEnabled && onPushCalendar` (~530-541). The Change pane is a SEPARATE file (find it:
grep `onPushCalendar` across `src/app` — the non-raid pane file, likely `changes-panel.tsx`) with the same
prop shape. `workspace-section.tsx` passes to `<RaidPanel>` (~543-546) and the Change pane (~696-699):
`calendarEnabled` / `onPushCalendar` / `calendarPushBusy` from the `calendarRaidEnabled`/`pushRaidToOutlook`/
`calendarRaidPushBusy` (and change equivalents) props.

**No new i18n keys** (reuse `calendarPull`/`calendarPulling` + the `calendarPull*` summary keys). No new
persisted field (`RaidItem.outlookEventId`/`ChangeItem.outlookEventId` exist). No golden fixtures.

**Execution order:** T1 (all RAID+Change wiring — symmetric, shared files) → T2 (release).

---

### Task 1: Wire RAID + Change Pull-from-Outlook (task-manager → panes)

**Files:** `task-manager.tsx`, `workspace-section-types.ts`, `workspace-section.tsx`, `raid-panel.tsx`, the
Change pane file, + their pane tests (`raid-panel.test.tsx`, the change pane test).

- [ ] Step 1 — task-manager: import `useEntityCalendarPull` (`./use-entity-calendar-pull`) — already imported?
  and `CalendarPullSummaryModal` (already imported for milestones). After the RAID push block (~1839), add:
```ts
const raidPull = useEntityCalendarPull<RaidItem>({
  items: pushableRaid, entityType: "raid", projectId: calendarProjectId,
  getDate: (r) => r.targetDate, withDate: (r, date) => ({ ...r, targetDate: date }),
  toGraphEvent: raidToGraphEvent, setItems: setRaidForCalendar,
  isPopout, lang, enabled: calendarRaidEnabled,
});
```
  After the Change push block (~1875), add the mirror:
```ts
const changePull = useEntityCalendarPull<ChangeItem>({
  items: pushableChanges, entityType: "change", projectId: calendarProjectId,
  getDate: (c) => c.decisionDate, withDate: (c, date) => ({ ...c, decisionDate: date }),
  toGraphEvent: changeToGraphEvent, setItems: setChangeForCalendar,
  isPopout, lang, enabled: calendarChangeEnabled,
});
```
  (Confirm `RaidItem.targetDate` / `ChangeItem.decisionDate` field names in `types.ts`.)

- [ ] Step 2 — task-manager `workspaceProps`: add (mirroring the milestone `onPullMilestonesFromOutlook`):
```ts
pullRaidFromOutlook: calendarRaidEnabled ? raidPull.pull : undefined,
calendarRaidPullBusy: calendarRaidEnabled ? raidPull.busy : undefined,
pullChangeFromOutlook: calendarChangeEnabled ? changePull.pull : undefined,
calendarChangePullBusy: calendarChangeEnabled ? changePull.busy : undefined,
```

- [ ] Step 3 — task-manager: render TWO more `CalendarPullSummaryModal`s in the shared `modalsBlock` (next to the
  milestone one), each gated on its hook's `result`, `nameOf` resolving RAID `title` / Change `title`:
```tsx
{raidPull.result && (() => {
  const plan = raidPull.result.plan;
  const nameOf = (id: number) => pushableRaid.find((x) => x.id === id)?.title ?? String(id);
  return (<CalendarPullSummaryModal lang={lang} open onClose={raidPull.clearResult}
    applied={plan.applies.map((a) => ({ id: a.id, name: nameOf(a.id), newDate: a.newDate }))}
    conflicts={plan.conflicts.map((c) => ({ id: c.id, eventId: c.eventId, name: nameOf(c.id), appDate: c.appDate, outlookDate: c.outlookDate }))}
    deletions={plan.deletions.map((d) => ({ id: d.id, name: nameOf(d.id) }))}
    onKeepApp={raidPull.keepApp} onTakeOutlook={(c) => raidPull.applyMove(c.id, c.eventId, c.outlookDate)} />);
})()}
```
  + the Change mirror (`changePull`, `pushableChanges`, `title`). (Confirm RAID/Change display-name field — likely
  `title`; adapt if `name`.)

- [ ] Step 4 — `workspace-section-types.ts`: add to `WorkspaceSectionProps`:
```ts
pullRaidFromOutlook?: () => void; calendarRaidPullBusy?: boolean;
pullChangeFromOutlook?: () => void; calendarChangePullBusy?: boolean;
```

- [ ] Step 5 — `workspace-section.tsx`: destructure the 4 new props; pass to `<RaidPanel>` (~543):
  `onPullCalendar={pullRaidFromOutlook}` + `calendarPullBusy={calendarRaidPullBusy}`; and to the Change pane (~696):
  `onPullCalendar={pullChangeFromOutlook}` + `calendarPullBusy={calendarChangePullBusy}`.

- [ ] Step 6 — `raid-panel.tsx` + the Change pane: add props `onPullCalendar?: () => void;` + `calendarPullBusy?: boolean;`
  to the pane's Props interface + destructure; render a pull button DIRECTLY AFTER the push button (inside the same
  `calendarEnabled && ...` block), gated `onPullCalendar`, neutral secondary style (mirror the milestone pull button):
```tsx
{onPullCalendar && (
  <button type="button" onClick={onPullCalendar} disabled={calendarPullBusy}
    aria-label={t(lang, "calendarPull")} title={t(lang, "calendarPull")}
    className={`rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}>
    {calendarPullBusy ? t(lang, "calendarPulling") : t(lang, "calendarPull")}
  </button>
)}
```
  (Match each pane's existing push-button gating exactly — RAID's is `calendarEnabled && onPushCalendar`.)

- [ ] Step 7 — tests: `raid-panel.test.tsx` + the change pane test — pull button renders when `calendarEnabled` +
  `onPullCalendar`, absent otherwise, click fires the handler. Mirror the existing push-button test.

- [ ] Step 8 — verify: `npx tsc --noEmit`; `npm run test:run -- raid-panel.test.tsx <change-pane>.test.tsx`;
  `npm run lint`; RAID axe gate `npx playwright test e2e/a11y.spec.ts --project=chromium -g "RAID"` (RAID IS
  axe-scanned; the Change pane is NOT — eye-verify its button has a label, which it does). All PASS.

- [ ] Step 9 — commit `feat(calendar): wire RAID + Change Pull-from-Outlook + summary modals (two-way SP3)`.

---

### Task 2: Release 0.162.0

- [ ] `version.ts`: `APP_VERSION="0.162.0"`, `APP_BUILD_DATE`, unused codename (grep-verify), `APP_MILESTONE`,
  append `"versionHighlightCalendarPullRaidChange"` to `APP_HIGHLIGHT_KEYS`.
- [ ] `package.json` → 0.162.0.
- [ ] i18n `versionHighlightCalendarPullRaidChange` EN "Outlook date reschedules pull back into RAID + changes" /
  DE (node write) "Outlook-Terminverschiebungen werden in RAID + Aenderungen zurueckgespielt" — use REAL umlauts
  (Änderungen with Ä, zurückgespielt with ü) via the node utf8 write; verify bytes.
- [ ] `CHANGELOG.md` `## [0.162.0]` entry (RAID+Change two-way pull, SP3).
- [ ] `AGENTS.md`: extend the two-way section — SP3 RAID (`targetDate`) + Change (`decisionDate`) pull, thin-pane
  threading via task-manager, reuse generic hook.
- [ ] Memory — update `calendar-twoway-roadmap.md` + `MEMORY.md`.
- [ ] `npx tsc --noEmit`, `npm run test:run` (full), `npm run lint`; commit `chore(release): 0.162.0 "<Codename>" — RAID + Change two-way calendar pull (SP3)`.
- [ ] Full release chain only on the "release" trigger.

---

## Self-review
- Reuses SP1/SP2 engine/baseline/hook/modal unchanged; only new wiring + 4 threaded props.
- Symmetric RAID/Change wiring in one task (shared files) avoids double-editing task-manager/workspace-section.
- RAID date=`targetDate`, Change date=`decisionDate`; both use the shared generic hook with the keep-app convergence fix.
- RAID axe-scanned (run gate); Change eye-verified.
- No persisted field, no new i18n keys (except release highlight), no golden fixtures.
