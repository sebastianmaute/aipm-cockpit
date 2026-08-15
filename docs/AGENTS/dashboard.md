<!-- Split out of AGENTS.md, which is the always-loaded file (CLAUDE.md is `@AGENTS.md`).
     THIS file is NOT auto-loaded — open it when you work on this subsystem.
     Same conventions: ★ = a non-obvious rule, ★★ = has already caused a bug,
     ★★★ = has caused the same bug more than once.
     `npm run docs:symbols:check` gates this file exactly as it gates AGENTS.md:
     it proves a backticked NAME is real, never that a CLAIM about it is true.
     Every claim here was true when written and some have outlived their code —
     grep before relying on one, and correct what you disprove in the same commit. -->

# Dashboard landing cockpit

[← AGENTS.md](../../AGENTS.md) · [doc set](../../AGENTS.md#the-doc-set--what-lives-where)

### Dashboard landing cockpit

**Layout = an ORDERED, user-arrangeable grid. NOT masonry any more, and NOT coordinates.**
`dashboard-panel.tsx` stays a thin orchestrator (data derivation + the `computeDashboard` memo) and
renders three zones: a full-width HEADLINE (`DashboardDeltaStrip` · `NarrativeSummary` ·
`DashboardCoachingCard` · `DashboardTipCard` · `DigestCardConnected` · `DashboardHero`) → the
arrangeable tile grid (`DashboardGrid`, the reset-arrangement button, `DashboardShelf`) → a full-width
FOOTER (`NarrativeEditor`). ★ The footer was described here as `NarrativeEditor` **plus a
Recent-activity `<details>`** — nothing has rendered one since 0.151.0. `dashboard.ts` still computes
`recentActivity` and both dictionaries still carry `dashboardRecentActivity`, but no component consumes
either (`grep -rln "dashboardRecentActivity" src/app --include="*.tsx"` returns nothing). A dead claim
outlived its markup by ~87 releases, which is what the header of this file warns about.

★★★ **ORDER IS THE ENTIRE PLACEMENT MODEL.** `DashboardGrid` renders `grid grid-cols-1 lg:grid-cols-2
xl:grid-cols-4 grid-flow-row-dense`, so an ordered list of `PlacedTile` `{id,w,h}` resolves into cells
and there are no coordinates to store — every operation in `dashboard-layout.ts` (`moveTile` ·
`hideTile` · `restoreTile` · `resizeTile` · `reconcile`) is an array operation. ★★ THE FIRST FOUR
return the SAME object reference on a no-op, so a caller can skip a persist cheaply; **`reconcile` DOES
NOT** and never did — it allocates a fresh `{v, board, hidden}` on every non-null input, identical
content or not. Harmless today (both of its call sites are loads), but a persist-skip written against
`next !== stored` would fire on every one of them. This sentence used to lump all five together, which
is exactly the claim someone would build that skip on. ★★ A user therefore CANNOT
leave a deliberate hole: `dense` backfills it with the next tile that fits. ★★ That is also why the
panel renders the reorder hook's `previewOrder` rather than the stored board and draws NO edge drop
indicator — dense re-places everything after a move, so an edge marker would routinely point at a slot
the tile does not land in. Drag comes from the shared `useListReorderDnd` primitive; the ⋮ menu's move
commands are this surface's keyboard path (the primitive's own arrow-key option is off — `keyboard:
false`).

★★★ **`W_CLASS`/`H_CLASS` (`dashboard-grid.tsx`) MUST STAY WHOLE LITERAL STRINGS, AND NO UNIT TEST CAN
SEE A VIOLATION.** Tailwind v4 builds its stylesheet by scanning source for class-name candidates, so an
interpolated `col-span-${w}` emits NO CSS and every tile silently renders one column wide. jsdom has no
layout engine, so `dashboard-grid.test.tsx` can only assert that a class STRING was rendered, never that
Tailwind emitted a rule for it. `e2e/dashboard-grid.spec.ts` is the ONLY detector in the repo — it reads
computed geometry (`getComputedStyle` on the container, `getBoundingClientRect` on real tiles) and
deliberately makes no class-string assertion at all.

★ **The responsive clamp lives ENTIRELY in the width table** — `W_CLASS`'s literal `lg:`/`xl:` variants
plus the container's own `lg:grid-cols-2 xl:grid-cols-4`. No width measurement, no `ResizeObserver`, no
JavaScript anywhere in the feature; height does not clamp, so a tall tile stays tall.

★★ **The row unit is a density class, and only ONE of its two values is GATED.** `dc.tileRow` is
`auto-rows-[80px]` comfortable / `auto-rows-[72px]` compact (`dashboard-density.ts`). The e2e geometry
spec pins the 80px value twice — the container's `grid-auto-rows` AND a real h:2 tile's box, since
`H_CLASS` is a second literal table Tailwind must also have emitted. The 72px compact value is pinned
only as a class STRING by `dashboard-density.test.ts`, i.e. in the layer that cannot see CSS — so a
compact-only Tailwind emission failure is caught by nothing. ★★ Both values are now MEASURED, which is
a different property from gated: 72 replaced a provisional 64 on 2026-08-15 after a seeded Chromium
measurement of every tile at 64/72/80/88. `dashboard-density.ts`'s own test carries the numbers and
the two rejected alternatives — read it before moving either value.

★★★ **DO NOT READ A SCROLLBAR ON A COMPACT TILE AS A ROW-UNIT DEFECT.** The tile body is
`min-h-0 flex-1 overflow-auto p-2` (`dashboard-tile.tsx`), so nothing ever clips or spills — over-tall
content becomes an inner scroll container. And **6 of 9 rendering tiles already overflow at the
shipped comfortable/80** (measured, default catalogue board, 1600px, e2e seed: `burn` 507px over,
`insights` 239, `upcoming` 133). Inner scrolling is this design's normal mode, not something compact
introduced, and no row unit fixes those three — fitting `burn` at h:2 would take a ~340px unit, which
is what per-axis resize is for. Measure comfortable before calling anything a regression.

★★ **TWO CHROMIUM MEASUREMENTS FROM THIS BRANCH'S REVIEW, both about assertions that LOOK sufficient:**
• `grid-auto-flow: row dense` COMPUTES as `"dense"`, not `"row dense"` — a `toHaveCSS("grid-auto-flow",
"row dense")` would fail against correct code. The spec's `gridMetrics` still collects `autoFlow` but
asserts nothing on it (`grep -n autoFlow e2e/dashboard-grid.spec.ts` → ONE hit, the collection); dense is
proved by measuring a backfill instead.
• dropping `xl:grid-cols-4` still yields FOUR `gridTemplateColumns` entries, as IMPLICIT tracks — so a
length-only `toHaveLength(4)` passes against that mutant. Measured under it:
`"19.3594px 19.3594px 575.641px 575.641px"`. The template does not collapse to one track, because the
w:4 tile's own `xl:col-span-4` reaches past the two explicit `lg:grid-cols-2` tracks and grid
MANUFACTURES two implicit ones to hold it. What kills the mutant is the EQUAL-WIDTH loop in the same
test (delta 556.28px), plus the w:2 half-width assertion in "emitted the width-span utilities" — TWO of
the five tests, each on its second assertion. ★★★ AND THE TRACKS-PLUS-GAPS SUM DOES **NOT** KILL IT,
which is the surprise and which an earlier revision of this bullet got wrong in both directions: implicit
tracks are content-sized, so the row still tiles the content box exactly — 1238.0008px against a 1238px
box, a 0.0008px delta well inside the spec's 1.5 tolerance. That assertion is kept because it pins a
DIFFERENT failure (four tracks that do not fill the box), never as a second detector for this one.
★★ The spec used to carry an inline comment claiming the opposite ("a `grid-cols-4` that Tailwind failed
to emit would leave a single implicit `auto` track, which the length check already catches") and this
file then declared the contradiction unsettled and told the reader to go run the mutant. It was settled
by running it; the spec's comments now carry the measurement at each assertion, and the work does not
need redoing.

★★ **HIDE→RESTORE DISCARDS A RESIZE, ON PURPOSE — it is a decision, not an oversight, and nothing but
this paragraph says so.** `restoreTile` splices the tile back at its CATALOGUE default `{w, h}`
(`spec.w`/`spec.h`), never at the size it carried when it was hidden, because `hideTile` drops the whole
`PlacedTile` and keeps only the id on the shelf — the size is gone before restore is reached. So a user
who widens `burn` to w:2, hides it and restores it gets w:1 back. `dashboard-layout.test.ts` pins this
("appends a hidden tile to the board at its catalogue default size"), so a change of mind has to go
through that test rather than sliding in. ★ Preserving it would mean shelving the `PlacedTile` instead
of the id, which changes the stored shape (`hidden: DashboardTileId[]`) and therefore
`dashboard-layout-store.ts`'s validation, `reconcile`'s de-duplication and every stored blob in the
field. Not worth it for a lost span — but say so out loud, because "I resized that and it came back
wrong" reads as a bug to whoever hits it.

★★★ **A GATE DECIDES WHAT RENDERS, NEVER WHAT IS STORED.** `reconcile` takes ONE argument for exactly
that reason, and `dashboard-layout.test.ts` pins its arity so the parameter cannot creep back: a
gated-off tile KEEPS its stored position, so switching Budget off and on again does not lose the burn
tile's place. `useDashboardLayout` has no `gate` option either. Filtering happens at RENDER, in
`dashboard-panel.tsx`, against each tile's own `gate` from the catalogue — INLINE, with no shared
helper. ★★ There was one: a catalogue-order `liveTiles(gate)` export in `dashboard-tiles.ts`, which
three comments here named as "the render layer filter" while NOTHING called it. It is DELETED. The
claim survived review because `liveTiles` was a real export and `docs:symbols:check` only proves a
backticked NAME exists, never that a claim about it is true — a green symbol gate is not coverage of a
claim. ★ Do not reintroduce it: the panel filters PLACEMENTS in board order and additionally requires
a rendered body, so a catalogue-order list is a different function, not a shareable one.

★★ **THE TILE CHROME OWNS THE FRAME AND THE TITLE** — `dashboard-tile.tsx` draws the bordered
`<section>` and renders the `<h3>` — so a body in `dashboard-tile-bodies.tsx` must be UNBOXED and
UN-TITLED, or it stacks two borders and two identical headings. The catalogue's `labelKey`s were chosen
to match the headings these cards used to carry themselves. ★★ THE TEST IS THE TEXT, NOT THE COMPONENT:
`RaidRegisterCard` keeps its `Section` heading because "Top open RAID" DIFFERS from its chrome title
"RAID register", while `InsightsCard`'s heading was byte-identical to `dashboardInsights` in BOTH
dictionaries and was removed. ★★ That header used to record a "ONE DOCUMENTED EXCEPTION" for
`InsightsCard`, on the grounds that `insights-panel.tsx` renders it too. It does not — that panel
renders its own list and merely shares the `insightsCardTitle` string — and the tile double-titled on an
axe-scanned view for as long as the false premise stood.

★★ **THE ARRANGEMENT IS PER-DEVICE, PER-PROJECT localStorage — NOT a `Workspace` field**, so none of the
six write paths change and no codec, DDL or golden fixture is touched. `dashboard-layout-store.ts` keeps
one `{[projectId]: layout}` map under `DASHBOARD_LAYOUT_KEY`, capped at `MAX_PROJECTS` with
insertion-order recency, over `device-store.ts`'s `readDeviceJson`/`writeDeviceJson` envelope — the same
shape as `landing-state.ts`, so `clearAppConfig`'s `aipm-cockpit:*` sweep already clears it. A write
failure (quota, private mode) is swallowed on purpose: the arrangement is a preference, not data.
★ Popout is READ-ONLY (`readOnly` from `useDashboardLayout`) — no grips, no ⋮, no shelf, no persist.

★★ **PER-TILE CONTROL NAMES MUST BE TILE-UNIQUE, AND THE AXE GATE CANNOT SEE A COLLISION AT ANY SEED
SIZE** (AGENTS.md carries the measurement: no rule under the four tags `e2e/a11y.spec.ts` requests flags
two controls sharing an accessible name). Every tile renders the same grip, the same ⋮ and the same size
chooser, so each of those names carries the tile title; and inside ONE ⋮ menu both axes offer a value
labelled "2", so `optionAriaLabel` has to carry the axis as well as the tile. Dashboard IS in axe
`A11Y_VIEWS`, and the unit tests are still the only possible detector for this class.

★★★ **EVERY ⋮ COMMAND THAT CLOSES THE POPOVER MUST SAY WHERE FOCUS GOES, AND THE DESTINATION IS NOT THE
SAME FOR ALL OF THEM.** `PopoverPanel` focuses the first control on OPEN and restores focus to nothing on
close — there is no focus-restore in it, `use-dismissable.ts` or `dismissal-stack.ts` — so a command that
unmounts the panel drops focus on `<body>` unless the panel puts it somewhere. That stranded a keyboard
user at the top of the document after using the menu that IS this surface's keyboard path (the drag
primitive's own arrow keys are off here, `keyboard: false`). Three cases, each measured:
• **Hide** → the shelf disclosure. The ⋮ trigger it was anchored to goes with the tile, and the shelf is
  where the tile now lives. `DashboardShelf` takes a `toggleRef` for it — the one node in that subtree
  that never unmounts.
• **Restore** → the shelf disclosure again. The chip's own Restore button is removed by the click that
  restores, and the remaining chips shift, so the chip list is the wrong target in both directions.
• **Move** (earlier / later / first) → **the moved tile's own ⋮ trigger**, so a second press needs no
  re-navigation. ★★ TWO THINGS MAKE THIS DIFFERENT FROM THE OTHER TWO. It fires from a `useEffect` keyed
  on a fresh request object, NOT from the handler: React reorders a keyed list by MOVING the existing DOM
  nodes and moving a focused element blurs it, so a synchronous focus would be undone by the very
  re-render the move causes. And it resolves the trigger by TILE ID through a ref map
  (`menuButtonRef` on `DashboardTile`), never through `menuAnchorRef` — that holds a node captured
  BEFORE the reorder, and focusing a stale node is a silent no-op, i.e. the same defect one level down.
  ★★★ jsdom CANNOT TELL THE TWO APART: the synchronous version passes the unit test. Measured, so do not
  "simplify" it back on the strength of a green suite.
★★ **RESIZE IS NOT IN THAT LIST AND MUST NOT BE ADDED TO IT.** `TileAxisGroup`'s `onPick` calls
`onResize` and nothing else, so the size radios do NOT close the popover; the pressed control stays
mounted and keeps focus by itself, and the panel is portaled so the tile re-rendering at its new span
cannot disturb it. Verified before the move fix was written, precisely so no machinery was added for a
defect that is not there, and pinned by a test that goes red if a future change makes resize close the
menu.

★ **An axis where `min === max` renders NO chooser** — `TileAxisGroup` shows a static "fixed at N" line,
because a row of values with all but one disabled reads as a broken control. No catalogue tile pins an
axis today, so that branch is reachable ONLY through the exported `TileAxisGroup`, which is why it is
exported. ★ Values outside a tile's own limits are not rendered rather than disabled: `SegmentedControl`
has no per-option `disabled`, and forking it would have cost the APG roving, the sole tab stop and the
non-colour selected state.

★ **The abandoned bento is still worth knowing**, because it is why dense packing matters: a fixed
`lg:grid-cols-2` grid with `items-start` and wildly uneven card heights trapped large wide-screen voids
under the short KPI/Progress cards. The multicolumn masonry that replaced it killed the voids but owned
the order; the arrangeable grid keeps dense packing AND hands the order to the user.

The Trends widget (`props.tursoActive`-gated `VarianceSummary`) is now the `trends` tile and is still a
click-through button → navigates to the Trends view (`onNavigate("trends")`).
★ Tip-of-the-day (`DashboardTipCard`, `dashboard-tip-card.tsx` + pure English-only `tips.ts`)
is a dismissable headline card that rotates one tip per day; per-device `aipm-cockpit:tip-state` (next/dismiss),
popout read-only, day captured via lazy `useState` (purity — no `Date.now()` in render).
★★ **Digest email (`use-digest.ts` + `digest/digest-mail-sender.ts`):** `createDigestMailSender`'s CONTRACT is
resolve ONLY on a mail Graph actually accepted, THROW on every other outcome — the hook treats a resolved
promise as "sent" and confirms it to the user, so reporting a failure and then resolving produced a false
"Digest email sent." with nothing in the mailbox. All user feedback lives in the HOOK (success toast, no-account
guidance via `reportCapabilityGap`, failure via `reportSilentFailure`); the sender only throws, and its message
must stay free of the recipient and token (it reaches the diagnostics ring). ★★ `generate()` takes THREE independent flags — `advance` (reschedule the cadence), `notify` (desktop
notification), `narrative` (a BILLED AI call). They were one flag, so emailing had to advance the cadence just
to get its narrative: clicking Email with the feature disabled pushed the next digest out a full week. Email
passes `advance:false, narrative:true`; a not-due remount passes all false. Never re-couple them — the
narrative is billed and must never ride along with something else. ★★ The duplicate-send guard is a
`sendingRef`, NOT the `busy` state: `emailDigest` awaits `generate()`, whose own `finally` clears `busy`, so
between that and the next `setBusy(true)` the flag is false and two clicks in one tick BOTH sent (verified —
it really sent twice). `busy` stays for the disabled/visual state only. ★ `generate()` is deliberately OUTSIDE
the send's `catch` so one of ITS failures can't surface as "digest email failed".
The presentational slices:
- `dashboard-sections/dashboard-hero.tsx` (`DashboardHero`) — now ONLY the compact Overall RAG band +
  Adjust-health `<details>`; OWNS the `OverrideSelect` helper. Props trimmed to
  `{lang, today, model, status, setStatus, showBudget?, showChanges?, dc}` — `trends`/`topActions`/
  `onOpenAction`/`onNavigate` were REMOVED (they moved with the KPI/Top-actions cards).
- `dashboard-sections/dashboard-kpi-strip.tsx` (`DashboardKpiStrip`) — the 3 "at a glance" KPI tiles
  (complete % · overdue · open RAID; overdue and open-RAID always carry a `TrendArrow`, completion
  carries one only outside the no-active-scope state below); the body of the `kpi` tile. Uses a
  `dc.cardPad` card wrapper (NOT `<Section boxed>`, which hardcodes `p-4` and ignores compact density).
  ★★★ **NEVER RE-DERIVE "is this project all cancelled" — call `hasNoActiveScope(progress)`
  (`dashboard.ts`), or `tasksHaveNoActiveScope(tasks)` when you hold only tasks.** Both go through the
  one `scopeCounts`, so a surface gated on either cannot drift from the tiles. This rule exists
  because the predicate WAS re-derived: the Progress tile got the state and the KPI card did not, and
  for four commits one dashboard showed "No active scope" beside "Complete 0%". THREE more surfaces
  then turned out to render the same metric — the completion sparkline, and the Trends variance row
  in both of its consumers (gated in `use-snapshots.ts`, the hook that PRODUCES `variance`, not at
  either render site). In that state the completion tile drops its `TrendArrow`, `KpiGradientBar` and
  `hint` together, since each explains a percentage it no longer shows. ★ `total === 0` is
  DELIBERATELY excluded — an empty project keeps 0%, and a test pins that exclusion.
  ★★ DROPPING `hint` CHANGES THE TILE'S BOX: `Tile` only wraps itself in the
  `relative h-full w-full` div when `hint` is present, so the completion tile is a DIFFERENT element
  in the grid between the two states. Harmless in the `grid` strip (cells stretch), but jsdom has no
  layout so no test here can see it — eye-verify this tile in both states, and never assume the
  wrapper is there when writing a `.parentElement` walk against it.
  ★★ STILL INCONSISTENT, recorded not fixed (`docs/open-followups.md` §66): the R/A/G tile beside it
  counts a cancelled task GREEN, because `computeGroupHealth` tallies `computeTaskHealth` per task
  and that returns Green for anything finished. So an all-cancelled project reads "No active scope"
  next to "G 2".
- `dashboard-sections/dashboard-top-actions.tsx` (`DashboardTopActions`) — the ranked Top-actions queue;
  returns `null` when `!topActions?.length`. ★★ The panel no longer gates a wrapper on that: the old
  `break-inside-avoid` masonry wrapper is gone and the condition moved into `TileGateInput`
  (`hasTopActions`), so an empty queue means the whole `topActions` TILE does not render. The other
  inline masonry conditions moved the same way (`hasInsights`, `hasCompletionTrend`).
- `dashboard-sections/registers-band.tsx` — split into `RaidRegisterCard` (gated on `showRaid`) +
  `UpcomingCard`, the bodies of the `raid` and `upcoming` tiles; the old combined `RegistersBand` wrapper
  was RETIRED.
- `dashboard-sections/dashboard-narrative.tsx` — `NarrativeSummary` (headline, read-only saved text,
  renders null when empty) + `NarrativeEditor` (footer folded `<details>`, owns the draft + autogrow + the
  render-time reconcile; the textarea carries an `aria-label`, NOT just a placeholder — axe).
★ ALL tier/card spacing uses `dc.*` density classes, never literal `gap-*`/`space-y-*`/`p-*`/`mb-*`.
`DashboardPanelProps` is unchanged by the reorg (the ~30 test/caller sites were untouched).
★★ `DensityClasses` has FIVE fields — `{outer, kpiGap, cardPad, sectionGap, tileRow}`. A sixth,
`cardGap` (`mb-4`/`mb-2`), was the masonry's inter-card margin and is REMOVED along with it. It
outlived the masonry for one release because `dashboard-density.test.ts` still asserted its value, so
nothing went red — a test over a dead field is not evidence the field is used. ★ The two surviving
`toEqual` assertions pin the WHOLE object, so re-adding a field there is a red test rather than silent
regrowth; keep them exact-shape rather than per-key. Re-derive the count, don't trust it:
`grep -c ": string;" src/app/dashboard-density.ts`.

The Dashboard (`dashboard-panel.tsx`, owns `computeDashboard`) opens with a greeting + "since you last
looked" delta strip, with the four RAG `OverrideSelect`s folded into a `<details>` "Adjust health
ratings" disclosure inside `DashboardHero`. ★★ This used to add "then the ranked top-actions queue
(promoted ABOVE the health band)" — top-actions is a TILE now, so it sits in the grid BELOW the hero,
and a user can move it anywhere or hide it. Nothing in the headline zone is ranked any more. Dashboard
IS in axe `A11Y_VIEWS`. Built as slices:

- **Delta strip:** pure i18n-free `dashboard-delta.ts` (`computeDelta` diffs the activity log by
  `timestamp > lastVisitAt` + a prior RAG snapshot → `DeltaResult`; `buildGreeting`); per-project
  localStorage store `landing-state.ts`; hook `use-landing-delta.ts`; presentational
  `dashboard-delta-strip.tsx`. ★★ `landing-state.ts` is a per-BROWSER, per-PROJECT store (single key
  `aipm-cockpit:landing-state` → `{[projectId]: LandingState}` map, capped 50 most-recent) — NOT a Workspace
  field (zero backend write paths), OUT of exports/Turso, cleared by `clearAppConfig`'s `aipm-cockpit:*` sweep.
  Keyed off workspace-section's `currentProjectId ?? "default"`. ★★ `use-landing-delta` captures the delta
  ONCE at mount via a LAZY `useState(() => computeDelta(loadPrior, …))` (reads the PRIOR snapshot before
  advancing) and advances the stored snapshot in a DEBOUNCED (4s) `useEffect` that ONLY writes localStorage
  (a side-effect, NOT setState) — both shapes are deliberate to pass the react-hooks PURITY +
  `set-state-in-effect` bans; `new Date()` lives in the timeout callback. Popout = read-only (no advance).
  ★★ CHIP CLICK ROUTING: deep-links RAID/milestone/change to the SPECIFIC item via `requestOpen(view, id)`
  (wired in `workspace-section.tsx`, same channel as the Action Center) — `onOpenRaid`/`onOpenMilestone`/
  `onOpenChange` carry their id arg. Only the AGGREGATE delta-strip milestone/change chips + the
  milestone-horizon "+N more" affordance stay view-LEVEL (pass sentinel `-1` → target panel's `pendingOpen`
  effect finds no item → view switch only). `onOpenTask` OPENS A SPECIFIC EDITOR by id (`tasks.find(id)`),
  so it MUST be gated on a real `repTaskId` (first overdue/due-soon) or the chip is a DEAD `-1` no-op button
  (the strip downgrades a handler-less chip to a non-interactive `<span>`). ★ `DashboardPanel.projectId` is
  OPTIONAL (defaults `"default"`) so the ~30 existing test render sites don't break. ★ greeting hour via
  lazy `useState(() => new Date().getHours())` (purity — no `Date` in render body). ★ `newOverdue` lower
  bound is INCLUSIVE (`dueDate >= sinceDate && < today`): a task due ON the last-visit date wasn't overdue
  then (due end-of-day) but is now. ★ strip chips are real `<button>`s (text = accessible name), flip labels
  are `<span>`s; the `<details>` is keyboard-native and keeps the override `<select>`s in the DOM (so
  `getByText("Overall")` still resolves).
- **Milestone horizon strip ("what's coming"):** pure engine `bucketMilestonesByHorizon` (in
  `milestones.ts`) buckets NON-achieved milestones into `overdue`/`thisWeek`/`next2Weeks`/`later` by
  CALENDAR days (`HORIZON_THIS_WEEK_DAYS=7`, `HORIZON_NEXT_DAYS=21`; UTC-midnight `Date.parse`, no
  `new Date()` of now — `today` passed in); overdue-first, a `d < 0` safety net also routes to overdue, an
  unparseable date → `later` (never crashes, never false-overdues). Each `HorizonEntry` carries its
  `milestoneStatus`. Presentational `milestone-horizon-strip.tsx` REPLACED the old flat dashboard
  Milestones list (same `showMilestones`-gated `Section` slot; buckets via a `useMemo` over
  `props.milestones`+`props.tasks`+`today`+`holidaySet`; `onOpenMilestone` ignores its arg → routes to the
  milestones view). ★ The ENGINE is uncapped (full + testable); the STRIP caps each bucket at
  `MAX_PER_BUCKET = 5` rendered chips with a "+N more" affordance (bucket header still shows the TRUE
  total) — without the cap a large portfolio's `later` bucket floods the cell. ★★ REUSABLE a11y LANDMINE: a
  `RagBadge` (renders `<span role="img" aria-label="Red"/"Amber">`) placed INSIDE a `<button>`/clickable
  chip BLEEDS its label into the element's computed accessible name (→ "Red ⚠ M1 · date"). Wrap it in
  `<span aria-hidden="true">` whenever the visible ⚠/text already conveys the meaning — applies to ANY
  RagBadge-in-button. ★★ INVERSE trap (same class): an `aria-label` on a NON-interactive BARE `<div>`/wrapper
  (no `role`) is NOT announced by screen readers — dead markup. To name a decorative graphic (SVG
  sparkline/chart), put `role="img"` + `aria-label` ON THE GRAPHIC element itself (mirrors
  `trend-chart.tsx`), NOT on a wrapper div. axe does NOT flag the dead-label case, so it passes the gate
  while the meaning is invisible.
- **Coaching CTAs (first-open story):** pure i18n-free `dashboard-coaching.ts`
  `computeCoaching({taskCount,milestoneCount,budgetCount,showMilestones,showBudget,aiConfigured})` →
  ordered `CoachingCta[]` (`{key,labelKey,view}`, keys+`AppView` only). ★ GATED on `taskCount === 0`
  (blank project) → returns `[]` once any task exists, so the card SELF-HIDES (no dismiss control). Order:
  Add task(`open-points`) · Configure AI(`settings`) · Add milestone(`milestones`) · Set budget(`budget`),
  each gated on its module/empty condition. Presentational `dashboard-coaching-card.tsx` (returns null when
  empty); rendered right after the delta strip. ★★ NAV from the dashboard uses a single `onNavigate` prop
  wired to `useWorkspaceTab().setActiveTab` (the SINGLE active-view source — routes to `open-points`
  correctly even though tasks render in a separate `TasksSection`, not WorkspaceSection). ★★ The
  Anthropic-key "configured" signal is `settings.ai.apiKey` (NOT top-level `settings.apiKey` — that does
  not exist; `apiKey` lives on the nested `AiConfig`); use `!!settings.ai.apiKey?.trim()` (in-memory
  hydrated value, blanked on disk by `writeSettings`, passphrase-locked → `""` → unconfigured). ★ New
  `DashboardPanel` props `onNavigate?`/`aiConfigured?` are OPTIONAL (back-compat with ~30 test sites).
  ★★ EXHAUSTIVE-DEPS LANDMINE: a `?.length`/`obj.member`/any complex expression INSIDE a `useMemo` dep array
  is a FATAL `--max-warnings=0` warning — HOIST it to a scalar local (`const milestoneCount =
  props.milestones?.length ?? 0`) and depend on that. ★ The greeting summary is suppressed when
  `needsYou===0 && milestonesSoon===0` (avoids "0 items need you" on a blank project). ★ The live demo seeds
  a POPULATED project so the coaching card is ABSENT at scan time (buttons eye/unit-verified, not axe-gated).
- **KPI trend arrows ("which way is it moving"):** an "at a glance" 3-tile KPI strip (completion % · overdue
  · open RAID) below the coaching card, each tile with a trend arrow (↑/↓/→) + signed delta vs LAST VISIT.
  Pure i18n-free `dashboard-trends.ts` `computeMetricTrends(prior, current)` → `Record<MetricKey,
  MetricTrend>` (`{value, delta, direction, improved}`); per-metric `HIGHER_IS_BETTER` (completion up = good;
  overdue/openRaid up = bad). ★ `delta===null ⟺ improved===null ⟺ no prior value` → arrow renders NOTHING;
  exactly-flat `delta===0` → `improved:false` + `direction:"flat"` ("unchanged", muted, NOT worsened).
  Presentational `trend-arrow.tsx` returns `null` when `improved===null || delta===null`; glyph + signed
  delta are `aria-hidden`, the WRAPPER carries the full `aria-label` (label-bleed class — never let the glyph
  become the accessible name). ★★ REUSES the per-project `landing-state` snapshot — `LandingState.metrics?:
  MetricSnapshot` rides the SAME `aipm-cockpit:landing-state` map (zero new backend paths); guard accepts an
  optional metrics object. `use-landing-delta` returns `{delta, trends}` — trends mount-captured in the SAME
  lazy `useState` (reads `prior.metrics` before advancing), `metrics` written in the SAME debounced 4s
  advance (popout read-only). ★ The KPI tile VALUE reads LIVE `model`
  (`progress.percent`/`overdue.length`/`openRaidCount`); the arrow is mount-captured vs prior — same
  mount-snapshot asymmetry as the delta strip (a mid-visit reload can briefly diverge value vs arrow;
  accepted). ★ `DashboardModel.openRaidCount` is the TRUE open (non-terminal) RAID count — `topRaid` is
  capped at 5 so can't be the source; REQUIRED field but the only literal `DashboardModel` construction
  (`snapshot.test`) is an `as unknown as` cast. ★ `complete` KPI is a PERCENTAGE → `TrendArrow` takes a
  `unit` prop (`"%"`) so the visible delta (`+5%`) + aria-label aren't ambiguous; counts pass `""`. ★ `Tile`
  (`report-table.tsx`) gained an optional `trend` slot. Trend templates are i18n EN+DE.
- **Completion-trend sparkline ("trajectory"):** compact axis-less line of % complete over time, in a
  self-hiding card below the KPI strip. Pure i18n-free `completion-trend.ts`
  `computeCompletionTrend({snapshots, activity, currentDone, currentTotal, today})` → `CompletionPoint[]`
  (`{label,percent}`). ★★ SOURCE PRIORITY: if `snapshots` yields ≥2 points → exact
  `SnapshotRecord.pctComplete` series (Turso path); ELSE reconstruct done/total from the LOCAL activity log —
  anchor at the live counts and walk `task.created/completed/reopened/deleted` BACKWARD per day (deleted
  task's done-state unknown → assumed NOT done; documented approximation, like `newOverdue`). Neither ≥2 →
  `[]` (card hidden). Pure: `today`+counts passed in; percents clamped 0–100; future-dated + non-task events
  ignored; trailing cap `MAX_POINTS=12`. ★ ALWAYS-ON, no `tursoConfig` guard — on file/IDB `snapshots` is
  `[]` so the log path runs automatically (reads snapshots opportunistically, never WRITES). Presentational
  `sparkline.tsx` (pure SVG `<polyline>`, `stroke-ui-dark-blue`, null for <2 points; optional `ariaLabel`
  prop → SVG gets `role="img"`+`aria-label`, else `aria-hidden` decorative — name rides the GRAPHIC, not the
  bare card div). ★ New optional `DashboardPanel` prop `snapshots?` threaded from `trends.snapshots`; the
  panel ALREADY loads `activity` via `loadActivityLog()` (no activity prop). ★ series `useMemo` deps hoisted
  to scalar locals (`snapCount`/`activityCount`/`currentDone`/`currentTotal`/`today`). `model.progress`
  exposes `completed`+`total`. i18n EN+DE.
- **Density toggle ("fit more on screen"):** per-device Comfortable/Compact, SPACING ONLY (no
  font/palette/contrast change). Pure i18n-free `dashboard-density.ts` `densityClasses(d)` →
  `{outer,kpiGap,cardPad,sectionGap,tileRow}` class strings — comfortable REPRODUCES the original
  literals (`space-y-4`/`gap-2`/`p-3`/`gap-4`, a no-op for existing users), compact tightens
  (`space-y-2`/`gap-1`/`p-2`/`gap-2`). ★★ `sectionGap` NO LONGER drives "the two-column section grids
  (Progress+Budget, Milestones+Changes)" — those grids went with the masonry, and its ONLY consumer today
  is the tile grid's gap (`grep -rn "dc.sectionGap" src` → one hit, `dashboard-grid.tsx`). `tileRow` is
  the newer key and drives that same grid's row unit; `cardGap` is REMOVED (see above). ★ Any NEW
  spacing on a cockpit slice MUST use a `dc.*` class,
  NOT a literal `gap-*`/`space-y-*`/`p-*` — a literal ignores compact mode (it bit the two section
  grids of the day: they stayed `gap-4` while everything else compressed).
  `DashboardPanel` takes `density?` (default `"comfortable"`). ★★ ONE control now (the on-panel toggle was
  REMOVED): the SOLE density control is a `SegmentedControl<DashboardDensity>` in `AppearanceSection`
  (Settings→General), writing `settings.dashboardDensity?` (per-device, persisted via
  `setSettings`→`writeSettings` SPREAD — no allowlist edit, mirrors `tasksViewMode`). The panel just reads
  the `density` prop. ★ Settings→General is axe-scanned — SegmentedControl's `ariaLabel` keeps the gate
  green. ★ Compact-test asserts `.space-y-2` PRESENCE only (container-only; a global-absence check is
  brittle). i18n EN+DE.
- **Click-through:** `Tile` (`report-table.tsx`) gained an optional `onActivate`/`activateLabel` clickable
  variant (renders a real `<button>` — axe-safe name via `activateLabel`); pure i18n-free `activityViewOf`
  (`dashboard-activity-nav.ts`) maps an activity `kind`→`AppView`; KPI/progress/burn tiles + the completion
  sparkline launch their view via `onNavigate`, Top Changes rows + RAID register rows + horizon chips
  deep-link the item.
- **`Tile` `hint` tooltip (★★):** `Tile` (`report-table.tsx`) has an optional `hint?: string` that renders an
  `InfoTooltip` as a DOM **SIBLING** of the tile (`<div className="relative h-full w-full">{tile}<span absolute>
  InfoTooltip</span></div>`), NOT inside the `label`. Embedding an `InfoTooltip` (role=button) inside a CLICKABLE
  tile's label (Tile `onActivate` → `<button>`) is a **nested-interactive axe FAIL** — Dashboard is axe-scanned, so
  the dashboard cockpit tiles (which are click-through) MUST use `hint`, never a label-embedded tooltip. The wrapper
  needs `w-full` or hinted tiles shrink-to-content in flex rows (grid rows stretch regardless; flex rows don't). A
  NON-clickable tile can still embed a tooltip in its label node (budget-report pattern), but `hint` is the safe
  default. ★ tests that walk `getByText(...).closest("div.rounded-lg").parentElement` to reach a tile's row need one
  extra `.parentElement` hop when `hint` adds the wrapper.

- **Deep-link row flash:** shared `use-deeplink-row-flash.ts` — `useDeepLinkRowFlash(view)` (render-time
  reconcile sets `flashId` + a monotonic `flashSeq` nonce; an effect keyed on `[flashId, flashSeq]` does the
  rAF `scrollIntoView({block:"center"})` + a `DEEPLINK_FLASH_MS=1800` auto-clear; the nonce makes a same-id
  re-request re-fire) + `flashOutlineClass(isFlashed)`. Each of the five deep-linkable panels
  (raid/milestones/changes/stakeholders/tasks) attaches `containerRef` to its `overflow-auto` scroll
  container and adds `data-deeplink-row={id}` + `flashOutlineClass(flashId===id)` to rows; static
  `outline-ui-green` (no bg → never fights row `bg-*` state classes; palette-safe). Fires ALONGSIDE the
  editor-open effect and does NOT clear `pendingOpen` (the panel's own effect does — both fire in the same
  commit; the side-effect is keyed on `flashId` NOT `pendingOpen` so `clearPendingOpen` can't cancel the
  scroll/auto-clear). ★ The Kanban **board** is ALSO wired: `tasks-section.tsx` threads the SAME
  `containerRef`+`flashId` into `<TaskKanban>` (only one of table/board mounts at a time, so the single ref
  is free); `task-kanban-board.tsx` attaches `containerRef` to the outer `overflow-x-auto` div and adds
  `data-deeplink-row`+`flashOutlineClass` to each card `<article>` (card scroll works because the per-column
  vertical scroller is a descendant of the outer ref). ★ Graceful no-ops (no scroll/outline, never crashes;
  editor still opens): tasks **modern full-page edit** (list unmounted) + any row/card hidden by an active
  filter/search (`hideFinishedTasks`, milestone filters). ★ By-design limit: toggling tasks table↔board
  WITHIN the 1.8s window re-points the shared `containerRef` so the OUTLINE shows on the new view, but the
  scroll won't re-fire (`flashId`/`flashSeq` unchanged). ★★ v0.190.0: the modern task editor is now the
  FLOATING `TaskFormModal` (the full-page `TaskEditView` was retired), so the list/board stays MOUNTED under
  the editor and the IMMEDIATE `requestOpen`/`pendingOpen` render-reconcile + rAF scroll flash path covers
  `open-points` deep-links too (no editor-return special case). The old flash-only `pendingFlash`/
  `requestFlash`/`clearPendingFlash` return-path channel on `WorkspaceTabContext` + `task-manager`'s
  `flashOnEditReturnRef` were REMOVED (dead once the editor became a modal) — do NOT reintroduce them; there
  is no `pendingFlash` channel and no reserved `"edit"` AppView anymore. Classic/popout also uses the
  immediate path; all five panels show the flash in modern the same way.
- **Global search:** pure i18n-free `global-search.ts` (`searchWorkspace(ws, query)` → ranked
  `SearchResult[]`; id-exact > title-hit > body-hit tiers, per-type cap `SEARCH_MAX_PER_TYPE`
  round-robin-merged under `SEARCH_MAX_RESULTS`, `SEARCH_MIN_QUERY=2` with pure-numeric `#id` queries exempt
  from the min). Presentational `global-search-box.tsx` uses `combobox-shared`
  (`role=combobox/listbox/option`); module-level `GlobalSearchConnected` wraps `useWorkspace`+
  `useWorkspaceTab`, mounted in BOTH headers (modern `topBarMenus`/`search` slot + classic `AppHeader
  trailing`, not popout). Result select → `requestOpen(view,id)` → deep-link + row flash. ★ The search input
  is a top-bar control → scanned in EVERY axe view; keep its combobox a11y (aria-label + roles) intact. ★
  i18n key is `searchGlobalPlaceholder` (`searchPlaceholder` was taken by the task-table search). ★ Document
  keydown FOCUS SHORTCUT (⌘K/Ctrl-K always; "/" only when no INPUT/TEXTAREA/SELECT/contentEditable is active;
  Escape blurs). Pure `search-highlight.ts` `splitHighlight(text,query)` (indexOf-based, NOT a RegExp from
  input → no metachar/`/s`-flag traps) renders matched segments as `<mark class="bg-ui-green/20
  text-inherit">` in result title+subtitle, query-mode only. Pure `search-recents.ts` (per-device
  `aipm-cockpit:search-recents`, `MAX_RECENTS=8`, validated load, pure `pushRecent` dedupe+cap) — recents shown
  when the box is focused with an EMPTY query, FILTERED to items still present in the live workspace; OUT of
  exports/Turso, cleared by `clearAppConfig`. Unified `items` list (recents on empty, results otherwise)
  drives the combobox; "Recent" header is a non-option `<div>` outside the `<ul>`. ★ PERF: `buildSearchIndex(ws)`
  scans+lowercases the 5 arrays ONCE (query-independent, memoized on the arrays); `searchIndex(index, query)`
  runs per keystroke. `searchWorkspace` kept as a thin back-compat wrapper. Gantt uses the same shape — a
  `Map<taskId,haystack>` memo keyed on `[tasks]` ONLY (do NOT bundle the search text into the prefs memo, or
  every keystroke busts the whole `visible` memo).
- **RAID edit modal map:** `RaidEditModal` (`raid-edit-modal.tsx`) owns draft, query state, derived option
  lists, add/remove handlers; presentational `raid-risk-matrix.tsx` (`RiskMatrix` 5×5 picker, Risk items
  only) and `raid-edit-fields.tsx` (`RaidLinkedTasksField`, `RaidCausedByField` — the two chip-picker
  sections, threaded handlers/state as props). RAID IS in axe `A11Y_VIEWS`.
- **Shared edit-modal chrome (`edit-modal-chrome.tsx`):** three presentational atoms the change/raid/
  stakeholder edit modals repeated verbatim (top cross-file jscpd clones, TD-6): `ModalFieldError` (the
  `<p role="alert">` ui-pink banner — caller keeps the `{error && …}` guard), `StakeholderChipPicker` (the
  linked-stakeholders checkbox chip list — caller keeps its own field-visibility gate; change + raid),
  `ModalEditFooter` (bordered footer, destructive delete left + cancel/submit right — change + stakeholder;
  takes `deleteConfirmKey`/`deleteLabelKey`/`deleteAriaLabelKey?`/`deleteDisabled`/`saveDisabled`/
  `saveLabelKey`). ★ RAID's footer stays BESPOKE (border-less + `InfoTooltip`, no submit-disabled) — divergent,
  deliberately NOT folded in. Presentational only; edit shared modal markup/a11y HERE.
  ★ `EditModalShell` (the resizable/draggable panel + `ModalHeader` + backdrop, in `modal.tsx`) is now used by ALL
  SIX edit-modals — change/raid/stakeholder + absence/milestone/resource (adopted 0.190.39). It takes defaulted
  `widthClassName`/`formClassName` (defaults = the wide 720px two-column form), so a modal overrides ONLY when it
  diverges — today that is every one but stakeholder: absence/resource still pass the narrower 560px width,
  while change/raid/milestone now pass a wide 1280px width (change/raid used to rely on the 720px default;
  milestone used to pass the narrower 560px, and still keeps its single-column form). Changing a default here
  shifts every non-overriding adopter — keep the defaults == the pre-0.190.39 hardcoded values.
- **Stakeholder Influence/Interest map drag:** `stakeholder-map-panel.tsx` chips drag between the 2×2 quadrants
  (native HTML5 DnD, no lib). Pure i18n-free `applyQuadrantMove(s, quadrant)` in `stakeholders.ts` uses
  **preserve-Medium**: high side → "High"; low side demotes only a "High" → "Medium", keeps existing Medium/Low;
  returns `null` on a no-op drop. ★ round-trips are NOT identity (Low → keep-satisfied → monitor yields Medium — the
  2×2 can't express Medium so a demotion out of the high band lands there). Gated on the panel's `onSaveStakeholder`
  prop (omitted → read-only popout mirror, chips not draggable); reuses `handleSaveStakeholder` (functional setter +
  `localModifiedAt` stamp + `stakeholder.updated` log). Chips stay plain (no level badge). The map is NOT in axe
  `A11Y_VIEWS` — drag is a mouse enhancement; the edit modal's High/Med/Low selects are the keyboard path.
- **OOXML export map:** hand-rolled Office export (no lib; own `zip.ts` writer) split by format:
  `export-docx.ts` (`buildDocx`), `export-xlsx.ts` (`buildXlsx`), `export-pptx.ts` (`buildPptx`) over shared
  `export-ooxml-shared.ts` (brand palette consts, `xmlEscape`, `todayHuman`, `PPTX_MAX_ROWS_PER_SECTION`).
  `export-ooxml.ts` is a BARREL re-exporting the 3 builders — `export.ts` consumes them via `await
  import("./export-ooxml")` and `export-ooxml.test.ts` imports from the barrel, so keep those three names
  exported there. (Sections come from `export-sections.ts`.)
- **Sanitize module map:** `sanitize.ts` is a BARREL (`export *`) over three files — keep importing from
  `./sanitize` (**63** importers on 2026-08-04 — `grep -rl 'from "\./sanitize"' src/app --include=*.ts
  --include=*.tsx | wc -l`; a long-stale "≈37" sat here, so re-derive rather than trust the number).
  Pure i18n-free, one-way deps (core ← entities ← records): `sanitize-core.ts`
  (primitives + length caps: `sanitizeText`/`sanitizeMultiline`/`toNumber` EXPORTED, plus the
  field/date/email/label/dependency sanitizers), `sanitize-entities.ts`
  (Absence/Shift/Resource/Role/Discipline/Grade/Plan/Budget/allocations/FxRates), `sanitize-records.ts`
  (Milestone/Change/RAID/Stakeholder/ProjectMeta/SteeringCommittee/timezone — imports only
  `BUDGET_NAME_MAX`+`sanitizeIdList` from entities). ★ A NEW entity sanitizer goes in entities or records
  (whichever cluster); a new shared primitive goes in core. Each `*_SET`/`*_RE` const stays in the file with
  its consumers. Golden byte-stability + `sanitize.test`/`.property` + the 63 importers guard behavior.
- **Codec module maps:** `csv-codecs.ts` and `markdown-codecs.ts` are BARRELS (`export *`) — keep importing
  from `./csv-codecs` / `./markdown-codecs`. Pure i18n-free, byte-stable (golden-workspace pins exact bytes).
  One-way deps:
  • CSV (core ← config ← decode): `csv-codecs-core.ts` (leaf — `*_CSV_COLUMNS` registries, parse helpers,
  the `fieldToString` family + `build*FromObj` decoders shared with the MD codec & Turso schema, csv
  escaping, per-section entity encoders, the low-level `parseCsv` tokenizer), `csv-codecs-config.ts`
  (status/field-visibility/features/steering config-blob codecs + ProjectMeta codecs + the `workspaceToCsv`
  ENCODER assembler), `csv-codecs-decode.ts` (`splitCsvSections` + row→object helpers + entity decoders +
  `decodeRatesMap` + the `csvToWorkspace` assembler).
  • MD (core ← decode): `markdown-codecs-core.ts` (leaf — `*_MD_COLUMNS`, `mdEscape`/`mdUnescape`, per-entity
  table encoders, config/project MD codecs, the THREE self-contained table decoders
  `markdownToMilestones`/`Changes`/`Stakeholders`, the `workspaceToMarkdown` encoder, the shared row
  primitives `splitMdRow`+`markdownTableToObjects`), `markdown-codecs-decode.ts` (`splitMarkdownSections` +
  remaining entity decoders + `markdownToWorkspace`). ★★ `parseCsv` (CSV) and
  `splitMdRow`+`markdownTableToObjects` (MD) were HOISTED into the respective CORE so the config-blob / early
  table decoders share them WITHOUT a config↔decode / core↔decode cycle. ★ Cross-module-referenced core
  internals (the `CSV_SECTION_*` consts, entity encoders, `csvCellEscape`; `mdUnescape`, the row primitives,
  the three MD table decoders) are EXPORTS. A new per-section codec goes in core; a new config-blob codec in
  `csv-codecs-config`; a new assembler stays with its peer.
- **useStorageBackend module map:** `use-storage-backend.ts` keeps the PERSISTENCE core (backend memo,
  reactive refs, `applyWorkspace`, the load/save debounce effects, broadcast sync, the storage-file controls
  `onPick`/`onGrantWriteAccess`/`onOpen`/`onRequestStorageSwitch`, and shared helpers
  `backendFor`/`currentWorkspace`/`commitRegistry`/`persistBackendHandle`/`tursoConfigNow`/
  `reportProjectError`). The two project-operation clusters live in hook factories it composes:
  `use-storage-file-ops.ts` `useFileProjectOps` (switchToProject / createProject / loadProjectFromFile /
  createDemoProject) and `use-storage-turso-ops.ts` `useTursoProjectOps`
  (switch/create/migrate/archive/restore/hardDelete Turso portfolio projects). Each takes a typed `deps`
  object (the live render-scope closure values + shared helpers) and returns the handlers. ★★ These handlers
  MUST NOT be memoized — they read live render-scope state every call (the same reason the originals were
  bare `function` declarations). ★★ The factories are named `use*` and called UNCONDITIONALLY (before the
  single `return`, no early-return precedes them) because the react-hooks PURITY rule REJECTS passing a ref
  object into a plain function call during render — a `use*` hook may receive the hook's refs, a plain
  `createX(deps)` cannot. ★ A new project flow goes in file-ops or turso-ops; a new persistence concern or
  shared helper stays in `use-storage-backend.ts` and is threaded into the deps. Public return shape is
  unchanged.
- **Workspace-section module map:** `workspace-section.tsx` is the view ROUTER (the tabpanel switch); it
  imports the lazy panels from `workspace-panels.tsx` (the **23** `dynamic(ssr:false)` view-panel `export
  const`s, `grep -c "ssr: false" src/app/workspace-panels.tsx` — it read "20" for long enough that the
  count was wrong in two places at once) and the props contract `WorkspaceSectionProps` from
  `workspace-section-types.ts`, which it RE-EXPORTS. Static (non-lazy) panels
  (Dashboard/Milestones/SteeringCommittee/ResourceDirectory) stay imported directly. Routes the axe-scanned
  views, so changes there re-scan them. ★ The two tab-navigation strips (primary tablist + sub-tablist)
  live in `workspace-section-chrome.tsx` (`WorkspaceTabStrip`, presentational, move-only Phase 3 split);
  the router file keeps only the tabpanel switch. Routing pinned by `workspace-section.characterization.test.tsx`.
- **RAID panel module map (gantt pattern):** `raid-panel.tsx` is the orchestrator (state, derivation, edit
  modal); the toolbar is `raid-panel-toolbar.tsx` (`RaidToolbar`), the table is `raid-panel-rows.tsx`
  (`RaidTable`), shared column metadata is the leaf `raid-panel-columns.ts` (`RAID_COL_WIDTHS`/`RAID_CONFIG_COLS`).
  Both presentational pieces are PURE (data + handlers as props). ★ Two brittle source-scan guard tests read
  the file the markup MOVED to: the add-before-search order test → `raid-panel-toolbar.tsx`; `table-head-sweep`
  → `raid-panel-rows.tsx` (same precedent as `gantt-chrome`).
- **Shared calendar toolbar controls:** the two-way Outlook toggle+push+pull toolbar block (duplicated
  verbatim across the RAID / Change / Absence toolbars — only the entity aria-label differed) is one shared
  `CalendarSyncControls` (`calendar-sync-controls.tsx`), keyed by an i18n `entityLabelKey`. Renders null
  unless `m365Configured && !isPopout && onToggleCalendar`. Milestone push/pull stays SEPARATE (manual-only,
  no enable toggle). ★ Tasks (Open Points) hand-rolled its OWN copy of this whole block (enable control + push
  + pull) rather than consuming the shared component, and its control used the bare `calendarSyncEnable` name
  with no entity qualifier — until the 0.211.0 toolbar-polish batch, which moved it onto `CalendarSyncControls`
  (`entityLabelKey="calendarSyncEntityTask"`) like every other calendar-capable pane. The enable control now
  carries the same per-entity accessible name the other panes do ("… – Tasks (due dates)"), which is what
  makes N panes' identically-labelled controls distinguishable under WCAG 2.4.6.
  ★★ IT IS A `ToggleButton`, NOT A CHECKBOX, since 0.212.0 — in all four panes AND in the four Settings rows,
  labelled "Add to Outlook". This bullet said "checkbox" four times after that stopped being true. Query it by
  `role="button"`. The toolbars carry ONLY the enable control; Settings additionally has the auto-sync
  control, which is a `ToggleButton` too — so neither surface has a calendar checkbox left to find.
- **Portfolio health (Turso-only cross-project rollup):** view `portfolio-health` (`portfolio-health-panel.tsx`,
  lazy). Uses the STANDARD resizable content-pane shell (`VIEW_PANE_RESIZABLE_CLASS` +
  `useResizable("aipm-cockpit:portfolio-health-size")` + `ResetSizeButton`; header OUTSIDE the bordered scroller,
  `print-root print-landscape`) — the empty/loading/error states stay full-fill (`VIEW_PANE_FILL_CLASS`).
  Pure `portfolio-rollup.ts` (`aggregatePortfolio`/`deriveMilestoneHealthBucket`) + hook
  `use-portfolio-health.ts`: for each portfolio project it does `new TursoBackend(cfg, projectId).load()` then
  runs the pure `computeDashboard` → per-project RAG/completion/openRAID/milestone rows + aggregate KPIs.
  ★★ Loads SEQUENTIALLY — `TursoBackend.load()` embeds `CREATE TABLE IF NOT EXISTS` DDL OUTSIDE the write
  lock, so parallel loads contend → `SQLITE_BUSY` (the "read-only load" assumption is FALSE). ★★ total
  failure (every project errors) surfaces an error (`PORTFOLIO_LOAD_FAILED`), NOT the empty state (else an
  outage reads as "no projects"). ★ budget RAG needs a REAL plan (period-key alignment) → pass budgets ONLY
  when `ws.plan` exists, never against the placeholder `FALLBACK_PLAN`. ★ effect deps: `configKey` must
  include the authToken (token rotation reloads); `holidaySet` (a Set) via a derived content key. ★ all four
  `computeDashboard` call sites (this hook, dashboard-panel, task-manager snapshot + render model) assemble
  their input via the shared `buildDashboardInput(entities, ctx)` in `dashboard.ts` (one place for the
  14-field shape + `?? []` array defaults); callers do their OWN gating (feature-off / no-plan budgets)
  BEFORE building — pass `[]` for a gated-off entity.

