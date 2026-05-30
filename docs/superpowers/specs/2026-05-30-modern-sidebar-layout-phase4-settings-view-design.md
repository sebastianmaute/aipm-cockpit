# Modern Sidebar Layout — Phase 4 Workstream B: Full-page Settings View

**Date:** 2026-05-30
**Status:** Design approved, ready for implementation plan
**Phase:** Phase 4 "Shell Polish" — Workstream B (independent of A/C/D)

## Goal

Replace the Phase-1 Settings **popover stand-in** in the modern layout with a real
**full-page Settings view** that uses a left section rail. All section content is
shared with the classic-layout popover via extracted components (single source of
truth). The classic layout is unchanged — it keeps its gear-icon popover.

## Background

- `SettingsMenu` (`src/app/settings-menu.tsx`, ~864 lines) is a gear-button popover
  (`max-h-[80vh] w-80` dialog) used in **both** layouts. It holds ~8 logical
  sections and **auto-saves** — every control calls `onChange`/`setSettings`
  immediately, persisted by `useSettings`.
- In **modern**, the sidebar already has a "Settings" nav item, but
  `task-manager.tsx`'s `onNavigate` intercepts `v === "settings"` →
  `setSettingsOpen(true)`, popping the gear menu instead of navigating. That is the
  Phase-1 stand-in this workstream removes.
- `settings` is already a member of `AppView` and appears in `NAV_GROUPS` /
  `allNavViews()`, so hash deep-linking is already wired via `useHashView`.
- **Phase 2** established the full-page-view pattern this mirrors: a reserved
  `AppView`, `ModernShell` content slots (`editView`/`editTitle`/`editActions`),
  and `TopBar.primaryAction`. With **live auto-save**, the settings view needs no
  draft state and no `primaryAction`, so it is strictly simpler than the edit view.
- The classic `AppHeader` renders its **own uncontrolled** `SettingsMenu` (its own
  internal `useState` open state). It does not use the modern `settingsOpen` state,
  so dropping the modern gear does not affect classic.

## Decisions (from brainstorming)

1. **Page layout:** Left section rail — vertical section list on the left, content
   panel on the right (one section visible at a time).
2. **Reuse strategy:** Extract each section body into its own presentational
   component; **both** the classic popover and the new modern page consume them
   (single source of truth, guaranteed parity).
3. **Save model:** Keep **live auto-save** exactly as today. No draft state, no Save
   button.
4. **Modern entry point:** **Sidebar only** — drop the Settings gear from the modern
   TopBar. The sidebar "Settings" item navigates to the full-page view. Classic
   keeps its gear popover unchanged.

## Architecture

### Shared types extraction

`settings-menu.tsx` currently exports types/defaults consumed across the app
(`Settings`, `defaultSettings`, `AiConfig`, `JiraConfig`, notifications shape,
`IntegrationsSettings`, `sanitizeIntegrations`, etc.). Section components need these
types, and `settings-menu.tsx` needs the section components — a circular dependency.

**Resolution:** Move the shared types, defaults, and `sanitizeIntegrations` into a
new `src/app/settings-types.ts`, and **re-export them from `settings-menu.tsx`** so
that every existing importer elsewhere in the app keeps working unchanged. Both the
popover and the section components import types from `settings-types.ts`.

### Section components (single source of truth)

New directory `src/app/settings-sections/`, one presentational component per rail
entry. Each takes `settings` + `onChange` plus the extra props a given section needs:

| Rail entry | Component | Content | Extra deps |
|---|---|---|---|
| Appearance | `appearance-section.tsx` | Theme + Layout | `useTheme` |
| Language & Holidays | `localization-section.tsx` | Language + holiday countries | `COUNTRIES` |
| General | `general-section.tsx` | Pop-out reuse window + Resources workday hours | — |
| Notifications | `notifications-section.tsx` | Notifications block (incl. the `NotificationRow` helper, moved here) | — |
| AI Assistant | `ai-section.tsx` | AI api key / model / consent | — |
| Jira | (reuse existing `JiraSettingsSection`) | Jira config | — |
| Storage | (reuse existing `StorageConfigSection`) | Storage config | storage props |
| Integrations | `integrations-section.tsx` | M365 + Turso | `useMsAuth`, env flags |

`settings-menu.tsx` is refactored so its popover body becomes a stack of these
components (`<AppearanceSection/><hr/><LocalizationSection/>…`), producing
**byte-identical** rendered output. Behavior is preserved; a parity guard test
enforces it.

### Full-page view

New `src/app/settings-view.tsx`:
- Left rail listing the 8 entries; content panel renders the active section.
- Local `activeSection` UI state, defaulting to the first entry ("Appearance").
- Pure presentational + local UI state; receives `settings`/`onChange` and the
  storage/auth props the sections need, forwarding them to the active section.
- Active rail item styled `bg-AIPM-dark-blue text-white` (consistent with the
  sidebar). **AIPM palette only** — no new colors, no shadows, no gradients.
- Responsive: rail sits to the left on `md+`, stacks above the panel on narrow
  screens.

### Shell + seam changes

`src/app/modern-shell.tsx`:
- Add a `settingsView?: React.ReactNode` slot. Render it when
  `activeView === "settings"`; title from `navLabelKey("settings")`. No
  `primaryAction` for the settings view (auto-save).

`src/app/task-manager.tsx`:
- `onNavigate`: **delete** the `if (v === "settings") setSettingsOpen(true)`
  interception → plain `setActiveTab(v)`.
- Build `settingsViewEl = <SettingsView … />` and pass it to `ModernShell`.
- **Drop the modern gear:** remove `<SettingsMenu>` from `topBarMenus`, and remove
  the now-unused `settingsOpen` / `setSettingsOpen` state.
- Keep the existing classic-layout guard (redirects away from
  `settings`/`edit`/`open-points` when `layout === "classic"`) — classic never
  lands on the page.
- Classic `AppHeader` is untouched.

## Data Flow & Error Handling

Live auto-save: control → `onChange`/`setSettings` → persisted by `useSettings`,
exactly as today. No new error surfaces — storage, auth (`useMsAuth`), and Jira
sub-components retain their existing error handling.

## i18n

Add 8 rail-label keys (`settingsSectionAppearance`, `settingsSectionLocalization`,
`settingsSectionGeneral`, `settingsSectionNotifications`, `settingsSectionAi`,
`settingsSectionJira`, `settingsSectionStorage`, `settingsSectionIntegrations`)
across `en-US`, `en-GB`, and `de`.

**Caution:** `i18n.de.ts` has a known ASCII-quote→curly-quote corruption hazard when
edited with the Edit tool. Prefer Write/byte-patch and grep-verify the affected keys
after editing.

## Testing

- **Unit tests per extracted section:** controls render; `onChange` fires with the
  expected patch.
- **Parity guard** (modeled on `table-head-sweep.test.ts`, resolving paths via
  `process.cwd()` not `import.meta.url`): assert `settings-menu.tsx` imports each
  section from `./settings-sections/` — prevents the popover and page from drifting.
- **`settings-view` tests:** default section is "Appearance"; clicking a rail entry
  switches the visible section; a control change propagates through `onChange`
  (auto-save).
- **Seam tests:** navigating to `settings` in modern renders `SettingsView` (not the
  popover); the Settings gear is absent from the modern `topBarMenus`; the classic
  popover still renders all sections.

## Out of Scope

- Workstreams A (done), C (DRY menu cluster + banner parity), D (divergent-table
  sweep) — each has/gets its own plan.
- Explicit Save/Cancel for settings (rejected — auto-save retained).
- Any change to classic-layout Settings behavior beyond sourcing sections from the
  shared components.

## Constraints Honored

- AIPM 9-color palette only; no gradients, no drop shadows, no off-palette colors.
- `README.md` and `public/*.png` are pre-existing uncommitted user changes — never
  touched or staged.
- Branch: `phase4b-settings-view`; merge to `main` locally; push only on request.
