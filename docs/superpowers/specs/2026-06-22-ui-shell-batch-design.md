# UI Shell Batch (#16) — Design

**Date:** 2026-06-22
**Status:** Approved
**Release:** 0.131.0 "Aldiss"
**Scope:** Eight independent UI/shell tweaks. One release.

## Goal

A batch of shell/dashboard/tasks polish items requested together. Each is self-contained;
they share a release but not code.

## Items

### 1. Steering committee pane restyle (visual shell only)

`steering-committee-panel.tsx` currently uses a plain `<div className="min-h-0 flex-1
overflow-auto pr-2">` wrapper with the header INSIDE the scroller and bare `py-1` table
headers. Standard panes (`raid-panel`, `change-panel`, `milestones-panel`) use:
- outer `<div ref={paneRef} className={VIEW_PANE_RESIZABLE_CLASS}>` (`./view-styles`) +
  `useResizable("lop-app:steering-size")`,
- header OUTSIDE the scroller (stays put),
- a bordered scroller `min-h-[240px] flex-1 overflow-auto rounded-md border border-line pr-2`,
- standard `th` padding (`px-3 py-2`).

**Decision (approved):** visual-shell parity ONLY — adopt the resizable bordered pane,
header-outside-scroller, and standard `th` padding. Do NOT add per-column resize handles or
reset-cols buttons (committee meeting/info tables are short editorial lists). Add a
`ResetSizeButton` (pairs with `useResizable`). `TABLE_HEAD_CLASS` already used — keep.
The two inner tables (meetings, info schedules) both get the standard `th` padding.

### 2. Dashboard: density + trends toggles → left of Print button

The density ("Compact view") and trends toggles live in the Overall band
(`dashboard-panel.tsx:420-451`, `ml-auto` cluster). The Print button is `<PrintButton>` in the
`ReportCard` header toolbar (`report-table.tsx:219`), rendered AFTER the `toolbarExtra` slot.
Move the two toggle buttons OUT of the Overall band and pass them as `toolbarExtra` to
`ReportCard` (dashboard renders `<ReportCard … toolbarExtra={…}>` at `dashboard-panel.tsx:267`).
Result: `[toggles] [Print] [ResetSize]` left-to-right. Toggle markup (aria-pressed, pinned
labels, palette classes) unchanged — only relocated.

### 3. Dashboard: report date on the "Overall:" line

The report-date span (`dashboard-panel.tsx:453`) sits below the Overall band because the
`<details>` adjust-health block has `basis-full` (forces a wrap). Move the date span to
immediately AFTER the "Overall: <color>" div (after line 376) and BEFORE the `<details>`, with
`ml-auto text-sm text-muted-foreground` so it right-aligns on the SAME flex line as "Overall:".
Remove the old span at 453 and its toggle-conditional `ml-auto` className logic (now always just
the relocated span). The `dashboardRagThresholds` `<p basis-full>` stays at the bottom.

### 4. Default landing page = Dashboard

`workspace-tab-context.tsx:29`:
`useState<AppView>(popoutTab ? slugToView(popoutTab) : "chat")` → default `"dashboard"` instead
of `"chat"` for the non-popout, no-hash first load. Popout + hash paths unchanged.

### 5. "Configure AI" deep-links to Settings → AI section

The Dashboard coaching CTA (`dashboard-coaching.ts` → `{key:"ai", labelKey:"coachingConfigureAi",
view:"settings"}`, rendered by `dashboard-coaching-card.tsx` via `onNavigate(cta.view)`) lands on
the Settings view's default section. Make it deep-link to the AI section:
- `CoachingCta` gains optional `section?: SettingsSectionId` (set `section:"ai"` on the ai cta).
- `dashboard-coaching-card.tsx` `onNavigate` widened to `(view, section?)`; pass `cta.section`.
- `DashboardPanel.onNavigate` widened to `(view: AppView, section?: SettingsSectionId)`.
- task-manager's `onNavigate` impl: `setActiveTab(view)`; if `section`, bump
  `settingsSectionRequest` to `{ id: section, nonce: ++ }`.
- Widen the `settingsSectionRequest` state type from `{id:"nextActions";…}` to
  `{id:"nextActions" | "ai";…}` (settings-view already lists `"ai"` as a valid `SectionId`).

The shared section-id type lives where `SectionId` is defined (settings-view). Export a reusable
alias if needed so the coaching engine can reference it WITHOUT a circular import — if a clean
import isn't available, the coaching CTA carries a plain string literal `"ai"` typed against a
local `SettingsSectionId` string-union mirror. Other `onNavigate` call sites (KPI tiles, sparkline)
pass no section → unchanged behavior.

**Out of scope (approved):** empty-state "Configure AI" (shows pre-workspace, Settings view not
reachable — its `BackendConfigModal` is correct there) and the scheduled-jobs-section button.

### 6. Timezone switcher show/hide setting (hidden by default)

New per-device `settings.showDisplayTzSwitcher?: boolean`, **default `false`** (approved — hidden
until opted in). Add to `Settings` type + `defaultSettings` in `settings-types.ts`. Gate the
`displayTzSwitcherEl` in task-manager so it renders only when `settings.showDisplayTzSwitcher ===
true` (both modern `topBarMenus` and classic `AppHeader trailing` use the same `displayTzSwitcherEl`
var — one gate covers both; popout already excluded). Add a labeled checkbox in
`timezone-settings-section.tsx` writing via the existing `onChange({ ...settings,
showDisplayTzSwitcher: v })` spread (no `writeSettings` allowlist edit — it spreads). New i18n keys
`tzShowSwitcher` (label) + `tzShowSwitcherHint` (description), EN+DE.

### 7. Remove edit-task action buttons from the top navigation bar

In modern full-page edit, `editActions` (Send inquiry / Push to Jira / Delete / Jira sync / Cancel /
Update task) is rendered in BOTH the top bar (`ModernShell primaryAction` ← task-manager passes
`editActions`) AND the editor footer (`TaskEditView footer={editActions}`). Remove the top-bar
copy: stop passing `editActions` as ModernShell's `primaryAction` (pass `undefined`/omit while
editing). The footer keeps ALL actions, so nothing is lost. Classic/popout use `TaskFormModal`
(its own header+footer) — unaffected. Verify `TaskEditView` footer still receives `editActions`.

### 8. Jira read-only badge on tasks

Jira-synced tasks (`isJiraSynced(task)`, i.e. `!!task.jiraKey`) can't be dragged on the board and
their status `<select>` is disabled (`task-status-select.tsx` already has `title=jiraManagedTooltip`).
Both surfaces already show a `task.jiraKey` chip. Make the chip clearly signal read-only:
- Extract a small `task-jira-badge.tsx` (memo, props `jiraKey`, optional `href`, `issueType`,
  `lang`) rendering the existing chip styling + a leading inline lock SVG (palette-safe, `aria-hidden`)
  + `title`/`aria-label` = `jiraSyncedReadOnly` ("Synced with Jira — drag and manual status change
  disabled"). When `href` present (table, has siteUrl) it's a link; otherwise a `<span>` (board card).
- Board card (`task-kanban-card.tsx:119-122`) and table row (`task-row.tsx:219-234`) render the
  new badge instead of the inline chip. Behavior/drag/disabled logic UNCHANGED (this is signage).
- New i18n key `jiraSyncedReadOnly` EN+DE. Lock SVG uses `currentColor` (inherits the chip's
  `text-AIPM-dark-blue`/`dark:text-AIPM-blue` — no off-palette color).

## Cross-cutting / gates

- a11y: Dashboard, Open Points, Settings→General are axe-scanned. The relocated dashboard toggles
  keep their accessible names; the TZ checkbox + steering pane keep labeled controls. The jira
  badge's lock SVG is `aria-hidden` (the chip text + title carry meaning) — no label-bleed. Steering
  committee is NOT in `A11Y_VIEWS` (eye-verify row-unique labels unchanged).
- i18n EN/DE parity tsc-enforced; DE edited via node utf8 write (CRLF anchors, real umlauts).
- No new persisted Workspace field (only a per-device `settings` flag — rides `writeSettings` spread).
- Palette tokens only; no `Date.now()`/`Math.random()`/`new Date()` in render/pure.

## Testing

- Unit: dashboard-panel (toggles in toolbar, date placement), workspace-tab-context default,
  dashboard-coaching (ai cta carries section), settings-types default, timezone settings section
  (checkbox writes flag), task-manager TZ gate, task-jira-badge (renders, link vs span, aria),
  card+row render the badge. Edit-task removal: assert top bar lacks the actions while editing,
  footer keeps them.
- tsc, lint (--max-warnings=0), full test:run, build.
- axe: `-g "Dashboard"`, `-g "Open Points"`, `-g "Settings"`.

## Release

`version.ts` → `0.131.0` "Aldiss" (Brian W. Aldiss), build date; NO new highlight key (UI polish).
`CHANGELOG.md`, README badge, `package.json`, AGENTS.md pointers.

## Out of scope

Per-project keying of any setting; restyling other panels; touching classic `TaskFormModal`;
empty-state / scheduled-jobs Configure-AI rewiring.
