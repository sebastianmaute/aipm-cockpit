# Calendar write-back SP4 — Resource absences → Outlook

**Date:** 2026-07-01
**Roadmap:** Generic Outlook calendar write-back engine. SP1 tasks + SP2 RAID (v0.157 "Baxter"), SP3 changes (v0.158 "Erikson"). **SP4 = resource absences** — the final entity; completes the roadmap.

## Goal

Push resource absences to the authenticated PM's Outlook calendar as multi-day all-day events, reusing the generic engine (`planEntityReconcile` / `useEntityCalendarPush` / `useCalendarAutoSync` / type-scoped category). Manual "Push to Outlook" button + per-entity enable/auto toggle in the Resources view and Settings → Integrations, mirroring the RAID (SP2) and Change (SP3) thin-pane pattern.

## Key model fact

`Absence = { id, assignee, assigneeEmail?, startDate, endDate, type: "vacation"|"sick"|"training"|"other", note?, localModifiedAt?, resourceId? }`. Unlike task/raid/change (single anchor date), an absence is a **date RANGE** (`startDate`..`endDate`, both inclusive `YYYY-MM-DD`). `CalendarEntityType` already includes `"absence"`; `CALENDAR_ENTITY_TYPES` + `sanitizeOutlookCalendar` already loop it — no settings-model change.

## Design decisions

### Event span — ONE multi-day all-day event per absence
The engine keys 1:1 on a single `outlookEventId` per entity, so an absence maps to exactly one event spanning its range:
- `isAllDay: true`
- `start = { dateTime: `${startDate}T00:00:00`, timeZone: "UTC" }`
- `end   = { dateTime: `${nextDay(endDate)}T00:00:00`, timeZone: "UTC" }` — Graph all-day `end` is **exclusive**, so a Mon–Fri absence (start=Mon, end=Fri) is Mon 00:00 → Sat 00:00 (5 all-day cells). Reusing `nextDay(endDate)` (not `startDate`) is the only structural difference from `changeToGraphEvent`.
- `categories: [categoryFor(projectId, "absence")]` → `AIPM:<projectId>:absence` (type-scoped; list-based reconcile never cross-deletes another entity's events).
- `subject: `${assignee} – ${type}`` (en-dash U+2013; e.g. "Jane Doe – vacation").
- `body` (Text): `Type: <type>`, `Assignee: <assignee>`, `<note>`, `Managed by the AIPM PM Tracker.` — empty lines `.filter(Boolean)`-dropped, `\n`-joined (mirrors `changeToGraphEvent`).

The per-day alternative (N single-day events) is infeasible — only one `outlookEventId` field exists per absence. Rejected.

### Pushable predicate — current+future, exclude sick
`pushableAbsences = absences.filter(a => a.type !== "sick" && !!a.startDate && !!a.endDate && a.endDate >= today)` where `today` is the task-manager `effectiveToday(effectiveTz)` ISO string. Rationale: skip fully-past absences (no calendar clutter from last year's vacations) and omit sick leave for privacy even though events land on the PM's own calendar (Graph `/me`). Vacation / training / other, ongoing or upcoming, sync.

### Persistence — `Absence.outlookEventId?`, 6 write paths
Mirror `RaidItem.outlookEventId` exactly (RAID/task edited the curated sample; changes did not — absences ARE in the curated sample, so follow the RAID recipe):
1. `types.ts` — add `outlookEventId?: string` to `Absence` (after `resourceId`).
2. `ABSENCES_CSV_COLUMNS` (csv-codecs-core.ts) — append `"outlookEventId"`. The generic `absenceFieldToString` = `String(a[c] ?? "")` default arm covers CSV **and** Turso single+tenant (DDL/insert derive from the column list).
3. `ABSENCES_MD_COLUMNS` (markdown-codecs-core.ts) — append `{ key: "outlookEventId", label: "OutlookEventId" }`. Decode arm in `markdownToAbsences` (markdown-codecs-decode.ts) — add `else if (norm === "outlookeventid") colMap[idx] = "outlookEventId";`.
4. `sanitizeAbsence` (sanitize-entities.ts) — `outlookEventId: sanitizeText(raw.outlookEventId, 1024) || undefined` in the returned object.
5. JSON + IndexedDB — whole-object pass-through (no change).
6. Fixtures — regenerate `__fixtures__/golden-workspace.{csv,md}` + `sample-workspace-{small,big,huge}.sqlite3`; append the empty `outlookEventId`/`OutlookEventId` column to the curated `sample-workspace-small.md` Absences table AND the `# ABSENCES` section of `sample-workspace-small.csv`. Regen order: edit codecs + curated samples → `npx vite-node scripts/generate-sample-workspace.ts` (emits json/sqlite + -big/-huge from the .md) → regenerate golden fixtures via serializers.

### Engine — `absenceToGraphEvent(absence, projectId)`
New export in `outlook-calendar-write.ts` after `changeToGraphEvent`, per "Event span" above. Uses the existing module-local `nextDay` + `categoryFor`.

### task-manager wiring (thin pane → logic here, mirror the SP3 Change block ~line 1841)
Resources-panel is a thin callback-prop pane (`absences` in, `onAddAbsence`/`onEditAbsence` out), so all calendar logic lives in task-manager:
- `absenceSync = calendarSyncFor(settings, "absence")`; `calendarAbsenceEnabled = absenceSync.enabled && m365Enabled && !isPopout`; `absenceAutoSyncActive = absenceSync.auto && m365Enabled && !isPopout`.
- `pushableAbsences` memo (predicate above; deps `[absences, today]`).
- `absenceAutoSyncKey` memo = `pushableAbsences.map(a => `${a.id}|${a.startDate}|${a.endDate}|${a.type}|${a.assignee}`).join(";")` — **EXCLUDES `outlookEventId`** (push output). `type` included (drives subject + sick-exclusion), `assignee` included (drives subject).
- `setAbsenceForCalendar = useCallback((updater) => setAbsences(prev => updater([...prev])), [setAbsences])` (functional bridge; `setAbsences` already destructured at task-manager line 240).
- manual `useEntityCalendarPush<Absence>` (`entityType:"absence"`, `toGraphEvent: absenceToGraphEvent`, `enabled: calendarAbsenceEnabled`) → `pushAbsenceToOutlook` + `calendarAbsencePushBusy`.
- silent-auto `useEntityCalendarPush<Absence>` (`interactive:false`, `enabled: absenceAutoSyncActive`) → `autoPushAbsence`.
- `useCalendarAutoSync({ active: absenceAutoSyncActive, contentKey: absenceAutoSyncKey, push: autoPushAbsence })`.
- `onToggleCalendarAbsence` (forces `auto:false` when disabling; mirrors `onToggleCalendarChange`).
- Import `absenceToGraphEvent`. Thread 4 new props into `workspaceProps`: `calendarAbsenceEnabled`, `onToggleCalendarAbsence`, `pushAbsenceToOutlook`, `calendarAbsencePushBusy` (`m365Configured` already threaded).

### Prop plumbing
- `workspace-section-types.ts` — 4 optional props: `calendarAbsenceEnabled?: boolean`, `onToggleCalendarAbsence?: (enabled: boolean) => void`, `pushAbsenceToOutlook?: () => void`, `calendarAbsencePushBusy?: boolean`.
- `workspace-section.tsx` — pass to the Resources panel that hosts the absence toolbar, renamed at the boundary to `m365Configured`/`calendarEnabled`/`onToggleCalendar`/`onPushCalendar`/`calendarPushBusy`.
- The panel — add the props, render an Enable checkbox (aria-label `${t(lang,"calendarSyncEnable")} – ${t(lang,"calendarSyncEntityAbsence")}`, en-dash) + "Push to Outlook" button beside the absence toolbar, gated `m365Configured && !isPopout`. **Resources IS in axe `A11Y_VIEWS`** → controls need accessible names; run `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Resources"` before push.

### Settings row
4th `<CalendarSyncEntityRow entityType="absence" labelKey="calendarSyncEntityAbsence">` in `integrations-section.tsx` (below the change row). Settings → Integrations is axe-scanned; the shared `CalendarSyncEntityRow` already emits labeled controls.

### i18n
`calendarSyncEntityAbsence` — EN "Resource absences (vacation/training dates)", DE "Ressourcenabwesenheiten (Urlaubs-/Schulungstermine)". `versionHighlightCalendarAbsence` — EN/DE. DE strings written via node utf8 write (Edit tool corrupts umlauts + curls quotes; file is CRLF), umlaut bytes verified after.

## Release
v0.159.0, new milestone codename (verify unused via grep), `APP_HIGHLIGHT_KEYS += "versionHighlightCalendarAbsence"`, CHANGELOG entry, AGENTS.md SP4 → done + roadmap COMPLETE, memory `calendar-writeback-roadmap.md` SP4 done. Full release chain on the "release" trigger.

## Testing
- `sanitize-absence` unit: `outlookEventId` preserved / capped 1024 / absent-safe.
- `storage-*-roundtrip` (or existing absence roundtrip): CSV+MD preserve `outlookEventId`; `ABSENCES_CSV_COLUMNS` canonical-order assertion updated.
- `outlook-calendar-write` unit: `absenceToGraphEvent` — multi-day span (`end === nextDay(endDate)`), category `AIPM:<pid>:absence`, subject/body.
- Resources-panel test: calendar toggle render / hidden without m365 / popout-hidden / onToggle / push (mirror change-panel.test.tsx).
- Golden fixtures regenerated (byte-diff = single new trailing column only).
- `npx tsc --noEmit`, `npm run lint`, `npm run test:run`, resources + Settings axe.

## Out of scope
Two-way sync (reading Outlook events back into absences), reminders, per-absence-type calendar routing, all-day vs busy/free status.
