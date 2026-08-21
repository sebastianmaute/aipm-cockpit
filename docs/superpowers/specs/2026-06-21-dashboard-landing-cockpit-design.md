# Dashboard Landing Cockpit — Design

**Date:** 2026-06-21
**Status:** Approved (design)

## Goal

Turn the project Dashboard from an analytical status report into a PM **landing-page cockpit** that answers three questions in five seconds: *What changed since I last looked? What needs me today? What's coming?* Three Tier-1 additions in one slice: a "Since you last looked" delta strip, the engine-ranked top-actions queue promoted above the fold, and a synthesized greeting/summary line.

## Background / current state

`dashboard-panel.tsx` renders (top→bottom): RAG band + override selects, editable narrative, progress/burn (EVM, burndown), registers band (top RAID / overdue / due-soon tasks), milestones + changes, Turso trends, **top actions (bottom)**, recent activity. Pure aggregation lives in `dashboard.ts` (`computeDashboard` → `DashboardModel`). The panel is a **static** (non-lazy) panel imported directly in `workspace-section.tsx`. Dashboard **is** in the axe `A11Y_VIEWS` 12-view gate.

`topActions` (the deterministic `next-actions/` engine output, already threaded as a prop) is buried at the very bottom — wrong place for a landing page's "what needs me" answer.

Two signal sources already exist:
- **Activity log** (`activity-log.ts`): per-browser localStorage, chronological `ActivityEntry { timestamp, kind, args }`, capped 500. Records created/updated/deleted/completed/status-changed/synced for tasks, RAID, milestones, changes, etc. **Global, not project-scoped.**
- **RAG model**: `DashboardModel.{overall,schedule,budget,scope}.effective` (Health `R|A|G` or null). Derived each render; no prior snapshot is stored.

A stable per-project id is available in `task-manager.tsx` as `calendarProjectId = portfolioCurrentId || project?.code || "default"` (registry/tenant id → ProjectMeta.code → `"default"`). Per-project state (RAG snapshot, last-visit) MUST key off this so switching projects cannot cross-contaminate the diff.

## Architecture

Four new units (pure engine isolated from React / storage / i18n, mirroring the existing `dashboard.ts` ↔ `dashboard-panel.tsx` split) plus a layout reorder and prop threading.

### Unit 1 — `dashboard-delta.ts` (pure, i18n-free)

The single testable core. No React, no I/O.

```ts
export type RagScope = "overall" | "schedule" | "budget" | "scope";
export type LandingState = {
  lastVisitAt?: string;                              // ISO timestamp of prior visit
  rag?: Partial<Record<RagScope, Health>>;           // RAG snapshot at prior visit
};

export type DeltaGroup = "tasks" | "raid" | "milestone" | "change";
export type DeltaCounts = Record<DeltaGroup, {
  created: number; updated: number; completed: number; statusChanged: number;
}>;
export type RagFlip = { scope: RagScope; from: Health | null; to: Health | null; worsened: boolean };

export type DeltaResult = {
  isFirstVisit: boolean;          // prior.lastVisitAt undefined
  since?: string;                 // prior.lastVisitAt (for "since <date>" copy)
  counts: DeltaCounts;            // activity grouped by entity + verb, timestamp > since
  newOverdue: Task[];             // overdue now AND dueDate >= since-date (newly crossed)
  ragFlips: RagFlip[];            // prior.rag[scope] !== current[scope]
  total: number;                  // sum of all activity counts + newOverdue + ragFlips; 0 ⇒ "all caught up"
};

export function computeDelta(args: {
  prior: LandingState;
  activity: readonly ActivityEntry[];
  currentRag: Record<RagScope, Health | null>;
  overdue: readonly Task[];       // model.overdue
  today: string;
}): DeltaResult;
```

**Rules:**
- `isFirstVisit` ⇒ `prior.lastVisitAt` is undefined. First visit: `counts` all zero, `newOverdue` empty, `ragFlips` empty, `total` 0 — the strip shows a "Welcome" variant, not noise.
- Activity grouped by `activityGroupOf`-style prefix mapping to `DeltaGroup` (task→tasks, raid→raid, milestone→milestone, change→change; other kinds ignored for the strip). Verb derived from the kind suffix (`.created`/`.updated`/`.completed`/`.statusChanged`; `.deleted` ignored — a deleted item isn't actionable from the strip). `task.reopened` counts as `updated`. `raid.autoIssue` counts as `created`.
- `newOverdue`: tasks in `overdue` whose `dueDate >= since-date` (the date slice of `lastVisitAt`). Approximation — activity log doesn't reliably record dueDate edits, so "newly overdue" means "became due on/after last visit and is now past." Documented as approximate.
- `ragFlips`: for each scope, compare `prior.rag[scope]` (may be undefined → treated as null) to `currentRag[scope]`. Emit only when different. `worsened` = rank(to) > rank(from) using `R:3,A:2,G:1,null:0`.

### Unit 2 — `landing-state.ts` (per-browser localStorage store)

Mirrors `activity-log.ts` exactly (same defensive parse, try/catch, SSR guard, cap).

- Single key `lop-app:landing-state` holding `Record<string, LandingState>` keyed by projectId.
- `loadLandingState(projectId): LandingState` — returns `{}` when absent/corrupt.
- `saveLandingState(projectId, state): void` — merges into the map, caps the map at the **50 most-recently-written** projects (drop oldest by `lastVisitAt`, undefined sorts oldest), tolerant of quota errors.
- `clearLandingState(): void` — removes the key (for completeness / tests).
- Per-browser, per-project. NOT a Workspace field → zero impact on the 6 backend write paths. Cleared by the existing `clearAppConfig` (`lop-app:*` sweep). Never in exports / Turso / recovery `CONFIG_KEYS`.

### Unit 3 — `use-landing-delta.ts` (hook)

```ts
export function useLandingDelta(args: {
  projectId: string;
  currentRag: Record<RagScope, Health | null>;
  overdue: readonly Task[];
  today: string;
  isPopout: boolean;
}): DeltaResult;
```

- **Mount capture (no set-state-in-effect):** `const [delta] = useState(() => computeDelta({ prior: loadLandingState(projectId), activity: loadActivityLog(), currentRag, overdue, today }))`. Reads the PRIOR snapshot before advancing, so the strip reflects what changed since last time.
- **Debounced advance (side-effect only):** `useEffect(() => { if (isPopout) return; const id = setTimeout(() => saveLandingState(projectId, { lastVisitAt: new Date().toISOString(), rag: snapshotOf(currentRag) }), 4000); return () => clearTimeout(id); }, [])`. Writes the NEW snapshot 4s after mount so the strip stays readable this visit and the next visit diffs from now. `new Date()` lives in the timeout callback, never a render body. localStorage write only — no setState → passes the react-hooks purity + set-state-in-effect rules.
- **Popout:** read-only — compute the delta for display but skip the advancing write (popouts must not mutate device state).
- Empty `projectId` ("default" never empty in practice, but guard) still works — keys under `"default"`.

### Unit 4 — `dashboard-delta-strip.tsx` (presentational) + greeting

Pure render, all copy via props/`t`. Lives at the very top of the panel.

- **Greeting line:** from pure `buildGreeting(hour, counts)` in `dashboard-delta.ts` (keys + args, i18n-free). Returns `{ greetingKey: "dashboardGreetingMorning"|"...Afternoon"|"...Evening", summary: { needsYou: number, milestonesSoon: number } }`. Thresholds: morning < 12, afternoon < 18, else evening. `hour` captured once via lazy `useState(() => new Date().getHours())` in the panel (purity rule). `needsYou` = `topActions.length`; `milestonesSoon` = overdue + at-risk + due-soon milestone count from the model.
- **Delta chips:** one chip per non-zero signal — e.g. "4 tasks updated", "1 RAID raised", "2 milestones due", plus RAG flips rendered as "Schedule G→A" with a `RagBadge`. Each clickable chip routes via the existing `onOpenTask/onOpenRaid/onOpenMilestone` handlers (chips that map to a register). RAG-flip chips are non-interactive labels.
- **States:** first visit → "Welcome" copy (no chips). Zero delta → subtle "All caught up since {date}". Otherwise → greeting + chips.
- **a11y:** interactive chips are `<button>` with row-unique accessible names (`${verb} – ${group}` qualified) — Dashboard is axe-scanned. Non-interactive flip labels are plain text/badges.

### Layout reorder — `dashboard-panel.tsx`

New order: **(1) delta strip + greeting → (2) Top actions** (moved up from bottom; same `ActionRow` rendering) **→ (3) health band** with the four RAG `OverrideSelect`s folded into a native `<details><summary>Adjust health</summary>` disclosure (keyboard-operable, collapsed by default; the big "Overall: <color>" headline + report-date stay visible) → (4) narrative → (5) progress/burn → (6) registers → (7) milestones/changes → (8) trends → (9) recent activity.

Top-actions block is removed from its old bottom position; recent activity stays at the bottom (no longer paired with actions — render it full-width or keep the grid with trends; simplest: standalone `Section`).

### Wiring

- `task-manager.tsx`: pass `projectId={calendarProjectId}` and `isPopout` (already in scope) to `DashboardPanel`.
- `workspace-section.tsx`: thread `projectId` through to the static `DashboardPanel`. Add `projectId: string` to its props type. (No `workspace-panels.tsx` change — Dashboard is a static, not lazy, panel.)
- `DashboardPanel` calls `useLandingDelta(...)` with the model's effective RAGs mapped to `Record<RagScope, Health|null>`.

### i18n (EN + DE, key parity enforced by tsc; DE via node utf8 write with real umlauts)

New keys (~12): `dashboardGreetingMorning`, `dashboardGreetingAfternoon`, `dashboardGreetingEvening`, `dashboardGreetingSummary` (`"{0} items need you · {1} milestones soon"`, 0-based placeholders), `dashboardDeltaWelcome`, `dashboardDeltaAllCaught` (`"All caught up since {0}"`), `dashboardDeltaSince`, `dashboardDeltaTasksUpdated`, `dashboardDeltaRaidRaised`, `dashboardDeltaMilestonesDue`, `dashboardDeltaChanges`, `dashboardDeltaFlip` (`"{0}: {1}→{2}"`), `dashboardAdjustHealth` (disclosure summary). Exact key list finalized in the plan; counts use positional args.

## Error handling

- Corrupt / missing `lop-app:landing-state` → `loadLandingState` returns `{}` (first-visit behavior), never throws (try/catch like activity-log).
- localStorage quota / disabled → `saveLandingState` swallows (strip just won't advance; non-fatal).
- `computeDelta` is total: empty activity, empty overdue, all-null RAG → `total: 0`, `isFirstVisit` per prior. No NaN, no throws.
- Popout: never writes device state.

## Testing

- `dashboard-delta.test.ts` — first visit, verb/group mapping, `.deleted` ignored, RAG flips (incl. null↔value, worsened flag), newOverdue date boundary, `total` zeroing, `buildGreeting` thresholds.
- `dashboard-delta.property.test.ts` — fast-check: counts never negative; `total === 0 ⇔ no signals`; flip emitted ⇔ from≠to; idempotent under empty activity. (Heed: `fc.date()` Invalid Date → use ms-range→`new Date(ms)`; no `/s` regex flag.)
- `landing-state.test.ts` — round-trip, per-project isolation, 50-project cap (oldest dropped), corrupt input → `{}`, quota-error tolerance.
- `dashboard-panel.test.tsx` — strip renders greeting + chips; chip click invokes the right `onOpen`; `<details>` disclosure present and labeled; top-actions now above the band.
- a11y: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"` green before push.
- `npx tsc --noEmit` (i18n parity + test-only type errors), `npm run lint` (`--max-warnings=0`), `npm run test:run`.

## Release

Bump `version.ts` (APP_VERSION + new milestone codename), `CHANGELOG.md` entry, append `versionHighlightLandingCockpit` to `APP_HIGHLIGHT_KEYS` + EN/DE strings, README badge, `package.json` version.

## Decisions (defaults; flagged in design review, may revisit)

- Debounce to advance last-visit: **4 s**.
- Project map cap: **50** most-recent.
- `newOverdue` is approximate (dueDate ≥ last-visit date), since activity log doesn't track dueDate edits.
- Greeting time thresholds: morning < 12:00, afternoon < 18:00, evening otherwise.
- Strip hidden entirely? No — zero-delta returning users see "All caught up"; the greeting always renders (it's the landing identity).

## Out of scope (future slices)

Trend arrows on tiles (#4), milestone horizon strip (#5), burndown sparkline tile (#6), empty-state coaching CTAs (#7), density toggle (#8), full click-through parity (#9).
