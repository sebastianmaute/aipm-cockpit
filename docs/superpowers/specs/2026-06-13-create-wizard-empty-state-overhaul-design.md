# Create-project wizard & empty-state overhaul — design

Date: 2026-06-13

## Problem

The fresh-install / empty-state and the create-project wizard have several
usability gaps reported by the user:

- The empty-state modal shows a ✕ that does nothing (non-dismissable by design),
  and there is no way to configure backends (Turso, M365) before creating or
  loading a project.
- The wizard modal is narrow and tall, not resizable, and "Next" sometimes
  can't be clicked even when the user believes all mandatory fields are filled.
- Field ergonomics: external links lack a consistent "Link to" prefix, there is
  no Jira link, end date is mandatory (should be optional), identity count is a
  free number with no guidance, and fields have no tooltips.
- Turso can only be chosen via a global Settings switch, not at create time.

## Scope (workstreams)

A. Empty-state redesign + backend-config entry points
B. Wizard modal shell (resizable, wider/shorter, footer pinned)
C. Wizard fields & validation (Storage dropdown, Link-to, Jira, dates, identity, tooltips)
D. Turso-at-create flow + config modal
E. `jiraUrl` persistence across all serializers
F. "Next disabled" diagnosis

---

## A. Empty-state (project-empty-state.tsx)

Layout (approved option A):

- Remove the ✕ entirely. The empty-state is a forced choice; ModalHeader is
  rendered without a close button (or the empty-state stops using ModalHeader's
  close affordance). The underlying shared `Modal` keeps its no-op `onClose` for
  Escape/backdrop — but no visible ✕.
- Below the two existing primary actions ("Create a new project", "Load from a
  file") add a **Backend setup** section (a labelled divider) with two buttons:
  - **Configure Turso backend** → opens a Turso-config modal (workstream D).
  - **Configure M365 integration** → opens an M365-config modal that reuses the
    sign-in block from `settings-sections/integrations-section.tsx`.
- Tooltips (`title`) on all four buttons.

Acceptance: on a fresh install the user can set up Turso and/or M365 without a
project, then return to the create/load choices. No dead ✕.

## B. Wizard modal shell (create-project-wizard.tsx + its modal host)

- The whole modal **panel** is resizable via the existing `useResizable` hook
  (same pattern as the resizable report/chat panes), with a **↺ reset-size**
  button in the header (existing `ResetSizeButton` / `ResizeCornerHint`).
- Wider default width (~880px, up from the current 720px — a 2-column grid needs
  the extra width) and **shorter** overall by switching the form body to a
  **2-column grid** (workstream C). Resizable from a sensible min (~520px) so it
  can collapse back to a single column on small viewports.
- Internal structure: fixed header (step indicator + ↺ + ✕-where-applicable) /
  scrolling form body (`flex-1 overflow-auto`) / footer pinned to the panel
  bottom (Back · Cancel · Next/Create) — footer lives **inside** the resizable
  panel so it resizes/scrolls with it.
- Note: in the empty-state host the wizard's own Cancel returns to the choices
  screen; the ✕ rules from A apply (no dead ✕).

## C. Wizard fields & validation (project-form-fields.tsx, create-project-form.tsx, project-validation.ts)

- **Storage dropdown** (was "File format"): JSON file / CSV file / Markdown file
  / **Turso (cloud DB)**. See D for behaviour.
- **2-column responsive grid** for the field groups (`sm:grid-cols-2`), reducing
  height. Required fields keep their `*` marker; group full-width fields
  (stakeholders, notes, document links, regulatory checkboxes) span both columns.
- **"Link to" label prefix** on Salesforce / SharePoint / Confluence, and a new
  **"Link to Jira"** field (`jiraUrl`). All four are optional URLs validated by
  the existing `isLikelyUrl` (blank allowed).
- **End date optional**: remove `errorEndDateRequired`; keep the
  end-before-start check only when both dates are present. Update the field label
  (drop required `*`, add "(optional)").
- **Identity count**: keep the numeric input, add a `<datalist>` of stepped
  suggestions: 50, 100, 500, 1000, 2500, 5000, 10000, 30000, 50000, 100000,
  250000, 500000, 1000000, 5000000, 10000000, 50000000. Suggestions only — any
  number still accepted.
- **Tooltips**: `title` (and `aria-describedby` where it adds value) on every
  field, with short i18n help strings (EN + DE).

## D. Turso at create time (create-project-wizard.tsx, storage-config.tsx, use-turso-projects.ts)

- Selecting **Turso** in the Storage dropdown:
  - If Turso is **not configured** (no db URL/token), open the **Turso-config
    modal** (reusing the Turso form from `storage-config.tsx`). On successful
    save, the selection stays "Turso" and the wizard proceeds.
  - If configured, completing the wizard creates the project on Turso
    (`handleCreateProjectByMode` already branches on `portfolioMode === "turso"`
    / `createTursoProject`); creating a Turso project switches the app into Turso
    mode.
- The same Turso-config modal is reused by the empty-state "Configure Turso"
  button (A).

## E. `jiraUrl` persistence (the "all write-paths" landmine)

`jiraUrl?: string` is added to `ProjectMeta` (types.ts) and MUST be threaded
through every place the existing `confluenceUrl` appears:

- `types.ts` (type), `sanitize.ts` (`sanitizeProjectMeta`),
- `csv-codecs.ts`, `markdown-codecs.ts` (if it serializes meta),
- `export-sections.ts` / `export.ts` (report/export),
- `project-validation.ts` (validation + draft type),
- `project-form-fields.tsx` (`emptyProjectDraft`, `draftFromMeta`, the field),
- `project-form.tsx` `handleSubmit` (include in the sanitized meta).

Grep `confluenceUrl` across `src/app` and add `jiraUrl` at each non-test site.
Round-trip (JSON/CSV/MD) must stay byte-stable for projects without a Jira link
(empty → omitted/empty, matching the other URL fields).

## F. "Next disabled" diagnosis

`Next` is gated by `hasProjectErrors(validateProjectMeta(draft))`. Required
fields include the easily-missed `endDate` (being made optional in C),
`keyStakeholdersInternal`, `keyStakeholdersExternal`, and `regulatory` (≥1).
Making end date optional removes one common blocker; verify the remaining
required fields are visibly marked. If a genuine validation bug remains after C,
fix it (e.g. a field whose value isn't wired into the draft). Confirm via a test
that a fully-filled valid draft yields `hasProjectErrors === false`.

---

## Testing

- Unit: `validateProjectMeta` — end date optional; end-before-start still flagged
  when both set; a complete draft (incl. new `jiraUrl` blank) is error-free.
- Unit: serializer round-trip for `jiraUrl` (JSON/CSV/MD) incl. byte-stable
  omission when blank.
- Component: wizard renders Storage dropdown; choosing unconfigured Turso opens
  the config modal; "Link to Jira" present; identity datalist present.
- Component: empty-state shows the two config buttons and no ✕.
- E2E (seeded): unaffected; the visual snapshot of the empty-state/wizard may be
  re-baselined.

## Out of scope

- Changing the global File/Turso switch in Settings (only adding a create-time
  entry point).
- Reworking the Projects-panel "Add project" modal beyond inheriting the shared
  wizard changes.
