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

**Layout = single masonry (CSS multicol, NOT a fixed grid).** `dashboard-panel.tsx` stays a thin
orchestrator (data derivation + the `computeDashboard` memo) and renders three zones: a full-width
HEADLINE (`DashboardDeltaStrip` · `NarrativeSummary` · `DashboardCoachingCard` · `DashboardTipCard` ·
`DashboardHero`) → ONE
masonry flow → a full-width FOOTER (`NarrativeEditor` · Recent-activity `<details>`).
★★ The masonry is a CSS multicolumn container — `columns-1 lg:columns-2 xl:columns-3 ${dc.sectionGap}`
(default `column-fill: balance` equalises column heights) — NOT `grid-cols-*`. Each card is wrapped in
`<div className="break-inside-avoid ${dc.cardGap}">` so no card splits across a column. This REPLACED the
old fixed `lg:grid-cols-2` bento, whose `items-start` + wildly uneven card heights trapped large
wide-screen voids (huge whitespace under the short KPI/Progress cards). ★★ Masonry only kills voids when
`#cards > #cols` (two cards in two columns is one-per-column = the void stays) — that is WHY the hero was
re-split: its KPI strip + Top-actions had to join the same flow as the other short/tall cards. Reading
order is column-major (top→bottom per column); cards are ordered priority-first. New density key
`dc.cardGap` (`mb-4` comfortable / `mb-2` compact) is the inter-card vertical margin (multicol ignores
`gap`/`space-y` between items). The Trends widget (`props.tursoActive`-gated `VarianceSummary`) is a masonry
card placed directly after Progress and is itself a click-through button → navigates to the Trends view
(`onNavigate("trends")`); the footer holds only the status-summary + recent-activity
`<details>`. ★ Tip-of-the-day (`DashboardTipCard`, `dashboard-tip-card.tsx` + pure English-only `tips.ts`)
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
  carries one only outside the no-active-scope state below); a standalone masonry card. Uses a
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
  returns `null` when `!topActions?.length`, and the PANEL also gates its `break-inside-avoid` wrapper on
  `topActions?.length` so an empty queue leaves no dead `dc.cardGap` margin in the flow.
- `dashboard-sections/registers-band.tsx` — split into `RaidRegisterCard` (gated on `showRaid`) +
  `UpcomingCard`, two standalone masonry cards; the old combined `RegistersBand` wrapper was RETIRED.
- `dashboard-sections/dashboard-narrative.tsx` — `NarrativeSummary` (headline, read-only saved text,
  renders null when empty) + `NarrativeEditor` (footer folded `<details>`, owns the draft + autogrow + the
  render-time reconcile; the textarea carries an `aria-label`, NOT just a placeholder — axe).
★ ALL tier/card spacing uses `dc.*` density classes (`dc.outer`/`sectionGap`/`cardGap`/`cardPad`/`kpiGap`),
never literal `gap-*`/`space-y-*`/`p-*`/`mb-*`. `DashboardPanelProps` is unchanged by the reorg (the ~30
test/caller sites were untouched).

The Dashboard (`dashboard-panel.tsx`, owns `computeDashboard`) opens with a greeting + "since you last
looked" delta strip, then the ranked top-actions queue (promoted ABOVE the health band), with the four
RAG `OverrideSelect`s folded into a `<details>` "Adjust health ratings" disclosure. Dashboard IS in axe
`A11Y_VIEWS`. Built as slices:

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
  panel reads `activity` straight off `useWorkspace()`'s `activityLog` slice (no activity prop —
  the log is workspace data, not a per-device load). ★ series `useMemo` deps hoisted
  to scalar locals (`snapCount`/`activityCount`/`currentDone`/`currentTotal`/`today`). `model.progress`
  exposes `completed`+`total`. i18n EN+DE.
- **Density toggle ("fit more on screen"):** per-device Comfortable/Compact, SPACING ONLY (no
  font/palette/contrast change). Pure i18n-free `dashboard-density.ts` `densityClasses(d)` →
  `{outer,kpiGap,cardPad,sectionGap}` class strings — comfortable REPRODUCES the current literals
  (`space-y-4`/`gap-2`/`p-3`/`gap-4`, a no-op for existing users), compact tightens
  (`space-y-2`/`gap-1`/`p-2`/`gap-2`). `sectionGap` drives the two-column section grids
  (Progress+Budget, Milestones+Changes) so compact mode compresses them too. ★ Any NEW
  spacing on a cockpit slice MUST use a `dc.*` class (`outer`/`kpiGap`/`cardPad`/`sectionGap`),
  NOT a literal `gap-*`/`space-y-*`/`p-*` — a literal ignores compact mode (bit the two section
  grids: they stayed `gap-4` while everything else compressed).
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

