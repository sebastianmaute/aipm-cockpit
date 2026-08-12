<!-- Split out of AGENTS.md, which is the always-loaded file (CLAUDE.md is `@AGENTS.md`).
     THIS file is NOT auto-loaded — open it when you work on this subsystem.
     Same conventions: ★ = a non-obvious rule, ★★ = has already caused a bug,
     ★★★ = has caused the same bug more than once.
     `npm run docs:symbols:check` gates this file exactly as it gates AGENTS.md:
     it proves a backticked NAME is real, never that a CLAIM about it is true.
     Every claim here was true when written and some have outlived their code —
     grep before relying on one, and correct what you disprove in the same commit. -->

# UI shell — Help · navigation · focus/keyboard · surfaces · dismissal

[← AGENTS.md](../../AGENTS.md) · [doc set](../../AGENTS.md#the-doc-set--what-lives-where)

### UI shell — Help system

  • **Help view:** `help` AppView in the SYSTEM nav group below Settings (help-circle icon). `HelpView`
  (`help-view.tsx`, STATIC import — it takes function-valued callbacks like `onStartTour`/`onNavigateView` and
  `dynamic()` strips function props under the RSC serializable-props rule) renders the SHARED backbone `help-content.ts` (`HELP_ENTRIES`:
  HelpGroup `concepts`/`workflows`/`features`/`automated`, EN/DE, `relatedViews`/`relatedConcepts` for later
  SPs) GROUPED — grouped TOC + group headers (`HELP_GROUP_LABEL`, exhaustive `Record<HelpGroup>`) + per-concept
  "Related:" links. (`help-sections.ts` was renamed to `help-content.ts`.)
  ★★★ BOTH surfaces render EVERY group — the floating panel is NOT features-only. It was, via a
  derived `HELP_SECTIONS` slice, and this file said so long after that stopped being true while
  CONTRADICTING ITSELF six lines below ("FLOATING panel is CONTENT-PANE ONLY"). The export outlived
  its last caller; its only surviving reference was a test asserting it equalled its own definition,
  which would have kept passing however few surfaces used it. Cost: slice 2 of the help roadmap was
  scoped around "split the surfaces", work that already existed. Both the export and that test are
  now REMOVED — do not reintroduce a group filter without a caller. `docs:symbols:check` passed the
  whole time, because `HELP_SECTIONS` was a real NAME; the gate proves names, never claims.
  ★★ **Reading level** (`Settings.helpReadingLevel`, `SegmentedControl` in Settings → Appearance):
  `guided` | `standard` | `expert`, per-DEVICE, default `standard` (= today's rendering, byte-identical).
  `helpGroupOrder(level)` (`help-content.ts`) gives Expert a reference-first order (features →
  automated → workflows → concepts); Guided/Standard keep teaching-first. `HelpContentPane` takes an
  optional `readingLevel` (defaults `"standard"`, so every un-wired caller and test is unaffected);
  `help-menu.tsx` + `help-view.tsx` each read it via a LOCAL `useSettings()`. ★ Do NOT thread it
  through `ActionMenus` — that contract is guarded by `action-menus-sweep.test.ts`, and the
  props-not-hooks rule it documents was motivated by staleness that `use-settings.ts`'s listener
  registry has since fixed. ★ DELIBERATELY device-only: it is the ONLY Appearance field with no
  `ProjectAppearancePref` entry, because reading level belongs to the reader, not the project.
  ★★ Guided adds a `primerKey` primer above the body on the 12 `concepts` entries (a test pins that
  no other group has one). Primers name NO control, path or setting — conceptual prose cannot rot,
  and twelve paragraphs of behavioural claims would hand the next slice slice 1's job over again.
  A primer is SEARCHABLE only at the level that renders it, same rule as marker-stripping: never
  match text the user cannot see. Consequence, pinned by test: one query, different hit counts per level.
  ★★ `help-content-pane.tsx` (shared by the in-pane view AND the floating panel) renders each concept
  as a CARD (`border-l-ui-dark-blue` stripe, no shadow) on a `bg-surface-muted` scroller, with a wider `w-56`
  TOC driven by an `IntersectionObserver` SCROLL-SPY (effect dep = a hoisted scalar `sectionIdsKey` join, NOT an
  array; observer callback sets `activeId` — not render-phase setState). ★★ IN-PANE `HelpView` is its OWN TABBED
  surface: a `role=tablist` in the header beside the search box with tabs **Help · Guided tours · How it connects ·
  Information flows** (arrow-key roving, `FOCUS_RING`, `activeTab` drift guard); clicking a tab swaps the body and
  ONLY the active tab's body mounts (single shared `role=tabpanel` `#help-view-panel`). Search renders on the Help
  tab ONLY. Tours tab gated on `onStartTour` (modern-only) → 3 tabs in classic/popout/tests. Connects-tab concept
  click → `goToConcept` switches to Help + bumps a nonce; a nonce-keyed effect `scrollIntoView`s (no
  `set-state-in-effect` — `scrollTarget` never cleared). The catalog props (`catalogTours`/`completedTours`/
  `onStartTour`) thread `task-manager → WorkspaceSectionProps → workspace-section → HelpView`, REPLACING the dead
  `onTakeTour`. In-pane view is resizable (`useResizable` key `aipm-cockpit:help-view-size`) + carries Print/Reset-size
  buttons. ★★ FLOATING panel (`help-menu.tsx`) is CONTENT-PANE ONLY (`HelpContentPane` + its own search box; props
  `{lang}` only — NO tabs, NO tour catalog); the `helpIntro` slogan + footer "Take a tour" button are GONE (footer =
  license link only). Floating `useResizable` key `aipm-cockpit:help-size-v3`.
  `InformationFlowsSection` has an optional `maxWidth` (default 480 keeps Settings byte-identical; the in-pane flows
  tab passes 720). jsdom
  lacks `IntersectionObserver`/`scrollIntoView` → global no-op stubs in `vitest.setup.ts`. ★ Adding `help` to `AppView` forced FOUR edits (tsc/runtime): `CORE_VIEWS` (`feature-modules.ts`
  — else `filterNavGroups` prunes it), `LABEL_KEYS` + `navLabelKey` (`nav-config.ts`), `ICON_PATHS`
  (`nav-icons.tsx`, exhaustive `Record<AppView>`), + i18n `navHelp`. NOT a popout tab. Not in `A11Y_VIEWS`
  (the sidebar entry IS scanned every view; eye-verify the page).
  • **Help body `[[label]]` markers:** a body naming a UI control writes it `[[Take the tour]]`, never in bare
  quotes. Pure `help-body-markup.ts` (`parseHelpBody`/`stripHelpMarkers`/`helpBodyLabels`) splits them;
  `help-content-pane.tsx` renders label segments `font-medium text-foreground` and feeds the STRIPPED body to
  `matchesQuery` — TWO call sites, and missing the second gives users search hits on markup they cannot see.
  ★★ `help-content-gate.test.ts` resolves every marker against all three dictionaries and ratchets nav-view
  coverage against an explicit `KNOWN_UNCOVERED` id list, asserted by set EQUALITY so a CLOSED gap fails until its
  id is removed (a subset check would let the baseline rot into a permanent exemption). Coverage is measured over
  `allNavViews()`, which flattens nested `children` — a walk over `NAV_GROUPS` items alone sees half the sidebar and
  measured 7 gaps where there are 14.
  ★★ **The baseline is now EMPTY** (slice 3): every nav view is named by some entry's `relatedViews`, so the
  assertion reads "nothing is uncovered" and a regression fails on the next run. `HELP_ENTRIES` is 64
  (`grep -c '^  { id: "' src/app/help-content.ts`).
  ★★★ **FIVE of the fourteen gaps were missing WIRING, NOT CONTENT**, and the gate cannot tell those apart —
  coverage is `relatedViews` membership, so a complete, truthful entry that lists no view reads as a gap.
  `feature-activity`, `feature-version-history` and `feature-resources` already described `activity`, `history`
  and the `directory`/`calendar`/`manage-roles` sub-tabs; they simply carried no `relatedViews`. Slice 1's spec
  called slice 3 "~18 new entries for features that have none today", and acting on that would have written a
  SECOND entry for each. Read the entry before concluding a view is undocumented.
  ★★ It is FIVE and not six: the sixth baseline id, `stakeholder-map`, DID need content — the body that named
  it was false (see the `stakeholder-map`/`concept-stakeholder` bullet further down; it is not the next one,
  and a positional pointer in a doc whose thesis is that stale references rot was a poor choice). This
  paragraph said "SIX … NOT CONTENT" for a day while that bullet
  described rewriting that very prose — a self-contradiction ten lines apart, which is exactly the defect
  slice 2 was scoped around. `workload` and `planning` are not in the arithmetic at all: `concept-resource`
  already covered them, so they were never in the baseline.
  ★★★ **AN EMPTY BASELINE IS NOT "HELP IS COMPLETE."** Coverage is defined over VIEWS, so a feature that is not
  a view can never appear in the list however undocumented it is. Seven had zero prose while the ratchet was
  silent — saved views, install/PWA, undo/redo, inline AI edit, weekly digest, column widths, print — and were
  written in slice 3 by judgement, not by any gate result. Nothing enforces the next one.
  ★★ Wiring `stakeholder-map` onto `concept-stakeholder` FORCED a truth fix slice 1 had left in its
  REPORTED-not-verified bucket: the body claimed an "interest × power" matrix in the Stakeholders view, but the
  axis is Influence (`quadrantAxisInfluence`) and the 2×2 grid is the separate `stakeholder-map` view, whose own
  `stakeholderMapTitle` reads "Influence / Interest". The cheap structural fix dragged the truth fix with it —
  an argument for doing both in one slice.
  ★★ The DE dictionary is LAZY: without `beforeAll(loadI18n("de"))` the DE lane silently falls back to en-US and
  passes by testing English twice. Proof it is per-language: injecting the EN value of the `print` key into the DE
  body as a marker (DE renders "Drucken") fails `de` ALONE while both English lanes pass.
  ★ Keep every marker WRITTEN IN THESE DOCS multi-word. Tailwind v4 scans `.md` too, and a space-free
  `[[Something]]` can read as an arbitrary variant — the failure mode that has already broken `globals.css` once.
  ★★★ IT PROVES STRUCTURE, NOT TRUTH. A body can be entirely false and pass — `helpSecAiBody` claimed the API key
  lived in localStorage while it is AES-256-GCM sealed in IndexedDB, and no assertion here would catch it. Worse,
  `[[Take the tour]]` would have RESOLVED (`tourLaunch` exists) while rendering on no control — a green gate on a
  false sentence. A green run is not evidence that help content is correct.
  ★ Markers are UI LABELS ONLY; ordinary quoted prose stays quoted, because a false marker fails the build on a
  true sentence. Near-misses that would fail an exact match: `"Also create in Jira"` (real value carries `({0} — {1})`),
  `"Version history: keep N versions"` (split across two keys), `"internal/d"` (real: `"Internal /d"`).
  • **Contextual per-view callouts (Help SP2):** a slim dismissable banner atop each WORKING view — a novice
  one-liner + "Learn more →" deep-linking the matching Help concept. Pure `view-callouts.ts`
  (`VIEW_CALLOUTS: Partial<Record<AppView, {textKey, conceptId}>>`, **16** views — `grep -c 'conceptId: "'
  src/app/view-callouts.ts`, was documented as "~14" until 2026-08-05; ★★ the quote in that pattern is
  load-bearing — a bare `grep -c 'conceptId:'` returns **17**, counting the interface's own
  `conceptId: string;` field, and anchoring to `^  ` does not help because that field is indented too. A
  reproduce command published beside a corrected count and never run re-seeds the rot it was meant to
  stop; this one shipped wrong for a day. `conceptId` in `HELP_ENTRIES`
  concepts — guard test) + per-device dismiss store `view-hints-store.ts` (`aipm-cockpit:view-hints`, out of
  exports/Turso, cleared by `clearAppConfig`'s `aipm-cockpit:*` sweep). Presentational `view-callout.tsx` is
  PROPS-only (`view`/`lang`/`showHints`/`isPopout`/`onLearnMore`) — NOT context-consuming, because the
  TasksSection/Kanban unit tests render outside `WorkspaceTabProvider` (a `useWorkspaceTab()` there THROWS).
  Self-hides when: no `VIEW_CALLOUTS[view]` / `!showHints` / `isPopout` / dismissed. Mounted in
  `workspace-section` (after the `ActionChips` strip — covers all routed views) AND `tasks-section`
  (open-points renders separately; gated `{onLearnMoreHint && …}` so the bare unit test stays unaffected).
  ★ workspace-section's mount is gated `{activeTab !== "open-points" && …}`: in CLASSIC both surfaces mount at
  once, so without the guard the open-points callout double-renders (mirrors the adjacent ActionChips
  open-points `[]` guard). The Learn-more arrow is `aria-hidden` (label-bleed rule).
  ★★ "Learn more" deep-links via a NEW `workspace-tab-context` string channel `requestHelpConcept(conceptId)`
  (mirrors `requestChat`: `setActiveTab("help")` + `pendingHelpConcept`, NO hash write); `HelpView` consumes
  it via OPTIONAL props `pendingHelpConcept`/`onHelpConceptConsumed` (optional so the standalone
  `help-view.test.tsx`, which has no provider, is unchanged) using the render-reconcile + nonce-effect pattern
  (mirrors `useDeepLinkRowFlash`; no `set-state-in-effect`). Global on/off: `settings.showViewHints?` (default
  ON, read `!== false`) — a `SegmentedControl` in Settings → Appearance, persisted via the `writeSettings`
  spread (no allowlist edit, mirrors `dashboardDensity`). Many mount views are axe-scanned (banner buttons are
  labeled, palette-safe — verified). Dashboard EXCLUDED (has coaching + tip cards). ★ A loose
  `getByText(/changes/i)` in `dashboard-panel.test` collided with the date-rotating tip card's "Changes" text →
  scope such queries to a `heading` role, not free text.
  • **Interactive relations map (Help SP3):** a node graph of the Help CONCEPT entries (edges =
  `relatedConcepts`), now the "How it all connects" TAB of the Help-view accordion (was a `<details>`). Pure
  i18n-free engine `relations-graph.ts` `buildRelationsGraph(entries)` → `{nodes:[{id,titleKey,x,y}],edges:[{a,b}]}`:
  deterministic **VERTICAL single column** (concepts only; shared `x=0.5`, `y` evenly `TOP=0.08..BOTTOM=0.92`; no
  RADIUS), edges undirected + deduped (sorted `"a|b"` key), no self-loops; no `Date`/`Math.random`.
  Presentational `relations-map.tsx` uses the ★★ OVERLAY technique: a `<ul>` of flow rows, each a dot
  `<span aria-hidden>` + a real `<button>` (keyboard-native, axe-clean interactive layer), plus a decorative
  `aria-hidden` `<svg viewBox="0 0 24 100">` in the LEFT GUTTER drawing edge `<path>` bezier curves (control-point
  `bow` CLAMPED ≤11 so it stays in the viewBox; green when incident to the active node, else `stroke-line`). Local `useState(active)` from hover AND focus highlights incident edges (`stroke-ui-dark-blue`,
  dim the rest) + neighbour buttons; click → `onSelectConcept(id)` → HelpView `scrollToSection`. Concept-only —
  view navigation lives in the Related line: SP3 upgraded each entry's `relatedViews` from a plain italic `<span>`
  to a navigate `<button>` gated on a NEW OPTIONAL `HelpView` prop `onNavigateView?: (view:AppView)=>void` (optional
  ⇒ standalone `help-view.test.tsx` unchanged), wired `workspace-section` → `setActiveTab(v)`. Help is NOT in axe
  `A11Y_VIEWS` (map keyboard-focus/contrast + SVG positioning EYE-verified; jsdom rect=0 so tests assert
  structure/handlers/`data-active`, not pixels). i18n EN+DE; `helpRelationsGoToView` uses positional `{0}`.
  • **Themed guided tours (Help SP4):** the single onboarding tour became a CATALOG of 6 themed
  tours (`getting-started` · `raid` · `reporting` · `planning` · `stakeholders` · `ai`). Pure engine
  `app-tour.ts` gained `TourDefinition`/`TourCatalogEntry`/`TOURS`/`findTour`; the old flat `TOUR_STEPS`
  is KEPT as an export (= `getting-started`'s steps; `tour-overlay.test` imports it). `visibleSteps`
  is now `(steps, features)` (was `(features)`) — drops a step whose `view` is a disabled module.
  `use-tour.ts` tracks `activeTourId` (`start(tourId?)` defaults `getting-started`, preserving
  auto-launch + HelpMenu), exposes `catalogTours` (tours with ≥1 visible step) + `completedTours` +
  `activeTourTitleKey`; `done()` appends the active id to `settings.completedTours` (functional
  `setSettings`), `skip()` sets `tourSeen` only. Per-device `settings.completedTours?: readonly
  string[]` rides the `writeSettings` spread (no allowlist edit, sanitized on load, capped 50), OUT of
  exports/Turso, cleared by `clearAppConfig`'s `aipm-cockpit:*` sweep; `tourSeen` STILL gates first-run
  auto-launch separately. Presentational `tour-catalog.tsx` (props-only, no context — standalone
  unit-tested) renders a card grid as the "Guided tours" TAB of the Help-view accordion (was a `<details>`),
  gated on `onStartTour` presence (mirrors the `onTakeTour` gate) so standalone tests / classic / popout don't
  render it — tours stay modern-only. ★ `TourCatalogEntry` now also carries `stepCount` + `iconView: AppView`
  (projected in `use-tour.ts` `catalogTours` from `visibleSteps(...).length` + a new `TourDefinition.iconView`);
  each card shows a `NavIcon` badge (or green ✓ when done), a step-count meta line (`tourStepCount`), and a
  Start/Replay CTA (`tourReplayCta` when completed — the card's `aria-label` tracks that verb, WCAG 2.5.3).
  Threaded task-manager → `WorkspaceSectionProps` (3 new OPTIONAL fields) → HelpView. `TourOverlay`
  gained an optional `tourTitleKey` label. Help is NOT in axe `A11Y_VIEWS` → catalog a11y eye-verified
  (`tour-catalog` uses the `INTERACTIVE` atom + `text-ui-green-strong` for the ✓-Done badge — there is
  NO `text-ui-green-text` utility token).

### UI shell — navigation & landing

  • Default landing view is `dashboard` (`workspace-tab-context.tsx` initial `activeTab`); `useHashView`
  also lands a fresh/empty hash ("" or bare "#") on `dashboard` (not the `slugToView` "open-points"
  fallback), so opening the app at `/` goes to the Dashboard home. Deep-links + reload-on-a-view still honour the hash.
  • Nav: `actions` (Next actions) + `trends` are SUB-MENU children of `dashboard` in the Overview group
  (`nav-config.ts`); `trends` is in `TURSO_ONLY_VIEWS` so the Trends sub-entry only shows on a Turso backend.
  ★ TURSO_ONLY child views are pruned in TWO places: `filterNavGroups` (sidebar) AND `subTabsFor(view,
  features, onTurso)` (classic sub-tab row, pass `trends.active`) — gate BOTH for a new turso-only child,
  or it leaks into the classic sub-tab row on file backends.
  • **★★★ THE COLLAPSED RAIL IS A 64px HORIZONTAL SCROLL BOX, so nothing positioned `absolute` inside it
  can escape.** `sidebar.tsx` wraps `SidebarNav` in `overflow-y-auto`, and per CSS spec a non-`visible`
  axis forces the OTHER axis's `visible` to compute as `auto` — so the wrapper scrolls horizontally too,
  at `w-16` when collapsed. `CollapsedNavFlyout`'s panel was `absolute left-full`, laying out at roughly
  x 68–244, entirely outside that box; `z-index` does not escape `overflow`. Worse, the on-open
  `.focus()` made the browser scroll the box sideways to reveal the focused menuitem, dragging the icon
  rail out of view and leaving the panel's right-hand slice over it with every label sheared
  ("esources", "irectory"). ★★ MEASURED, not reasoned: on the pre-fix code a Playwright probe read the
  open panel's viewport box at **x = −56** — off the left edge of the screen. There is NO CSS fix, since
  one axis cannot be `visible` while the other is not; the panel must LEAVE the box. It now renders
  through `PopoverPanel`, which portals to `document.body` and positions `fixed`.
  ★★ `PopoverPanel` grew a `placement` prop for this — `"right-start"` (beside the anchor, top edges
  aligned) beside the default `"bottom-end"`. They drive MUTUALLY EXCLUSIVE edge sets (`left`+`top` vs
  `right`+`top`/`bottom`), which is why the post-paint clamp branches on which one is set; a placement
  that left a stale opposite edge behind would stretch the panel across the viewport.
  ★★ `role="menu"` stays on an INNER div, NOT on `PopoverPanel`. The div carries the arrow-key handler,
  and a React handler only sees events from its own subtree — putting the role on the panel would make
  "the menu element" and "the element with the key handler" two different nodes, so a keyboard test
  firing at the menu would exercise nothing.
  ★ Focus-on-open is `PopoverPanel`'s job now and that is load-bearing, not tidying: its
  `.focus({ preventScroll: true })` is what stops a focus call scrolling an ancestor. Its all-roving
  `??` fallback is also what lands focus at all here, since every flyout menuitem is `tabIndex={-1}`.

### UI shell — focus & keyboard (modern shell)

  • **Focus/keyboard a11y (modern shell, all modern-only — classic has no sidebar):** `use-focus-trap.ts`
  (`useFocusTrap(ref, active, onEscape)`) is the app's FIRST real focus trap — ★★ `onEscape` MUST be a
  stable `useCallback` or the effect re-focuses the first element every render. **Mobile off-canvas drawer**
  (`modern-shell.tsx`, `<1024px` via `useMediaQuery(SIDEBAR_NARROW_QUERY)`): the hamburger opens the EXPANDED
  sidebar as a `role=dialog aria-modal` overlay + backdrop (`bg-ui-dark-blue/50`) + trap; Escape/backdrop/nav
  close. ★ drawer content UNMOUNTS when closed (no phantom off-screen tab stops); ★ a stale `drawerOpen` is
  reset via a render-time reconcile (`if (!isNarrow && drawerOpen) setDrawerOpen(false)` — NOT an effect);
  ★ `Sidebar` gained `toggleAriaLabel?` so the drawer relabels its toggle as the dialog CLOSE
  (`sidebarCloseMenu`, WCAG 2.5.3), and opening the version modal from the drawer closes the drawer first
  (one trap at a time). **`CollapsedNavFlyout`** (`sidebar-nav.tsx`): a collapsed-rail parent-with-children
  becomes an `aria-haspopup` trigger opening a `PopoverPanel` (`placement="right-start"`) of parent+children
  (roving arrows/Home/End, Escape→trigger, Tab→trigger) so nested views stay reachable from the icon rail.
  ★★ It owns NO dismissal of its own — that moved to the panel when it was portaled; this line said
  `usePopoverDismiss` for a release after the call was deleted from `sidebar-nav.tsx`, and BOTH doc gates
  stayed green because the symbol still exists in nine other files. A name resolving is not a claim holding.
  ★★ Tab must `preventDefault` and re-focus the trigger: the panel is portaled to the END of `document.body`,
  so simply closing lets sequential navigation resume out of the app (WCAG 2.4.3) — the pre-portal version
  could get away with a bare close because the menu sat inside the trigger's `<li>`. Caret dot + collapsed urgency
  dot (`bg-ui-medium-grey`/`bg-ui-pink`). **`resource-calendar.tsx`** is the app's FIRST `role=grid` 2-D
  roving grid (Arrow ±day/±assignee, Home/End, Ctrl+Home/End, PageUp/Down ±7; ★ clamp-on-read `focusRow/
  focusCol` so a window shrink keeps EXACTLY one tab stop; keydown guards on `document.activeElement` being a
  `[data-cell]` so the assignee row-header keeps its own arrow keys; `default: return` before `preventDefault`
  so Tab still escapes). Calendar sub-tab is NOT axe-scanned (Resources default sub-tab = directory).
  ★★★ **The rich-text toolbar (`role="toolbar"`, open-followups §144(a)) is one of SEVERAL roving-tabindex
  widgets — `use-tablist-roving.ts`, `band-roving.ts`, `segmented-control.tsx` and the `resource-calendar.tsx`
  grid above all predate it — and it deliberately shares NONE of their models, nor `use-focus-trap.ts`.**
  ★ Deliberately no ordinal: an earlier revision here called it "the app's SECOND", which was wrong by at
  least three and read as though it followed the `role=grid` line directly above — a different axis (2-D grid
  vs 1-D row). Count the `*-roving.ts` engines plus the hand-rolled `tabIndex={… ? 0 : -1}` sites before
  writing any such number:
  `ls src/app/*roving*.ts; grep -ln "tabIndex={.*? 0 : -1}" src/app/*.tsx`
  ★★ Read that output at the right GRANULARITY — it lists the files carrying the ternary, which for the
  resource calendar are `resource-calendar-band.tsx` and `resource-calendar-rows.tsx`, NOT the
  `resource-calendar.tsx` orchestrator that declares the `role="grid"` itself. Counting output lines gives
  you spellings, not widgets. The
  pure engine is `toolbar-roving.ts` `moveToolbarFocus(count, index, key, modifiers)` — one tab stop per row
  (14 of 15 controls carry `tabIndex={-1}`); Left/Right move within the row and WRAP at either end; Home/End
  jump straight to the first/last control; a chord (Alt/Ctrl/Meta) is left alone so it falls through to the
  browser or OS (Alt+Left is Back). ★★ **Activation never follows focus** — arrowing across the row moves
  focus and runs no command, unlike the tablist-style roving hook whose move ends in a `target.click()`; doing
  that here would fire Bold/Italic/Quote on every keypress and mutate the user's document. ★★★ **THE PORTAL
  GUARD.** The heading-level trigger opens a `PopoverPanel` that `createPortal`s to `document.body`, but React
  synthetic events bubble the REACT tree, not the DOM tree — so a keydown fired while focus sits inside that
  OPEN menu still reaches the row's `onKeyDown` even though the menu item is nowhere inside the row in the
  DOM. Without an explicit guard (bail out when `document.activeElement` is not one of the row's own direct
  `<button>` children), arrowing inside the menu would silently rove the toolbar underneath it. Proven, not
  just reasoned: a mutation that deleted the guard turned exactly one test red (the heading-menu-open pin in
  `rich-text-toolbar.test.tsx`), and a vacuity check on that same test confirmed focus had genuinely reached
  the menu item before the arrow press, so a green run there could not have hidden a broken guard.

### UI shell — surfaces & controls

  • **★★★ A NATIVE HTML5 DRAG CANNOT REACH AN OFF-SCREEN DROP TARGET IN THIS APP, on any surface, unless
  the code scrolls for it.** Browsers do auto-scroll during a drag, but that serves the DOCUMENT
  scroller, and neither main-window layout has one: `modern-shell.tsx`'s root is `flex h-screen w-full
  overflow-hidden`, and the classic root is an `h-screen` flex column whose `<main>` owns the scroll. So
  every pane scrolls in a nested div. Reported against Reports (each report card is tall, so the target is
  usually below the fold) and fixed with `use-drag-autoscroll.ts` — `useDragAutoscroll(ref, active)` plus
  the pure `autoscrollDelta`, wired to the scroller `ReportCard` now exposes via its `contentRef` prop
  (the `sizeRef` shell is `overflow-hidden`, so passing THAT scrolls nothing).
  ★★ POPOUT WINDOWS ARE THE EXCEPTION, deliberately — `task-manager.tsx` renders a popout as a bare
  `<main>` with no `h-screen`/`overflow-hidden` ("Popout windows keep the simple scrolling flow"), so it
  HAS a document scroller and the browser's own auto-scroll works; the hook is a no-op there. `"reports"`
  is in `REPORT_POPOUT_TABS`, so the surface this was written for behaves differently in its popout. An
  earlier revision of this bullet said a document scroller is "never" present here, which is false in that
  window and false about the classic root's classes.
  ★ Other native-DnD surfaces are unwired. Do NOT trust a list here for which — a first cut named three
  and a review found the enumeration closed a class that is open. Count them yourself:
  `grep -rn "draggable" src/app --include=*.tsx | grep -v '\.test\.'`
  ★★ A native drag emits no `pointermove`/`mousemove`, but `dragover` is NOT its only cursor signal — the
  same loop fires `drag` at the SOURCE node plus `dragenter`/`dragleave` at the target, and all are
  `DragEvent`s, which extend `MouseEvent` and so carry `clientX`/`clientY`. Driving autoscroll off `drag`
  is a real alternative; `dragover` is chosen because it fires on the element under the cursor and bubbles
  to the scroller, so the source need not stay mounted. Either way, scrolling directly in the handler ties
  speed to an event rate the browser throttles and that the spec only guarantees to re-fire every 350ms
  when the cursor holds still — the moment the user most wants it smooth. Capture the position in the
  handler, scroll in a rAF loop.
  ★★ Read `ref.current` INSIDE the frame loop, not once in the effect. A ref object is permanently stable,
  so an effect keyed on `[ref, active]` never re-runs if the scroller is swapped mid-drag, and a captured
  element goes on being scrolled after it has left the document — silently.
  ★★ Guard the `dragleave` clear on `relatedTarget`: `dragleave` also fires crossing between CHILDREN, so
  an unguarded clear drops the pointer at every card boundary and the scroll stutters.
  ★★ The zone is clamped to a third of the container height. At a flat 48px the top and bottom zones
  OVERLAP on anything under 96px tall, the pointer satisfies both tests, and whichever branch is written
  first wins — so a drag near the bottom of a short list scrolls UP.
  ★★★ TEST TRAP, measured: `fireEvent.dragOver(el, { clientY })` SILENTLY DROPS THE COORDINATE in jsdom —
  a listener reading `e.clientY` gets `undefined`, so a position-driven hook looks broken in tests while
  working in the browser. Dispatch a real `MouseEvent` named `"dragover"` instead (`DragEvent extends
  MouseEvent`, so that is the true interface).
  ★★ SEPARATE DEFECT found in the same area: a `dragstart` handler that sets no transfer data means
  **Firefox never begins the drag at all**. The reports handle drove its reorder purely off React state
  and called no `setData`, so reorder was inert there — and jsdom dispatches the whole sequence happily,
  so no test could see it. Any new `draggable` calls `e.dataTransfer?.setData(...)` even when the payload
  is unused. ★★ THIS IS NOT A COMPLETED SWEEP and an earlier revision read like one by naming only the
  already-correct `task-kanban-board.tsx`. Three live `dragstart` handlers still set nothing and are
  therefore still inert in Firefox for the identical reason — the `budget-panel.tsx` bucket handle (whose
  handler takes no event argument at all) and both `roles-editor.tsx` sites (which set `effectAllowed`
  only; that does NOT satisfy Firefox). Re-derive rather than trust this list:
  `grep -rn "onDragStart" src/app --include=*.tsx | grep -v '\.test\.'` against
  `grep -rn "setData" src/app --include=*.tsx`.
  ★★ A per-row drag handle needs a row-UNIQUE accessible name. Reports gave every handle the same
  `reportReorderHandle` string; axe cannot see that at any seed size, in a view it scans. The unit test
  asserting the names are DISTINCT is the only detector — and note every other test in that file finds its
  handles by the shared prefix and indexes `[0]`/`[1]`, so they all stay green when the qualifier is lost.
  ★★ A drop indicator drawn as a border must render in BOTH states, swapping only the COLOUR. Adding the
  border on hover grows the box and shifts every card below it, during a drag — exactly when the hit
  target must hold still.
  ★★★ SPELL IT WITH DISJOINT PER-SIDE COLOURS (`border-t-… border-b-transparent`), never a baseline
  `border-transparent` with a directional layered over it — and an earlier revision of THIS line
  recommended the second form, in the same fix round that removed it from the code. `border-transparent`
  is the `border-color` SHORTHAND and `border-t-…` is `border-top-color`: two declarations, identical
  specificity, different properties, so the winner is decided by Tailwind's EMIT order rather than by
  the order they appear in the class list. The indicator would then either work or render invisible
  depending on a detail of the generated stylesheet, and jsdom cannot see either outcome. Every branch
  naming both edges removes the question. Colour it `--ui-green-strong`, not
  `--ui-green`: as a 2px graphical object carrying state it owes WCAG 1.4.11's 3:1, and `--ui-green` is
  2.17:1 on harbor-light (1.97 meridian-light, 2.48 umber-light) — it passes only on the three DARK
  schemes, and light is the default.
  ★★★ `--ui-green-strong` IS DERIVED PER SCHEME, NOT A FIXED HEX, and getting that wrong is how a first
  cut of this line quoted "3.07 worst-case dark": `scheme-tokens.ts` sets it to
  `nudgeToAa(--ui-green, --surface-muted)`, `resolveSchemeColors` is base-wins, and NO built-in scheme
  pins it — so all six get the derived value and the `globals.css` `:root` hex is only the un-themed
  fallback. Computing against that fallback gives a number the app never renders. Two consequences worth
  having: the swap is HUE-PRESERVING (umber-light derives `#805f25`, still amber — it does not paint teal
  into the amber scheme), and in every DARK scheme `nudgeToAa` exits on iteration zero and returns the
  base unchanged, so the swap is a literal no-op there. Measured 5.30 / 6.31 / 5.86 light, 7.49 / 6.74 /
  8.80 dark. ★ A user's CUSTOM scheme can pin `--ui-green-strong` (it is in `ADVANCED_TOKENS`), which
  skips the derivation — out of scope, same reachability class `scheme-tokens.ts` already documents.
  ★ Recompute rather than trust these numbers: replicate `nudgeToAa` over `builtin-schemes.ts`.
  ★ A drop indicator must be DERIVED from the splice, not chosen: reports removes the dragged id before
  inserting at the target's ORIGINAL index, so dropping on a LATER card lands after it and on an EARLIER
  card lands before it. One fixed edge is correct in one direction and a lie in the other.

  • Steering committee panel uses the STANDARD resizable content-pane shell
  (`VIEW_PANE_RESIZABLE_CLASS` + `useResizable("aipm-cockpit:steering-size")` + `ResetSizeButton`, header OUTSIDE
  the bordered scroller).
  • Dashboard has NO on-panel density or Trends toggle (both removed + unwired). Density is set ONLY via
  Settings → Appearance (`settings.dashboardDensity`); the dashboard Trends card is Turso-gated
  (`props.tursoActive`), not toggled. The `ReportCard` `toolbarExtra` slot is unused on the dashboard now;
  the report date sits on the "Overall" line.
  • `settings.showDisplayTzSwitcher?` (per-device, default **false**) gates the top-bar `displayTzSwitcherEl`
  — both header mounts share the ONE gated element.
  • Task-editor actions render ONLY in the editor surface (the floating `TaskFormModal` footer), NEVER the
  top bar — `ModernShell` takes no `editActions`/`primaryAction` for the edit case.
  • `task-jira-badge.tsx` = SHARED Jira badge, TWO variants via `readOnlyProject?: boolean`: read-only project →
  padlock + `jiraSyncedReadOnlyProject` title/aria; two-way → sync-arrows glyph + `jiraSyncedTwoWay` (link variant
  when `href`). Used by BOTH the Kanban card and the table row; takes everything as PROPS (board renders outside
  RowContextProvider). ★ Callers pass `readOnlyProject={isReadOnlyIssue(task.jiraKey, {projectKey, extraProjects})}`
  — the SINGLE classifier (see multi-project Jira bullet); an unknown/removed project reads read-only.
  • Settings-section deep-link is GENERAL: dashboard `onNavigate(view, section?: SettingsSectionId)` →
  task-manager `onOpenSettingsSection(section)` → `settingsSectionRequest` → SettingsView. `SettingsSectionId`
  (mirrored in `dashboard-coaching.ts`) is a SUBSET of settings-view `SectionId`.
  • **Backend setup wizard:** `backend-setup-wizard.tsx` (4-step modal: Storage & connections → AI → Jira
  → Review; integration steps skippable; Review summarises configured/not-configured for storage/M365/AI/
  Jira/Timelog, driven by pure `backend-setup-steps.ts` — `BackendSetupStepKey`, `BACKEND_SETUP_STEPS`,
  `clampStep` (re-exported from `app-tour`), `summarizeBackendSetup`). ★ NO dedicated Timelog/M365 step:
  step 1 reuses the WHOLE `IntegrationsSection` (which already renders storage+Turso+M365+Timelog), so a
  separate step would duplicate the form. Step bodies: IntegrationsSection, AiSection, JiraSettingsSection;
  threads the SAME `settings`+`onChangeSettings` — no new persistence path. ★ Wizard passes
  `IntegrationsSection hidePortfolioSwitch` so the portfolio "Save & switch" `window.location.reload()`
  can't nuke a create-project draft. Shared `WizardStepIndicator` (`wizard-step-indicator.tsx`) de-dups
  the two wizards' step rails. Two launch points: Settings → Integrations ("Run setup wizard" button) and
  the new-project empty-state window's "Backend setup" section (alongside "Configure database / M365"),
  both gated `{wizardOpen && …}` (fresh mount per open → step resets). NOT launched from inside the
  CreateProjectWizard (the project-creation flow) — that header carries the step indicator only.
  `isPopout`-gated (never shown in pop-outs). `SettingsView` gained an `isPopout` prop threaded from
  task-manager. `onMigrateToTurso` is threaded ONLY on the Settings launch (no existing workspace to
  migrate in create-project / empty-state).

  • **★★★ A `<label>` MUST NOT WRAP A WIDGET WHOSE FIRST LABELABLE DESCENDANT IS A BUTTON.** A `<label>`
  with no `for` binds to its first LABELABLE descendant — button · input · meter · output · progress ·
  select · textarea, among the elements this app uses. (The full HTML set also counts a form-associated
  custom element and excludes `<input type="hidden">`; this repo has neither, so the seven above are the
  working set rather than the complete one.) A chip row, a `role="radiogroup"` div and a contenteditable are
  none of those, so the caption silently adopts a BUTTON inside instead. Two consequences, both measured
  in Chromium: `:hover` on the label paints that button's hover state (reported as "hovering the text
  field highlights Bold"), and clicking anywhere non-interactive in the label forwards a synthetic click
  to it. Whether the click DOES anything depends on that button's own handlers, so the two halves diverge
  — the dictation mic binds pointerdown/keydown with no `onClick` (hover bleed only), while
  `SegmentedControl`'s radios carry a real DOM `onClick` (the `onClick` on the `role="radio"` button in
`segmented-control.tsx` — cited by SYMBOL, not line: this read `:99` and was falsified twice by
commits that merely added comments above it; its `onChange` is
  the COMPONENT's prop, not the DOM handler — naming `onChange` here reverses the point), so clicking the
  caption WROTE data. Shipped instances: clicking "Priority" set Low, "Labels" DELETED the first chip,
  "Documents" removed a link, RAID "Status"/"Severity" changed the record, and the Knowledge linked-tasks
  caption UNLINKED a task. ★ RAID "Category" only on a NEW or explicitly unlocked item — it is
  `disabled={!isNew && !categoryUnlocked}`, and a DISABLED labeled control receives no forwarded click
  (measured in Chromium). ★★ Every one of those assumes a NON-EMPTY collection: with no chips or links the
  first button is a different one, so "Documents" with nothing linked opens the picker (the Add button) and
  an empty chip row lets the input win and merely focuses it. A test that forgets to seed a row passes
  against the unfixed code.
  ★★ TWO sanctioned fixes, and picking the wrong one strips an accessible name. The deciding question is
  **what the caption is FOR**, not whether the widget self-names. (a) If the block has no single input the
  caption could name — a chip row, a radiogroup, a contenteditable, or several controls — use
  **`FieldGroup`** (`form-controls.tsx`): `<div role="group" aria-label>` + a `<span>` caption, so the block
  is still named but the caption is not a click target. Both form `Field` helpers (`task-form-layout.tsx`,
  `project-form-fields.tsx`) take a `group` prop that delegates to it, and `DocumentLinksGroup` wraps the
  Documents case the four entity editors share. (b) If the caption legitimately names a real `<input>` and a
  button merely got IN FRONT of it (the mic before a title/name field), keep the `<label>` and add an
  explicit `htmlFor`/`id`.
  ★★ Self-naming is NOT the criterion, and an earlier revision of this bullet said it was. FOUR converted
  widgets do not name themselves — Documents, the Health chip row, Labels, and the stakeholder Name row.
  The last two both needed a new `aria-label` in the same change: Labels because its placeholder collapses
  to `""` once a chip exists, and stakeholder Name because its `ResourcePicker` carried neither
  `aria-label` nor `placeholder` on HEAD (`git show HEAD:src/app/stakeholder-edit-modal.tsx`). Naming the block is precisely what `FieldGroup` is for; a bare `<div>` there would lose the name
  outright. ★ Where the widget DOES self-name and a visible caption sits beside it (the Settings appearance
  rows, the rich-text editors) a plain `<div>` is enough and the app uses one — either is correct, but only
  after asking (a) vs (b).
  ★ Fix (b) has a failure mode of its own: `htmlFor` and `id` are written by hand in two places, and a TYPO
  leaves the field with no accessible name while looking fixed. `expectNoLabelBoundToButton` fails on a
  dangling `htmlFor` for that reason — the source scan can only see that the attribute is PRESENT.
  ★★ THE ORDER IS THE RULE — a mic AFTER its `<Input>` is harmless, because the input already won the
  association (task-form-fields' title field).
  ★★★ NEITHER GATE SEES THIS BY DEFAULT. No axe rule models label→control binding — enumerating axe
  4.12.1 under the four tags the gate uses returns 69 rules and none of them do; axe's own name computation
  takes the nearest ANCESTOR `<label>`, so it credits that text to the input regardless of the real binding.
  (Do NOT write "a name exists, just on the wrong element" — the change title and milestone name had no
  accessible name at all in a real browser. ★ But do not flatten the class either: the RAID title carries a
  placeholder, which HTML-AAM makes its fallback name — a POOR name, not none. `src/test/label-binding.ts`
  keeps the same distinction; an earlier revision of this parenthetical erased it.) Modals are not in `A11Y_VIEWS` anyway; under jsdom the mic never renders (`voice.ts`
  `getCtor()` returns null) and `KnowledgeLinksFieldGated` renders a bare `<p>` with SharePoint off, so a
  unit render is blind to both classes. Coverage is `src/app/label-binding.guard.test.ts` (a positional
  SOURCE scan over every `.tsx` — a named-widget list, so a NEW button-first component is invisible to it
  until added there) plus per-suite render guards using `src/test/label-binding.ts`
  (`expectNoLabelBoundToButton`, which asks the browser's own `HTMLLabelElement.control`).

### UI shell — dismissal: Escape & Tab ownership

  • ★★ **Shared `Modal` (`modal.tsx`) STACKS — topmost-only Escape/Tab.** Per-instance Symbol tokens in
  the SHARED `dismissal-stack.ts` (the local `modalStack` it once owned is GONE — see the ESCAPE PROTOCOL
  bullet below); only the layer that owns the key handles Escape (`claimsEscape`) and only the topmost
  MODAL contains Tab (`isTopmostOfKind(token,"modal")`), so a nested modal (wizard
  opened from inside the create-project modal) no longer double-fires Escape and dismisses the parent.
  LANDMINE (bit twice): the keydown effect must depend on `[open]` ALONE and read `onClose` via a ref —
  if it deps `[open, onClose]`, an unstable parent `onClose` identity (re-created each render/keystroke)
  re-runs the effect and re-pushes that modal's token to the top → wrong modal becomes topmost. Push/pop
  lives in a SEPARATE `[open]`-only effect (order = mount order). Regression-tested in `modal.test.tsx`.
  • ★★★ **ESCAPE PROTOCOL — the dismissal stack decides, not listener phase.**
  `dismissal-stack.ts` holds a module-level stack of open layers in OPEN order,
  each tagged `modal` or `layer` and carrying an optional `claims()` predicate.
  `escapeOwner()` walks top-down to the first entry that CLAIMS the key and is
  the ESCAPE question; `isTopmostOfKind(token,"modal")` is the separate TAB
  question. `claimsEscape(e, token)` is the single guard every handler calls.
  React surface is `use-dismissable.ts` — `useDismissable({open, kind, onDismiss,
  claims?})` — which every document-level closer now uses on BUBBLE phase.
  ★★ WHY A STACK: phase ordering cannot work. Native listeners on one node fire
  in REGISTRATION order and a modal opens BEFORE a popover inside it, so a
  bubble-phase `preventDefault` lands after the modal already closed. 0.202.4
  moved closers to CAPTURE to beat that, which fixed Modal-vs-popover but broke
  the combobox pickers: React 19 delegates `onKeyDown` at BUBBLE, so a
  capture-phase closer ran BEFORE the picker's own handler and one keypress took
  BOTH layers down. Capture also never helped against PEERS — capture listeners
  are registration-ordered too. Nesting is knowable directly, so the stack knows
  it and phase stopped mattering.
  ★★ `preventDefault`/`defaultPrevented` REMAINS the boundary with
  ELEMENT-scoped handlers: `claimsEscape` declines an already-marked event, and
  `useDismissable` marks the one it consumes. `stopPropagation` CANNOT do this
  job — React 19 delegates on `document` (Next passes `document` to
  `hydrateRoot`), the same node the closers listen on, and stopPropagation does
  not suppress a listener co-registered on the SAME node.
  ★★★ PRECONDITION — stack order is OPEN order, and open order must equal
  NESTING order. Holds in production because a layer opens in response to a user
  action, never in the same commit as its parent. It is ASSERTED, NOT DETECTED:
  the obvious detection is DOM containment and `PopoverPanel` is a portal, which
  defeats it. ★★ A TEST HARNESS THAT RENDERS A POPOVER AS A CHILD OF AN
  ALREADY-OPEN `<Modal>` IN ONE COMMIT VIOLATES IT — React runs child effects
  BEFORE parent effects, so the modal ends up topmost over its own popover and
  Escape INVERTS. The plan's own first draft of `dismissal-integration.test.tsx`
  did exactly this and the failure read like an implementation bug. Open the
  popover via a click on a trigger, as production does. Nothing enforces this —
  a future surface that mounts a layer in its parent's commit gets inverted
  Escape with NO test failure anywhere to warn it. ★ The ONE push site in the app
  that is NOT a user gesture is `use-tour.ts`'s render-time auto-launch — re-check
  the precondition there specifically whenever tour launch conditions change (it
  is safe today only because the empty-state modal and the tour are mutually
  exclusive `if/else` branches in `task-manager.tsx`).
  ★★ `kind` MEANS "traps Tab", NOT "looks like a dialog". Tag a surface `modal`
  ONLY if it actually contains Tab; otherwise `layer`, however `aria-modal` it is.
  `tour-overlay` is `role=dialog aria-modal` with NO focus trap, and tagging it
  `modal` took `isTopmostOfKind(…,"modal")` away from any real `Modal` open at the
  same time — that Modal stopped trapping Tab and nothing took over, so focus
  walked out of both (WCAG 2.4.3). Caught in review, not by a gate. If such a
  surface gains a real trap, flip its `kind` in the SAME commit.
  ★★ STANDING GAP, not closed by that fix: `tour-overlay` has NO Tab trap at all
  and never has, so Shift+Tab from its first button walks into the app behind the
  dimmed backdrop, and its `aria-modal="true"` tells AT a containment story the
  keyboard does not honour. `kind:"layer"` only stops it breaking OTHER modals.
  Tracked separately — do not read the bullet above as "the tour is a11y-clean".
  ★★ **Focus-on-open (`use-panel-focus.ts`).** A floating panel that gates Escape
  on `useClaimsWhenFocusWithin` MUST call `usePanelInitialFocus`, or the trigger
  that opened it keeps focus, the panel declines its own Escape, and the layer
  beneath eats the key — for `notes-window` that is the task editor, and the
  user's draft goes with it. ★★★ Its flag means "the panel is RENDERED", not
  "open": `help-menu` renders on `{open && pos && …}` with `pos` arriving a tick
  later, so it passes `open && pos !== null`. Shipped once with raw `open` and
  the focus silently never moved — the panel looked fixed and was not.
  ★★ THREE LOAD-BEARING RULES: (1) the push/pop effect's deps are `[open]` (or
  `[open, kind]`) ALONE and handlers ride refs — re-running it moves the token to
  the TOP and makes the wrong layer topmost, the bug `modal.tsx` hit twice via an
  unstable `onClose`. (2) `claims()` is read at EVENT time and must be a live DOM
  read, never a captured state value. (3) Register ONLY when you can act —
  `use-focus-trap` gates on a `hasEscape` BOOLEAN because an always-claiming
  entry with no handler swallows the key and leaves every layer beneath
  unclosable (`inline-ai-edit-popover` passes no `onEscape`).
  ★★ A NON-MODAL floating panel claims Escape ONLY while focus is inside it (or
  nowhere) via `useClaimsWhenFocusWithin(ref)` — `notes-window` and `help-menu`.
  The gate MUST live in `claims`, not in the handler: a decliner that stayed
  topmost would block every layer beneath (each asks "am I topmost?" and gets
  false) and Escape would become a dead key. The stack walks PAST a decliner.
  ★★ `useClaimsWhenFocusWithin` is a HOOK, not a plain factory: `react-hooks/refs`
  rejects passing a ref object into an ordinary function call during render
  ("Cannot access refs during render"), and a `useMemo` wrapper does NOT satisfy
  it — both lint-verified. Call it unconditionally, pass the result (or
  `undefined`) as `claims`.
  ★ DELIBERATELY OUT of the stack: the five combobox pickers (`entity-link-picker`,
  `resource-picker`, `combo-input`, `labels-input`, `stakeholder-recipient-input`),
  `global-search-box`, and `chat-panel`'s abort. Focus location is a stronger signal
  than open order for a widget that only exists while its own field has focus, and
  React's boot-registered delegation runs an element-scoped handler before any effect
  listener. ★ Only the five pickers participate via `preventDefault` — they are the
  ones that CLOSE something. `global-search-box`'s Escape is element-scoped and merely
  clears + blurs its own field (it marks nothing), and `chat-panel`'s abort is a
  `document` listener that self-gates on an open `[aria-modal]` and on focus being
  inside the chat panel. Don't cite either as an example of the `preventDefault`
  boundary.
  ★ CORRECTION to long-standing text here: `global-search-box` does NOT close from
  a document listener. Its Escape is element-scoped on the input; its `document`
  listener is the ⌘K / "/" focus shortcut.
  ★ `use-focus-trap`'s Tab containment moved to BUBBLE with its Escape. That makes
  it consistent with `modal.tsx`, whose keydown listener has ALWAYS been bubble —
  so a descendant `stopPropagation` on keydown could defeat Tab containment in
  either. No consumer does this today (checked across the trapped subtrees); it is
  a constraint on future content placed inside a trap, not a current defect.
  ★★★ **TEST-TOPOLOGY TRAP — three separate bugs hid here in one release; assume a passing keyboard
  test is lying until its DOM shape matches production.** (1) React Testing Library renders into a div
  under `body`, so React's listener sits on a DESCENDANT and `stopPropagation` appears to work — it
  cannot in the real app, where the root IS `document`. (2) `document.dispatchEvent(...)` is an
  AT-TARGET dispatch, where capture and bubble listeners both fire in plain registration order — so it
  cannot distinguish a capture-phase fix from a bubble-phase one; fire from a focused ELEMENT instead.
  (3) jsdom reports every rect as zero, so a positioned popover never renders and its tests must be
  hosted on the hook. Assert `defaultPrevented` (a property of the event) rather than "some other
  listener did not fire" (a property of the topology).
  • **Info-flows diagram** (`settings-sections/information-flows-section.tsx`) has **9 nodes** in two
  colour-coded zones (AIPM tokens): *Your data* (green) = Local/IndexedDB, **File storage** (JSON/CSV/MD),
  Turso; central Browser-app hub; *Connected services* (dark-blue) = Jira, Timelog, **SharePoint**, **Outlook**,
  Anthropic — M365 SPLIT into SharePoint (docs) + Outlook (contacts/calendar). Option-B tight-horizontal SVG
  (`Node`/`Zone` helpers, `role=img`+`aria-label`+`<title>`/`<desc>`; node text hardcoded EN, legend `<dl>` +
  zone-swatch row use i18n). Rendered in BOTH Settings → Integrations AND the Help-view accordion (same
  component, two mounts).

