# Calendar Write-back — SP2: RAID Review Dates (Design)

**Date:** 2026-07-01
**Status:** Approved (design)
**Roadmap:** SP1 Tasks (done) → **SP2 RAID review dates (this)** → SP3 Change decision dates → SP4 Resource absences.

## Goal

Reuse the SP1 calendar engine to push **RAID items** as all-day Outlook events on their **`targetDate`** (the item's review/target date). Active (non-terminal) RAID items with a `targetDate` get an event; finishing/closing an item or clearing its `targetDate` drops it from the pushed set → next reconcile deletes its event. No new engine code — SP2 is engine *reuse* + one new entity's field/wiring.

**Date source (decided):** `RaidItem.targetDate` (mirrors SP1's `Task.dueDate`). No new date field.

## What SP1 already gives us (unchanged)

- `categoryFor(projectId, entityType)` → type-scoped `AIPM:${projectId}:raid` (no cross-delete with milestone/task/committee).
- Generic `planEntityReconcile<T extends HasEventLink>` (`calendar-reconcile.ts`), `listEntityEvents(token, projectId, entityType)` (`outlook-calendar-write.ts`).
- Generic hook `useEntityCalendarPush<T>` (`use-entity-calendar-push.ts`) — module-level `inFlightReconcile` lock, 404-on-PATCH self-heal, `interactive` flag (silent auto), popout no-op.
- `use-calendar-auto-sync.ts` debounced (4s) fail-once runner.
- `CalendarEntityType = "task" | "raid" | "change" | "absence"` — **`"raid"` already in the union**; `calendarSyncFor(settings, "raid")` and `sanitizeOutlookCalendar` already accept it (SP1 stubbed the union). No settings-model change.
- Central Settings → Integrations "Calendar write-back" sub-section framework (SP1 renders the **task** row; SP2 adds the **raid** row).

## Components

### 1. `raidToGraphEvent(raid, projectId)` — `outlook-calendar-write.ts`

Mirror `taskToGraphEvent`: all-day on `raid.targetDate`, subject = `raid.title`, `categories: [categoryFor(projectId, "raid")]`, body notes owner/severity/status + "Managed by the AIPM PM Tracker." Callers filter to items **with** a `targetDate` before calling (builder assumes a date, like the task builder).

```ts
export function raidToGraphEvent(raid: RaidItem, projectId: string): GraphEvent {
  return {
    subject: raid.title,
    isAllDay: true,
    start: { dateTime: `${raid.targetDate}T00:00:00`, timeZone: "UTC" },
    end: { dateTime: `${nextDay(raid.targetDate!)}T00:00:00`, timeZone: "UTC" },
    categories: [categoryFor(projectId, "raid")],
    body: { contentType: "Text", content: [
      raid.owner ? `Owner: ${raid.owner}` : "",
      raid.severity ? `Severity: ${raid.severity}` : "",
      raid.status ? `Status: ${raid.status}` : "",
      "Managed by the AIPM PM Tracker.",
    ].filter(Boolean).join("\n") },
  };
}
```

### 2. Persistence — `RaidItem.outlookEventId?: string`

Add to `RaidItem` (`types.ts`), then the **column + write paths** (mirror `Task.outlookEventId` / `Milestone.outlookEventId`):
- `RAID_CSV_COLUMNS` (`csv-codecs-core.ts:83`) — append `"outlookEventId"`. `raidFieldToString` default arm handles arbitrary string fields (verify); Turso single+tenant derive DDL/insert from `RAID_CSV_COLUMNS`; `turso-migrate.ts` PRAGMA-diff ALTER-adds it to existing DBs.
- RAID CSV decoder (`csv-codecs-decode.ts` `build*` for RAID / the RAID row→object path) — copy `obj.outlookEventId` when present.
- `RAID_MD_COLUMNS` (`markdown-codecs-core.ts:55`) — append `{ key: "outlookEventId", label: "OutlookEventId" }`; MD RAID decoder (`markdown-codecs-decode.ts`) — decode arm.
- `sanitizeRaidItem` (`sanitize-records.ts:162`) — accept/cap `outlookEventId` (string, ≤1024), mirroring the milestone sanitizer (lines 95-96). App-managed field; users never enter it.
- IDB (`BrowserBackend`) + JSON — full-object pass-through; confirm no field allowlist drops it.
- **Golden fixtures** — regenerate `__fixtures__/golden-*` (legit new empty column). Append the empty column to the curated `sample-workspace-small.csv` + `.md` RAID rows (or regenerate via the sample generator). No new sample *data*.

### 3. Central Settings row — Integrations "Calendar write-back"

Add the **RAID** row beside the SP1 task row (Enable + Auto switches; Auto greyed until Enabled). M365-gated. Row-unique `aria-label`s (Settings axe-scanned). Writes `settings.outlookCalendar.raid` via `setSettings`→`writeSettings`.

### 4. RAID pane wiring — `raid-panel.tsx` toolbar

Mirror SP1's tasks-pane wiring:
- **Per-pane enable toggle** — small labelled switch writing `settings.outlookCalendar.raid.enabled` (same setting as the central row → lockstep). Forces `auto:false` when un-enabling (SP1 landmine). M365-gated (hidden when M365 not configured). RAID panel IS axe-scanned → row-unique `aria-label`.
- **"Push to Outlook"** button beside it when enabled (`iconOnly` to match the compact toolbar), wired to `useEntityCalendarPush({ items: pushableRaid, entityType: "raid", toGraphEvent: raidToGraphEvent, setItems: <raid setter>, … })`.
- **Filter** `pushableRaid = raid.filter(r => isActiveForReview(r) && !!r.targetDate)`, where "active" = the same non-terminal + not-closed test the review engine uses (`!closedDate && !TERMINAL.has(status)`). Reuse `raid-review.ts`'s notion of active — extract a tiny exported `isRaidActiveForReview(item)` predicate from the existing private `isActive` (keep the review engine using it) so pane + engine agree.

### 5. Auto-sync runner — `task-manager.tsx`

Mirror the SP1 task block (task-manager ~1770-1800): `pushableRaid` memo, `raidAutoSyncKey` (ids + `targetDate` + `title` + `status` — **exclude** `outlookEventId`, it's an output), silent `useEntityCalendarPush<RaidItem>` (`interactive:false`), `useCalendarAutoSync({ active: raidAutoSyncActive, contentKey: raidAutoSyncKey, push })`. `active = calendarSyncFor(settings,"raid").enabled && .auto && m365Configured && !isPopout`. The RAID list + `setRaid` already live in task-manager (line 237/1191).

## Data flow

manual: click → `pushToOutlook` → token → `listEntityEvents(projectId,"raid")` → `planEntityReconcile(pushableRaid, existing)` → CRUD → `setRaid` writes back/clears `outlookEventId` → toast.
auto: `raidAutoSyncKey` change → debounced silent `pushToOutlook`.

## Error handling (all inherited from SP1)

No/absent token → manual error toast, auto silent no-op + re-arm. 404-on-PATCH → clear stale id, re-create next push. Partial failures → count toast (manual) / silent (auto). No `targetDate` or terminal/closed → filtered out, never reaches builder. Popout → all writes no-op. Never logs token/body.

## Testing

- `outlook-calendar-write.test.ts` — `raidToGraphEvent` (all-day on targetDate, subject, `AIPM:<pid>:raid` category, date→next-day end, body owner/severity/status).
- `use-entity-calendar-push.test.tsx` — already generic; add a raid-typed case OR confirm the task cases cover the generic path (raid uses the same hook). Minimal: one raid smoke case.
- Persistence round-trip — a RAID item with `outlookEventId` survives CSV/MD/JSON/IDB/Turso round-trip; golden fixtures regenerated (byte diff = the new empty column only).
- `sanitizeRaidItem` — accepts + caps `outlookEventId`; absent → field omitted.
- `raid-review.ts` — extracted `isRaidActiveForReview` keeps the existing review tests green (behaviour identical).
- Auto runner — fires on `raidAutoSyncKey` change when enabled+auto; no-op disabled/popout; debounced; fail-once (reuse the SP1 auto-sync test shape).
- RAID panel axe — the new toggle/button keep row-unique labels + palette tokens (RAID is in `A11Y_VIEWS`); verify with `npx playwright test e2e/a11y.spec.ts -g "RAID"` before push.
- `npx tsc --noEmit` after any test edit (i18n parity + test-only type errors fail CI).

## i18n (EN + DE)

Reuse SP1's `calendarPush*` keys for the button/toasts. New: the RAID central-row label + the RAID pane enable-toggle `aria-label` (or reuse a generic "Calendar sync" label parameterised by entity name). DE via node utf8 write (CRLF + real umlauts landmine).

## Out of scope (SP2)

- SP3/SP4 entities (Change decision dates / Resource absences) — separate specs.
- Milestone/committee mechanism or their bare category — untouched.
- Per-row manual "add to calendar" — toggle is per entity-type.
- A dedicated `reviewDate` field — `targetDate` is the review date (decided).
