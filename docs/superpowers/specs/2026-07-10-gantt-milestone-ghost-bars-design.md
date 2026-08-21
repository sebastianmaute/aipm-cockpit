# Gantt milestone ghost bars (audit #23) — design

_2026-07-10. Overlay each Gantt milestone's committed baseline date behind its live
diamond to make schedule slip visible where PMs plan. Milestone-only (tasks have no
per-task baseline in snapshots). Turso-gated._

## Problem

Rebaseline CTAs + Turso snapshots capture a project baseline, but the Gantt shows only
the *current* milestone date — there is no visual of how far a milestone has slipped from
its committed date. Verified 2026-07-10: no baseline/ghost bar exists today; snapshots are
Turso-only and store per-milestone `target`/`forecast` dates but **no per-task** baseline
dates, so this is milestone-only by necessity.

## Decisions (locked with user)

- **Baseline source:** the pinned `isBaseline` snapshot's per-milestone **`target`** date (the
  committed PM baseline). Not `forecast`, not the latest snapshot.
- **Visual:** hollow ghost diamond at the baseline date + dotted connector to the live diamond
  + a small `+Nd` / `−Nd` slip label.
- **Control:** a Gantt-toolbar **Baseline** toggle (mirrors the critical-path toggle), **default
  ON**, persisted in gantt prefs; the toggle button renders only when baseline data exists.

## Data flow (approach A — derive in task-manager, thread a lean map)

`useSnapshots` already loads snapshots once in `task-manager`. A pure selector picks the
baseline snapshot's milestone targets into a `Map<milestoneId, targetISO>`; task-manager
memoizes it (gated on `trendsActive`) and threads ONE prop down the existing chain to
GanttPanel. No new Turso reads (rejected approach C re-loaded → the portfolio `SQLITE_BUSY`
lesson); no snapshot-domain logic inside the view (rejected approach B).

```
useSnapshots (task-manager)
  └─ baselineMilestoneTargets(snapshots)  → Map<number,string>  [memo, gated trendsActive]
      └─ WorkspaceSectionProps.baselineMilestoneDates?
          └─ workspace-section → GanttPanel
              └─ GanttMilestoneRow baselineDate={map.get(m.id)}   (gated on showBaseline pref)
```

## Components

### Pure engine

- `snapshot.ts` — `baselineMilestoneTargets(snapshots: readonly SnapshotRecord[]): Map<number,string>`:
  find the `isBaseline` snapshot (none → empty Map), map each `milestone.id → milestone.target`.
  No React, no I/O. Empty Map when no baseline / no snapshots.
- `gantt-engine.ts` — `milestoneSlipDays(baselineISO: string, liveISO: string): number | null`:
  `diffDays(baseline, live)` (reuse existing pure `diffDays`); `null` when either date is
  unparseable. Positive = slipped later, negative = pulled earlier, 0 = on baseline.

### Toggle (prefs)

- `gantt-engine.ts` `GanttPrefs` — add `showBaseline: boolean` (DEFAULT_PREFS → `true`).
- `use-gantt-prefs.ts` — add `toggleBaseline()` (`setPrefs(p => ({...p, showBaseline: !p.showBaseline}))`)
  to `GanttPrefsApi`; hydrate/persist unchanged (whole-prefs localStorage blob already covers it).
- `gantt-chrome.tsx` `GanttToolbar` — render a Baseline toggle button (mirrors the critical-path
  button: `aria-pressed`, `INTERACTIVE`, i18n label) **only when `hasBaseline` is true** (a new
  prop = `baselineMilestoneDates` non-empty). Pin the label to what the toggle ENABLES
  ("Baseline") so `aria-pressed` state stays coherent.

### Render

- `gantt-rows.tsx` `GanttMilestoneRow` — new optional props `baselineDate?: string` and
  `showBaseline?: boolean`. When `showBaseline && baselineDate` and `slip = milestoneSlipDays(...)`
  is non-null and `!== 0`:
  - ghost diamond at `bx = diffDays(range.min, baselineDate) · DAY_WIDTH_PX`, rendered `fill="none"`
    + `stroke="var(--line)"` (hollow) — same rotated-rect shape as the live diamond;
  - dotted connector `<line>` from `bx`→`mx` at row mid-height, `stroke="var(--line)"`,
    `stroke-dasharray` dotted;
  - a slip label `+Nd` / `−Nd` near the live diamond, `text-muted-foreground` tiny (`N = abs(slip)`).
  - fold the baseline + slip into the row `title` tooltip (e.g. `… · baseline 2026-06-01 (+5d)`).
  Zero slip / no baseline entry / unparseable → render exactly as today (single live diamond).

### Wiring

- `gantt.tsx` `GanttPanel` — accept `baselineMilestoneDates?: ReadonlyMap<number,string>`; pass
  `hasBaseline` + `toggleBaseline`/`showBaseline` to `GanttToolbar`; pass `baselineDate` +
  `showBaseline` to each `GanttMilestoneRow`.
- `workspace-section-types.ts` — add `baselineMilestoneDates?: ReadonlyMap<number,string>`.
- `workspace-section.tsx` — forward it to `GanttPanel`.
- `task-manager.tsx` — `const baselineMilestoneDates = useMemo(() => trendsActive ?
  baselineMilestoneTargets(snapshots.snapshots) : undefined, [trendsActive, snapshots.snapshots])`;
  thread into `WorkspaceSectionProps`.

## Turso-gating & a11y

- The map is built only when `trendsActive` (Turso backend + snapshots module on). File/IDB →
  `undefined`/empty → no ghosts, no toggle button — file-mode Gantt is byte-unchanged.
- Gantt IS in `A11Y_VIEWS` but the file-mode e2e seed has no Turso/baseline, so ghosts + the
  toggle are unreachable at scan time → **eye-verify** the Turso path. The toggle button still
  carries an `aria-label`; ghost/connector SVG are `aria-hidden` decorative (slip is in the row
  title, the accessible channel).
- Palette: only `--line` + `text-muted-foreground`; no new colors, no gradient/shadow → palette
  guards clean.

## Error handling / edge cases

- No baseline snapshot → empty Map → feature invisible (no toggle, no ghosts).
- Milestone created after the baseline (not in the snapshot) → `map.get(id)` undefined → no ghost.
- Unparseable baseline date → `milestoneSlipDays` null → no ghost (never crashes).
- Achieved milestones still show their ghost (historical slip is meaningful).

## Testing

- `snapshot.test` — `baselineMilestoneTargets`: no snapshots → empty; no `isBaseline` → empty;
  picks the baseline snapshot; maps id→target for each milestone.
- `gantt-engine.test` — `milestoneSlipDays`: positive/negative/zero; unparseable → null.
- `gantt-rows` test — `GanttMilestoneRow`: with `baselineDate` + `showBaseline` → 2 diamonds +
  connector + label, correct slip sign; `showBaseline=false` → 1 diamond; no `baselineDate` → 1
  diamond; equal dates → no ghost.
- `use-gantt-prefs.test` — `showBaseline` default true; `toggleBaseline` flips + persists.
- (Optional) a `gantt.tsx` characterization touch if the prop contract test pins milestone-row props.

## Out of scope

- Task ghost bars (no per-task baseline in snapshots — would need a `SnapshotRecord` schema
  extension; separate future slice).
- Baseline-vs-actual on the burndown series (already covered by the Trends view).
- No new persisted Workspace field, no golden-fixture regen (reads existing snapshot data only).
