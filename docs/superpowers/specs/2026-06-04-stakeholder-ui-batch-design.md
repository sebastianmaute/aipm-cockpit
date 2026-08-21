# Stakeholder / UI Refinement Batch — Design (v0.53.0 "Asimov")

**Date:** 2026-06-04
**Status:** Approved (pending written-spec review)
**Release:** v0.53.0 "Asimov" (continues Le Guin → Sanderson → Pratchett → Scalzi)

## Goal

A batch of seven independent refinements that build on the v0.52.0 Stakeholder/RACI
feature and existing UI patterns. No storage schema change (schema stays at v8); the
only data work is read-only reporting plus seeding the sample workspace.

## Context

v0.52.0 introduced the `Stakeholder` workspace entity (register, RACI matrix,
influence/interest map) and generic deep-linking. This batch polishes those views,
adds a stakeholder report, replaces the influence/interest dropdowns with a clickable
matrix modelled on the existing RAID risk matrix, and seeds sample data so every
stakeholder view is demonstrable out of the box.

All work obeys the AIPM 9-colour palette (no gradients/shadows/off-palette), the
ASCII-only `i18n.de.ts` rule (byte-patch via Node, CRLF-aware — never the Edit tool),
and the `--max-warnings=0` lint gate.

## The Seven Items

### 1. `+` prefix on the Change Log "Add" button
`change-panel.tsx` toolbar button renders `+ {t(lang,"changesAdd")}` instead of the
bare label. Pure JSX text change. No i18n change.

### 2. Visible label on the Stakeholders "Add" button
`stakeholders-panel.tsx`: the button currently shows only `+` (label lives in
`aria-label`/`title`). Change the visible content to `+ {t(lang,"stakeholdersAdd")}`
so it reads "+ Add stakeholder", matching item 1. Remove the now-stale comment about
the button text being only `+`. Update the panel test that relied on `getByText`
finding "Add stakeholder" only in the modal `<h2>` — switch those assertions to
`getByRole("button", { name })` / scope to the dialog.

### 3. Resizable RACI matrix + Influence/Interest map panes
Both `raci-panel.tsx` and `stakeholder-map-panel.tsx` currently use the static
`VIEW_PANE_CLASS`. Convert each to the resizable-pane pattern already used by
`stakeholders-panel.tsx`:
- wrap the root in `VIEW_PANE_RESIZABLE_CLASS` with `ref={paneRef}`,
- `const { ref: paneRef, reset: resetPaneSize } = useResizable("<key>")`,
- add a small toolbar row holding `<ResetSizeButton onClick={resetPaneSize} lang={lang}/>`
  beside the existing title,
- render `<ResizeCornerHint lang={lang} />` at the end of the pane.

New localStorage keys: `lop-app:raci-size` and `lop-app:stakeholder-map-size`.
Preserve each panel's empty states (they currently early-return with `VIEW_PANE_CLASS`;
keep those returns but they need no resize affordance). The inner scroll container keeps
`flex-1 overflow-auto` so the table/grid fills the resized pane.

### 4. Dashboard "Clear" button (Clear + persist empty)
`dashboard-panel.tsx`, Status-Summary section. Add a Clear button immediately right of
the Save button. Behaviour:
- sets `draftNarrative = ""`,
- commits an empty narrative through the same path as Save (so the cleared state
  persists and `narrativeUpdatedAt` updates),
- disabled when the saved narrative is already empty (`(status.narrative ?? "") === ""`).

New i18n key `dashboardStatusClear` (EN "Clear" / DE "Leeren"). Style mirrors the
existing Save button but as a secondary/outline button (border + surface bg), `print:hidden`.

### 5. Influence/Interest 3×3 click-matrix (replaces the two dropdowns)
New file `influence-interest-matrix.tsx` — a clickable grid adapted from
`RaidPanel`'s `RiskMatrix` (its function, style, makeup):
- 3×3 grid; **X-axis = Interest** (Low→High, left→right), **Y-axis = Influence**
  (High at top → Low at bottom, matching the quadrant map orientation),
- `Low|Medium|High ↔ 1|2|3` mapping helpers live in this file
  (`LEVELS = ["Low","Medium","High"]`, index helpers),
- each cell is a `<button type="button">` with `aria-label` of the form
  `"{influenceLabel} {High}, {interestLabel} {Low}"` (localised),
- cell colour by quadrant using brand tokens (reuse the quadrant tinting idea:
  manage-closely highest, monitor lowest — greens/grey, no off-palette),
- selected cell gets `ring-2 ring-AIPM-green ring-offset-1`,
- axis labels flank the grid like RiskMatrix (rotated influence label on the left,
  interest label underneath),
- single prop callback `onPick(influence: InfluenceInterest, interest: InfluenceInterest)`.

In `stakeholder-edit-modal.tsx`, replace the two `<select>` fields (Influence, Interest)
with `<InfluenceInterestMatrix>` spanning both grid columns (`sm:col-span-2`). Clicking a
cell calls `onChange({ ...draft, influence, interest })` — one update sets both. A short
caption under the matrix shows the current selection
(e.g. "Influence: High · Interest: Medium") using existing level label keys.

### 6. Addable Stakeholder report (all four sections, read-only, embedded)
- `addable-reports.ts`: append `{ id: "stakeholder-report", titleKey: "stakeholderReportTitle" }`
  to `ADDABLE_REPORTS`. Leave it OUT of `DEFAULT_EXTRA_REPORTS` (opt-in).
- New `stakeholder-report-panel.tsx`, `embedded`-capable like `RaidReportPanel`, props
  `{ lang, stakeholders, milestones }`. Sections:
  1. **Summary tiles** — total stakeholder count + count per category
     (Internal/Customer/Vendor/Sponsor/Regulator/Other), reusing the report `Tile` look.
  2. **Influence/Interest grid** — read-only 2×2 quadrant breakdown built from
     `quadrantFor`, listing stakeholder name chips per quadrant (mirrors
     `stakeholder-map-panel.tsx` visuals, no edit).
  3. **RACI coverage** — per-milestone table: milestone name, Accountable count
     (`accountableCountByMilestone`), and a missing/multiple warning chip
     (`raciWarningFor`), reusing the amber `bg-amber-500/20 text-AIPM-purple` chip.
  4. **Register table** — read-only table: name, organization, category, influence,
     interest, linked resource. `TABLE_HEAD_CLASS` headers.
  Empty states: if no stakeholders, show a single muted "no stakeholders" line; the RACI
  section additionally shows "no milestones" when milestones is empty.
- `reports.tsx`: extend `ReportsPanel` props with `stakeholders?: Stakeholder[]` and
  `milestones?: Milestone[]`; add the `stakeholder-report` branch to `renderEmbedded`.
- Thread `stakeholders` + `milestones` from the `ReportsPanel` call site
  (`task-manager.tsx`).

### 7. Seed sample-workspace data (Milestones + Stakeholders + RACI)
**First restore the truncated working-tree `sample-workspace.md` from HEAD** (it is an
uncommitted 8-line stub; HEAD is the intact 110-line file). Build on the restored file.

Neither sample file has a Milestones or Stakeholders section, and RACI is milestone-keyed,
so seed BOTH:
- **~3 milestones** spanning the sample timeline (e.g. "Design Sign-off", "Go-Live",
  "Hypercare Exit") with dates inside the existing 2026 plan window.
- **~6 stakeholders** spanning ALL categories and varied influence/interest so **every
  quadrant of the map is populated** (at least one each in manage-closely, keep-satisfied,
  keep-informed, monitor). A couple link to existing sample resources (e.g. Taylor Specimen,
  resourceId 3). RACI roles assigned across the seeded milestones, deliberately including:
  - one milestone with **no Accountable** (drives the "missing" warning), and
  - one milestone with **multiple Accountables** (drives the "multiple" warning),
  so the RACI matrix warnings and the report's RACI-coverage section both have something
  to show.

Add the sections to **both** `sample-workspace.csv` (`# MILESTONES` and `# STAKEHOLDERS`
with `MILESTONES_CSV_COLUMNS` / `STAKEHOLDERS_CSV_COLUMNS` headers) and
`sample-workspace.md` (the markdown section format).

**Generation, not hand-authoring:** to guarantee the seeded text round-trips, generate
the exact section lines with the real serializers (`milestonesToCsv` / `stakeholdersToCsv`
for the CSV; `workspaceToMarkdown` for the MD) from a constructed in-memory sample, then
paste the verified output. Guard with a new test (mirroring `sample-workspace-budget.test.ts`)
that reads each committed sample file, parses it (`csvToWorkspace` / `markdownToWorkspace`),
and asserts: milestone count/names, stakeholder count, every quadrant non-empty, and the
two RACI-warning conditions. This keeps the budget test green (md restored) and locks the
new seed.

Out of scope: reconciling the pre-existing csv/md divergence (md has Budgets, csv does not).

## Cross-cutting

- **Version:** bump to `0.53.0` "Asimov" in `version.ts` + `package.json`; build date
  2026-06-04; add a `versionHighlight*` entry if that pattern is in use.
- **i18n:** new EN + DE keys: `dashboardStatusClear`, `stakeholderReportTitle`, plus any
  report-section labels not already present (category labels and level labels already
  exist). DE keys byte-patched, ASCII-only, CRLF-aware.
- **Docs:** CHANGELOG.md entry, README highlight if applicable, `docs/CODEMAPS/*` for the
  two new files.
- **Tests:** unit test per new/changed unit (matrix component, report panel, dashboard
  clear, resizable panels render, sample-seed round-trip). Existing tests updated where
  behaviour changed (items 2 button text).

## File Structure

| File | Change |
|------|--------|
| `change-panel.tsx` | Item 1 — `+` prefix |
| `stakeholders-panel.tsx` | Item 2 — visible label |
| `stakeholders-panel.test.tsx` | Item 2 — assertion update |
| `raci-panel.tsx` | Item 3 — resizable |
| `stakeholder-map-panel.tsx` | Item 3 — resizable |
| `dashboard-panel.tsx` | Item 4 — Clear button |
| `dashboard-panel.test.tsx` | Item 4 — test |
| `influence-interest-matrix.tsx` (new) | Item 5 — matrix component |
| `stakeholder-edit-modal.tsx` | Item 5 — use matrix |
| `stakeholder-edit-modal.test.tsx` | Item 5 — test |
| `addable-reports.ts` | Item 6 — registry entry |
| `stakeholder-report-panel.tsx` (new) | Item 6 — report |
| `reports.tsx` | Item 6 — wire embedded + props |
| `task-manager.tsx` | Item 6 — pass stakeholders/milestones |
| `sample-workspace.csv` / `.md` | Item 7 — restore + seed |
| sample-seed round-trip test (new) | Item 7 — guard |
| `i18n.ts` / `i18n.de.ts` | new keys |
| `version.ts` / `package.json` / `CHANGELOG.md` / docs | release |

## Testing strategy

TDD per task. Component tests use `lang="en-US"` (the `Lang` type is
`"en-US"|"en-GB"|"de"`). The sample-seed test reads the committed files from disk and
parses them, so it fails loudly if the seed drifts or the md regresses.
