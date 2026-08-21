# Additive Multi-Project Jira Sync (per-project read-only) — Design

**Date:** 2026-07-01
**Status:** Approved (brainstorming) — ready for implementation plan.

## Goal

Let a user sync issues from **more than one** Jira project into the app, while
keeping the existing single "primary" project as the two-way, create-capable
target. Each additional project is opt-in and carries its own **read-only**
toggle.

## Decisions (locked)

- **Option A — additive.** Keep the existing single `projectKey` as the
  **primary**: it stays two-way, remains the create target, and is the source
  for the issue-type picker and user search. Multi-project only *widens the read
  scope*; it does not touch create/issue-type/user flows.
- **Per-project read-only toggle.** Each extra project has its own `readOnly`
  flag.
- **Read-only semantics = remote wins / revert.** For an issue in a read-only
  project: never push, never transition, never raise a conflict-modal entry. On
  sync the Jira-owned fields are overwritten from Jira, so a stray local edit
  silently reverts on the next sync. Local-only fields (`blockers`, `group`,
  `inquiriesSent`) are never touched.
- **Default read-only ON.** Adding an extra project starts as watch/read-only;
  the user explicitly flips it to two-way. The primary project is always
  two-way.
- **Telegraph = badge distinction + editor banner.** At-a-glance in the
  table/board via the Jira badge, plus a clear banner at edit time.

## Non-goals

- No multi-project **create** (create always targets the primary).
- No per-project issue-type / assignee filters (the existing single filter set
  applies across the whole union).
- No change to how credentials are stored or to the `/api/jira/*` proxy.

## Architecture / components

### 1. Data model — `settings-types.ts`

```ts
export type JiraExtraProject = { key: string; name: string; readOnly: boolean };
```

`JiraConfig` gains `extraProjects: JiraExtraProject[]` (default `[]` in
`defaultJiraConfig`).

- `projectKey` / `projectName` are unchanged and remain the **primary**
  (two-way, create target, issue-type/user-picker source).
- Persistence: `settings.jira` is top-level and persists via the `writeSettings`
  **spread** — **no allowlist edit, no six-write-path, no Workspace field, no
  golden-fixture regen, no CSP change.** This is per-device settings config.
- `sanitizeJiraConfig` extension — for each `extraProjects` entry:
  - `key`: non-empty string; entries with an empty key are dropped.
  - `name`: sanitized/length-capped string (reuse an existing text cap).
  - `readOnly`: coerced boolean; **missing ⇒ `true`** (safe default).
  - Drop any entry whose `key === projectKey` (primary can't also be an extra).
  - Dedupe by `key`.
  - Cap the array length (20) — excess dropped.

### 2. JQL union — `jira-api.ts buildJql(config)`

- Collect `keys = [config.projectKey, ...config.extraProjects.map(p => p.key)]`,
  deduped, empty strings dropped.
- `keys.length === 0` → return `null` (unchanged "no scope" behavior).
- `keys.length === 1` → `project = "K"` — **byte-identical to today**, so
  existing single-project users see no behavior change.
- `keys.length > 1` → `project in ("K1", "K2", …)` (each key run through
  `escapeJqlString`).
- Assignee filter, issue-type filter, and `ORDER BY updated DESC` are appended
  exactly as today and apply across the whole union.

### 3. Read-only classifier — `jira-api.ts` (pure, exported)

```ts
// Project key is the substring before the first "-" (Jira project keys never
// contain "-"; issue keys are "<PROJECTKEY>-<number>").
export function jiraProjectKeyOf(issueKey: string): string;

// primary -> false; found in extraProjects -> its readOnly;
// not found (unrecognized project) -> true (never write to an unknown project).
export function isReadOnlyIssue(issueKey: string, config: JiraConfig): boolean;
```

`jiraProjectKeyOf`: `const i = issueKey.indexOf("-"); return i < 0 ? issueKey : issueKey.slice(0, i);`

`isReadOnlyIssue`: `project === config.projectKey` → `false`; else look up
`config.extraProjects.find(p => p.key === project)` → return its `readOnly`;
else → `true`.

### 4. Sync loop — `use-jira-sync.ts`

Per linked row (has `jiraKey` and a matching in-scope issue), compute
`const ro = isReadOnlyIssue(row.jiraKey, jiraCfg);`

- **`ro === true`:** never call `updateIssue` / `transitionIssueTo`, never
  append to `conflictItems`. Runs the **pull** path — overwrite Jira-owned fields
  from `issueToTaskFields(issue)`, clear `localModifiedAt`, set `lastSyncedAt`.
  This holds for remote-changed, local-changed (revert), and both-changed
  (silent remote win). If neither side changed, just refresh the sync stamp.
  Reverts count toward `pulled`.
- **`ro === false`:** exactly today's behavior (push / pull / conflict branches
  unchanged).

New-issue create loop: derive each new task's `group` from the issue's **own**
project (`jiraProjectKeyOf(issue.key)` → matching name from primary or
`extraProjects`, fallback to the key), instead of always using the primary
project name.

`handleResolveConflicts`: read-only rows never enter `conflictItems`, so no
functional change is required; add a defensive guard that skips the push if a
resolution somehow targets a read-only key (pull-only fallback).

### 5. Settings UI — `jira-settings.tsx`

Below the existing primary project `<select>`, add an **"Also sync from other
projects"** block:

- Always render the currently-configured `extraProjects` (from config) as rows,
  each with a read-only / two-way toggle and a remove control — so configured
  extras remain visible and editable even before a fresh connection test
  reloads the full project list.
- When the full project list is loaded (`projects.length > 0`), offer the
  projects not yet included (excluding the primary) as an add affordance;
  including one appends `{ key, name, readOnly: true }`.
- Accessibility: Settings → Integrations is axe-scanned. Every per-row control
  needs a **row-unique** accessible name (e.g.
  `` `${t(lang,"jiraReadOnly")} – ${p.name}` ``). Use `INTERACTIVE` / `FOCUS_RING`
  atoms; palette-safe tokens only.
- Writes flow through the existing config setter → `writeSettings`.

### 6. Telegraph

- **Badge** — `task-jira-badge.tsx` gains `readOnlyProject?: boolean`:
  - read-only project → lock glyph + tooltip/aria "Watched · read-only"
    (`jiraSyncedReadOnly`).
  - two-way project → a sync/refresh glyph + "Synced with Jira"
    (`jiraSyncedTwoWay`), dropping today's blanket "read-only" wording that is
    misleading for two-way tasks. (Status/drag lock for synced tasks is a
    separate existing constraint and is unchanged.)
  - Callers (table row + Kanban card) pass the precomputed
    `isReadOnlyIssue(task.jiraKey, jiraConfig)` flag as a **prop** (the Kanban
    board renders cards outside `RowContextProvider`, so the badge must not read
    context). The jira config is available where the badge's callers live; thread
    the boolean down.
- **Editor banner** — `TaskEditView` + `TaskFormModal` render a palette-safe
  banner when the edited task's project is read-only:
  *"Read-only — watched from Jira project {name}. Changes here won't be saved and
  revert on next sync."* (`jiraReadOnlyBanner`, takes the project name).

### 7. i18n (EN + DE)

New keys (EN in `i18n.ts`, DE in `i18n.de.ts` via node utf8 write with real
umlauts — the Edit tool corrupts that file):

- `jiraExtraProjectsLabel` — section heading "Also sync from other projects".
- `jiraExtraProjectsHint` — one-line explanation.
- `jiraExtraProjectInclude` — include/add control label.
- `jiraReadOnly` — "Read-only".
- `jiraTwoWay` — "Two-way".
- `jiraSyncedTwoWay` — badge tooltip for two-way projects.
- `jiraReadOnlyBanner` — editor banner (positional `{0}` = project name).

(`jiraSyncedReadOnly` already exists and is reused for the read-only badge.)

## Data flow

1. User picks a primary project (existing) and optionally checks extra projects
   in Settings → each stored on `settings.jira.extraProjects` via `writeSettings`.
2. `buildJql` unions all project keys into one JQL string.
3. `searchAllIssues` pulls the union; the sync loop classifies each linked row
   via `isReadOnlyIssue` and pulls-only for read-only projects, two-way for the
   rest.
4. UI reads the same classifier to render the badge variant and the editor
   banner.

## Error handling

- Unrecognized project on an issue key → treated as read-only (`true`) → never
  written. Conservative; avoids surprise writes.
- Sanitization drops malformed / duplicate / primary-colliding extra entries so
  a corrupt stored config can't push to an unintended project.
- Existing Jira error classification (`auth` / `network` / `other`) and
  push-failure toasts are unchanged.

## Testing

- `buildJql`: single-project output is byte-identical to today; multi-project
  emits `project in (...)`; keys are escaped.
- `sanitizeJiraConfig`: extras dedupe, drop primary-colliding, default
  `readOnly` to `true`, cap length.
- `isReadOnlyIssue` / `jiraProjectKeyOf`: primary → false, extra read-only →
  true, extra two-way → false, unknown → true; key parsing for normal and
  edge-shaped keys.
- `use-jira-sync`: read-only row with a local change → **no `updateIssue`
  call**, fields revert to remote; read-only both-changed → **no conflict item**;
  two-way rows keep today's push/pull/conflict behavior (regression).
- `jira-settings`: including a project appends it with `readOnly: true`; the
  toggle flips `readOnly`; remove drops the entry; row-unique labels present.
- `npx tsc --noEmit` passes (EN/DE i18n key parity).

## Constraints checklist

- No new `AppView`; no CSP host; no new persisted Workspace field / six-path; no
  golden-fixture regeneration. Per-device settings only.
- Settings → Integrations is axe-scanned → row-unique labels required in the new
  block.
- DE i18n patched via node utf8 write, not the Edit tool.
