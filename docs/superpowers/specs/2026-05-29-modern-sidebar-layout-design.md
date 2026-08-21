# Modern Sidebar Layout + Classic Mode — Design

**Date:** 2026-05-29
**Status:** Approved (brainstorming) — pending implementation plan
**Baseline version:** 0.28.1

## Problem & Goal

The app currently renders as a single centered column (`max-w-[1536px]`): a top
`AppHeader`, a resizable tabbed `WorkspaceSection` (Chat / Reports / Gantt / RAID /
Resources / Budget / Activity), and the always-visible `TasksSection` (the LOP
table) beneath it. Navigation is a horizontal tab strip.

We are introducing a new **default** layout: a left **Dark-Blue sidebar** with
grouped, nested navigation; a **top bar** with the page title and action buttons;
and a **full-viewport** content area that shows one view at a time — matching the
Acme design language in `docs/patterns/layout.png`, `table.png`, and
`edit.png`. The existing layout is preserved as a toggleable **"Classic mode."**

## Hard Constraints

- **Color palette (locked):** only the 9 permitted Acme brand colors, already
  wired in `src/app/globals.css` as CSS vars + Tailwind tokens (`AIPM-dark-grey`,
  `AIPM-dark-blue`, `AIPM-green`, `AIPM-white`, `AIPM-light-grey`, `AIPM-medium-grey`,
  `AIPM-blue`, `AIPM-pink`, `AIPM-purple`; plus semantic `--surface`, `--surface-muted`,
  `--line`, `--foreground`, `--muted-foreground`). Green (`#84BD00`) is the dominant
  accent; Dark Blue (`#004159`) for backgrounds / headings / table headers.
  **No gradients, no drop shadows, no off-palette colors.** Dark-mode neutral
  surfaces (`#121619` / `#1b2024` / `#2b3137`) pre-exist as the only exception.
- **No new routing framework.** Stay single-page + state-driven (Approach A) with
  **URL-hash deep-linking** (Approach C). Popout windows keep their existing
  `?popout=` query mechanism untouched.
- **Reuse existing panels and modal/validation logic.** The redesign is primarily a
  new shell + chrome; panel internals are reused.
- **i18n:** all new labels go through `t(lang, ...)` with keys in `i18n.ts` and
  `i18n.de.ts`. `i18n.de.ts` is prone to ASCII→curly-quote corruption when edited —
  byte-patch carefully and grep-verify after every change.

## Decisions (from brainstorming)

1. **View model:** one full-viewport view at a time. "Open Points" (the LOP table)
   is its own nav item and the default home view.
2. **Sidebar palette:** Dark Blue (`#004159`) background, White text, Green active
   band + accents, Medium-Grey caps section headers (matches `table.png` / `edit.png`).
3. **Editing:** the primary **task editor** becomes a dedicated full-viewport edit
   view (per `edit.png`). Smaller editors (absence, shift, roles, Outlook import, due
   list) remain overlay modals, lightly restyled for palette consistency.
4. **Shell architecture:** Approach **C** = state-driven shell + URL-hash sync.
5. **Navigation:** nested two-level sidebar (expandable parents).

## Navigation Tree

```
OVERVIEW
  Open Points        (home; LOP TasksSection)
  Chat
PLAN
  Gantt
  Resources
    Address Book     (ResourceDirectory)
    Resource Report  (ResourcesReportPanel)
  Budget
REGISTERS
  RAID
    RAID Report      (RaidReportPanel)
  Reports            (ReportsPanel)
SYSTEM
  Activity
  Settings
```

- Group headers (`OVERVIEW`, `PLAN`, `REGISTERS`, `SYSTEM`) render in Medium-Grey caps.
- Parents with children (`Resources`, `RAID`) expand/collapse via a chevron; clicking
  the parent navigates to the parent view **and** expands its children.
- `Address Book`, `Resource Report`, `RAID Report` already exist as view types
  (`address-book`, `resource-report`, `raid-report`) and today open only as popouts.
  They now also render full-viewport in the main window when selected. Existing
  in-panel popout buttons remain as a convenience.

## Architecture

### Layout mode setting

- Add `layout: "modern" | "classic"` to `Settings` (`settings-menu.ts` `defaultSettings`),
  default `"modern"`. Persisted through the existing `lop-app:settings` merge in
  `use-settings.ts` (additive → backward-compatible; existing users default to modern).
- Toggle exposed in Settings UI (Layout: Modern / Classic).

### View state

- Generalize the current `WorkspaceTabProvider` (`workspace-tab-context.tsx`) into the
  app-wide **view** state. Extend the `TopTab` union (rename concept to `AppView`) with
  `open-points`, `settings`, and `edit`. Existing values (`chat`, `reports`, `gantt`,
  `raid`, `resources`, `activity`, `resource-report`, `raid-report`, `address-book`,
  `budget`) are retained so popout logic and panel rendering are unaffected.
- Default view in modern mode: `open-points`. Popout windows still initialize from
  `readPopoutTabFromUrl()`.

### Shell components

- **`AppShell`** — reads `settings.layout`; renders `ClassicShell` or `ModernShell`.
  Both receive the same already-wired handlers/state from `TaskManagerInner`.
- **`ClassicShell`** — today's exact JSX tree (AppHeader → banners → WorkspaceSection →
  TasksSection → modals), extracted verbatim. No behavioral change.
- **`ModernShell`** — full-viewport CSS grid: `Sidebar` (fixed width, Dark Blue,
  collapsible) + main column (`TopBar` + scrollable content host). Renders the active
  view full-bleed (bypassing `WorkspaceSection`'s resizable box). Overlay modals and
  banners still mount here.
- **`Sidebar`** — brand header (white Acme logo + green "LIST OF OPEN POINTS"
  subtitle), nested nav groups, footer (storage/account status, theme toggle, version,
  sign-out when M365 signed in). Collapsible to an icon rail; auto-collapses below a
  width breakpoint (top bar then shows a menu button).
- **`TopBar`** — left: current view title (Dark-Blue heading). Right: the action
  cluster migrated out of `AppHeader` (New/Add Task as green primary, Due-alerts bell +
  badge, Export, Help, Version, Voice, Settings).
- **Content host** — renders the active view. Each existing panel is reused at full
  height. In modern mode the `WorkspaceSection` tab strip and resizable wrapper are not
  used; panels mount directly.

### URL-hash deep-linking

- On mount (main window only), read `location.hash` (e.g. `#gantt`) → set the active
  view. On view change, write the hash. Guarded so popout windows (`?popout=`) and
  Classic mode are unaffected. Unknown/empty hash → `open-points`.

### Full-page edit view (Phase 2)

- A new view (`edit`) hosts the **task editor** full-viewport, styled per `edit.png`:
  numbered/labeled sections, two-column field grid, Dark-Blue section headings, RAG
  toggle buttons, chip inputs. Save (green) / Cancel live in the top bar.
- Reuses the existing task-form state/validation (`task-form-modal` / `app-modals` /
  `use-task-submit`); the modal chrome is replaced by the full-page view in modern mode.
  Classic mode keeps the existing modal.
- Entered by clicking an open point or "New"; exits to the prior view on Save/Cancel.

### Table restyle (Phase 3)

- Data tables adopt the `table.png` treatment: Dark-Blue header row (white text),
  Light-Grey alternating rows, palette-only status badges. Applied to the LOP
  `TasksSection` table first, then other data tables.
- **Note:** extensive `palette-sweep-*` specs are already implemented (panels, calendar,
  modals, tasks-ui, raid-panel, gantt, menus-chrome). Phase 3 audits what is already
  palette-compliant and only adds the header/zebra/badge treatment where missing —
  it does not redo completed palette work. Supersedes the stale "palette sweep (E)" /
  "resources styling (B)" memory items.

## Phasing

The work is large; it is specified as one design and will be planned in phases. Each
phase is independently shippable and version-bumped (feature → minor bump).

1. **Chrome** — `AppShell` / `ModernShell` / `ClassicShell` / `Sidebar` / `TopBar`,
   view-state generalization, layout setting + toggle, hash sync. Panels render
   full-bleed. Classic mode verified identical to today.
2. **Full-page edit view** for the task editor.
3. **Table restyle** across data tables (header/zebra/badges).
4. **Polish** — responsive sidebar collapse, footer details, dark-mode pass,
   accessibility (landmarks, `aria-current`, keyboard nav for nested nav).

## Component / File Plan (indicative)

- New: `app-shell.tsx`, `modern-shell.tsx`, `classic-shell.tsx`, `sidebar.tsx`,
  `sidebar-nav.tsx` (nested nav model + items), `top-bar.tsx`, `nav-config.ts`
  (view→group/label/icon/parent mapping), `task-edit-view.tsx` (Phase 2).
- Modified: `task-manager.tsx` (delegate body to `AppShell`), `workspace-tab-context.tsx`
  (generalized view state + hash sync), `settings-menu.ts` (`layout` field + UI),
  `i18n.ts` / `i18n.de.ts` (new keys), `globals.css` (only if a missing semantic token
  is needed — no new colors).
- Unchanged internals: all panels (`gantt.tsx`, `raid-panel.tsx`, `budget-panel.tsx`,
  `reports.tsx`, `resources-panel.tsx`, `activity-log-panel.tsx`, `chat-panel.tsx`,
  `resource-directory.tsx`, report panels), storage, contexts, hooks.

## Error Handling & Edge Cases

- Corrupt/absent `layout` setting → default `"modern"` (existing merge already guards).
- Unknown hash → `open-points`; hash writes must not break the back button loop.
- Popout windows: sidebar/top bar suppressed (reuse existing `isPopout`); read-only
  mirror banner preserved.
- Collapsed sidebar must keep keyboard focus order and `aria-current` on the active item.
- Phase 1 must not regress Classic mode — it is the literal current tree.

## Testing (Vitest + React Testing Library; 80% target)

- Shell selection by `settings.layout`; toggling switches shells and persists.
- Sidebar: groups render; nested parents expand/collapse; clicking an item sets the
  active view; `aria-current` correct.
- Hash sync: initial hash selects view; navigation updates hash; unknown hash falls back.
- Top bar actions wired to the same handlers as Classic.
- Phase 2: edit view opens from a row / New, saves and cancels via the existing
  task-form logic, returns to prior view.
- Phase 3: table header/zebra/badge classes present; no off-palette colors introduced.
- Regression: existing panel and popout tests stay green.

## Out of Scope

- Next.js route-based navigation (rejected — Approach B).
- Converting absence/shift/roles/import modals to full-page views (stay overlays).
- Relocating report sub-views away from their parent nav entries.
- Any change to data models, storage backends, or business logic.
