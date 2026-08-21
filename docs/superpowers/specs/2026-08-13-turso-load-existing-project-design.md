# Load an existing Turso-stored project — design

**Branch:** new, off `main` (unrelated to `feat/attribute-boundary-140`).

## Problem

The project registry (`projects-registry.ts`) is entirely local (`localStorage`). Real
per-project data in Turso only becomes visible once `portfolioMode` flips to `"turso"` —
that flip is what triggers `listProjects(cfg)` / `listArchivedProjects(cfg)` against the
real DB and populates the switchable project list (`task-manager.tsx` `tursoProjects`,
`portfolioProjects`).

After a local-storage wipe (or on a new device), a user can enter correct Turso
credentials pointing at a DB that already holds their project, and still has no path to
discover or load it: the only actions offered are "Create" (mints a brand-new empty
project row via `createTursoProject`/`buildNewProjectWorkspace`) or "Load from file"
(wrong medium). The one control that would surface the existing project — the
"Portfolio storage mode" switch in `IntegrationsSection` (`confirmPortfolioModeSwitch`:
saves the mode, sets `storageConfig.kind:"turso"`, reloads) — is present and working in
Settings, but is unconditionally hidden (`hidePortfolioSwitch`) on both surfaces reachable
from the pre-project empty state:

- `ProjectEmptyState`'s own "Configure database / M365" button → `BackendConfigModal`
  (`project-empty-state.tsx`, hardcoded `hidePortfolioSwitch` on the JSX).
- `ProjectEmptyState`'s "Run setup wizard" button → `BackendSetupWizard`'s storage step
  (`backend-setup-wizard.tsx`, `hidePortfolioSwitch` hardcoded unconditionally on the
  `<IntegrationsSection>` inside it — this affects EVERY caller, including Settings').

One path already works today and is not touched by this fix: `CreateProjectForm`'s own
Storage → Turso → "Configure" button opens `BackendConfigModal` with no
`hidePortfolioSwitch`, so the switch is already visible there. It's just non-obviously
reachable only by starting the Create flow.

## Fix

Reuse the existing switch + "Save & switch" button (`IntegrationsSection`,
`confirmPortfolioModeSwitch`) — no new component, no new backend call, no auto-select.

1. **`backend-setup-wizard.tsx`** — add a real `hidePortfolioSwitch?: boolean` prop to
   `BackendSetupWizardProps`; forward it to the internal `<IntegrationsSection
   hidePortfolioSwitch={hidePortfolioSwitch} .../>` in place of the hardcoded literal.
2. **`settings-view.tsx`** — pass `hidePortfolioSwitch` (true) on its `<BackendSetupWizard>`
   call, preserving today's protection (a real project is open there; blindly flipping
   portfolio mode does not migrate it, so hiding the switch inside the *guided wizard*
   stays correct in that context — Settings' own direct `<IntegrationsSection>` render
   is untouched and already shows the switch unconditionally).
3. **`project-empty-state.tsx`**:
   - Drop `hidePortfolioSwitch` from its `<BackendConfigModal>` call (the "Configure
     database / M365" button's modal).
   - Omit `hidePortfolioSwitch` (i.e. pass nothing / `false`) on its `<BackendSetupWizard>`
     call, using the new prop from (1).
4. **i18n hint** — one new EN+DE string pair, shown in `IntegrationsSection` next to the
   portfolio-mode switch only when `tursoConfigured` is true (reuses the existing
   `tursoConfigured` local), e.g. `integrationsTursoSwitchHint`:
   "Already have a project stored in this database? Switch to Turso to load it." /
   "Bereits ein Projekt in dieser Datenbank gespeichert? Zu Turso wechseln, um es zu
   laden." This is the "explicit load" affordance the report asked for — it names the
   action a user is actually trying to take, rather than leaving a generic "File / Turso"
   dropdown to be discovered by guessing.

## Not in scope

- No auto-selection of a project after the mode switch, even when `listProjects` returns
  exactly one. The user reaches the existing `ProjectsPanel` (or the Turso empty-state's
  archived-projects section) and clicks the existing "Switch" button — that path already
  works correctly once `portfolioMode === "turso"` and the list is non-empty; the bug was
  only that this state was unreachable from the empty-state screen. (User-approved scope.)
- No change to the registry model itself (still local; Turso-mode already bypasses it via
  `portfolioProjects`/`tursoProjects` — see `task-manager.tsx:1996-2013`).
- No change to `CreateProjectForm`'s already-working `BackendConfigModal` call (no
  `hidePortfolioSwitch` passed there today).

## Testing

- `backend-setup-wizard.test.tsx`: new case asserting the portfolio-mode switch renders
  when `hidePortfolioSwitch` is omitted/false, and stays hidden when explicitly `true`
  (mirrors the existing default-hidden assumption the current tests may rely on — check
  and update any test currently asserting the switch is absent unconditionally).
- `project-empty-state.test.tsx`: assert the switch is reachable (present in the DOM)
  from both the "Configure database" modal and the "Run setup wizard" modal when Turso
  is configured.
- `settings-view.test.tsx`: assert the switch stays hidden via the guided wizard from
  Settings (regression guard for point 2).
- i18n: `tsc --noEmit` enforces EN/DE key parity; DE string written via the existing
  node-utf8/CRLF-anchor patch method (Edit tool corrupts umlauts in `i18n.de.ts`).
