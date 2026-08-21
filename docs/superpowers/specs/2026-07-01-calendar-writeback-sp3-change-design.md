# Calendar write-back SP3 — Change decision dates → Outlook

**Date:** 2026-07-01
**Status:** Approved
**Roadmap:** Calendar write-back engine — SP3 of 4 (SP1 tasks ✓, SP2 RAID ✓, SP3 changes, SP4 resource absences).

## Goal

Push change-control decisions to the shared Outlook calendar as all-day events on
their `decisionDate`, reusing the generic calendar write-back engine
(`planEntityReconcile` / `useEntityCalendarPush` / `useCalendarAutoSync`). Manual
"Push to Outlook" + opt-in silent auto-sync, toggled per entity in the Changes pane
and centrally in Settings → Integrations.

## Date-source decision (settled)

`ChangeItem` has two date fields:
- `raisedDate` (required) — when the change was raised.
- `decisionDate?` — set by `applyChangeStatus` the first time status leaves the
  pending set; **cleared** if it returns to pending. So a `decisionDate` exists
  **only on decided** changes (Approved/Rejected/Implemented/Deferred) and marks
  when the decision was made (a past date). There is **no** forward-looking
  "decide-by" target field.

**Chosen anchor: `decisionDate`.** Pushable = changes with a `decisionDate`. The
event is a governance **audit marker** ("CR-5 decided 2026-06-09"), not a future
reminder. This matches the field + roadmap name honestly; a manual push right after
deciding yields a timely calendar marker. Every decision counts — including
Rejected/Deferred (a rejection is a governance decision worth recording).

This differs from SP1/SP2 (which push active items on a future actionable date) —
accepted, because the Change data model carries no decide-by date.

## Architecture

The engine is generic and already serves task (SP1) + RAID (SP2). SP3 adds the
Change entity by mirroring the SP2 RAID slice exactly:

### 1. Persistence — `ChangeItem.outlookEventId?: string`

New optional field, across all six write paths (mirrors `RaidItem.outlookEventId`):
- `types.ts` — add field after `documentLinks`.
- `csv-codecs-core.ts` — append `"outlookEventId"` to `CHANGES_CSV_COLUMNS`
  (covers CSV **and** Turso single+tenant — DDL/insert derive from it; the generic
  `changeFieldToString` default arm `String(r[c] ?? "")` already encodes it).
- `markdown-codecs-core.ts` — append `{ key: "outlookEventId", label: "OutlookEventId" }`
  to `CHANGES_MD_COLUMNS`; add the decode arm
  `else if (norm === "outlookeventid") mapped["outlookEventId"] = val;` in the
  change table decoder (`markdown-codecs-core.ts` — the changes decoder lives there).
- `sanitize-records.ts` — `sanitizeChangeItem` preserves `outlookEventId`, capped 1024.
- JSON + IndexedDB — whole-object pass-through, no change needed.
- Golden fixtures (`__fixtures__/golden-workspace.{csv,md}`) + curated
  `sample-workspace-small.{csv,md}` — regenerate (one new trailing empty column).

### 2. Event builder — `changeToGraphEvent(c, projectId)`

In `outlook-calendar-write.ts`, after `raidToGraphEvent`:
- all-day on `c.decisionDate`, `end: nextDay(c.decisionDate!)`.
- `categories: [categoryFor(projectId, "change")]` — TYPE-SCOPED, so its list-based
  reconcile can't touch task/raid/milestone/committee events.
- body lines (filter Boolean, join "\n"): `Type: <type>`, `Impact: <impact>`,
  `Status: <status>`, `Decision by: <decisionBy>`, "Managed by the AIPM PM Tracker."
- subject = `c.title`.

### 3. Settings — no model change

`CalendarEntityType` already includes `"change"`; `CALENDAR_ENTITY_TYPES` and
`sanitizeOutlookCalendar` already loop it. Add a third `<CalendarSyncEntityRow
entityType="change" labelKey="calendarSyncEntityChange">` in
`integrations-section.tsx` after the RAID row.

### 4. Wiring — logic in task-manager (thin pane)

`change-panel.tsx` is a thin callback-prop pane (all mutations via props; parent owns
`changes`), so — like RAID SP2 — every calendar concern lives in `task-manager.tsx`
as a change block mirroring the RAID block:
- `changeSync = calendarSyncFor(settings, "change")`.
- `calendarChangeEnabled = changeSync.enabled && m365Enabled && !isPopout`.
- `changeAutoSyncActive = changeSync.auto && m365Enabled && !isPopout`.
- `pushableChanges = useMemo(() => changes.filter((c) => !!c.decisionDate), [changes])`.
- `changeAutoSyncKey` = `pushableChanges.map((c) => \`${c.id}|${c.decisionDate}|${c.title}|${c.status}\`).join(";")`
  — **excludes** `outlookEventId` (it's an OUTPUT the push writes back; including it
  would re-fire one redundant round).
- `setChangeForCalendar = useCallback((updater) => setChanges((prev) => updater([...prev])), [setChanges])`
  (`setChanges` is already destructured in task-manager).
- manual `useEntityCalendarPush<ChangeItem>` (`enabled: calendarChangeEnabled`) →
  `pushChangeToOutlook` + `calendarChangePushBusy`.
- silent-auto `useEntityCalendarPush<ChangeItem>` (`enabled: changeAutoSyncActive,
  interactive: false`) → `autoPushChange`; feed `useCalendarAutoSync`.
- `onToggleCalendarChange(enabled)` — `setSettings` spread, forcing `auto:false` when
  disabling (mirrors RAID).
- Thread into `workspaceProps`: `calendarChangeEnabled`, `onToggleCalendarChange`,
  `pushChangeToOutlook`, `calendarChangePushBusy` (`m365Configured` already threaded).

`workspace-section-types.ts` — 4 new optional props (`m365Configured` already present).
`workspace-section.tsx` — pass to `<ChangePanel>`, renamed at the boundary:
`m365Configured` / `calendarEnabled` / `onToggleCalendar` / `onPushCalendar` /
`calendarPushBusy`.

`change-panel.tsx` — add the 5 props to `ChangePanelProps` + body destructure; toolbar
renders the Enable checkbox (row-unique aria-label
`\`${t(lang,"calendarSyncEnable")} – ${t(lang,"calendarSyncEntityChange")}\``) + Push
button, inserted after `<PanelViewsControl view="changes" />`, byte-mirroring the RAID
toolbar block (checkbox className `h-3.5 w-3.5 rounded border-line text-AIPM-dark-blue
${FOCUS_RING} ${TRANSITION}`; button uses `${INTERACTIVE}`). `ChangePanel` wrapper
forwards via `{...props}`.

### 5. i18n — one new key

`calendarSyncEntityChange`: EN "Change decisions (decision dates)" / DE
"Änderungsentscheidungen (Entscheidungstermine)". DE patched via node utf8 write
(Edit corrupts umlauts + CRLF). Reuses `calendarSyncEnable` / `calendarPush` /
`calendarPushing`.

### 6. Release — 0.158.0 "Egan"

- `version.ts` — APP_VERSION "0.158.0", APP_MILESTONE "Egan" (Greg Egan), build-date
  comment; append `versionHighlightCalendarChange` to `APP_HIGHLIGHT_KEYS`.
- `package.json` version 0.158.0.
- `CHANGELOG.md` — new entry.
- i18n `versionHighlightCalendarChange` EN/DE.
- `AGENTS.md` — calendar section: mark SP3 done (v0.158+), SP4 (Resource absences)
  remains.

## Testing

- `sanitize-change.test` — `outlookEventId` preserved / capped 1024 / undefined-when-absent.
- `change-panel.test` — calendar toggle renders when m365Configured; hidden without;
  hidden in popout; `onToggleCalendar(true)` fired; Push button gated on enabled +
  fires `onPushCalendar`.
- storage round-trip test — `CHANGES_CSV_COLUMNS` includes `outlookEventId`;
  CSV/MD/KV round-trip preserves it.
- `outlook-calendar-write.test` — `changeToGraphEvent` shape (all-day on decisionDate,
  type-scoped category, body lines).

## Out of scope

- SP4 (Resource absences) — separate slice.
- Forward-looking "decide-by" reminders — no data field; not added here.
- Pushing pending (undecided) changes — they carry no anchor date.
