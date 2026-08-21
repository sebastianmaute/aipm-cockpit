# Turso project picker — design

**Status:** approved, ready for planning.

## Problem

Loading an existing Turso-stored project from a file-mode install (or from the
pre-project empty state) requires: open Settings/Configure-DB → flip a generic
File/Turso dropdown → confirm → reload → *if* the Turso portfolio already has
≥1 project, land in the normal app shell with no project selected → manually
find the Projects view → click "Switch" on the right row. There is no direct
"go load an existing Turso project" action, and no picker — the dropdown
switches storage mode, it does not let you choose which project.

"Load from file" already exists as a direct one-click action in both the
empty state (`project-empty-state.tsx`) and the Projects view
(`projects-panel.tsx`). "Load from Turso" should be symmetric with it.

## Goal

Add a "Load from Turso" button, in the same two places "Load from file"
already lives, that opens a picker listing the Turso portfolio's active
projects and switches straight into whichever one the user clicks.

## Non-goals

- Archived-project restore — both surfaces already have a dedicated flow for
  that (empty-state's archived section, ProjectsPanel's "Show archived" +
  Restore). The picker lists active projects only.
- Changing the existing Settings File/Turso dropdown (`integrations-section.tsx`
  `confirmPortfolioModeSwitch`) — it stays as the general, bidirectional mode
  toggle. The new button is a one-way shortcut layered on top, not a
  replacement.
- Anything in the "new project" *wizard* itself (`create-project-wizard.tsx`).
  The button lives on the empty-state choices screen and the Projects view
  header, alongside "Load from file" — not inside the create flow.

## Design

### Shared switch-and-reload helper

`portfolio-mode.ts` already owns the two localStorage primitives this needs
(`savePortfolioMode`, `saveCurrentTursoProjectId`) and has no React/DOM
dependency. Add one more export there:

```ts
export function commitTursoPortfolioSwitch(settings: Settings, projectId: string): void {
  savePortfolioMode("turso");
  saveCurrentTursoProjectId(projectId);
  writeSettings({ ...settings, storageConfig: { kind: "turso" } });
  window.location.reload();
}
```

This is the same three writes `confirmPortfolioModeSwitch` already does when
switching *to* turso (`savePortfolioMode` + the `storageConfig` write +
reload), plus persisting which project to land on. `confirmPortfolioModeSwitch`
is left as its own inline function in `integrations-section.tsx` — it also
handles the switch-*away*-from-turso branch, which this helper has no reason
to know about. No behavior change to the existing dropdown path.

On reload, `tursoProjectId` (in `use-storage-backend.ts`) initializes from
`loadCurrentTursoProjectId()`, so the app boots directly into the chosen
project — the same mechanism that already makes a *returning* Turso user land
back in their last project after a refresh.

### `TursoProjectPicker` component (new file, `turso-project-picker.tsx`)

Built entirely from existing shared primitives — `Modal`, `ModalHeader`,
`Button`, `EmptyState` — no hand-rolled dialog or list chrome.

Props:
```ts
interface TursoProjectPickerProps {
  lang: Lang;
  settings: Settings;
  onClose: () => void;
}
```

Behavior:
- On mount, resolves `getTursoConfig(...)` from `settings.integrations.turso`
  and calls `listProjects(cfg)`.
- **Loading:** a spinner/placeholder row inside the modal body.
- **Error:** message + a "Retry" `Button` (mirrors the existing storage-error
  banner's language — this is a fetch failure, not a fatal state).
- **Empty:** `EmptyState` ("no projects found in this Turso database").
- **Success:** each project rendered as a row with a "Load" `Button`
  (mirrors `ProjectsPanel`'s existing row markup: name + code). Clicking a
  row calls `commitTursoPortfolioSwitch(settings, project.id)`.

The modal never mutates `settings` itself — `onClose` is the only other
callback, for cancel/backdrop/Escape (reuses `Modal`'s existing dismissal
behavior, same as `BackendConfigModal`).

### Wiring

**`project-empty-state.tsx`:** new "Load from Turso" `Button` beside the
existing "Load from file" button in the choices view, gated on
`tursoConfigured` (same guard already used for `ProjectsPanel`'s
"Migrate to Turso" button — computed the same way,
`!!getTursoConfig(turso.databaseUrl, turso.authToken)`). Clicking it opens
`TursoProjectPicker` in a local `pickerOpen` state, same pattern as the
existing `configOpen`/`wizardOpen`/`aiConfigOpen` modals in this file.

**`projects-panel.tsx`:** new "Load from Turso" `Button` in the header,
beside the existing "Load from file"/"Migrate to Turso" buttons, gated
`!isTurso && tursoConfigured` (same guard the "Migrate to Turso" button
already uses). Same local-state-opens-modal pattern as the Edit/Create
modals already in this file.

Both call sites pass `settings` straight through (already threaded to both
components) — no new props need to flow further down.

### i18n

New keys, matching this file's existing naming convention
(`projectSwitcherLoadFile`, `projectMigrateToTurso`,
`projectMigrateToTursoHint`):

- `projectLoadFromTurso` — button label, "Load from Turso"
- `projectLoadFromTursoHint` — tooltip, e.g. "Browse projects already stored
  in the configured Turso database and switch into one."
- `tursoPickerTitle` — modal title, e.g. "Load a Turso project"
- `tursoPickerEmpty` — empty-state message
- `tursoPickerError` — error message
- `tursoPickerRetry` — retry button label (may reuse an existing generic
  "Retry" key if one exists — check before adding a duplicate)
- `tursoPickerLoad` — per-row action label, "Load"

EN + DE pairs for all of the above (DE via the raw Node.js UTF-8 script per
`i18n.de.ts`'s CRLF/encoding landmine, not the Edit tool).

## Error handling

- `listProjects` failure → picker shows the error state described above;
  nothing is persisted, nothing reloads. User can Retry or close the modal
  and nothing about their current portfolio has changed.
- No Turso config resolved (shouldn't happen given the `tursoConfigured`
  render guard, but the picker component should not assume it can't be
  opened without one) → treat as the error state rather than throwing.

## Testing

- `portfolio-mode.test.ts`: unit test for `commitTursoPortfolioSwitch` —
  asserts all three writes happen (mode, current-project-id, storageConfig)
  before `window.location.reload()` is called (mock `location.reload`, mirror
  existing tests in this file for the other exported functions).
- `turso-project-picker.test.tsx` (new): loading → success (rows render,
  clicking a row calls `commitTursoPortfolioSwitch` with the right id) /
  loading → error (Retry re-fetches) / loading → empty (EmptyState renders).
  Mock `listProjects` and `commitTursoPortfolioSwitch`.
- `project-empty-state.test.tsx`: button renders only when `tursoConfigured`;
  clicking it opens the picker.
- `projects-panel.test.tsx`: button renders only when `!isTurso &&
  tursoConfigured`; clicking it opens the picker.

## Open questions

None — design approved as written above.
