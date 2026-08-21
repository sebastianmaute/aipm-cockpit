# UI Shell Batch (#16) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Eight independent UI/shell tweaks shipped as 0.131.0 "Aldiss".

**Architecture:** Mostly relocations + small additive props/flags. No new Workspace field; one new
per-device `settings` flag. Full design: `docs/superpowers/specs/2026-06-22-ui-shell-batch-design.md`.

**Tech:** Next.js 16 (forked) / React 19 / TS / Tailwind / vitest+RTL.

Tasks are sequenced to minimise `task-manager.tsx` collisions (T4/T5/T6 touch it — run serially).

---

### Task 1: Default landing page = Dashboard

**Files:** Modify `src/app/workspace-tab-context.tsx`; Test `src/app/workspace-tab-context.test.tsx` (create if absent, else extend).

- [ ] **Step 1: Failing test** — render `WorkspaceTabProvider` (non-popout) + a probe reading `useWorkspaceTab().activeTab`; assert it === `"dashboard"`. If a popout test helper exists, assert popout path still honours `popoutTab`.
- [ ] **Step 2:** Change line ~29 `: "chat")` → `: "dashboard")`.
- [ ] **Step 3: Green + gates.** scoped test, `npx tsc --noEmit`, `npm run lint`.
- [ ] **Step 4: Commit.** `feat: default landing view to Dashboard`

---

### Task 2: Dashboard toggles → toolbar + report date on Overall line

**Files:** Modify `src/app/dashboard-panel.tsx`, `src/app/dashboard-panel.test.tsx`.

- [ ] **Step 1: Failing tests** —
  - the density + trends toggle buttons render INSIDE the ReportCard toolbar (assert they appear
    before/near the Print button, e.g. both present and the Overall band no longer contains them —
    query by their aria-labels `dashboardDensityCompactView` / `dashboardShowTrends`).
  - the report-date text (`dashboardReportDate`) renders within the Overall band container that also
    holds the "Overall" label (same parent element) — assert they share an ancestor row.
- [ ] **Step 2: Implement** — (a) build a `toolbarExtra` node containing the existing two toggle
  buttons (cut from the Overall band lines ~420-451) and pass it to `<ReportCard … toolbarExtra={…}>`
  at ~267 (only when `onToggleDensity || onToggleTrends`, else undefined). (b) Move the report-date
  `<span>` to right after the "Overall: <color>" div (~376), classes `ml-auto text-sm
  text-muted-foreground`; delete the old span at ~453 and its conditional `ml-auto` logic.
- [ ] **Step 3: Green + gates.** `npm run test:run -- dashboard-panel`, tsc, lint.
- [ ] **Step 4: a11y.** `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"`.
- [ ] **Step 5: Commit.** `feat: dashboard density/trends toggles into card toolbar; report date on Overall line`

---

### Task 3: Steering committee pane restyle (visual shell)

**Files:** Modify `src/app/steering-committee-panel.tsx`, `src/app/steering-committee-panel.test.tsx`.

- [ ] **Step 1: Failing test** — assert the outer container carries the resizable pane class (query
  the rendered root for `VIEW_PANE_RESIZABLE_CLASS` substring e.g. `"resize"`/`min-h-[300px]`), and a
  Reset-size control with its accessible name is present.
- [ ] **Step 2: Implement** — import `VIEW_PANE_RESIZABLE_CLASS` (`./view-styles`), `useResizable`,
  `ResetSizeButton` (`./task-manager-ui`). Wrap output in `<div ref={paneRef}
  className={VIEW_PANE_RESIZABLE_CLASS}>`; move `<header>` OUT of the scroller; put the body in a
  scroller `<div className="min-h-[240px] flex-1 overflow-auto rounded-md border border-line pr-2">`;
  add a `ResetSizeButton` in a header row (`flex items-center justify-between`); change both inner
  tables' `th` padding `py-1` → `px-3 py-2`. `const { ref: paneRef, reset } = useResizable("lop-app:steering-size")`.
- [ ] **Step 3: Green + gates.** scoped test, tsc, lint.
- [ ] **Step 4: Commit.** `feat: steering committee pane matches standard content-pane shell`

---

### Task 4: "Configure AI" deep-link to Settings → AI section

**Files:** Modify `src/app/dashboard-coaching.ts`, `src/app/dashboard-coaching-card.tsx`,
`src/app/dashboard-panel.tsx`, `src/app/task-manager.tsx`, and their tests
(`dashboard-coaching.test.ts`, `dashboard-coaching-card.test.tsx`).

- [ ] **Step 1: Read** — `settings-view.tsx` `SectionId` union (must include `"ai"`); task-manager
  `settingsSectionRequest` state (~771) typed `{id:"nextActions";nonce}`.
- [ ] **Step 2: Failing tests** — coaching engine: the `ai` cta object includes `section:"ai"`.
  coaching-card: clicking the ai cta calls `onNavigate("settings","ai")` (spy).
- [ ] **Step 3: Implement** —
  - `dashboard-coaching.ts`: add `section?: SettingsSectionId` to `CoachingCta`; set `section:"ai"` on
    the ai cta. Define/import the section-id string-union (mirror locally if importing settings-view
    would cycle — a `type SettingsSectionId = "ai" | "nextActions" | …` minimal literal is fine; keep
    in sync with settings-view comment).
  - `dashboard-coaching-card.tsx`: `onNavigate: (view: AppView, section?: SettingsSectionId) => void`;
    call `onNavigate(cta.view, cta.section)`.
  - `dashboard-panel.tsx`: widen `onNavigate?` prop signature to `(view, section?)`; the `??(()=>{})`
    default stays.
  - `task-manager.tsx`: widen `settingsSectionRequest` state id union to include `"ai"`; in the
    dashboard `onNavigate` handler (where it calls `setActiveTab`), if `section` is passed also
    `setSettingsSectionRequest({ id: section, nonce: prevNonce+1 })`. Confirm SettingsView consumes
    `{id:"ai"}` (it already lists "ai").
- [ ] **Step 4: Green + gates.** `npm run test:run -- dashboard-coaching`, tsc, lint.
- [ ] **Step 5: a11y.** `-g "Settings"` (section deep-link keeps the AI section's controls labeled).
- [ ] **Step 6: Commit.** `feat: Configure-AI coaching CTA deep-links to Settings AI section`

---

### Task 5: Timezone-switcher show/hide setting (hidden by default)

**Files:** Modify `src/app/settings-types.ts`, `src/app/settings-sections/timezone-settings-section.tsx`,
`src/app/task-manager.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, and tests
(`timezone-settings-section.test.tsx`).

- [ ] **Step 1: i18n** — EN `tzShowSwitcher: "Show timezone switcher in the top bar"`,
  `tzShowSwitcherHint: "Adds a dropdown to the top bar for changing the displayed timezone for this session."`.
  DE via node utf8 write (CRLF anchor, real umlauts): `tzShowSwitcher: "Zeitzonen-Umschalter in der Kopfzeile anzeigen"`,
  `tzShowSwitcherHint: "Fügt der Kopfzeile ein Auswahlfeld hinzu, um die angezeigte Zeitzone für diese Sitzung zu ändern."`. tsc parity.
- [ ] **Step 2: Failing test** — timezone section: a labeled checkbox for `tzShowSwitcher` exists;
  toggling it calls `onChange` with `showDisplayTzSwitcher` flipped.
- [ ] **Step 3: Implement** — `settings-types.ts`: add `showDisplayTzSwitcher?: boolean;` to `Settings`
  + `showDisplayTzSwitcher: false` to `defaultSettings`. `timezone-settings-section.tsx`: add a
  `<label><input type="checkbox" checked={!!settings.showDisplayTzSwitcher} onChange=… /> {t(lang,"tzShowSwitcher")}</label>`
  + hint text; write via `onChange({ ...settings, showDisplayTzSwitcher: e.target.checked })`.
  `task-manager.tsx`: gate `displayTzSwitcherEl` so the mounts render `{settings.showDisplayTzSwitcher && displayTzSwitcherEl}` (or set `displayTzSwitcherEl = settings.showDisplayTzSwitcher ? <…/> : null`).
- [ ] **Step 4: Green + gates.** scoped test, full test:run (settings tests), tsc, lint.
- [ ] **Step 5: a11y.** `-g "Settings"` (checkbox labeled).
- [ ] **Step 6: Commit.** `feat: opt-in setting to show the top-bar timezone switcher (hidden by default)`

---

### Task 6: Remove edit-task action buttons from the top bar

**Files:** Modify `src/app/task-manager.tsx` (and `task-manager.test.tsx` if it asserts top-bar edit actions).

- [ ] **Step 1: Failing test** — while editing in modern layout, the top bar does NOT render the
  edit actions (e.g. `updateTask`/`cancel` buttons appear once, inside the editor footer, not twice).
  If hard to assert in the existing harness, add an assertion that ModernShell receives
  `primaryAction === undefined` while editing.
- [ ] **Step 2: Implement** — stop passing `editActions` as `ModernShell primaryAction` (pass
  `undefined` / omit) while editing; keep `footer={editActions}` on `TaskEditView`. Leave classic
  `TaskFormModal` path untouched. Remove any now-unused intermediate var if lint flags it.
- [ ] **Step 3: Green + gates.** `npm run test:run -- task-manager`, tsc, lint.
- [ ] **Step 4: a11y.** `-g "Open Points"` (top bar re-scanned across views).
- [ ] **Step 5: Commit.** `feat: keep task-editor actions only in the editor, not the top bar`

---

### Task 7: Jira read-only badge on tasks

**Files:** Create `src/app/task-jira-badge.tsx`, `src/app/task-jira-badge.test.tsx`; Modify
`src/app/task-kanban-card.tsx`, `src/app/task-row.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`.

- [ ] **Step 1: i18n** — EN `jiraSyncedReadOnly: "Synced with Jira — drag and manual status change disabled"`.
  DE via node utf8 write: `jiraSyncedReadOnly: "Mit Jira synchronisiert — Ziehen und manuelle Statusänderung deaktiviert"`. tsc parity.
- [ ] **Step 2: Failing tests** — `task-jira-badge.test.tsx`: renders `jiraKey` text; with `href`
  renders an `<a>` (target/rel), without `href` a `<span>`; the lock SVG is `aria-hidden`; the
  element `title`/`aria-label` includes the `jiraSyncedReadOnly` string. (Build a `Task` fixture with
  `jiraKey`.)
- [ ] **Step 3: Implement** — `task-jira-badge.tsx` (memo): props `{ jiraKey: string; href?: string;
  issueType?: string; lang: Lang }`. Render the existing chip classes (`inline-block rounded
  bg-surface px-1.5 py-0.5 text-[10px] font-medium text-AIPM-dark-blue dark:text-AIPM-blue`) +
  hover:underline when link; leading inline lock `<svg aria-hidden="true" …
  fill="currentColor"/>` (palette via currentColor); `title`/`aria-label` = `t(lang,
  "jiraSyncedReadOnly")` (link keeps issue-type in title too). Use it in `task-kanban-card.tsx`
  (replace the inline `task.jiraKey` chip, no href) and `task-row.tsx` (replace the `<a>` chip, pass
  `href={safeJiraIssueHref(...)}`, `issueType`). No drag/disabled logic change.
- [ ] **Step 4: Green + gates.** `npm run test:run -- task-jira-badge task-row task-kanban`, tsc, lint.
- [ ] **Step 5: a11y.** `-g "Open Points"`.
- [ ] **Step 6: Commit.** `feat: jira read-only badge (lock + tooltip) on board cards and table rows`

---

### Task 8: Release 0.131.0 "Aldiss" + docs

**Files:** `src/app/version.ts`, `CHANGELOG.md`, `README.md`, `package.json`, `AGENTS.md`.

- [ ] **Step 1: version.ts** — `APP_VERSION="0.131.0"`, `APP_MILESTONE="Aldiss"` (Brian W. Aldiss),
  `APP_BUILD_DATE="2026-06-22"`, update doc-comment. NO new `APP_HIGHLIGHT_KEYS` entry (UI polish).
- [ ] **Step 2: CHANGELOG** — new top entry summarising the 8 items (Changed/Added as fits).
- [ ] **Step 3: README badge** → `v0.131.0_%22Aldiss%22`. **package.json** → `"0.131.0"`.
- [ ] **Step 4: AGENTS.md** — short pointers: default landing = dashboard; steering pane now uses the
  standard resizable shell; dashboard toggles live in the card toolbar; `settings.showDisplayTzSwitcher`
  (default false) gates the top-bar TZ switcher; edit-task actions only in the editor footer (not top
  bar); `task-jira-badge.tsx` shared read-only badge; Configure-AI coaching CTA deep-links to Settings AI section.
- [ ] **Step 5: Verify** — tsc, lint, `npm run test:run`, `npm run build`; restore any CRLF-only diff
  on `operating-guide-builtin.generated.ts`; tree clean.
- [ ] **Step 6: Commit.** `release: 0.131.0 "Aldiss" — UI shell batch`

---

## Self-review

- Coverage: items 1-8 mapped to T1-T7 + release T8. ✓
- task-manager.tsx touched by T4/T5/T6 — sequenced serially. ✓
- Type consistency: `SettingsSectionId` shared between coaching CTA + task-manager request; `onNavigate(view, section?)` signature consistent across coaching-card/dashboard-panel. ✓
- a11y gates: Dashboard (T2), Settings (T4,T5), Open Points (T6,T7). ✓
- No placeholders. ✓
