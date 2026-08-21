# Dashboard Masonry Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the dashboard's fixed two-column bento grids with a CSS multicolumn (masonry) flow so uneven-height cards pack tightly and the wide-screen voids disappear.

**Architecture:** Extract the hero's KPI strip and Top-actions into standalone cards, split the registers band into two cards, shrink the hero to the Overall RAG band, then render all nine variable-height cards in one `columns-1 lg:columns-2 xl:columns-3` flow with `break-inside-avoid` items. Footer strips unchanged.

**Tech Stack:** Next.js 16 (forked) · React 19 · TypeScript · Tailwind v4 · Vitest.

---

## Conventions (CI-fatal — every task must respect)

- `npm run lint` is `--max-warnings=0`: an unused import/var is FATAL. After every extract, re-check for orphaned imports.
- `npx tsc --noEmit` typechecks test files (vitest does not). Run it after editing ANY test.
- Cockpit spacing uses `dc.*` density classes ONLY — never literal `gap-*`/`space-y-*`/`p-*`/`mb-*`.
- AIPM palette tokens only; shadows only via `shadow-[var(--shadow-card)]`.
- Dashboard ∈ axe `A11Y_VIEWS`: keep every accessible name; verify with
  `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"`.
- Public `DashboardPanelProps` MUST stay unchanged.

---

### Task 1: Add `dc.cardGap` density key

**Files:**
- Modify: `src/app/dashboard-density.ts`
- Test: `src/app/dashboard-density.test.ts`

- [ ] **Step 1: Write the failing test** — add to the existing density test:

```ts
test("cardGap is mb-4 comfortable, mb-2 compact", () => {
  expect(densityClasses("comfortable").cardGap).toBe("mb-4");
  expect(densityClasses("compact").cardGap).toBe("mb-2");
});
```

- [ ] **Step 2: Run it, expect FAIL** — `npm run test:run -- dashboard-density` → `cardGap` undefined.
- [ ] **Step 3: Implement** — add `cardGap: string` to the `DensityClasses` type/interface and return `cardGap: "mb-4"` (comfortable) / `cardGap: "mb-2"` (compact) from `densityClasses()`.
- [ ] **Step 4: Run test + `npx tsc --noEmit`** → PASS, 0 errors.
- [ ] **Step 5: Commit** — `feat(dashboard): add dc.cardGap density key for masonry card spacing`.

---

### Task 2: Extract `DashboardKpiStrip`

**Files:**
- Create: `src/app/dashboard-sections/dashboard-kpi-strip.tsx`
- Create: `src/app/dashboard-sections/dashboard-kpi-strip.test.tsx`
- Modify: `src/app/dashboard-sections/dashboard-hero.tsx` (cut the KPI block; leave a clean compile — the panel rewires in Task 6)

**Context:** The KPI strip is the 3-tile "at a glance" row (complete % · overdue · open RAID) with `TrendArrow`s, currently inside `DashboardHero`. Read the current hero to copy the exact JSX (the `Tile` trio, the `trend` slots, the `onActivate`/`activateLabel` per tile, the `unit="%"` on completion). Move it verbatim into a card.

- [ ] **Step 1: Write the failing test** — render `<DashboardKpiStrip>` with a minimal `model` + `trends` stub; assert the 3 tile labels render (complete %, overdue, open RAID) and the completion tile's activate-label resolves.
- [ ] **Step 2: Run it, expect FAIL** (module missing).
- [ ] **Step 3: Implement** — new component:

```tsx
interface DashboardKpiStripProps {
  lang: Lang;
  model: DashboardModel;
  trends: Record<MetricKey, MetricTrend>;
  onNavigate?: (view: AppView) => void;
  dc: DensityClasses;
}
```

Wrap the 3 tiles in one `<Section boxed>` (or the same card wrapper the hero used). Use `dc.kpiGap` for the tile grid gap (as today). Keep every `aria`/activate label byte-identical.

- [ ] **Step 4:** Remove the KPI block from `dashboard-hero.tsx`. Drop now-unused imports there (lint will fail otherwise). Hero still compiles (it keeps Overall band + Top-actions for now; Top-actions leaves in Task 3).
- [ ] **Step 5: Run** new test + `npm run test:run -- dashboard-hero dashboard-kpi-strip` + `npx tsc --noEmit` → green.
- [ ] **Step 6: Commit** — `refactor(dashboard): extract DashboardKpiStrip from hero`.

---

### Task 3: Extract `DashboardTopActions`

**Files:**
- Create: `src/app/dashboard-sections/dashboard-top-actions.tsx`
- Create: `src/app/dashboard-sections/dashboard-top-actions.test.tsx`
- Modify: `src/app/dashboard-sections/dashboard-hero.tsx` (cut the Top-actions block)

**Context:** The Top-actions card is the ranked queue (each row: icon · source badge · title · subtitle · Open button) currently in the hero, gated on `topActions?.length`. Copy the exact JSX.

- [ ] **Step 1: Write the failing test** — render with 2 `SuggestedAction`s; assert both titles + the row "Open" buttons render with their row-unique accessible names; render with `topActions={[]}` → asserts the component returns null (nothing in the document).
- [ ] **Step 2: Run it, expect FAIL** (module missing).
- [ ] **Step 3: Implement**:

```tsx
interface DashboardTopActionsProps {
  lang: Lang;
  topActions?: readonly SuggestedAction[];
  onOpenAction?: (a: SuggestedAction) => void;
  dc: DensityClasses;
}
```

Return `null` when `!topActions?.length`. Card uses `dc.cardPad`. Keep the Open-button labels byte-identical.

- [ ] **Step 4:** Remove the Top-actions block + its now-unused imports from the hero.
- [ ] **Step 5: Run** new test + hero test + `npx tsc --noEmit` → green.
- [ ] **Step 6: Commit** — `refactor(dashboard): extract DashboardTopActions from hero`.

---

### Task 4: Split RegistersBand into two cards

**Files:**
- Modify: `src/app/dashboard-sections/registers-band.tsx` (export `RaidRegisterCard` + `UpcomingCard`; retire the combined `RegistersBand` export)
- Modify/Create: `src/app/dashboard-sections/registers-band.test.tsx`

**Context:** `RegistersBand` today renders a `md:grid-cols-2` band: left = top open RAID, right = upcoming & overdue. Split the two halves into standalone boxed cards so each can be a masonry item. Read the current file for exact props/JSX.

- [ ] **Step 1: Write failing tests** — `<RaidRegisterCard>` renders the RAID heading + a seeded RAID row's label; `<UpcomingCard>` renders the "Upcoming & overdue" heading + a seeded overdue row. Both row controls keep row-unique labels.
- [ ] **Step 2: Run, expect FAIL** (exports missing).
- [ ] **Step 3: Implement** — extract each half into its own exported card component (each its own `<Section boxed>`); have the panel use them directly. Remove the `RegistersBand` wrapper export (grep `RegistersBand` first; only `dashboard-panel.tsx` should consume it). `RaidRegisterCard` self-hides when `!showRaid`.
- [ ] **Step 4: Run** tests + `npx tsc --noEmit` → green.
- [ ] **Step 5: Commit** — `refactor(dashboard): split RegistersBand into RaidRegisterCard + UpcomingCard`.

---

### Task 5: Shrink `DashboardHero` to the Overall band

**Files:**
- Modify: `src/app/dashboard-sections/dashboard-hero.tsx`
- Modify: `src/app/dashboard-sections/dashboard-hero.test.tsx`

**Context:** After Tasks 2-3 the hero already lost KPI + Top-actions. Now finalize: hero = Overall RAG band + Adjust-health `<details>` (owns `OverrideSelect`) only. Remove the obsolete `lg:grid-cols-2` wrapper, the now-unused props (`topActions`, `onOpenAction`, `trends`, `onNavigate`) from `DashboardHeroProps`, and any orphaned imports.

- [ ] **Step 1: Update the test** — drop assertions about KPI tiles / Top-actions; keep/lift the Overall-band + Adjust-health assertions. Update the test host's props to the trimmed shape.
- [ ] **Step 2: Run it, expect FAIL** (props still wide / removed JSX referenced).
- [ ] **Step 3: Implement** — trim `DashboardHeroProps` to `{ lang, today, model, status, setStatus, showBudget, showChanges, dc }`; render only the Overall band + Adjust-health.
- [ ] **Step 4: Run** hero test + `npx tsc --noEmit` (panel will still reference old hero props — that is expected to break here; Task 6 fixes the panel. If tsc fails ONLY on `dashboard-panel.tsx` hero usage, that is acceptable for this task's commit boundary — note it in the handoff). To keep each commit green, prefer doing Step 3 of Task 6 in the SAME commit if the panel break blocks tsc.
- [ ] **Step 5: Commit** — `refactor(dashboard): hero renders Overall band only` (may be combined with Task 6 to keep the tree green).

---

### Task 6: Rewire the panel into a masonry flow

**Files:**
- Modify: `src/app/dashboard-panel.tsx`
- Modify: `src/app/dashboard-panel.test.tsx`

**Context:** Replace the hero KPI+TopActions usage and the two `lg:grid-cols-2` grids (hero-inner + Tier-2 bento) and the `RegistersBand` with: headline (hero = Overall band only) → ONE masonry wrapper → footer (unchanged). Read the current panel render body (lines ~242-516) for the exact card JSX to relocate (Progress, Budget, Milestones, Changes, Sparkline already live in the panel — only their container changes).

- [ ] **Step 1: Update/extend the panel test** — assert: (a) the masonry wrapper class `lg:columns-2` is present on the card region; (b) the KPI strip, Top actions, RAID, Progress, Budget, Milestones, Changes all render (existing assertions mostly survive — they query by text/role, not container). Add an assertion that a masonry card wrapper carries `break-inside-avoid`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the render body:

```tsx
{/* Headline */}
<DashboardDeltaStrip .../>
<NarrativeSummary .../>
<DashboardCoachingCard .../>
<DashboardHero lang={lang} today={today} model={model} status={status}
  setStatus={setStatus} showBudget={showBudget} showChanges={showChanges} dc={dc} />

{/* Masonry — variable-height cards pack via column-fill: balance */}
<div className={`columns-1 lg:columns-2 xl:columns-3 ${dc.sectionGap}`}>
  {/* order: priority-first */}
  <div className={`break-inside-avoid ${dc.cardGap}`}>
    <DashboardKpiStrip lang={lang} model={model} trends={trends} onNavigate={props.onNavigate} dc={dc} />
  </div>
  <div className={`break-inside-avoid ${dc.cardGap}`}>
    <DashboardTopActions lang={lang} topActions={topActions} onOpenAction={onOpenAction} dc={dc} />
  </div>
  <div className={`break-inside-avoid ${dc.cardGap}`}>
    <RaidRegisterCard lang={lang} topRaid={model.topRaid} onOpenRaid={onOpenRaid} showRaid={showRaid} />
  </div>
  <div className={`break-inside-avoid ${dc.cardGap}`}>
    <UpcomingCard lang={lang} overdue={model.overdue} dueSoon={model.dueSoon} onOpenTask={onOpenTask} />
  </div>
  {/* Progress, Budget(+burndown), Milestones, Changes, Sparkline — relocate each
     existing block here, each wrapped in `break-inside-avoid ${dc.cardGap}`,
     unchanged inner JSX. Keep the showBudget/showMilestones/showChanges gates and
     the sparkline `completionSeries.length >= 2` gate. */}
</div>

{/* Footer — unchanged */}
<NarrativeEditor .../>
<details>...Recent activity...</details>
{showTrends ? <div>...Trends...</div> : null}
```

`DashboardTopActions` returns null when empty → it simply drops from the flow (no empty card, no hole).

- [ ] **Step 4: Run** `npm run test:run -- dashboard-panel` + full `npx tsc --noEmit` + `npm run lint` → all green, 0 warnings.
- [ ] **Step 5: Commit** — `feat(dashboard): masonry cockpit (pack uneven cards, kill wide-screen voids)`.

---

### Task 7: Docs, gates, eye-check

**Files:**
- Modify: `AGENTS.md` (the working-tree change already shifts the cockpit note from "3-tier bento" → masonry; finalize the wording to describe the multicol flow + `dc.cardGap` + the hero/registers re-split)

- [ ] **Step 1:** Update the `### Dashboard landing cockpit` note in AGENTS.md: cockpit body is now ONE `columns-1 lg:columns-2 xl:columns-3` multicol (NOT a `lg:grid-cols-2` grid); each card wrapped `break-inside-avoid ${dc.cardGap}`; new `dc.cardGap` (mb-4/mb-2); hero = Overall band + Adjust-health only; KPI strip (`dashboard-kpi-strip.tsx`) + Top actions (`dashboard-top-actions.tsx`) + `RaidRegisterCard`/`UpcomingCard` are standalone masonry cards; footer (status/recent/trends) stays full-width stacked. Note the column-major reading order + the "masonry needs #cards > #cols" reason the hero was re-split.
- [ ] **Step 2: Full gate** — `npx tsc --noEmit` (0) · `npm run lint` (0 warnings) · `npm run test:run` (all green).
- [ ] **Step 3: axe** — `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"` → 3/3.
- [ ] **Step 4: Eye-check** — screenshot the live dashboard at 1680 / 1280 / 900 / 375 px + toggle Compact: confirm KPI void + Progress void gone, columns balanced, no card split mid-column, compact tightens.
- [ ] **Step 5: Commit** — `docs(dashboard): document masonry cockpit layout`.

---

## Self-review checklist (controller, before execution)

- Spec coverage: hero void (Tasks 2-3,5-6) · Tier-2 void (Task 6) · density (Task 1) · docs (Task 7). Footer row-packing explicitly out of scope.
- Type consistency: `DashboardKpiStrip`/`DashboardTopActions`/`RaidRegisterCard`/`UpcomingCard` names used identically in Tasks 2-6.
- No placeholders: every step has the concrete change or command.
- Commit-green caveat called out (Task 5↔6 boundary).
