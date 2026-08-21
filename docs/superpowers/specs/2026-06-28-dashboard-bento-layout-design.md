# Dashboard Bento Layout Redesign — Design

**Goal:** Re-lay-out the Dashboard cockpit from a flat 12-section vertical stack into a 3-tier
bento layout that cuts scroll, uses horizontal space on wide screens, encodes importance by
position/size, and declutters via disclosure — without changing what data is shown or the panel's
public props.

**Status:** Approved (sections 1–4). Layout-only reorg of `dashboard-panel.tsx`; no new data,
no engine changes, no new persisted fields.

---

## Problem

Today `dashboard-panel.tsx` renders ~12 sections in one full-width vertical column inside a single
`ReportCard`. All four reviewed pains apply:

- **Too much scrolling** — 12 stacked sections deep.
- **Wide screens wasted** — everything full-width, single column.
- **Weak hierarchy** — all sections equally weighted; importance not signalled by position/size.
- **Too dense** — many widgets compete; nothing folds.

## Approach (chosen: A — Bento grid + hierarchy tiers)

Rejected alternatives: B (sticky command rail — fights the resizable pane, awkward mobile/print),
C (tabs — hides at-a-glance info, adds nav + a11y surface). A hits all four pains at lowest risk:
reuses `Section`/`Tile`, respects density/responsive/print conventions, no new nav machinery.

---

## Section 1 — Layout skeleton (3 tiers)

Replace the flat stack with 3 stacked **tiers**; horizontal-space use happens *inside* each tier
via grid. Tiers separated by the existing `dc.outer` vertical rhythm.

```
TIER 0 · context banner (full width)
   Greeting + delta strip · Narrative summary (read-only) · Coaching card (blank project only)

TIER 1 · "needs you now" hero (above the fold)
   Overall RAG band (compact, full width)
   ┌ KPIs: complete / overdue / open-RAID (+ trend arrows) ┐  ┌ Top-actions queue ┐

TIER 2 · detail bento
   full width:  RegistersBand [ Top RAID | Upcoming tasks ]   (unchanged internally)
   bento grid (grid-cols-1 lg:grid-cols-2, items-start):
      Progress · Budget burn · Milestones · Changes · Sparkline

TIER 3 · folded / low-priority
   ▸ Edit status summary (details)   ▸ Recent activity (details)   Trends (existing toggle)
```

Mechanics:
- Inside Tier 1/2: `grid grid-cols-1 lg:grid-cols-2 ${dc.sectionGap}` with `items-start` so cards
  keep natural height (no forced-equal stretch, no masonry lib).
- Hierarchy = which tier + position (hero above the fold). No new colors/shadows/gradients.

Key moves vs today:
- **Top actions** promoted from mid-page (#5) into the Tier-1 hero — seen first.
- **Narrative** split: saved text shown read-only at Tier 0; the editor folds into Tier 3.
- **Recent activity** collapses into a `<details>` (was always-open #12).
- **Adjust-health** + **Trends** stay folded/toggled as today, pushed to the bottom.

## Section 2 — Tier 2 placement + narrative split

**Tier 2 = full-width Registers row, then ONE bento grid.** `RegistersBand` is already its own
2-col band (RAID | Upcoming) — keep it full-width; do **not** nest it in a cell.

```
full width:  RegistersBand  [ Top RAID | Upcoming tasks ]

bento  grid grid-cols-1 lg:grid-cols-2 ${dc.sectionGap} items-start
order: Progress · Budget burn · Milestones · Changes · Sparkline
   [ Progress ]   [ Budget burn ]
   [ Milestones ] [ Changes ]
   [ Sparkline ]  (flows)
```

Order rationale: keeps today's semantic pairings (Progress│Budget, Milestones│Changes) but merges
the two separate grids + the between-band into one tier, with Registers promoted above, full-width.

**Feature-gating is safe** — auto-flow, no fixed cell positions. `showBudget`/`showMilestones`/
`showChanges` off ⇒ that card omitted, rest reflow. Sparkline self-hides at <2 points. No gaps.

**Narrative read/edit split:**
- **Tier 0** (`NarrativeSummary`): if `status.narrative` set ⇒ read-only paragraph = saved exec
  summary + "updated <date>"; renders null when empty. No textarea up top.
- **Tier 3** (`NarrativeEditor`): `<details>` "Edit status summary" wrapping the existing textarea
  + Save/Clear (collapsed default). Empty narrative ⇒ summary invites "Add status summary".
- a11y: `<details>`/`<summary>` keyboard-native; edit controls keep labels; the summary text stays
  present so existing `getByText("Status summary")`-style tests resolve.

## Section 3 — Files / implementation

`dashboard-panel.tsx` is already ~707 lines + orchestrator. Follow the existing slice pattern
(presentational sub-components in `dashboard-sections/`). Extract the two cohesive blocks that
justify it; do Tier 2 as inline JSX reorg (avoids a giant prop-threading surface for marginal gain).

**NEW `dashboard-sections/dashboard-narrative.tsx`** — pulls state out of the orchestrator:
- `NarrativeSummary` (Tier 0): read-only para of `status.narrative` + "updated" line; null when empty.
- `NarrativeEditor` (Tier 3): `<details>` wrapping textarea + Save/Clear. Owns `draftNarrative`,
  the render-time reconcile (`if (stored !== prev) setState` — the sanctioned pattern, **not** a
  useEffect; `set-state-in-effect` is banned), and the autogrow `useEffect([draftNarrative])`.
  Props: `lang, status, setStatus, dc`.

**NEW `dashboard-sections/dashboard-hero.tsx`** — Tier-1 cohesive block:
- Compact Overall RAG band + `<details>` adjust-health + 3 KPI tiles + Top-actions card.
- `OverrideSelect` helper moves here (currently local in the panel).
- Props: `lang, today, model, trends, status, setStatus, topActions, onOpenAction, onNavigate,
  showBudget, showChanges, dc`. Pass `model` whole (presentational reads fields).

**MODIFY `dashboard-panel.tsx`** → stays the orchestrator (all data derivation/hooks unchanged).
New render body:
```
<ReportCard …>
  <div className={dc.outer}>
    {/* Tier 0 */} <DashboardDeltaStrip …/> <NarrativeSummary …/> <DashboardCoachingCard …/>
    {/* Tier 1 */} <DashboardHero …/>
    {/* Tier 2 */} <RegistersBand …/>
                   <div className={`grid grid-cols-1 lg:grid-cols-2 ${dc.sectionGap} items-start`}>
                     {Progress}{Budget burn}{Milestones}{Changes}{Sparkline}  // existing JSX moved in
                   </div>
    {/* Tier 3 */} <NarrativeEditor …/> <details>{Recent activity}</details> {Trends}
  </div>
</ReportCard>
```
Removes from the panel: narrative state/handlers/effect, hero JSX, `OverrideSelect`. Sparkline/
Progress/Budget/Milestones/Changes JSX relocated into the bento grid.

**Unchanged:** `registers-band.tsx`; **public `DashboardPanelProps`** — every change is internal,
so the ~30 existing test render sites + callers need zero edits.

## Section 4 — a11y / density / print / testing

**a11y (Dashboard ∈ `A11Y_VIEWS`):**
- New `<details>`/`<summary>` (narrative editor, recent activity) = keyboard-native, visible text
  name ⇒ axe-clean, no extra aria.
- `NarrativeSummary` read-only para = plain text; **no** `aria-label` on a bare div (dead-label
  landmine).
- KPI/card buttons, ActionRow, hero overrides keep existing labels. Bento = layout only, no new
  controls.
- Run `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"` before push (covers
  AIPM-light/dark + Mockup-light). Unit suite never runs playwright.

**Density:** every tier wrapper + bento grid + cards use `dc.outer/sectionGap/kpiGap/cardPad` — no
literal `gap-*`/`space-y-*`/`p-*`. Compact compresses tiers + bento. The compact test asserts
`.space-y-2` presence (`dc.outer`) — keep that driving the outer.

**Print** (root is `print-root`):
- Prints: Tier 0 narrative *summary* + all Tier 1/2 data (KPIs, RAG, registers, bento).
- Editor textarea/Save/Clear stay `print:hidden` (don't print an editor).
- Folded `<details>` bodies don't print (collapsed = `display:none`). Recent-activity folded ⇒
  omitted from print — acceptable (activity has its own printable view). If wanted in print: add a
  `globals.css @media print` rule force-expanding a `details.print-expand`. Left out by default.

**Testing:**
- NEW `dashboard-narrative.test.tsx`: summary shows saved text / hidden when empty; editor
  reconciles on external `status.narrative` change; Save commits trimmed; Clear empties.
- NEW `dashboard-hero.test.tsx`: KPIs + top actions render; override `<select>` writes status.
- `dashboard-panel` test: assert bento grid present + Section titles still resolve (existing
  `getByText` stays green).
- After moving JSX: relocate imports too (lint `--max-warnings=0` is fatal on unused/orphaned
  imports); `npx tsc --noEmit` after test edits (test-only type errors fail CI only); hoist any
  `obj.member` useMemo dep to a scalar local.
- Release step (when shipping): bump `version.ts` + `CHANGELOG` + append a highlight key + EN/DE
  string.

## Out of scope

- No change to `computeDashboard` or any engine.
- No new persisted `Workspace`/`settings` fields.
- No change to what widgets exist — only their arrangement and fold state.
- Recent-activity-in-print CSS rule (optional follow-up).
