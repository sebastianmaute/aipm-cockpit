# Two-way calendar sync SP1 — Milestone date-reschedule pull

**Date:** 2026-07-01
**Roadmap:** Two-way calendar sync (the READ direction complementing the shipped write-back). Realistic signal: a pushed all-day event carries only a date, so two-way = detect when a pushed event was **moved** in Outlook and reflect the new date onto the entity. SP1 pilots this on **milestones**; SP2 tasks, SP3 RAID+change, SP4 absences (date range), SP5 (optional) auto-pull + deletion semantics.

## Goal
Add a manual "Pull from Outlook" action to the Milestones view that fetches the app's pushed milestone events, detects date reschedules made in Outlook, applies the non-conflicting ones to milestone `date`, and surfaces conflicts + deletions for the PM — without ever silently overwriting a local edit.

## Decisions (from brainstorming)
- **Core behavior:** date-reschedule pull (Outlook move → entity date). Nothing else pulls (app owns all other fields).
- **Conflict rule:** app-wins + flag. Auto-apply only when the entity has no competing local change since last sync; otherwise flag a conflict for manual resolution.
- **Rollout:** milestones pilot first.
- **Trigger:** manual button only (auto-pull is a later SP).
- **Deletion:** flag only, no auto-action (a deleted/cancelled Outlook event is reported, never auto-unlinked — avoids the auto-push re-create fight; durable unlink needs a per-entity opt-out, deferred).

## Architecture

### 1. Read infra — `outlook-calendar-read.ts` (new, i18n-free)
`fetchProjectEventDates(token: string, projectId: string): Promise<PulledEvent[]>` where `PulledEvent = { id: string; date: string | null; isCancelled: boolean }`.
- Queries `${GRAPH}/me/events?$filter=categories/any(c:c eq '<bareCat>')&$select=id,start,isCancelled,type&$top=100`, paging via `@odata.nextLink` (mirror `listEntityEvents`). `bareCat = categoryFor(projectId)` (milestones use the BARE project category, shared with committee events — matching is by stored `outlookEventId`, not category alone, so committee events simply don't match any milestone id).
- `date` = the all-day event's `start.dateTime` sliced to `YYYY-MM-DD` (all-day starts are midnight UTC); malformed/missing → `null`.
- Reuse the existing `graphGet` + `GRAPH` const + `MAX_PAGES`. (These are currently module-private in `outlook-calendar-write.ts`; export `graphGet`/`GRAPH`/`MAX_PAGES` or lift them into a shared `outlook-graph.ts` leaf that both read+write import. Prefer the small shared leaf to avoid a read→write dependency.)

### 2. Pure diff/conflict engine — `calendar-pull.ts` (new, i18n-free)
```
type PullEntity = { id: number; date: string; outlookEventId?: string };
type PullPlan = {
  applies: { id: number; eventId: string; newDate: string }[];
  conflicts: { id: number; eventId: string; appDate: string; outlookDate: string }[];
  deletions: { id: number; eventId: string }[];
};
planCalendarPull(args: {
  entities: readonly PullEntity[];
  events: readonly PulledEvent[];          // from fetchProjectEventDates
  baseline: Record<string, string>;        // eventId -> last-synced date
}): PullPlan
```
Per entity with a non-empty `outlookEventId`:
- matching event missing, or `isCancelled`, or `event.date === null` → **deletion**.
- `event.date !== entity.date`:
  - `baseline[eventId] === entity.date` → **apply** `{id, eventId, newDate: event.date}` (entity unchanged locally since last sync; Outlook moved).
  - else → **conflict** `{appDate: entity.date, outlookDate: event.date}` (both changed, OR no baseline entry — bootstrap safety: never auto-apply when the baseline is unknown).
- `event.date === entity.date` → no-op (and, if `baseline[eventId]` is missing/stale, the caller refreshes it to the agreed date — self-heals the baseline).
Pure: no `Date.now()`/`new Date()`, no i18n. Fully unit-tested.

### 3. Per-device sync baseline — `calendar-sync-baseline.ts` (new)
Per-device store `lop-app:calendar-sync-baseline` (mirrors `landing-state.ts`): a validated `Record<string, string>` map keyed `${projectId}:${entityType}:${eventId}` → last-synced `YYYY-MM-DD`. Exports `loadBaseline()`, `readBaselineDate(projectId, entityType, eventId)`, `writeBaselineDate(projectId, entityType, eventId, date)`, `removeBaselineEntry(...)`. OUT of exports/Turso/CSV/MD; cleared by `clearAppConfig`'s `lop-app:*` sweep (no new code there — the prefix sweep already covers it).
- Written on every successful **push** (record the pushed entity date — a small hook into the existing milestone push success path) and on every **pull-apply / conflict-resolve** (record the applied date).
- **Bootstrap:** a milestone pushed before this feature has no baseline entry → `planCalendarPull` treats any Outlook mismatch as a conflict (not an apply). After the first agreed sync the baseline is populated and subsequent moves auto-apply.

### 4. Apply hook — in `task-manager.tsx` (mirrors the push wiring)
`pullMilestonesFromOutlook()`: acquire an **interactive** Graph token → `fetchProjectEventDates` → `planCalendarPull({ entities: milestones, events, baseline: loadBaseline()-slice })` → hold the `PullPlan` in state to drive the summary modal. Applying an entry sets `milestone.date = newDate` via functional `setMilestones` and `writeBaselineDate(...)`. It does **NOT** bump `localModifiedAt` (Outlook-sourced sync, not a local edit) — but it DOES go through the normal milestone save/persist path so the new date is written to the backend. Busy flag `calendarPullBusy`; popout no-op; gated on m365.

### 5. Surfacing — post-pull summary modal (`calendar-pull-summary-modal.tsx`, new)
Opens after a pull returns a non-empty plan:
- **Applied** (N): read-only list "‹milestone› → ‹newDate›" (already applied).
- **Conflicts** (M): each row shows app date vs Outlook date + two buttons — *Keep app date* (drop; refresh baseline to app date so it stops conflicting) / *Take Outlook date* (apply + baseline). Row-unique accessible names.
- **Deletions** (K): notice list "‹milestone›'s Outlook event was removed" — informational only (no action in SP1).
- If the plan is entirely empty → a toast "Already in sync", no modal.
Uses the shared `Modal` (stacks correctly). Milestones IS in axe `A11Y_VIEWS` → the button + modal controls need accessible names; verify with the Milestones axe run.

### 6. UI wiring
- "Pull from Outlook" button beside the existing "Push to Outlook" on the Milestones toolbar (`milestones-panel.tsx` already takes `calendarPushBusy` + renders the push button ~line 272). Add props `onPullCalendar?`, `calendarPullBusy?` threaded task-manager → `workspace-section-types` → `workspace-section` → `milestones-panel`, gated `m365Configured && !isPopout && onPullCalendar`.
- i18n EN/DE: `calendarPull` ("Pull from Outlook"), `calendarPulling` ("Pulling…"), plus summary-modal strings (`calendarPullSummaryTitle`, `calendarPullApplied`, `calendarPullConflicts`, `calendarPullDeletions`, `calendarPullKeepApp`, `calendarPullTakeOutlook`, `calendarPullInSync`, `calendarPullEventRemoved`). DE via node utf8 write.

## Graph / security
- Read uses `/me/events` (already CSP-allowed; no new host). Token scope `Calendars.Read` is implied by the existing `Calendars.ReadWrite`; reuse the push's `acquireToken` path (interactive for the manual pull). Never log token/body. 404/transient errors → a sanitized "couldn't reach Outlook" toast (mirror the push error handling).

## Testing
- `calendar-pull.test.ts` (pure): apply (baseline matches app date), conflict (both changed), conflict (no baseline / bootstrap), deletion (missing event), deletion (isCancelled), null-date event, no-op (dates equal), empty inputs.
- `calendar-sync-baseline.test.ts`: read/write/remove, validated load (bad JSON → {}), key format.
- `outlook-calendar-read.test.ts`: `fetchProjectEventDates` maps start→date, flags isCancelled, pages (mock graphGet).
- `milestones-panel.test.tsx` / summary-modal test: button renders gated on m365+handler+!popout; summary modal lists applied/conflicts/deletions; conflict resolve buttons fire the right callback.
- `npx tsc --noEmit`, `npm run lint`, Milestones axe run.

## File structure
- New: `outlook-graph.ts` (shared leaf: `GRAPH`, `graphGet`, `MAX_PAGES`), `outlook-calendar-read.ts`, `calendar-pull.ts`, `calendar-sync-baseline.ts`, `calendar-pull-summary-modal.tsx` (+ tests).
- Modified: `outlook-calendar-write.ts` (import the shared leaf instead of local consts — no behavior change), the milestone push success path (write baseline), `task-manager.tsx`, `workspace-section-types.ts`, `workspace-section.tsx`, `milestones-panel.tsx`, `i18n.ts`, `i18n.de.ts`.

## Out of scope (SP1)
Auto-pull; unlink/opt-out deletion semantics; tasks/RAID/change/absence; pulling any field other than the date; two-way for committee events.

## Sequencing note
Independent of the unreleased `feat-absence-sync-polish` branch (disjoint files apart from a no-behavior import move in `outlook-calendar-write.ts`). Can branch SP1 from `main`; if the polish merges first, rebase is trivial.
