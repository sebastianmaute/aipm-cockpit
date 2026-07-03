# `buildShellChrome` — dual-header assembly

**Source:** `src/app/shell-chrome.tsx` · **Extracted from** `task-manager.tsx` (Phase 3, move-only).

## Purpose
Builds the app's TWO header mounts from ONE input set: the classic `AppHeader`
element (`appHeaderEl`) and the modern TopBar's `topBarMenus` slot. This makes the
"wire BOTH headers or the control is invisible in one layout" landmine **structural**
— a control added here appears in classic AND modern automatically. Also owns the
internal `DisplayTzSwitcherConnected` and the `displayTzSwitcherEl` gate.

## Interface
`buildShellChrome(deps: ShellChromeDeps): { appHeaderEl, topBarMenus }`.
★ It is a **plain builder, NOT a hook** (`build*`, not `use*`) — its body calls no
React hooks (the switcher calls `useDisplayTimezone` when IT renders, not here), so
it is safely called AFTER task-manager's `!i18nReady` early return, where render
prep belongs. `deps` are the live header prop values (typed off `AppHeaderProps`) +
`lang`/`activeTab`/`nowCount` + the raw callbacks the former inline arrows used
(`setActiveTab`, `migrateCurrentProjectToTurso`, `openPopoutWindow`, `requestChat`)
+ the ActionMenus/template props.

## Invariants
- Returns JSX → the file is `.tsx`.
- No hook calls in the body (keeps it callable post-early-return).
- The display-tz switcher is shared by both mounts and gated on
  `settings.showDisplayTzSwitcher`; never rendered in popouts (they have no header).
- `action-menus-sweep.test.ts` pins that `ActionMenus` is imported HERE (moved from
  task-manager in the extraction).

## Coverage
`.tsx` → already outside the coverage gate (the `src/app/**/*.tsx` exclusion). Header
controls are verified by the axe gate (top bar is scanned in every view) + component
tests. See AGENTS.md "Top bar in TWO independent places".
