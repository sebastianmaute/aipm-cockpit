# SP-E - Steering Committee + Meeting Schedule + Info Reminders + Outlook - Design

**Date:** 2026-06-20
**Status:** Approved (design); spec pending user review
**Target release:** v0.111.0 "Chambers"

> Fifth slice of the 6-part roadmap ([[task-status-kanban-roadmap]]). New persisted entity +
> a new view + a reminder engine (2 surfaces) + Outlook calendar push. Reuses the existing
> people layer (Resources/Stakeholders), the next-actions engine, the Milestone->Outlook
> calendar plumbing (`outlook-calendar-write.ts` / `calendar-reconcile.ts`), and `due-dates.ts`
> working-day math.

## Goal

Document a project's steering committee (members), its meeting schedule, and "information
schedule" rules (e.g. circulate the board pack N working days before each meeting); surface the
resulting reminders both in the Action Center and in the committee panel; and (when M365 is on)
push the meetings AND the info-reminder due dates to the user's Outlook calendar.

## Non-goals (SP-E)

- SP-F (guided tour + demo) - the last slice.
- No agentic AI here. No recurrence-rule engine (meetings are explicit dated entries, not RRULEs).
- One steering committee per project (not multiple committees).
- The AI never auto-manages the committee; it's user-edited data.

## Decisions (locked during brainstorming)

1. **One `steeringCommittee` object** per project (members + meetings + info-schedules), a new
   persisted Workspace field.
2. **Reminders on BOTH surfaces:** a shared pure compute feeds a new next-actions provider AND an
   in-panel reminder list.
3. **Outlook pushes BOTH** meetings (1:1 eventId, like milestones) AND info-schedule reminder
   instances (all-day events, tracked in an id map), reusing the Milestone calendar plumbing.

## Architecture

### A. Data model (`types.ts` + `sanitize.ts`)
```ts
export interface CommitteeMeeting { id: number; date: string; title: string; agenda?: string; location?: string; outlookEventId?: string; }
export interface InfoSchedule { id: number; label: string; leadDays: number; } // working days before each meeting
export interface SteeringCommittee {
  name: string;
  memberResourceIds: number[];                 // FK -> Resource.id (existing people layer)
  meetings: CommitteeMeeting[];
  infoSchedules: InfoSchedule[];
  infoReminderEventIds?: Record<string, string>; // "<meetingId>:<scheduleId>" -> Outlook eventId
}
// Workspace gains: steeringCommittee?: SteeringCommittee  (optional; absent until used)
```
`sanitizeSteeringCommittee(raw): SteeringCommittee | undefined` - the single validator: coerce/cap
strings, validate `date` as `YYYY-MM-DD` (drop bad meetings), `leadDays` int >= 0, ids via
`nextEntityId`-style max+1 on add; member ids re-validated against live resources at the editor
boundary (legacy/missing -> dropped). Never throws.

### B. Persistence (SIX write paths + codecs + fixtures)
`steeringCommittee` is a persisted Workspace field. Wire all six (JSON/CSV/MD/Turso single+tenant/
IndexedDB). Because it's a NESTED object (not a flat row table like tasks), follow the pattern used
by `Workspace.plan`/`status`/`fxRates` (the other non-tabular workspace fields):
- JSON: include in the object + `sanitizeSteeringCommittee` on load (`workspace.ts jsonToWorkspace`).
- CSV + Markdown: a dedicated section (mirror how `plan`/`status` are emitted - a keyed block, NOT a
  per-entity table). Add encode/decode in `csv-codecs.ts` + `markdown-codecs.ts`. Members/meetings/
  schedules serialize as JSON-in-cell or a sub-block (follow the existing `plan`/`status` approach;
  match its escaping).
- Turso single + tenant: a global single-row blob (like `plan`/`status` are stored), NOT in
  `TABLE_NAMES` as a per-row entity unless that's how plan/status do it - MATCH the existing
  non-tabular-field storage exactly (read how `status`/`plan` persist to Turso).
- IndexedDB/BrowserBackend: covered by the JSON object shape + the load normalizer.
- Then: REGENERATE `__fixtures__/golden-*` (legit new-field format change) + add a small committee to
  the curated `sample-workspace-small.md` (+ regen .json/.sqlite). `turso-migrate.ts` self-heals any
  new column.

### C. Pure reminder engine (`steering-reminders.ts`, i18n-free)
`dueInfoReminders(committee, today): InfoReminder[]` where
`InfoReminder = { meetingId, scheduleId, label, meetingTitle, meetingDate, dueDate, daysLeft, tier }`.
For each future meeting x infoSchedule: dueDate = `leadDays` WORKING days before `meeting.date`
(reuse the working-day helper in `due-dates.ts`; pass `today` in - no internal `Date.now()`). `tier`:
overdue/now if dueDate <= today and meeting still future; soon if within a small window; else upcoming.
Skip past meetings. Pure + fully unit-testable.

### D. Reminders surfaces (both)
- **Next-actions provider** `next-actions/providers/committee-info.ts`: `provide(input)` maps
  `dueInfoReminders` (fed via an optional `input.steeringCommittee` + `input.today`) to
  `SuggestedAction[]` (now/soon tiers, a `why.key`, source `"committee"`). Engine stays i18n-free;
  the surface translates. New `ActionInput` field MUST be optional (don't break provider test
  `input()` helpers). Register in the providers list; gate on the committee existing + the feature
  module if one applies.
- **In-panel list:** the committee panel renders `dueInfoReminders` directly (overdue/soon/upcoming).

### E. UI - Steering Committee view (`steering-committee-panel.tsx` + `nav-config.ts`)
New `AppView` + nav label. The panel:
- Committee name input; members via the shared ResourcePicker (multi-select of resources).
- Meetings table: add/edit/delete rows (date, title, agenda, location). Row-unique a11y labels.
- Info-schedules editor: add/edit/delete (label + lead working-days number).
- The in-panel reminder list (from `dueInfoReminders`).
- A "Push to Outlook" button (gated on M365 enabled), busy/disabled while pushing.
- Wire into BOTH shell header sites if it needs a top-bar control; the view itself routes via
  `nav-config` + the modern/classic shells (follow how Milestones/Stakeholders panels mount).
- AIPM tokens only. If the new view is added to `A11Y_VIEWS`, it's axe-scanned -> all controls labeled.

### F. Outlook push (`use-committee-outlook-push.ts` + reuse `outlook-calendar-write.ts`)
Mirror `use-outlook-calendar-push.ts` + `calendar-reconcile.ts`:
- **Meetings:** each meeting -> a timed event; store/reconcile via `meeting.outlookEventId` (1:1,
  exactly like milestones - create/update/delete).
- **Info-schedule instances:** the desired set = future meetings x infoSchedules (each with its
  computed dueDate); each -> an all-day reminder event; tracked in
  `infoReminderEventIds["<meetingId>:<scheduleId>"]`. The reconcile: create missing, update changed,
  DELETE + prune stale ids when a meeting/schedule is removed. Idempotent (re-push never duplicates).
- `Calendars.ReadWrite` via `useMsAuth().acquireToken({ interactive: true })`. Gated on M365 enabled;
  popout read-only. Status-only errors; consent-denied caught. After push, persist the updated
  eventIds back to the workspace (via the committee setter -> the six write paths).

## Error handling
- Sanitizer never throws; bad dates/ids dropped; caps on strings + list lengths.
- Outlook: status-only errors (mirror milestone push); never log/echo tokens or bodies; consent
  denial -> caught -> sanitized message; reconcile idempotent.
- Reminder engine: pure, total, never throws (empty committee -> []).
- Member ids re-validated against live resources (a deleted resource -> dropped from display).

## Testing (TDD)
Pure first:
- `dueInfoReminders` - working-day lead math, overdue/soon/upcoming tiers, past-meeting skip, empty.
- `sanitizeSteeringCommittee` - bad date/leadDays/ids dropped; caps; never throws; legacy `undefined`.
- the reconcile diff helper - create/update/delete/prune of meetings + info-instances (pure, no fetch).
Then:
- codec round-trip (CSV+MD) preserves the committee; golden fixtures regenerated + byte-stable.
- the next-actions provider - committee reminders -> actions (optional ActionInput field).
- panel component - members/meetings/schedules edit; reminder list; push button gated on M365;
  row-unique labels.
- Outlook push hook - meetings + info-instances reconcile (mock Graph); status-only errors.
- `npx tsc --noEmit` (EN/DE parity) after editing tests; axe gate IF the view is in `A11Y_VIEWS`.
- EN+DE i18n (DE via node UTF-8 write, real umlauts).

## i18n / release
- New EN+DE keys: nav label, panel headings, meeting/schedule field labels, reminder strings
  (provider why-keys + panel), the push button + busy/error, and `versionHighlightSteering`.
- Bump `version.ts` (0.111.0 "Chambers"), append the highlight key to `APP_HIGHLIGHT_KEYS`,
  add a `CHANGELOG.md` entry. Confirm `graph.microsoft.com` already in CSP (it is).

## File map
- `types.ts` - `SteeringCommittee`/`CommitteeMeeting`/`InfoSchedule` + `Workspace.steeringCommittee`.
- `sanitize.ts` - `sanitizeSteeringCommittee`.
- `steering-reminders.ts` (NEW pure) - `dueInfoReminders`.
- `committee-calendar-reconcile.ts` (NEW pure) - the meeting + info-instance reconcile diff.
- `next-actions/providers/committee-info.ts` (NEW) - the reminder provider.
- `steering-committee-panel.tsx` (NEW) + `nav-config.ts` - the view.
- `use-committee-outlook-push.ts` (NEW) - the push hook (reuses `outlook-calendar-write.ts`).
- `workspace.ts`, `csv-codecs.ts`, `markdown-codecs.ts`, Turso single+tenant schema, `browser-backend.ts` - six write paths.
- `__fixtures__/golden-*`, `sample-workspace-small.*` - regenerate.
- `i18n.ts` / `i18n.de.ts`, `version.ts`, `CHANGELOG.md`.
