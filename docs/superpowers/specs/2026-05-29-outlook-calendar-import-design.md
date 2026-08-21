# Outlook Calendar Import — Design

**Date:** 2026-05-29
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.24.0-outlook-calendar`
**Context:** Sub-project **M4** — final piece of the 5-sub-project Microsoft 365 + Turso request (T1/Turso remains, independent). Builds on M1 (MSAL + Graph foundation, 0.21.0), the M3 import pattern (0.23.0), and the 0.23.1 interactive-consent `acquireToken`. Ships as **0.24.0 "Jemisin"** with a new highlight key. After this, **all M365 integration sub-toggles are live.**

## Goal

Let a signed-in Microsoft 365 user import time-away events from their own Outlook calendar (Graph `/me/calendarView`, `Calendars.Read`) into lop-app as **`Absence` records** on the resource calendar. A **preview-and-pick** dialog lists candidate events; each row has a **per-row absence-type dropdown**; on confirm, selected events become absences.

## Non-goals

- No write-back to Outlook (read-only `Calendars.Read`).
- No import of regular meetings — only **time-away** events (all-day OR `showAs === "oof"`) are candidates.
- No other users' calendars — `/me/calendarView` (the signed-in user) only.
- No background/auto-sync — explicit, user-triggered import.
- No recurrence editing — `calendarView` already expands recurrences into instances; each instance is a candidate.
- No new gated toggles remain after this — M4 is the last M365 feature.

## Architecture

Three units plus wiring — the same shape as M3 (pure core + fetch hook + presentational modal + coordinator).

### 1. `src/app/outlook-calendar.ts` (new, pure)

```ts
import type { Absence, AbsenceType } from "./types";

/** Raw Graph /me/calendarView item (subset we $select). */
export interface GraphEvent {
  id?: string;
  subject?: string | null;
  start?: { dateTime?: string | null; timeZone?: string | null } | null;
  end?: { dateTime?: string | null; timeZone?: string | null } | null;
  isAllDay?: boolean | null;
  showAs?: string | null; // free | tentative | busy | oof | workingElsewhere | unknown
}

/** Normalized, app-facing event (already filtered to time-away). */
export interface OutlookEvent {
  sourceId: string;
  subject: string;        // "" when Outlook omits it
  startDate: string;      // "YYYY-MM-DD" inclusive
  endDate: string;        // "YYYY-MM-DD" inclusive
  isAllDay: boolean;
  showAs: string;
}
```

- `isTimeAway(raw: GraphEvent): boolean` — `raw.isAllDay === true || raw.showAs === "oof"`.
- `mapGraphEvent(raw: GraphEvent, index: number): OutlookEvent | null`
  - Returns `null` unless `isTimeAway(raw)` and a usable `start.dateTime` exists.
  - `startDate` = first 10 chars (`YYYY-MM-DD`) of `start.dateTime`.
  - `endDate`: Graph all-day `end` is **exclusive** (a one-day all-day event ends at next-midnight), so for `isAllDay`, `endDate = isoAddDays(endDay, -1)`; for non-all-day OOF events, `endDate = endDay` (the date slice of `end.dateTime`). Clamp `endDate` to be `>= startDate` (defensive).
  - `subject` = trimmed `raw.subject ?? ""`; `sourceId` = `raw.id ?? \`event-${index}\``.
  - Uses `isoAddDays` from `due-dates.ts` for the −1-day shift (already exported; verify).
- `eventsToAbsences(input, existing, target): Absence[]` — pure merge:
  - `input`: array of `{ event: OutlookEvent; type: AbsenceType }` (the user's per-row type choices for the selected rows).
  - `target`: `{ assignee: string; assigneeEmail?: string; resourceId?: number }` (the signed-in user — see Target below).
  - `existing`: current `Absence[]` for dedup + id assignment.
  - For each input: skip if an existing absence already has the same `assignee` (normalized) + `startDate` + `endDate` (dedup). Otherwise create an `Absence`:
    `{ id: nextAbsenceId++, assignee, assigneeEmail, startDate, endDate, type, note: subject || undefined, resourceId, localModifiedAt: stamp }`.
  - `nextAbsenceId` starts at `existing.length > 0 ? Math.max(...existing.map(a => a.id)) + 1 : 1` and increments per added absence (matches `use-resource-planner` absence-id scheme). `stamp` is passed in (the module stays pure — no `new Date()` inside).
  - Returns `[...existing, ...created]` (immutable).
- `dedupeKey(assignee, startDate, endDate)` helper (normalized assignee, case-folded) — used for both the merge and the modal's "already in calendar" badge.

### 2. `src/app/use-outlook-calendar.ts` (new hook)

```ts
export interface CalendarWindow { startDateTime: string; endDateTime: string; } // ISO 8601
export interface UseOutlookCalendarResult {
  fetchEvents: (window: CalendarWindow) => Promise<OutlookEvent[]>;
}
export function useOutlookCalendar(
  acquireToken: (scopes: readonly string[], options?: { interactive?: boolean }) => Promise<string | null>,
): UseOutlookCalendarResult;
```

- `fetchEvents(window)`:
  - `acquireToken(["Calendars.Read"], { interactive: true })` → null throws `Error("outlookSignInRequired")`. (Interactive → first-time consent popup via the 0.23.1 fallback.)
  - Paged GET starting at
    `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime={start}&endDateTime={end}&$select=id,subject,start,end,isAllDay,showAs&$top=100&$orderby=start/dateTime`
    with headers `Authorization: Bearer <token>` and `Prefer: outlook.timezone="UTC"` (so date slices are stable). Follow `@odata.nextLink` (validate it stays on `https://graph.microsoft.com/`, same guard as the M3 hook) until absent.
  - Map each item via `mapGraphEvent`, dropping `null` (non-time-away). Page-count cap (100) → `outlookCalendarFetchFailed`.
  - Errors: 401 → `outlookSignInExpired`, 403 → `outlookCalendarPermissionDenied`, other non-ok / network / parse → `outlookCalendarFetchFailed`. A thrown `acquireToken` (interactive popup dismissed/failed) → caught → `outlookSignInExpired`.
- The window is supplied by the caller; `fetchEvents` is wrapped in `useCallback([acquireToken])`.

### 3. `src/app/outlook-calendar-import-modal.tsx` (new, presentational)

```ts
interface OutlookCalendarImportModalProps {
  lang: Lang;
  open: boolean;
  loading: boolean;
  error: string | null;
  events: OutlookEvent[];
  existingKeys: ReadonlySet<string>;  // dedupeKey(assignee,start,end) of current absences for the target user
  onConfirm: (rows: { event: OutlookEvent; type: AbsenceType }[]) => void;
  onClose: () => void;
}
```

- Shared `<Modal>` shell (same as M3's modal).
- Each event row: checkbox + subject (or "(no subject)") + date range (`startDate`–`endDate`, or single date) + a **per-row `<select>`** of absence types (vacation/sick/training/other, default **vacation**). Events whose `dedupeKey` is in `existingKeys` are badged "already in calendar" and unchecked by default.
- Select-all / deselect-all + live "N selected" count. States: loading / error / empty ("No time-away events found.") / list + Import(n)/Cancel.
- Selection (`Set<sourceId>`) and per-row type (`Record<sourceId, AbsenceType>`) are local state, re-seeded via the render-time previous-value sync pattern (no `useEffect`) when `events` changes. `onConfirm` passes only checked rows with their chosen types.

### 4. Wiring

- **`use-resource-planner.ts`**: new `handleImportAbsences(rows, target)` →
  `setAbsences((prev) => eventsToAbsences(rows, prev, target))` where `target` is computed by the caller; `localModifiedAt` stamp generated here (`new Date().toISOString()`) and passed into `eventsToAbsences`. Exposed in the hook's return.
- **`task-manager.tsx`**:
  - `const outlookCalendarEnabled = m365Enabled && (settings.integrations?.m365?.outlookCalendar ?? false);`
  - `useOutlookCalendar(msAuth.acquireToken)`; import state (`open/loading/error/events`); `handleOpenCalendarImport` computes the window (`today−30d … today+180d` via `isoAddDays`, as ISO datetimes `…T00:00:00Z`), fetches, maps thrown error-key → `t(lang, key)`.
  - Target: `assigneeEmail = msAuth.account?.username`; matching resource (by normalized email) → `assignee = resourceDisplayName(match)`, `resourceId = match.id`; else `assignee = msAuth.account?.name ?? username`, no `resourceId`.
  - `existingKeys` = `Set` of `dedupeKey` over current absences for the target assignee.
  - `handleConfirmCalendarImport(rows)` → `handleImportAbsences(rows, target)` + close + toast `outlookCalImportedN`.
  - Renders `<OutlookCalendarImportModal>`; passes `onImportOutlookCalendar` to the Resources panel only when `outlookCalendarEnabled && msAuth.account` (guarded with `guardEdit`, like M3).
- **`resources-panel.tsx`**: `onImportOutlookCalendar?: () => void` prop; render an **"Import from Outlook"** button in the header toolbar **only when `view === "calendar"` and the prop is provided** (beside "Add absence").
- **`settings-menu.tsx`**: flip the last gated tuple `["integrationsOutlookCalendar", "outlookCalendar", true]` → `false` (interactive). No gated sub-toggles remain.

### What ships when toggles are OFF

`outlookCalendarEnabled` false → no import button; `useMsAuth(false)` no-ops; MSAL never loads. Same "default OFF" contract as M1–M3.

### Edge cases

- **All-day exclusive end:** one-day all-day event (`start 2026-06-01T00:00:00`, `end 2026-06-02T00:00:00`) → `startDate 2026-06-01`, `endDate 2026-06-01`. Tested.
- **OOF timed event** spanning part of a day → `startDate === endDate` (the date slice). Tested.
- **Event with no subject:** absence `note` omitted; row shows "(no subject)".
- **Multi-day OOF across a DST/timezone boundary:** `Prefer: outlook.timezone="UTC"` makes the date slices deterministic; we accept UTC date boundaries (documented; acceptable for planning granularity).
- **Re-import:** dedup by `assignee+startDate+endDate` skips already-present absences (badged + unchecked).
- **No matching resource for the signed-in email:** absence still created with free-text `assignee` (the account display name) and no `resourceId` — it shows on the calendar by assignee name (Absence.assignee is free-text).
- **Token null / popup dismissed:** actionable "sign in" message; no partial import (merge only after full fetch).

## Data flow

```
Settings: enable M365 + Outlook calendar → Sign in
  ↓
Resources › Calendar → "Import from Outlook"
  ↓
acquireToken(["Calendars.Read"], { interactive: true })   ── consent popup on first use (0.23.1)
  ↓
GET /me/calendarView?startDateTime=today-30d&endDateTime=today+180d&$select=…  (Prefer: UTC)
  → follow @odata.nextLink → value[]
  ↓
mapGraphEvent(...)  → keep time-away (all-day | oof) → OutlookEvent[]
  ↓
Preview modal: checkboxes + per-row absence-type select; existing badged
  ↓ confirm(rows: {event, type}[])
setAbsences(eventsToAbsences(rows, prevAbsences, target))   // target = signed-in user
  ↓
toast "Imported N absences"
```

## i18n keys (EN + DE)

| Key | EN | DE |
|---|---|---|
| `integrationsOutlookCalendar` | (exists) | (exists) |
| `outlookCalImportButton` | "Import from Outlook" | "Aus Outlook importieren" |
| `outlookCalImportTitle` | "Import Outlook calendar" | "Outlook-Kalender importieren" |
| `outlookCalImportLoading` | "Loading events…" | "Termine werden geladen…" |
| `outlookCalImportEmpty` | "No time-away events found." | "Keine Abwesenheits-Termine gefunden." |
| `outlookCalImportExisting` | "already in calendar" | "bereits im Kalender" |
| `outlookCalImportNoSubject` | "(no subject)" | "(kein Betreff)" |
| `outlookCalImportSelectAll` | "Select all" | "Alle auswählen" |
| `outlookCalImportSelectedN` | "{0} selected" | "{0} ausgewählt" |
| `outlookCalImportConfirm` | "Import ({0})" | "Importieren ({0})" |
| `outlookCalImportCancel` | "Cancel" | "Abbrechen" |
| `outlookCalImportedN` | "Imported {0} absences" | "{0} Abwesenheiten importiert" |
| `outlookCalImportType` | "Type" | "Typ" |
| `outlookCalendarPermissionDenied` | "Permission denied. Grant calendar access." | "Zugriff verweigert. Kalenderzugriff gewähren." |
| `outlookCalendarFetchFailed` | "Could not load Outlook calendar." | "Outlook-Kalender konnte nicht geladen werden." |
| `versionHighlightOutlookCalendar` | "Import time-away events from your Outlook calendar as absences: sign in with Microsoft, then pull all-day and Out-of-Office events into the resource calendar from Resources › Calendar." | "Abwesenheits-Termine aus dem Outlook-Kalender importieren: mit Microsoft anmelden und ganztägige sowie Abwesenheits-Termine unter Ressourcen › Kalender in den Ressourcenkalender übernehmen." |

(`outlookSignInRequired` / `outlookSignInExpired` are reused from M3. `{0}` uses the existing positional substitution.)

## Testing

### Unit — `outlook-calendar.test.ts` (new)
- `isTimeAway` / `mapGraphEvent`: all-day kept; `oof` timed kept; `busy`/`free` meeting → `null`; all-day exclusive-end → inclusive `endDate` (−1 day); missing `start` → `null`; subject trimmed; `sourceId` fallback `event-{index}`.
- `eventsToAbsences`: per-row type applied; dedup by assignee+start+end (existing skipped); id assignment from `Math.max(existing ids)+1` incrementing; `note` = subject (omitted when blank); `resourceId`/`assigneeEmail` carried from `target`; immutable.

### Unit — `use-outlook-calendar.test.tsx` (new)
- Multi-page `@odata.nextLink`; correct `$select`/`$top`/`$orderby`/window params; `Prefer: outlook.timezone="UTC"` + `Authorization: Bearer` headers; off-Graph nextLink rejected.
- Null token → `outlookSignInRequired`; 401 → `outlookSignInExpired`; 403 → `outlookCalendarPermissionDenied`; 500/network → `outlookCalendarFetchFailed`; `acquireToken(["Calendars.Read"], { interactive: true })` asserted.
- Non-time-away events filtered out of the result.

### Unit — `outlook-calendar-import-modal.test.tsx` (new)
- Rows render with date range + per-row type select (default vacation); changing a row's select changes the type passed to `onConfirm`; existing-key rows badged + unchecked; select-all; confirm passes only checked rows with chosen types; loading/empty/error states.

### Unit — `settings-menu.test.tsx` (extend)
- Outlook calendar toggle now interactive + persists `integrations.m365.outlookCalendar`; no sub-toggle remains disabled.

### Gates
- `npx tsc --noEmit` 0; `npm run lint` 0; full suite green (existing 1012 + new); coverage ≥ current.

## Release

Minor → **0.24.0 "Jemisin"**. New highlight key `versionHighlightOutlookCalendar`.

- `src/app/version.ts`: `APP_VERSION = "0.24.0"`; `APP_BUILD_DATE = "2026-05-29"`; add 0.24.0 top comment; append `"versionHighlightOutlookCalendar"` as the LAST `APP_HIGHLIGHT_KEYS` entry.
- `src/app/i18n.ts` + `i18n.de.ts`: all new keys + the highlight key.
- `CHANGELOG.md`: `[0.24.0] — 2026-05-29 "Jemisin"` — Added (Outlook calendar → absences import; time-away filter; per-row type; preview-and-pick) + Changed (Outlook calendar sub-toggle interactive — **all M365 integrations now live**).
- No new dependencies; no DESIGN-TOKENS change.

## Plan shape (preview — `writing-plans` expands)

1. `outlook-calendar.ts` pure core (types, `isTimeAway`, `mapGraphEvent`, `eventsToAbsences`, `dedupeKey`) + tests.
2. `use-outlook-calendar.ts` hook (paged calendarView fetch, interactive scope, typed errors) + tests.
3. `outlook-calendar-import-modal.tsx` (per-row type select) + tests.
4. Wire into `task-manager.tsx` + `resources-panel.tsx`; add `handleImportAbsences` to `use-resource-planner.ts`.
5. Flip the Outlook calendar sub-toggle interactive in `settings-menu.tsx` + tests.
6. i18n EN + DE.
7. Release 0.24.0 (version.ts, CHANGELOG).

## What this closes

After 0.24.0, **M4 is done and all four M365 integrations (auth, SharePoint storage, Outlook contacts, Outlook calendar) are live.** Only **T1 (Turso storage backend)** remains from the original request — independent of MSAL, can land any time. Deferred: S4 (PDF export).
