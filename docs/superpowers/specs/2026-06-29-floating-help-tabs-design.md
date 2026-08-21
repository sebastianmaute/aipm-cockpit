# Floating Help — Tabbed Layout (Design)

**Date:** 2026-06-29
**Scope:** Floating top-bar Help panel only (`src/app/help-menu.tsx`). The in-pane Help view (`help-view.tsx`) and its `HelpCollapsibleRegion` accordion are **unchanged**.

## Goal

Rework the floating Help panel: remove the intro "slogan" line, and surface **Guided tours**, **How it all connects**, and **Information flows** as tabs in the header beside the search box. Selecting a tab swaps the panel body. The relations map and information-flows diagram adapt to the now-larger body area instead of a cramped accordion strip.

## Current state

`HelpMenu` (floating panel) renders, top to bottom:
1. Draggable title bar ("Help" + close ✕)
2. `helpIntro` paragraph (the "slogan")
3. Search input
4. `HelpContentPane` (TOC + content cards)
5. Footer: "Take a tour" button (`onTakeTour`) + license link

It has **no** tours / connects / flows surfaces today — those live only in the in-pane Help view's accordion. `ActionMenus` threads only `onTakeTour` into `HelpMenu` (not the tour catalog).

## Target layout

```
┌────────────────────────────────────────────┐
│ ⠿ HELP                                    ✕ │  ← draggable title bar (unchanged)
├────────────────────────────────────────────┤
│ [Help] Guided tours  How it connects  Info  │  ← tablist
│ flows        [ search help…             ]    │  ← search ONLY when Help tab active
├────────────────────────────────────────────┤
│                                              │
│   <active tab body>                          │  ← min-h-0 flex-1 overflow-auto
│                                              │
├────────────────────────────────────────────┤
│                              License ↗       │  ← footer (tour button removed)
└────────────────────────────────────────────┘
```

### Tabs

- **Help** (default), **Guided tours**, **How it connects**, **Information flows**.
- Semantics: `role="tablist"` / `role="tab"` / `role="tabpanel"`; selected tab `aria-selected`, `tabIndex` roving (0 active / -1 others), arrow-key navigation; `FOCUS_RING` from `interaction-styles`.
- **Tours tab is conditional**: rendered only when `onStartTour` is provided. Without it (tests, classic shell, popout) the tablist is 3 tabs: Help · How it connects · Information flows. Help / connects / flows are always present.
- Active-tab drift guard: if the active key is not in the current tab list (e.g. tours tab disappears), fall back to the first tab.

### Search

- The search `<input>` renders in the header row **only when the Help tab is active**. Hidden on the other tabs (search filters only the Help content).
- `query` state stays owned by `HelpMenu` (as today). Switching away and back to Help preserves the query.

### Body (only the active tab's body is mounted)

| Tab | Body | Props |
|-----|------|-------|
| Help | `HelpContentPane` | `lang`, `query` (no `onNavigateView` — unchanged from today) |
| Guided tours | `TourCatalog` | `lang`, `tours={catalogTours ?? []}`, `completedTours={completedTours ?? []}`, `onStartTour={startAndClose}` |
| How it connects | `RelationsMap` | `graph={buildRelationsGraph(HELP_ENTRIES)}` (memoized), `lang`, `onSelectConcept` |
| Information flows | `InformationFlowsSection` | `lang` |

- Non-Help bodies are wrapped in a `min-h-0 flex-1 overflow-auto` container so `RelationsMap` (vertical stack) and the `InformationFlowsSection` SVG fill the full panel width/height. This is the "adapt visualization for the new available space" requirement — verify both render at full body width and add wrapping/`max-w` only if a component overflows or fails to scale.

## Cross-tab behavior

### Connects → concept (scroll into Help)

When a `RelationsMap` node is clicked while the connects tab is active, the Help content sections are **not** in the DOM (only the active tab body is mounted). So:

1. `onSelectConcept(id)` records a pending scroll target and a monotonic nonce, and switches the active tab to **Help**.
2. The Help tab mounts (`HelpContentPane`).
3. An effect keyed on the nonce scrolls to `helpSectionId(id)` via `document.getElementById(...)?.scrollIntoView({ behavior: "smooth", block: "start" })`, then clears the pending target.

This mirrors the existing deep-link / `useDeepLinkRowFlash` reconcile-plus-nonce pattern. `HelpContentPane` already exposes `helpSectionId(id)` and renders `id={helpSectionId(e.id)}` on each `<section>`, so the target exists once the Help tab mounts.

Note a one-frame ordering point: the scroll effect must run **after** the Help body has mounted. Keying the effect on the nonce (bumped in the same render that switches the tab) guarantees the Help panel is committed before the effect fires.

### Tour start

`startAndClose(id)` = `setOpen(false)` then `onStartTour(id)`. Closing the panel lets the tour overlay (modern-shell-only) be visible, mirroring the current footer "Take a tour" behavior.

## Prop threading

`use-tour` (in `task-manager`) already produces `catalogTours`, `completedTours`, and `start(tourId?)`. Thread three new optional props through:

```
task-manager → AppHeader / TopBar → ActionMenus → HelpMenu
```

- `ActionMenusProps` gains optional `catalogTours?: readonly TourCatalogEntry[]`, `completedTours?: readonly string[]`, `onStartTour?: (id: string) => void`.
- `HelpMenu` gains the same three optional props.
- All optional → existing call sites (and `help-menu.test.tsx`, which renders `<HelpMenu lang="en-US" />`) compile and behave unchanged (no tours tab).
- `onTakeTour` stays on `HelpMenu`'s signature for back-compat but is **no longer rendered** in the footer (the tours tab replaces it). If `onTakeTour` is now unused after removing the footer button, drop it from `HelpMenu` and from the `ActionMenus → HelpMenu` pass-through — but keep `ActionMenus`'s own `onTakeTour` prop only if another consumer needs it (check: `AppHeader`/`TopBar`). Avoid leaving an unused prop (CI `--max-warnings=0`).

## Footer

- Remove the "Take a tour" button.
- Keep the license link (`APP_LICENSE_URL`, `versionLicense`).
- If removing the tour button empties the left side, the footer becomes a single right-aligned license link.

## i18n

Reuse existing keys for tab labels:
- Help tab: `help`
- Guided tours: `helpGuidedToursTitle`
- How it connects: `helpRelationsTitle`
- Information flows: `infoFlowsTitle`

No new i18n keys expected. (If a dedicated short "Help" tab label reads better than the panel title key `help`, add one EN/DE pair — but prefer reuse.)

## Accessibility

- Floating Help is **not** in the axe `A11Y_VIEWS` gate → verify by eye + unit tests.
- Tablist: keyboard-operable (arrow roving + Enter/Space activate), each tab has a text label (accessible name), `aria-controls` points at its panel id, panel has `role="tabpanel"` + `aria-labelledby` the tab id.
- Decorative glyphs (drag handle, RAID badges inside RelationsMap buttons) stay `aria-hidden` (label-bleed rule already handled inside `RelationsMap`).
- The info-flows SVG keeps its `role="img"` + `aria-label` (handled inside `InformationFlowsSection`).

## Testing

`help-menu.test.tsx` additions:
1. Default render (no `onStartTour`): exactly 3 tabs (Help / How it connects / Information flows); Help tab selected; search input present.
2. With `onStartTour` + `catalogTours`: 4 tabs including Guided tours; clicking it shows the tour cards; clicking a tour card calls `onStartTour` and closes the panel.
3. Switching to "How it connects" / "Information flows": search input is **absent**; the respective component renders.
4. Switching back to Help: search input returns; prior query preserved.
5. Connects → concept click: active tab becomes Help (assert via the search input reappearing / a Help section being present). Pixel scroll is not asserted (jsdom has no layout; `scrollIntoView` is a global no-op stub).

Run `npx tsc --noEmit` after editing tests (test-only type errors pass build/vitest but fail CI).

## Out of scope

- In-pane Help view and `HelpCollapsibleRegion` accordion — unchanged.
- `onNavigateView` wiring into the floating panel (related-view links stay non-interactive, as today).
- Settings → Integrations info-flows mount — unchanged.

## Release bookkeeping (at implementation end)

Bump `version.ts` (APP_VERSION + milestone), add `CHANGELOG.md` entry, append a new `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` + EN/DE strings. (Per AGENTS.md release rules — done as the final task, not per-task.)
