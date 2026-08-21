# Milestone Horizon Strip — Design

**Date:** 2026-06-21
**Status:** Approved (design)
**Roadmap:** Dashboard landing cockpit, slice 2 (Tier-2 #5). Slice 1 (v0.118.0 "Atwood") delivered the delta strip + greeting + actions-on-top.

## Goal

Add a "what's coming" milestone band to the Dashboard, bucketed by time horizon. Completes the PM landing triad: slice 1 answered *what changed?* and *what needs me?*; this answers *what's coming?*.

## Background / current state

`milestones.ts` is the pure i18n-free milestone engine: `milestoneStatus(m, tasksById, today, holidaySet, leadWorkdays?) → "achieved"|"overdue"|"at-risk"|"due-soon"|"on-track"`, `partitionMilestones(...) → {overdue, atRisk, dueSoon}`, `isAtRisk`, `sortMilestones`, `MILESTONE_DUE_SOON_WORKDAYS = 3`.

`dashboard.ts` `computeDashboard` already calls `partitionMilestones` and exposes `model.overdueMilestones / atRiskMilestones / dueSoonMilestones`. `dashboard-panel.tsx` renders a flat **Milestones** `Section` (in the milestones/changes 2-col grid) that lists `[...overdueMilestones, ...atRiskMilestones, ...dueSoonMilestones]` with a ⚠ prefix for at-risk and a per-item `<button>` → `onOpenMilestone` (the handler ignores its arg and just `setActiveTab("milestones")`). This near-term-only list has no forward view.

`Milestone` shape (types.ts): `{ id, name, date (YYYY-MM-DD), achievedDate?, linkedTaskIds, ... }`. Dashboard IS in the axe `A11Y_VIEWS` 12-view gate.

## Architecture

One engine extension + one presentational component + an in-place panel swap. No new prop threading (`showMilestones` already gates the section; `onOpenMilestone` already passed).

### Unit 1 — `milestones.ts` (extend)

```ts
export type MilestoneHorizon = "overdue" | "thisWeek" | "next2Weeks" | "later";
export type HorizonEntry = { milestone: Milestone; status: MilestoneStatus };
export type MilestoneHorizonBuckets = Record<MilestoneHorizon, HorizonEntry[]>;

export const HORIZON_THIS_WEEK_DAYS = 7;
export const HORIZON_NEXT_DAYS = 21;

export function bucketMilestonesByHorizon(
  milestones: readonly Milestone[],
  tasksById: ReadonlyMap<number, Task>,
  todayISO: string,
  holidaySet: ReadonlySet<string>,
  leadWorkdays?: number,
): MilestoneHorizonBuckets;
```

Rules:
- **Achieved milestones are excluded** (a "coming" view; done work isn't coming).
- For each non-achieved milestone, compute `status = milestoneStatus(...)`. If `status === "overdue"` → `overdue` bucket. Otherwise bucket by **calendar days** from `todayISO` to `m.date`: `d <= HORIZON_THIS_WEEK_DAYS` → `thisWeek`; `d <= HORIZON_NEXT_DAYS` → `next2Weeks`; else `later`. (A milestone dated today has `d = 0` → `thisWeek`, matching the engine's "today is not yet overdue" convention.)
- Calendar-day diff is pure: parse both `YYYY-MM-DD` as UTC midnight (`Date.parse` / `new Date(iso)`) and divide the ms delta by 86_400_000, rounded. `todayISO` is passed in (no `new Date()` of "now" in the engine — stays test-pure and tz-correct per TZ-1).
- Every bucket sorted by `(date, id)` (reuse the existing `byDate` comparator pattern).
- `status` rides on each entry so the strip flags at-risk (⚠) inside any non-overdue bucket without recomputing.

Buckets are **disjoint and exhaustive** over the non-achieved input: each non-achieved milestone lands in exactly one bucket.

### Unit 2 — `milestone-horizon-strip.tsx` (presentational)

Pure render. Props:
```ts
interface MilestoneHorizonStripProps {
  lang: Lang;
  buckets: MilestoneHorizonBuckets;
  onOpenMilestone?: () => void;
}
```
- Renders the four buckets in fixed order (Overdue · This week · Next 2 weeks · Later), each as a labeled group with the count in its header; a group with zero entries is omitted.
- Each entry is a chip: `name · date`, with a `RagBadge` + ⚠ when `status === "overdue"` or `"at-risk"`. When `onOpenMilestone` is provided, the chip is a `<button>` (its text is the accessible name, row-unique via `name · date`); otherwise a non-interactive `<span>`.
- When all buckets are empty → a single muted "No upcoming milestones" line.
- AIPM palette tokens only (`border-line`, `bg-surface`, `text-muted-foreground`, `text-AIPM-dark-blue`, `hover:bg-surface-muted`, `hover:border-AIPM-dark-blue`); no off-palette colors/shadows.

### Placement — `dashboard-panel.tsx`

Replace the existing flat **Milestones** `Section` body (the `[...overdueMilestones, ...atRiskMilestones, ...dueSoonMilestones]` list) with `<MilestoneHorizonStrip buckets={...} onOpenMilestone={props.onOpenMilestone} />`, keeping it inside the same `showMilestones`-gated `Section` in the milestones/changes grid slot. Compute the buckets in the panel from the already-available `props.milestones` + a `tasksById` map (build `new Map(props.tasks.map(t => [t.id, t]))` — or reuse one if the panel already has it) + `today` + `holidaySet`. Memoize the bucket computation with `useMemo` keyed on `[props.milestones, props.tasks, today, props.holidaySet]`.

No change to `workspace-section.tsx` (props unchanged). `model.overdueMilestones/atRiskMilestones/dueSoonMilestones` stay in the model (still used for the schedule RAG); only the panel's render of them changes.

### i18n (EN + DE, tsc-enforced parity; DE via node utf8 write with real umlauts)

New keys (~5): `milestoneHorizonOverdue` ("Overdue"), `milestoneHorizonThisWeek` ("This week"), `milestoneHorizonNext2Weeks` ("Next 2 weeks"), `milestoneHorizonLater` ("Later"), `milestoneHorizonEmpty` ("No upcoming milestones"). Bucket headers may append a count via an existing pattern or a `({0})` suffix — finalize exact form in the plan. (The "Milestones" section title key `dashboardMilestones` already exists and is reused for the `Section` heading.)

## Error handling

- Empty `milestones` → all buckets empty → "No upcoming milestones". No throw.
- Milestone with a malformed `date` → `Date.parse` yields `NaN`; the day-diff guards `NaN` by treating it as `later` (never crashes, never mis-buckets into overdue). Documented.
- `bucketMilestonesByHorizon` is total: empty input, all-achieved input, all-overdue input each return a well-formed `MilestoneHorizonBuckets`.

## Testing

- `milestones.test.ts` (extend): achieved excluded; overdue→overdue bucket; window boundaries (d=0,7,8,21,22); at-risk flag carried; sort by date; disjoint+exhaustive over non-achieved; `NaN` date → `later`.
- `milestones.property.test.ts` (new or extend if present): every non-achieved input milestone appears in exactly one bucket; bucket counts sum to non-achieved count; each bucket sorted ascending by date. (fast-check: build `Milestone` via integer-ms→`new Date(ms).toISOString().slice(0,10)` to dodge `fc.date()` Invalid Date; no `/s` regex flag.)
- `milestone-horizon-strip.test.tsx`: bucket headers + counts render; empty → "No upcoming milestones"; chip click invokes `onOpenMilestone`; handler-less chip is a `<span>` not a button; at-risk chip shows the ⚠/badge.
- `dashboard-panel.test.tsx` (extend): the horizon strip replaces the flat list — a "This week" / "Next 2 weeks" bucket header renders for appropriately-dated milestones; the `showMilestones={false}` gate still hides the whole section.
- a11y: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"` green.
- `npm run lint` (--max-warnings=0), `npx tsc --noEmit`, `npm run test:run`.

## Release

Bump `version.ts` (0.119.0 + new milestone codename), `CHANGELOG.md` entry, append `versionHighlightMilestoneHorizon` to `APP_HIGHLIGHT_KEYS` + EN/DE strings, README badge, `package.json` version.

## Decisions (defaults; flagged in design review)

- Windows: `thisWeek` ≤ 7 calendar days, `next2Weeks` 8–21, `later` > 21.
- Achieved milestones excluded.
- In-place replacement of the flat Milestones section (not promoted to a top band) — lower churn; promotion is a later tweak.
- Overdue shown as the first bucket (not hidden).
- Day-diff uses calendar days (UTC-midnight parse), not working days — horizon is a human "when" view, not a working-day SLA.

## Out of scope (future slices)

Trend arrows on tiles (#4), burndown sparkline tile (#6), empty-state coaching CTAs (#7), density toggle (#8), full click-through parity (#9).
