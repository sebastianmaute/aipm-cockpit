# Deepen Integrations — M365 Calendar Write-Back (Milestones → Outlook), Slice 1

**Date:** 2026-06-16
**Status:** Approved (brainstorm) — ready for implementation plan
**Feature area:** new Graph client `outlook-calendar-write.ts`, pure `calendar-reconcile.ts`, `use-outlook-calendar-push.ts` hook, `Milestone.outlookEventId` (+ six write paths), Milestones-view button, M365 settings toggle, docs.

---

## Goal

A manual **"Push to Outlook"** action that reconciles the **current project's milestones** into the
user's Outlook calendar as all-day events (create / update / delete). The PM's calendar reflects the
project without re-entering dates — the next step in the "enabler/accelerator, not a data silo"
narrative the README now leads with. **One-way: the app is the source of truth** for milestones;
Outlook is a mirror (no pull-back, no conflict UI).

This is **slice 1** of the "deepen integrations" direction (the execution-depth roadmap is complete).
It turns the currently **read-only** M365 calendar integration (OOO events → Absences) into a
two-way one (milestones → events), reusing the established Graph-client + `acquireToken` patterns.

## Background (verified by recon)

- **M365 calendar is read-only today:** `outlook-calendar.ts` + `use-outlook-calendar.ts` read
  `/me/calendarView` (`Calendars.Read`) and create `Absence` records from OOO/all-day events. **No
  write path exists.** `Calendars.ReadWrite` is **not** requested anywhere.
- **Graph write pattern already exists:** `graph-mail.ts` is a token-pure Graph client
  (`GRAPH = "https://graph.microsoft.com/v1.0"`, scope consts, `GraphMailError`, `graphPost`) called
  via `useMsAuth().acquireToken(scopes, { interactive })` (silent→popup incremental consent). The new
  calendar-write client mirrors it.
- **`graph.microsoft.com` is already in `src/proxy.ts` `connect-src`** — **no new CSP host.**
- **`Milestone`** (`types.ts:196`): `{ id, name, date (YYYY-MM-DD), description?, achievedDate?,
  linkedTaskIds, localModifiedAt?, documentLinks? }`. `documentLinks?`/`achievedDate?` are the
  precedent for an **optional persisted field threaded through all six backends**
  (`storage-serialization` CSV/MD, `turso-schema` single + tenant, `browser-backend` IndexedDB,
  `use-storage-backend`, JSON direct).
- **`jiraKey` on `Task`** (`types.ts:62`) is the precedent for storing an external-system link id on a
  domain entity — `outlookEventId` on `Milestone` follows it.
- **M365 settings:** `M365IntegrationsSettings { enabled, sharepoint, outlookContacts,
  outlookCalendar }` + `sanitizeIntegrations` (`settings-types.ts:134`). A new
  `outlookCalendarPush: boolean` mirrors the existing booleans.

## Decisions taken during brainstorming

1. **Push scope = milestones only** (absences stay import-only — pushing them would loop with the OOO
   import; task due-dates excluded — too noisy).
2. **Trigger = manual "Push to Outlook" button** (mirrors the Jira "Sync" button); first click triggers
   `Calendars.ReadWrite` consent via `acquireToken(["Calendars.ReadWrite"], { interactive: true })`.
3. **Link storage = `Milestone.outlookEventId?`** (new persisted field, SIX write paths) — correct
   idempotency (dedupes across devices/backends; the link travels with the project), mirrors
   `jiraKey` on `Task`.
4. **One-way push**, app = source of truth; no pull-back, no conflict resolution.
5. **Category-tagged full reconcile** — each event is tagged `AIPM:<projectId>` so the push discovers
   ALL of this project's events and can **delete orphans** (milestones removed in-app, or re-create
   when the user deleted the event in Outlook). `outlookCalendarPush` defaults **off** (opt-in).

> **`projectId` source (plan must pin):** use the current project's **stable id** — the project-meta /
> registry id used elsewhere for multi-project scoping (the same id Turso multi-tenancy keys on), NOT
> the display name (which can change and would orphan events). In single-project/file mode there is
> still a project-meta id; if none exists, fall back to a fixed constant (e.g. `"default"`) so the
> category is stable. The plan resolves the exact field during implementation.

---

## Architecture

```
"Push to Outlook" (Milestones view, gated: M365 enabled + outlookCalendarPush + !isPopout)
        │
use-outlook-calendar-push.ts ── acquireToken(["Calendars.ReadWrite"], {interactive:true})
        │                         │
        │                    outlook-calendar-write.ts (Graph client, token-pure)
        │                      listProjectEvents(token, projectId) → existing[]
        │                      createEvent / updateEvent / deleteEvent
        │
        ├─ calendar-reconcile.ts (PURE) ── planCalendarReconcile(milestones, existing)
        │                                     → { create[], update[], delete[] }
        │
        ├─ execute plan → collect per-event errors (partial success)
        ├─ write new event-ids back onto milestones → setMilestones (SIX paths)
        └─ toast: created/updated/deleted (+ partial-failure count)
```

### 1. Pure `src/app/calendar-reconcile.ts` (i18n-free, no Graph, unit-tested)

```ts
import type { Milestone } from "./types";

/** A minimal view of an existing Outlook event (project-tagged). */
export interface ExistingEvent { id: string; }

export interface ReconcilePlan {
  create: Milestone[];                       // no outlookEventId, or stored id absent from Outlook
  update: { milestone: Milestone; eventId: string }[]; // stored id present in Outlook
  delete: string[];                          // tagged event ids with no matching current milestone
}

export function planCalendarReconcile(
  milestones: readonly Milestone[],
  existing: readonly ExistingEvent[],
): ReconcilePlan {
  const existingIds = new Set(existing.map((e) => e.id));
  const keptIds = new Set<string>();
  const create: Milestone[] = [];
  const update: { milestone: Milestone; eventId: string }[] = [];
  for (const m of milestones) {
    if (m.outlookEventId && existingIds.has(m.outlookEventId)) {
      update.push({ milestone: m, eventId: m.outlookEventId });
      keptIds.add(m.outlookEventId);
    } else {
      create.push(m);                        // never pushed, or its event was deleted in Outlook
    }
  }
  const del = existing.map((e) => e.id).filter((id) => !keptIds.has(id));
  return { create, update, delete: del };
}
```

(Always `update` re-sends the date/subject, so an in-app date change is pushed without diffing — the
event body is small and the push is manual/infrequent. A future optimization could skip unchanged
events, but YAGNI for v1.)

### 2. `src/app/outlook-calendar-write.ts` (Graph client, token-pure, mirrors `graph-mail.ts`)

- `export const CALENDAR_READWRITE_SCOPE = ["Calendars.ReadWrite"] as const;`
- `categoryFor(projectId): string` → `"AIPM:" + projectId`.
- `milestoneToGraphEvent(m: Milestone, projectId): GraphEvent` — all-day event:
  `subject = m.name`, `isAllDay: true`, `start = { dateTime: m.date+"T00:00:00", timeZone: "UTC" }`,
  `end = { dateTime: (m.date + 1 day)+"T00:00:00", timeZone: "UTC" }` (Graph all-day requires
  `end = start + 1 day`), `categories: [categoryFor(projectId)]`, `body: { contentType: "Text",
  content: "Managed by the AIPM PM Tracker." }`.
- `listProjectEvents(token, projectId): Promise<ExistingEvent[]>` —
  `GET /me/events?$filter=categories/any(c:c eq '<cat>')&$select=id` + `@odata.nextLink` pagination
  (cap pages like `outlook-calendar.ts MAX_PAGES`).
- `createEvent(token, event): Promise<string>` — `POST /me/events` → returns the new event id.
- `updateEvent(token, eventId, event): Promise<void>` — `PATCH /me/events/{id}`.
- `deleteEvent(token, eventId): Promise<void>` — `DELETE /me/events/{id}` (treat 404 as success —
  already gone).
- `GraphCalendarError extends Error` (status + message), thrown by non-ok responses.

### 3. `src/app/use-outlook-calendar-push.ts` hook

- Input: `{ milestones, projectId, projectName, setMilestones, isPopout }` (and `acquireToken`,
  `showToast`, `lang` from context/props). Exposes `pushToOutlook(): Promise<void>` + a `busy` flag.
- Flow: gate `!isPopout`; `token = await acquireToken(CALENDAR_READWRITE_SCOPE, { interactive: true })`
  (null/throw → toast "calendar access not granted", return); `existing = listProjectEvents(...)`;
  `plan = planCalendarReconcile(milestones, existing)`; execute:
  - `create`: `createEvent` → map milestone.id → new eventId; on success stage the id.
  - `update`: `updateEvent`.
  - `delete`: `deleteEvent`.
  - Per-event try/catch → push to an `errors[]`, continue (partial success).
- After execution: `setMilestones` with the new `outlookEventId`s applied immutably (only for created
  ones; updates keep their id) → persists through all six paths. Toast a summary
  (`calendarPushResult` with created/updated/deleted counts; if `errors.length`, append a partial note).

### 4. `Milestone.outlookEventId` + SIX write paths

Add `outlookEventId?: string;` to `Milestone` (`types.ts`). Thread it through the six backends exactly
as `documentLinks?`/`achievedDate?` are threaded: `storage-serialization` (CSV + Markdown columns —
empty string when unset, byte-stable), `turso-schema` single + tenant (column add via CREATE-IF-NOT-
EXISTS; `SqlArg.value` string), `browser-backend` (IndexedDB), `use-storage-backend`, and the JSON
path (direct). Legacy data without the field defaults to `undefined` (omitted), so existing golden
fixtures stay byte-stable until a sample milestone gains an id (the sample won't, so no fixture
regen).

### 5. UI — "Push to Outlook" button

In the Milestones view header/toolbar: a button `t(lang, "calendarPush")` (with a busy/spinner state
like the Jira "Sync" button), rendered only when **M365 is enabled AND
`integrations.m365.outlookCalendarPush` is true AND `!isPopout`**. Calls `pushToOutlook()`. Labeled
(axe). Palette tokens only (no shadow).

### 6. Settings — `outlookCalendarPush`

Add `outlookCalendarPush: boolean` to `M365IntegrationsSettings` (default `false`) + coerce in
`sanitizeIntegrations` (mirror `outlookCalendar`). A checkbox under the M365 integration section:
"Push milestones to my Outlook calendar" + a hint (one-way; manual button in the Milestones view).
Labeled.

### 7. i18n / release / docs

- New keys (EN + DE real umlauts): `calendarPush` (button), `calendarPushing` (busy),
  `calendarPushResult` ({0}=created {1}=updated {2}=deleted), `calendarPushPartial` ({0}=failed),
  `calendarPushNoAccess`, `settingsOutlookCalendarPush`, `settingsOutlookCalendarPushHint`,
  `versionHighlightCalendarPush`. (`Lang` has no `"en"`; DE dict lazy; edit `i18n.de.ts` via node
  UTF-8 CRLF write.)
- Release bump `version.ts` + CHANGELOG + `APP_HIGHLIGHT_KEYS`.
- Docs: README — extend the M365 feature/integration table with calendar write-back (the
  repositioning narrative already lands); RUNBOOK — a "calendar write-back: disable / fix consent"
  note; codemaps — the new client/hook/field. Small (tables already exist).

## Error handling

Consent denied / not signed in → `acquireToken` returns null or throws → caught → toast
`calendarPushNoAccess`, no partial writes. Per-event Graph failure → collected, push continues, toast
reports partial counts. `deleteEvent` 404 → treated as success. Token expiry → existing
silent→interactive fallback in `acquireToken`.

## Testing

- **Pure `calendar-reconcile.test.ts`:** create (no id), update (id present), delete (orphan), re-create
  when stored id is absent from `existing`, empty/no-op cases.
- **`outlook-calendar-write` mapping test:** `milestoneToGraphEvent` all-day shape (`end = date + 1`),
  category string, subject; the `$filter` URL for `listProjectEvents`.
- **Hook test:** mock the Graph client + `acquireToken`; assert plan execution (create/update/delete
  calls), milestone `outlookEventId` write-back via `setMilestones`, partial-error toast, popout +
  no-token gating.
- **Serializer six-path round-trip** for `outlookEventId` (+ golden byte-stability unchanged).
- **a11y:** button + settings checkbox labeled (axe).

## What does NOT change

No new CSP host (`graph.microsoft.com` already allowlisted). No pull-back / conflict UI. Absences and
task due-dates are not pushed. The calendar *import* path is untouched. The `next-actions` engine and
all other subsystems are untouched.

## Out of scope (future)

- Auto-on-change push (manual button only for v1).
- Pulling Outlook-side event edits back into milestones.
- Pushing task due-dates or absences.
- A dedicated per-project Outlook calendar (uses the default calendar).
- Recurring events; reminders/alerts on the events.
