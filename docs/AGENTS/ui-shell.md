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
  "Related:" links. The floating top-bar Help panel stays features-only via the
  derived `HELP_SECTIONS` (`help-sections.ts` was renamed to `help-content.ts`).
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
  • **Contextual per-view callouts (Help SP2):** a slim dismissable banner atop each WORKING view — a novice
  one-liner + "Learn more →" deep-linking the matching Help concept. Pure `view-callouts.ts`
  (`VIEW_CALLOUTS: Partial<Record<AppView, {textKey, conceptId}>>`, ~14 views; `conceptId` in `HELP_ENTRIES`
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
  becomes an `aria-haspopup` trigger opening a `usePopoverDismiss` popover of parent+children (roving arrows/
  Home/End, Escape→trigger) so nested views stay reachable from the icon rail; caret dot + collapsed urgency
  dot (`bg-ui-medium-grey`/`bg-ui-pink`). **`resource-calendar.tsx`** is the app's FIRST `role=grid` 2-D
  roving grid (Arrow ±day/±assignee, Home/End, Ctrl+Home/End, PageUp/Down ±7; ★ clamp-on-read `focusRow/
  focusCol` so a window shrink keeps EXACTLY one tab stop; keydown guards on `document.activeElement` being a
  `[data-cell]` so the assignee row-header keeps its own arrow keys; `default: return` before `preventDefault`
  so Tab still escapes). Calendar sub-tab is NOT axe-scanned (Resources default sub-tab = directory).

### UI shell — surfaces & controls

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

