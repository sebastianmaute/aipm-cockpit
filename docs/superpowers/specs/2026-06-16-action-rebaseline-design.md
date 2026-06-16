# Action Re-baseline — design spec

**Roadmap:** Execution-depth slice 5 ("From Reports → Next-Best-Action"). Follows
create-task (0.84.0 "Cherryh"), assign-owner (0.86.0 "Hamilton"), draft-message
(0.87.0 "Wells"), escalate (0.92.0 "Asaro"). Comm-templates SP1–SP4 (0.88–0.91) were a
detour off slice 3's draft-message send path.

**Goal:** A "Re-baseline" CTA on drifting Action Center rows that, in one confirm
popover, lets the user accept the drift as the new plan — either by **moving a slipping
milestone's target date** (milestone rows) or by **capturing the project's current state
as the new variance baseline** (schedule/budget rows).

**Architecture:** Surface-only — the `next-actions/` engine is untouched, exactly like
the prior four slices. **No new persisted field:** the milestone path moves an existing
`milestone.date` (serializers already cover it — no 6-write-paths concern); the
schedule/budget path writes the existing Turso snapshot tables (already out of
`TABLE_NAMES`). Reuses `milestoneForecast` (`snapshot.ts`), `useSnapshots`, and the
4-slice CTA threading pattern.

## Decisions (locked in brainstorming)

| Question | Decision |
|----------|----------|
| What does Re-baseline do? | **Hybrid** — milestone rows move the date (B); schedule/budget rows snapshot-rebaseline (A) |
| Which rows? | **milestone** (`atRisk`/`overdue`) for B; **schedule** (`slipping`) + **budget** (`worsening`) for A |
| Milestone new date? | **Editable date input, prefilled `max(forecast, today)`** — user accepts or adjusts |
| Snapshot baseline source? | **Capture a fresh snapshot now** and flag it baseline (prior baseline kept in history) |
| Confirm UX? | **Single confirm popover** (B has a date field; A is a plain confirm) |
| Backends | B works on ALL backends; A is **Turso-gated** (`snapshotActive`) |
| Audit / undo? | **None** — append-only snapshots + version history already cover recovery |

## 1. CTA gate (`action-row.tsx`)

Two non-overlapping activation rules, keyed by `action.source`, mirroring escalate's
`canEscalate`:

```ts
const canRebaselineMilestone =
  rebaseline != null &&
  action.source === "milestone" &&
  (action.why.key === "actionMilestoneWhyAtRisk" ||
   action.why.key === "actionMilestoneWhyOverdue") &&
  action.cta.kind === "open";

const canRebaselineSnapshot =
  rebaseline != null &&
  rebaseline.snapshotActive &&
  ((action.source === "schedule" && action.why.key === "actionScheduleWhySlipping") ||
   (action.source === "budget"   && action.why.key === "actionBudgetWhyWorsening")) &&
  action.cta.kind === "open";
```

The `rebaseline` bundle is always supplied when `!isPopout`. The snapshot sub-path is
additionally guarded by `snapshotActive = tursoConfig !== null && snapshotsCfg.enabled`,
so a Turso-off project still shows the milestone CTA but never the snapshot CTA. A new
"Re-baseline" button (shown when either rule is true) opens `RebaselinePopover`. The
popover is **extracted** (not inlined) to keep `action-row.tsx` manageable.

Non-overlap with prior slices: milestone rows already show neither Assign-owner nor
Escalate (those are raid-only); schedule/budget rows show no other CTA. No collision.

## 2. Pure logic — `src/app/action-rebaseline.ts` (i18n-free)

`milestoneForecast` is currently a private function in `snapshot.ts` (lines 132–143);
**export it** so this module reuses it (DRY) rather than re-deriving the forecast.

```ts
import { milestoneForecast } from "./snapshot";
import type { Milestone, Task } from "./types";

// Prefill target for a milestone re-baseline: the later of its forecast finish
// (max of its date and any linked task's effective end) and today. Guarantees a
// future-or-today date even for an overdue milestone with no slipping linked tasks.
export function milestoneRebaselineDate(
  m: Milestone, tasks: readonly Task[], today: string,
): string {
  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const forecast = milestoneForecast(m, tasksById);
  return forecast > today ? forecast : today;
}

// Immutable; returns the SAME array ref when no milestone matches (mirrors
// applyEscalation / applyOwnerAssignment so the caller can short-circuit).
export function applyMilestoneRebaseline(
  milestones: readonly Milestone[], id: number, newDate: string,
): readonly Milestone[] {
  if (!milestones.some((m) => m.id === id)) return milestones;
  return milestones.map((m) => (m.id === id ? { ...m, date: newDate } : m));
}

// Strict YYYY-MM-DD validity (shape + real calendar date). No existing helper.
export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
```

`milestoneForecast` body (for reference; unchanged, just exported):

```ts
export function milestoneForecast(m: Milestone, tasksById: ReadonlyMap<number, Task>): string {
  let latest = m.date;
  for (const id of m.linkedTaskIds) {
    const t = tasksById.get(id);
    if (!t) continue;
    const end = t.completedDate || t.dueDate;
    if (end && end > latest) latest = end;
  }
  return latest;
}
```

## 3. RebaselinePopover — `src/app/rebaseline-popover.tsx`

`role="dialog"` mirroring escalate's a11y pattern in `escalate-popover.tsx`: focus the
first focusable on open, close on Escape via a **document-level** keydown listener,
`stopPropagation` on the dialog so a row-click doesn't fire. Reset local state on open
and after confirm. Branches on `action.source`:

**Milestone variant** (`source === "milestone"`):
- Description line `actionRebaselineMilestoneDesc` with param `[milestone name]`.
- Optional hint `actionRebaselineForecastHint` with param `[forecast date]`.
- A `<label>`-wrapped `<input type="date">` (label text = `actionRebaselineNewDate`),
  **also** carrying `aria-label={t(lang, "actionRebaselineNewDate")}` (placeholder/label
  belt-and-suspenders — the a11y gate treats a placeholder as no accessible name).
  Prefilled with `milestoneRebaselineDate(item, tasks, today)`.
- Confirm button (`actionRebaselineConfirm`), **disabled until** `isValidIsoDate(value)`.
  On click → `onRebaselineMilestone(item.id, value)` then close.

The popover looks the milestone up from `bundle.milestones` via `action.cta.id`; if the
lookup misses (deleted source), it renders nothing / no-ops.

**Snapshot variant** (`source === "schedule" | "budget"`):
- Description line `actionRebaselineSnapshotDesc` ("Capture the current state as the new
  baseline. Future variance is measured from now; the previous baseline stays in
  history.").
- Confirm button (`actionRebaselineConfirm`) → `onRebaselineSnapshot()` then close.

Accessible name: dialog has `aria-label` (`actionRebaselineTitle`); confirm has a text
label; the date input is labeled. Palette: only sanctioned tokens, no off-palette
shadows/gradients.

## 4. Hook addition — `src/app/use-snapshots.ts`

`useSnapshots` already exposes `captureNow()` and `setBaseline(id)`, but neither returns
the new record's id, so combining them surface-side would race the async state reload.
Add an atomic method:

```ts
// Build a fresh snapshot now, append it, and flag it as THE baseline — all using the
// known record id (no race). Mirrors captureNow's error routing (busy guard + onError).
const rebaselineNow = useCallback(async () => {
  // Append with isBaseline:false, then let setBaseline do the atomic clear-and-flag
  // using the known record id — no async-state race.
  const rec = makeRecord("manual", /* isBaseline */ false, currentBucket);
  await storeAppend(cfgRef.current, rec, pidRef.current);
  await setBaselineStore(cfgRef.current, rec.id, pidRef.current);
  await reload();
}, [/* same deps as captureNow */]);
```

Implementation detail pinned by the plan: reuse the existing `makeRecord` / `storeAppend`
(`appendSnapshot`) / `setBaseline` (`snapshot-store.ts`) internals; route failures
through the hook's existing `onError`/`busy` handling exactly as `captureNow` does. Expose
`rebaselineNow` on `UseSnapshotsResult`.

## 5. Data flow — `RebaselineBundle`

Mirrors `EscalateBundle`:

```ts
export interface RebaselineBundle {
  // Milestone (B) path — all backends:
  milestones: readonly Milestone[];
  tasks: readonly Task[];
  onRebaselineMilestone: (id: number, newDate: string) => void;
  // Schedule/budget (A) path — Turso-gated:
  snapshotActive: boolean;
  onRebaselineSnapshot: () => void;
}
```

Threaded **task-manager → workspaceProps → workspace-section → ActionsPanel → ActionRow
→ RebaselinePopover**, gated `!isPopout` (same as the other CTAs; `ActionsPanel` renders
in `workspace-section.tsx`, and renders TWO ActionRow lists — tier + monitor — so the
prop must thread to BOTH).

Handlers in `task-manager.tsx`:

```ts
const handleRebaselineMilestone = useCallback((id: number, newDate: string) => {
  if (!isValidIsoDate(newDate)) { window.alert(t(lang, "errorInvalidDate")); return; }
  const next = applyMilestoneRebaseline(milestones, id, newDate);
  if (next !== milestones) setMilestones(next as Milestone[]);
}, [milestones, setMilestones, lang]);

const handleRebaselineSnapshot = useCallback(() => {
  void snapshots.rebaselineNow();
}, [snapshots]);

const rebaselineBundle = useMemo<RebaselineBundle | undefined>(
  () => isPopout ? undefined : {
    milestones, tasks,
    onRebaselineMilestone: handleRebaselineMilestone,
    snapshotActive: tursoConfig !== null && snapshotsCfg.enabled,
    onRebaselineSnapshot: handleRebaselineSnapshot,
  },
  [isPopout, milestones, tasks, handleRebaselineMilestone, handleRebaselineSnapshot,
   tursoConfig, snapshotsCfg.enabled],
);
```

`rebaseline: rebaselineBundle` is added to `workspaceProps`.

**Validate-before-mutate** (the escalate review lesson): the milestone handler checks
`isValidIsoDate` BEFORE `applyMilestoneRebaseline`. The popover already disables confirm
until valid, so this is defense in depth.

## 6. Error handling / edge cases

- **Invalid date** → `window.alert(errorInvalidDate)`, no mutation (matches escalate's
  `errorInvalidEmail` guard; confirm is already disabled until valid).
- **Deleted milestone** (`some` miss) → `applyMilestoneRebaseline` returns same ref →
  `setMilestones` skipped (no-op, no churn).
- **Overdue milestone, no slipping linked tasks** → forecast ≤ today → prefill = today.
- **Turso write fails** (A path) → routed through the snapshots hook's existing
  `onError` toast; no partial state (append + setBaseline both run server-side per record).
- **Project with zero prior snapshots** (A path) → `rebaselineNow` still appends the
  fresh record and flags it; it simply becomes the first baseline.
- **mailto / window** — none here; this slice mutates local state and Turso only.

## 7. New i18n keys (EN + DE)

| Key | Params | EN (sketch) |
|-----|--------|-------------|
| `actionRebaseline` | — | "Re-baseline" (row button) |
| `actionRebaselineTitle` | — | "Re-baseline" (dialog label) |
| `actionRebaselineMilestoneDesc` | `{0}` name | "Accept the slip and move milestone “{0}” to a new target date." |
| `actionRebaselineNewDate` | — | "New target date" (date field label) |
| `actionRebaselineForecastHint` | `{0}` date | "Forecast finish: {0}" |
| `actionRebaselineSnapshotDesc` | — | "Capture the current state as the new baseline. Future variance is measured from now; the previous baseline stays in history." |
| `actionRebaselineConfirm` | — | "Re-baseline now" (confirm button) |
| `errorInvalidDate` | — | "Enter a valid date (YYYY-MM-DD)." |
| `versionHighlightRebaseline` | — | release highlight string |

Interpolation is 0-based positional (`{0}`). DE strings via node UTF-8 CRLF write with
real umlauts — never the Edit tool. Append `versionHighlightRebaseline` to
`APP_HIGHLIGHT_KEYS`.

## 8. Testing

- `action-rebaseline.test.ts`:
  - `milestoneRebaselineDate` — slipping (linked task pushes past today → forecast);
    overdue with no slip (forecast ≤ today → today); no linked tasks (→ max(date, today)).
  - `applyMilestoneRebaseline` — moves the matched milestone immutably; **same array ref**
    when id missing; other milestones untouched.
  - `isValidIsoDate` — accepts `2026-06-16`; rejects `2026-13-01`, `2026-6-1`, `""`, junk.
- `rebaseline-popover.test.tsx`:
  - Milestone variant: date input prefilled; confirm disabled until a valid date; clicking
    Re-baseline fires `onRebaselineMilestone(id, date)` then closes.
  - Snapshot variant: renders the confirm; clicking fires `onRebaselineSnapshot`.
  - Renders in EN **and** DE (`loadI18n("de")` in `beforeAll`; `Lang` is `"en-US"` — there
    is no `"en"`).
- `action-row.test.tsx` (non-overlap guards): Re-baseline shows for a milestone at-risk
  row, a milestone overdue row, a schedule-slipping row (when `snapshotActive`), and a
  budget-worsening row; hidden for raid rows; hidden when the bundle is absent; the
  snapshot CTA is hidden when `snapshotActive === false`.
- i18n EN/DE key parity (tsc-enforced); `i18n-encoding` test passes.

## Out of scope (explicit, with rationale)

- **Per-task / budget-bucket re-baseline** — no Action Center row fires for individual
  task or bucket baseline drift (the drift signals are aggregate project SPI/CPI), so
  there is no CTA anchor; the whole-project snapshot path already captures budget+schedule
  state. Would require new drift providers first (YAGNI).
- **Baseline history UI** — already exists (Trends/Snapshots pane lists snapshots, offers
  `setBaseline`, and renders `computeVariance`). Re-baseline writes into that machinery;
  duplicating it is wasted work.
- **Auto re-baseline** (threshold-triggered, no click) — re-baselining hides variance;
  doing it silently destroys the slip signal the PM needs. Must be a deliberate
  accept-the-slip act, like every prior slice's click-to-confirm.
- **Undo** — both paths are already recoverable: A keeps the prior baseline as an
  append-only snapshot (re-select in Trends); B's date change lands in version history and
  is a normal editable field. A bespoke undo would re-implement existing recovery.

## Process notes (apply during implementation)

- **Final whole-branch review is mandatory** — for the prior four slices it caught
  cross-cutting gaps (recipient validation, validate-before-mutate ordering) that per-task
  reviews missed.
- Re-check imports after every extract/refactor — CI runs `--max-warnings=0`; an unused
  import is fatal.
- DE strings via node UTF-8 CRLF write; verify with the encoding test. Never edit
  `i18n.de.ts` with the Edit tool (corrupts umlauts + curls quotes).
- Releasing: bump `version.ts` (APP_VERSION 0.93.0 + milestone), CHANGELOG entry, append
  the new `versionHighlightRebaseline` key to `APP_HIGHLIGHT_KEYS` (+ EN/DE).
