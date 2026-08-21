# Dashboard Empty-State Coaching CTAs — Design

**Date:** 2026-06-21
**Status:** Approved (design)
**Roadmap:** Dashboard landing cockpit, slice 3 (Tier-2 #7). Slice 1 (0.118.0 "Atwood") = delta strip + greeting + actions-on-top; slice 2 (0.119.0 "Gibson") = milestone horizon strip.

## Goal

Turn a blank/new project's barren Dashboard into a guided start. Slices 1–2 improved the *daily-return* experience (changed / needs-me / coming); this fills the *first-open* gap — a brand-new project currently shows only "Welcome", "No upcoming milestones", and 0% progress, with no nudge toward setup.

## Background / current state

`dashboard-panel.tsx` receives `tasks`, `milestones`, `budgets`, `showMilestones`, `showBudget` (and the slice-1/2 additions). It does NOT know whether the Anthropic key is configured, and has no generic view-navigation handler (only `onOpenMilestone`/`onOpenRaid`/`onOpenChange`, which route to their views by ignoring the id, and `onOpenTask(id)` which opens a specific editor).

Navigation is centralized: `useWorkspaceTab().setActiveTab(view: AppView)` switches the active view for any `AppView` (the single source of truth task-manager reads to decide what to render — works for `open-points`/`budget`/`settings`/`milestones` even though some render in separate sections). `workspace-section.tsx` sits inside `WorkspaceTabProvider`, so it can pass `setActiveTab` down.

`AppView` ids (nav-config.ts): tasks = `"open-points"`, budget = `"budget"`, settings = `"settings"`, milestones = `"milestones"`. Dashboard IS in the axe `A11Y_VIEWS` gate.

The SP3 empty-state ("Configure AI assistant") used a `BackendConfigModal` + `AiSection`; this slice deliberately routes to the Settings view instead (lower churn, no modal threading).

## Architecture

One pure function + one presentational card + an in-panel render gate + two new optional props.

### Unit 1 — `dashboard-coaching.ts` (pure, i18n-free)

```ts
import type { TranslationKey } from "./i18n";
import type { AppView } from "./nav-config";

export type CoachingCta = { key: string; labelKey: TranslationKey; view: AppView };

export function computeCoaching(input: {
  taskCount: number;
  milestoneCount: number;
  budgetCount: number;
  showMilestones: boolean;
  showBudget: boolean;
  aiConfigured: boolean;
}): CoachingCta[];
```

Rules:
- **Gated on a blank project:** if `taskCount > 0`, return `[]`. Coaching is a first-open affordance; once any task exists the project is underway and the card never shows (non-naggy, self-hiding — no dismiss control needed).
- When `taskCount === 0`, emit CTAs in this order, each only if its condition holds:
  1. Always: `{ key: "task", labelKey: "coachingAddTask", view: "open-points" }`.
  2. If `!aiConfigured`: `{ key: "ai", labelKey: "coachingConfigureAi", view: "settings" }`.
  3. If `showMilestones && milestoneCount === 0`: `{ key: "milestone", labelKey: "coachingAddMilestone", view: "milestones" }`.
  4. If `showBudget && budgetCount === 0`: `{ key: "budget", labelKey: "coachingSetBudget", view: "budget" }`.
- Returns keys + view ids only (no translations) — pure and fully unit-testable. References `TranslationKey`/`AppView` as type-only imports (no runtime i18n dependency).

### Unit 2 — `dashboard-coaching-card.tsx` (presentational)

```ts
interface DashboardCoachingCardProps {
  lang: Lang;
  ctas: readonly CoachingCta[];
  onNavigate: (view: AppView) => void;
}
```
- Renders nothing when `ctas` is empty.
- Otherwise a titled card: "Get started" heading + a short subtitle, then each CTA as a `<button>` (text = `t(lang, cta.labelKey)`, row-unique) calling `onNavigate(cta.view)`.
- AIPM palette tokens only (`border-line`, `bg-surface`, `text-AIPM-dark-blue`, `dark:text-AIPM-light-grey`, `text-muted-foreground`, `hover:bg-surface-muted`, `hover:border-AIPM-dark-blue`); no off-palette colors/shadows.

### Placement — `dashboard-panel.tsx`

Compute `const coachingCtas = computeCoaching({ taskCount: props.tasks.length, milestoneCount: props.milestones?.length ?? 0, budgetCount: props.budgets.length, showMilestones, showBudget, aiConfigured: props.aiConfigured ?? false })` (memoize if cheap; it is — a plain `useMemo` keyed on those scalars, or inline since it's O(1)). Render `<DashboardCoachingCard lang={lang} ctas={coachingCtas} onNavigate={props.onNavigate ?? (() => {})} />` **right after the `DashboardDeltaStrip`, before the top-actions section** — the first-open focal area. The card self-hides (renders null) when `coachingCtas` is empty, so a populated project sees no change.

### Wiring — `workspace-section.tsx`

Pass two new props to `DashboardPanel`:
- `onNavigate={setActiveTab}` (from the existing `useWorkspaceTab()` destructure).
- `aiConfigured={<derived>}` — true when the Anthropic key is present in the in-memory settings (exact field confirmed in the plan; e.g. `!!settings.apiKey`). Computed from the `settings` already in scope.

New `DashboardPanelProps`: `onNavigate?: (view: AppView) => void;` and `aiConfigured?: boolean;` (both optional, defaulting to a no-op / false) so the ~30 existing `DashboardPanel` test render sites and any other caller keep compiling.

### i18n (EN + DE, tsc-enforced parity; DE via node utf8 write, real umlauts)

New keys (~6): `coachingTitle` ("Get started"), `coachingSubtitle` ("A few steps to set up this project:"), `coachingAddTask` ("Add your first task"), `coachingConfigureAi` ("Configure AI assistant"), `coachingAddMilestone` ("Add a milestone"), `coachingSetBudget` ("Set up a budget").

## Error handling

- `computeCoaching` is total: any counts (incl. 0) and any flag combination return a well-formed array; `taskCount > 0` → `[]`. No throw.
- `props.onNavigate` absent → card uses a no-op (buttons render but do nothing); in production it is always wired.
- `props.milestones` may be undefined (optional prop) → coalesce to `0` count.

## Testing

- `dashboard-coaching.test.ts`: blank project shows Add-task; `taskCount>0` → `[]`; AI gate (configured → no AI CTA); milestone/budget gates on both `show*` and count; ordering; module-off suppresses the gated CTA.
- `dashboard-coaching-card.test.tsx`: empty ctas → renders null/nothing; renders a button per CTA; click invokes `onNavigate` with the right view; title present.
- `dashboard-panel.test.tsx` (extend): a blank project (no tasks) shows the "Get started" card + an "Add your first task" button; a populated project (`fullProps` has none — use an explicit tasks entry) does NOT show the card.
- a11y: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"` green (the live app seeds a populated demo, so the card is absent at scan time — but verify no regression; CTA buttons are text-labelled regardless).
- `npm run lint` (--max-warnings=0), `npx tsc --noEmit`, `npm run test:run`.

## Release

Bump `version.ts` (0.120.0 + new milestone codename), `CHANGELOG.md`, append `versionHighlightCoaching` to `APP_HIGHLIGHT_KEYS` + EN/DE strings, README badge, `package.json`.

## Decisions (defaults; flagged in design review)

- Card gated on `taskCount === 0` (first-open only; self-hiding; no dismiss).
- CTA order: Add task · Configure AI · Add milestone · Set up budget.
- "Configure AI" routes to the Settings view (not a modal).
- Single generic `onNavigate(view)` handler (= `setActiveTab`) rather than per-CTA handlers.
- AI CTA always shown on a blank project when the key isn't configured (independent of any AI module gate — the AI assistant isn't a per-project module toggle).

## Out of scope (future slices)

Trend arrows on tiles (#4), burndown sparkline tile (#6), density toggle (#8).
