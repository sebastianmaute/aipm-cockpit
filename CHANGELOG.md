# Changelog

All notable changes to **Project Management Tracker** are recorded here.
The format is loosely based on [Keep a Changelog](https://keepachangelog.com/);
versioning follows [Semantic Versioning](https://semver.org/).

Authoritative source for version + build date: [`src/app/version.ts`](src/app/version.ts).
This file is seeded from that module's milestone comment plus the
post-release changes captured in [`.reports/codemap-diff.txt`](.reports/codemap-diff.txt).

## [0.60.0] - 2026-06-10 "Stephenson"

### Added
- SharePoint browse/picker (custom Microsoft Graph browser): search sites, navigate libraries/folders, select a file or folder.
- Document links on all six workspace entities (Task, RAID, Change, Stakeholder, Milestone, Project): link SharePoint files/folders, open in a new tab, persisted losslessly across JSON/CSV/Markdown/Turso.
- "Browse…" button in the SharePoint storage-backend config (replaces blind URL paste).
- Graceful picker fallback for tenants without a `Sites.Read.All` grant: when site search is forbidden (403), paste a site URL to browse its default document library using only `Files.ReadWrite.All` (no admin consent required).
- Per-link activity logging (`doc.linkAdded` / `doc.linkRemoved`) via an `ActivityLog` context, so adding/removing a document link in any editor is recorded in the Activity log.

### Changed
- SharePoint storage backend scope consolidated to `Files.ReadWrite.All` (picker adds `Sites.Read.All` for site search, with a `Files.ReadWrite.All`-only fallback). Schema versions bumped (workspace 10, Turso single-tenant 10, Turso multi-tenant 11).

## [0.59.0] — 2026-06-10 "Gibson"

### Added
- **Turso multi-tenancy (multi-project Phase 2):** a single shared Turso database now holds every project. Every entity table gains a `project_id` column, and a new `projects` table is the authoritative registry (the database — not `localStorage` — is the source of truth for the Turso project list).
- **Global portfolio-mode switch** (Settings → Integrations) selects between a **file-based** portfolio (Phase 1) and a **Turso-backed** portfolio. Exactly one mode is active at a time; changing it reloads the app.
- **Archive / restore** projects (soft-delete by default) and **permanent hard-delete** behind a type-the-exact-name confirm dialog.
- Snapshot capture is **scoped per project**, so baseline/variance trend history never bleeds across projects.

### Changed
- Saves are **last-write-wins per project**, so concurrent tabs stay safe.
- The sample SQLite database (`sample-workspace.sqlite3`) is regenerated as a **multi-tenant** database (schema v10).

### Notes
- File-based projects (Phase 1) are unchanged and continue to work as before.
- New modules: `portfolio-mode.ts`, `turso-tenant-schema.ts`, `turso-tenant-backend.ts`, `turso-portfolio.ts`, and a reusable `type-to-confirm-dialog.tsx`. The single-tenant `TursoBackend` is left intact.
- **Accepted limitation (per the no-migration decision):** a pre-existing single-tenant Turso database that already had snapshot tables (Turso-only since v0.49) will not auto-gain `project_id`; its Trends view degrades gracefully (banner, no data loss) until those tables are recreated.

## [0.58.0] — 2026-06-10 "Vinge"

### Added
- **Multi-project / portfolio management (Phase 1, file-based):** each project is a self-contained workspace stored as a separate file.
- A **project metadata header** (name, code, description, lead, start/end dates, client, NACE sector, deployment model, identity types, regulatory requirements, internal/external key stakeholders) sits at the top of every workspace.
- A **portfolio registry** lets users create, switch, rename, and archive projects from a dedicated Projects management view, with a create/edit form and empty-state onboarding.
- A **top-bar project switcher** shows and changes the current project.

### Changed
- Every existing export surface (CSV, Markdown, JSON, DOCX, XLSX, PDF, PPTX) scopes to the active project.

### Notes
- File-based projects only in this phase; Turso multi-project support follows in 0.59.0.
- The storage round-trip stays byte-identical for a workspace without a project header (project emission is gated and appended last).

## [0.57.0] — 2026-06-09 "Butler"

### Added
- **Configurable document export:** choose which sections to include in XLSX / DOCX / PDF / PPTX / Markdown exports (default Tasks + RAID). The PDF export renders all enabled sections.
- **AI Assistant** (renamed from "Claude chat") gains suggested prompts (including "Give me an update"), a **token-usage panel** (session and weekly bars with an 80% alert), a **Stop** button, and a top-bar button that opens it as a **pop-out** (read-only mirror).
- A new **"Information flows"** diagram in Settings.

### Changed
- **Reminders** gain toast-first defaults, global-or-individual lead times, and a separate Jira-token-error banner toggle.
- **Views:** the Trends view matches the Dashboard layout (print-safe, resizable); the Gantt gains a Print button; the Calendar and Milestones views are sized like the assistant; the activity-log print hides controls.
- The **activity log** now records change, stakeholder, resource, and role changes plus a coarse settings event, and adds a "general" activity group.

## [0.56.0] — 2026-06-09 "Bradbury"

### Added
- **Input sanitization feedback** so silent input transformations are now visible:
  - **Character counters** appear on capped text fields as they approach the limit (hidden below ~80%, turning warning-colored at the cap) across the task, RAID, change, budget, stakeholder, and resource editors.
  - **On-blur clamp notices** on numeric fields (shift hours, change schedule-days/cost, budget fixed amount + rate/FX overrides) show when a value was adjusted to its min/max.
  - **Label strip notice** when separator characters are removed from a label.
  - **Save-time toast** summarizing how many fields were adjusted to fit limits.
- New modules: pure `sanitize-report.ts` (describes text-cap / clamp / label-strip adjustments), `field-feedback.tsx` (`CharCounter`, `FieldNotice`, `useAdjustmentTracker`), and `toast-context.tsx` (shared toast access for editors).
- The repo now ships a **complete sample workspace** as `sample-workspace.json` (new) and a Turso-importable `sample-workspace.sqlite3` (schema v9), featuring example RAID↔stakeholder links and change-log entries — generated from the curated `sample-workspace.md` via `scripts/generate-sample-workspace.ts` (import with `turso db create lop-demo --from-file sample-workspace.sqlite3`).

### Changed
- Capped text inputs no longer hard-stop at the limit via the browser `maxLength`; instead the counter shows the overflow and the value is trimmed on blur (storage-layer sanitizers remain the final guard).
- `BUDGET_NAME_MAX`, `PO_NUMBER_MAX`, `AMOUNT_MAX` are now exported from `sanitize.ts`.
- The hand-curated `sample-workspace.md` is the sample's source of truth; the generator derives the complete `.json` + `.sqlite3` exports from it (it does not re-emit the `.md`/`.csv`, since `workspaceToMarkdown` does not escape the pipe-delimited blended-budget cell).

## [0.55.0] — 2026-06-08 "Clarke"

### Added
- **Stakeholder communication reminders:** a new pure `stakeholder-comms.ts` engine derives "reach out" nudges from a quadrant engagement policy — manage-closely (High influence / High interest) stakeholders are flagged ahead of due-soon milestones, open RAID items, and pending changes they are linked to.
- Reminders surface as a **banner**, a **review modal**, and a **once-per-load toast**, with a **Notifications settings toggle** (default on) and persisted **snooze** (mirrors the RAID-review reminder infra).
- **`stakeholderIds`** optional link field on `RaidItem` and `ChangeItem`, with a mode-gated stakeholder **multi-select** in both the RAID and Change editors (round-trips through every serializer; schema bump).
- **Milestones panel upgrade:** resizable columns, name + status filters, a Gantt-style left **add** button, and Resources-Workload row hover (new pure `filterMilestones` helper + status classification in `milestones.ts`).
- **Sidebar mode pill** showing the current Simple / Modular / Advanced mode next to the version line.
- **i18n encoding guard test** (`i18n-encoding.test.ts`): asserts the DE bundle uses literal UTF-8 umlauts (no mojibake, no `\uXXXX` escapes, no ASCII-substituted umlauts).

### Changed
- **Rebrand** "List of Open Points" → **"Project Management Tracker"** (EN + DE).
- Dashboard **Save / Clear** buttons move beside the status text in the chat-input button layout.
- Stakeholder register gains a **dark-mode color scheme**; the influence/interest matrix is sized like the chat pane; the RACI legend is restyled.
- DE i18n bundle **umlaut audit** — literal UTF-8 throughout.

### Notes
- Every comms source is **silent** when its module (stakeholders / milestones / RAID / changes) is disabled, per the Simple/Modular/Advanced mode contract.

## [0.54.0] — 2026-06-04 "Herbert"

### Added
- **Simple / Modular / Advanced mode** via Settings → Mode: per-module checkboxes, Simple and Advanced presets, and a derived mode badge showing the current state.
- Explicit **Save & reload** triggers a full page reload so navigation and automation settle on the new feature set.
- **Disabled modules retain data** but pause automation: RAID-review alerts and Turso snapshot capture are suppressed while the relevant module is off.
- Dashboard hides its top-band **Budget and Scope pills** and module-specific sections when the corresponding module is disabled.
- Gantt hides **milestone overlays** when the Milestones module is off.
- Change editor hides the **Change → RAID link** control when the RAID module is off.
- **Reports picker and report cards** respect the enabled module set (disabled-module reports are excluded).
- Navigation gated in both the **modern sidebar** and the **classic tab strip**.
- Default mode is **Advanced** (all modules on); legacy settings migrate automatically to all-on.
- New pure module `feature-modules.ts` (module registry + helpers) and `settings-sections/mode-section.tsx` (Mode settings UI).

## [0.53.0] — 2026-06-04 "Asimov"

### Added
- Addable **Stakeholder report** in the Reports view (summary tiles, influence/interest quadrant grid, RACI coverage with missing/multiple-Accountable warnings, register table).
- Influence/Interest **3×3 click-matrix** in the stakeholder editor (replaces the two dropdowns; one click sets both axes).
- **Clear** button on the dashboard status summary (clears and persists an empty narrative).
- Sample workspace now seeds milestones, stakeholders, and RACI data.

### Changed
- RACI matrix and influence/interest map are now resizable panes.
- "+" prefix on the Change Log add button; "+ Add stakeholder" label on the register add button.

## [0.52.0] — 2026-06-04 "Scalzi"

### Added
- **Stakeholder register:** a new workspace entity (`Stakeholder`) with name,
  role, organisation, contact details, engagement level, influence/interest
  scores, and optional link to a Resource. Sortable/filterable panel,
  draggable edit modal, and a Stakeholders nav entry (Registers group). Rounds
  trips through every backend (schema v8 additive migration).
- **RACI matrix:** milestone-scoped responsibility matrix (Responsible /
  Accountable / Consulted / Informed) per stakeholder, rendered as a
  scrollable grid with soft warnings when a milestone has zero or more than
  one Accountable assignment.
- **Influence / Interest (power/interest) grid:** 2-D scatter plot placing each
  stakeholder by influence and interest score with colour-coded quadrants
  (Manage Closely / Keep Satisfied / Keep Informed / Monitor).
- **True RAID deep-linking:** the URL hash grammar is extended to
  `#<view>/<id>` — navigating to `#raid/<id>` opens the RAID register and
  immediately scrolls to / highlights the specified item. The RAID-review
  reminder modal now opens the exact overdue item rather than just navigating
  to the register.

## [0.51.0] — 2026-06-04 "Pratchett"

### Added
- RAID review reminders: a banner / modal / once-per-load toast nudge for active
  RAID items past their target date or not reviewed within a configurable
  interval (new Notifications setting, default on, 14-day interval).
- Budget Report: a burn-down caption plus RAG bubbles on the Plan(h), Actual(h),
  and Revenue figures.
- Help: full-text search with section filtering, match highlighting, and
  jump-to-first-match.

### Changed
- Dashboard RAG polish: colorized R/A/G counts, RAG bubbles on the budget-burn
  tiles, boxed Progress + Budget-burn sections, and an explicit Save button +
  last-updated label on the status summary.
- Reports: an added report can now be removed via a dropdown (alongside the
  × button).
- Chat: the reset-size button moves left (centered) and the input height matches
  the Send / Clear button stack.

## [0.50.0] — 2026-06-03 "Sanderson"

Change-control Log: a RAID-sibling register of change requests with a type,
6-state approval workflow, impact rating (+ optional schedule/cost), requestor/
approver, and links to tasks and RAID items. Sortable/filterable panel, draggable
edit modal, printable Change Report, and a Changes nav entry. New Workspace.changes
entity round-trips through every backend (schema v7). The dashboard gains its first
computed Scope RAG (from the pending-change backlog) plus a Changes subsection.

## [0.49.1] — 2026-06-03 "Le Guin"

Trends polish: the trend-chart gap-count caption is now localized (EN/DE), and
the Turso integration settings warn when snapshot recording is enabled but no
Turso database URL is configured.

## [0.49.0] — 2026-06-03 "Le Guin"

Baseline + variance / burn-down trends. Turso-only periodic KPI snapshots
captured into append-only tables (separate from the workspace save cycle) power a
new Trends view: baseline-vs-current variance, KPI trend charts, and a snapshot
list. Auto-capture once per cadence bucket (weekly default; daily/monthly) plus a
manual capture button; re-baselineable. Switching away from Turso warns that
recording stops (data retained, resumes on return); recording gaps are
highlighted.

## [0.48.0] — 2026-06-03 "Tchaikovsky"

### Added
- Burn-down charts: currency symbol and axis tick labels (hours / EUR scale).
- Dashboard print enhancements: print-safe RAG colors, colorized Overall health
  text, Progress and Budget section captions, and a RAG thresholds legend on
  every print card.
- Margin RAG in the Planning view and the Resource Report.
- Resource Calendar: custom Today highlight color.
- Planning table: filter and sort toolbar.
- Budget panel: role and discipline filter/sort controls.
- Budget Report: Actual(h) RAG column.

### Changed
- RAID and Budget reports are now present by default in the Reports view
  (no "+ Add report" step required).
- Both task editors (full-page and modal) gain Cancel + Add/Save buttons in
  the top action bar.
- Gantt Add-milestone button opens the milestone create form directly.

## [0.47.0] — 2026-06-03 "Reynolds"

### Added
- RAG status across the budget panel (bucket metrics + per-cell and per-role
  status in the allocation grid), the Budget Report (CCI tiles + status column),
  and the dashboard pills — a shared lettered RAG badge.
- Twin burn-down charts (hours + €) on the dashboard and in the Budget Report,
  rendered as dependency-free SVG.

### Changed
- Dashboard prints the status overrides as a static value + RAG badge instead of
  dropdowns; budget-burn tiles show the currency symbol; the Top RAID / Upcoming
  & Overdue / Milestones / Recent activity sections are boxed; clickable links
  use the resources-directory hover affordance.

## [0.46.0] — 2026-06-02 "Banks"

### Changed
- **EVM folded into the dashboard RAGs:** the Schedule RAG now folds in SPI and the Budget RAG folds in CPI, worst-of with the existing task / milestone / budget signals. An index below 0.8 is Red, below 0.9 Amber; a manual override still wins. CPI can surface a Budget RAG even when no budget buckets are configured. (Completes the EVM follow-up deferred in 0.45.0.)
- **Help window opens at double its previous size** (still draggable and resizable; on-screen caps unchanged).

### Added
- **Clickable version history:** the sidebar version line is now a button that opens a version-history modal (the same panel as the Version popover).
- **Settings footer:** the full-page Settings view shows a version-history link and an **Apache-2.0** license link (→ opensource.org); the license link is also added to the Help footer.

## [0.45.0] — 2026-06-02 "Robinson"

### Added
- **Earned Value (EVM):** task-effort SPI/CPI plus PV/EV/AC and schedule/cost variances, derived from task estimates, completion, and time spent. PV = estimate of tasks due by today, EV = estimate of completed tasks, AC = time spent; shown in hours with an optional EUR overlay (mean role internal rate). SPI/CPI tiles on the dashboard budget-burn band; the full table in the Budget Report. Informational only; no new persisted state.

## [0.44.0] — 2026-06-02 "Bujold"

### Added
- **Milestones:** zero-duration key dates distinct from tasks — name, date, optional description, manual achieved sign-off, and linked tasks. Diamond rows on the Gantt with linked-task connector edges and an at-risk ring; a dedicated Milestones view; a dashboard Milestones subsection that folds overdue/at-risk/due-soon into the computed Schedule RAG. Round-trips through JSON/CSV/Markdown/Turso.

## [0.43.0] — 2026-06-02 "Cherryh"

### Added
- **Project-Health Dashboard:** a consolidated view — first in the Overview nav — that works as both a live cockpit and a printable status report. Shows overall RAG plus Schedule / Budget / Scope sub-status (computed, with inline manual override), a PM status narrative, % complete + R/A/G task-health counts, budget burn, top open RAID items, upcoming/overdue dates, and recent activity, all inside the shared report/print card. RAID rows link to the RAID register; task rows open the editor.
- **Persisted project status:** a new `Workspace.status` (`ProjectStatus`: RAG overrides for overall/schedule/budget/scope + a PM narrative) that round-trips through every storage backend (JSON, CSV, Markdown, Turso).

## [0.42.2] — 2026-06-02

### Fixed
- Budget cost/revenue were zeroed for buckets loaded from the CSV/Markdown/Turso backends when their per-bucket rate-override cells were empty (an empty cell was parsed as a literal `0/h` override). Empty override cells are now treated as absent; an explicit `0` remains a valid non-billable override.

### Added
- The sample workspace now ships five budget buckets demonstrating detailed and blended planning, per-bucket rate overrides, fixed-price, and closed-with-successor spillover.

## [0.42.1] — 2026-06-02

### Fixed
- Print orientation is now per-view: reports print A4 landscape, while the Activity Log (and other non-report views) print portrait again. (0.42.0 had made all in-app printing landscape.)

## [0.42.0] — 2026-06-02 "Le Guin"

### Added
- **Composable Reports:** the Reports view has an "+ Add report" control that appends the RAID Report, Budget Report, and/or Resource Report below the task analytics. Each is removable, the selection persists, and the whole view prints as one document.

### Changed
- In-app printing now defaults to A4 landscape (matching the PDF export).

## [0.41.1] — 2026-06-01

### Fixed
- Budget panel: the empty-state "+ Add bucket…" prompt (shown when no buckets exist) is now a real button — clicking it creates a bucket and opens the editor modal. Previously it was inert text.

## [0.41.0] — 2026-06-01 "Okorafor"

### Added
- **Budget Report:** a dedicated, read-only report under Budget -> Budget Report. Shows the project-level CCI rollup (contribution margin, cost performance, consumption) and a sortable per-bucket detail table (mode, type, status, currency/FX, budget/plan/actual hours, budget/consumed EUR, margin, win/loss) across all buckets. Printable via the report card.

### Changed
- Budget reporting moved out of the task Reports view (added in 0.40.0) into the dedicated Budget Report.

## [0.40.0] — 2026-06-01 "Leckie"

### Added
- **Budget planning modes:** each bucket has a "Detailed budget planning" toggle. On = plan per role (discipline x grade); off = plan per discipline using the blended average rate of that discipline's grades.
- **Per-bucket rate overrides:** optional internal/external rates that override the role/blended rate for every line in the bucket.
- **Reports → Budget section:** filter by bucket and by minimum total budget, with total / used / free / hours rollups and a per-bucket table.

### Changed
- Budget entry fields now show a unit suffix (h) and explanatory tooltips. Switching a bucket off detailed planning warns before discarding the per-role hours.

## [0.39.0] — 2026-06-01 "Tchaikovsky"

### Added
- **Resource Calendar date range:** the calendar now has **Month / Week / Custom** views with **◀ / Today / ▶** navigation and **From / To** date pickers (Custom mode). It renders an arbitrary date window — showing **past as well as future dates** — and, like the Gantt, **scroll-centers today** when it opens (re-anchoring to today on every open). Month mode opens on the current month; Prev/Next step by month or week.

## [0.38.7] — 2026-06-01

### Fixed
- **Gantt & RAID top spacing:** the filter dropdowns no longer make those toolbars taller than other views, so the Gantt chart and RAID table start at the same offset from the top as every other window.
- **Sidebar alignment:** the navigation sidebar now ends level with the bottom of the content window instead of extending below it.

## [0.38.6] — 2026-06-01

### Changed
- **Milestone codename shown in the UI:** the version now reads `0.38.6 "Chambers"` in the sidebar footer and the Version popover. Patch releases inherit their minor version's codename (the whole 0.38.x line is "Chambers").
- **Version highlights refreshed:** added a highlight summarizing the 0.38.3–0.38.5 UI-consistency work (uniform header spacing, control sizing, and dialog buttons/headers).
- **Docs:** README version line and the CODEMAPS stamps refreshed to 0.38.6.

## [0.38.5] — 2026-06-01

### Changed
- **Modal/dialog buttons unified:** the Bulk Edit, Jira Conflicts, and RAID edit dialogs now use the same compact footer buttons (size + bordered Save with the standard hover) as the task/resource/shift/absence/budget/Outlook dialogs — and as primary buttons elsewhere in the app.
- **Dialog headers unified:** the two Outlook import dialogs and the Due-Dates dialog now match the shared modal header (sticky, correct layering and background) used by the other dialogs.

## [0.38.4] — 2026-06-01

### Changed
- **Header spacing unified across the remaining views** (follow-up to 0.38.3, after a full audit): Open Points, Reports / RAID Report / Resource Report, Activity, and Manage Roles now use the same header-to-content gap as every other view.
- **RAID toolbar** now matches the Gantt toolbar exactly — same control height (search field and filter dropdowns) and the same spacing below the toolbar.
- **Activity** search field adopts the standard control height.
- **Open Points** "Jira sync" button matches the size of Budget's "Refresh ECB rates" button.
- **Planning** control row (date pickers + granularity/mode toggles) uses the standard control spacing.

## [0.38.3] — 2026-06-01

### Changed
- **Consistent header spacing across primary views:** every primary pane now uses the same top rhythm — a ~30px header row followed by an 8px gap before its content.
- **Resources (Workload / Calendar / Planning):** the header is vertically centred (was baseline-aligned), so the "Resources" title and the reset buttons line up; the reset-button cluster uses the same 8px spacing as the Directory toolbar.
- **Budget:** the header gained the missing bottom margin so the cards no longer butt against it, and the "Refresh ECB rates" button matches the size of the adjacent "Add bucket" button.
- **Gantt:** the toolbar's search field and filter dropdowns adopt the standard control height (matching the rest of the app), so the chart starts at the same offset as other views.

## [0.38.2] — 2026-06-01

### Changed
- **Resources → Workload:** the Reset-column-widths and Reset-size buttons now sit on one header line instead of stacking vertically.
- **Resources → Planning:** the From/To date pickers match the height of the granularity/mode controls.
- **Resources → Manage Roles:** the rate-card table is styled like the Directory/Workload tables; the panel is centred and half-size like Chat.
- **RAID Report, Reports, Resource Report:** each card shows a left-aligned heading on the same line as its toolbar buttons.

## [0.38.1] — 2026-06-01

### Changed
- **Classic layout:** the primary tab strip now exposes a secondary sub-tab row (Resources sub-views: Directory, Workload, Calendar, Planning, Manage Roles; and RAID Report), matching modern sidebar navigation.

## [0.38.0] — 2026-06-01 "Chambers"

### Added
- **Resizable panes:** every primary view (Open Points, Chat, Gantt, RAID, Resources views, Budget, Activity, Reports, and the RAID/Resource reports) is now drag-resizable — views fill the available height by default, a corner handle lets you drag to any size, and a Reset-size button restores the default. Backed by a shared `VIEW_PANE_RESIZABLE_CLASS` + `useResizable` hook. Chat is presented as a centred half-size card.
- **Budget pane:** a bucket-count heading row with right-aligned action buttons.

### Changed
- **Gantt + RAID toolbars:** the add-button now appears before the search field.
- **RAID panel:** the in-panel "open report" button has been removed; the RAID Report is reachable via the sidebar.
- **Resources navigation restructured:** the Resources sidebar item now navigates directly to the Resource Report. Its sub-menu holds: Directory (formerly Address Book), Workload, Calendar, Planning, and Manage Roles (now a full page, not a modal). The standalone Resource Report sub-menu entry was removed.
- **RAID Report + Resource Report** adopt the Reports pane layout with sortable, filterable, column-resizable tables via a shared report-table kit.

## [0.37.2] — 2026-05-31

### Testing
- Added **property-based testing** with [fast-check](https://github.com/dubzzz/fast-check) (new dev dependency; no runtime impact).
- Eight co-located `*.property.test.ts` suites assert invariants over generated inputs for the pure-logic layer: `duration` (parse/format round-trip), `fx` (conversion round-trip, rate positivity, monotonicity), `resource-capacity` (period ordering, workday bounds, non-negative capacity), `due-dates` (working-day math, alert sorting), `sanitize` (length caps, idempotence, encode/decode round-trips, label dedup), `raid` (comparator antisymmetry & total order, monotonic severity, counts), `resource-cost` (cost identities, no-throw formatting), and `date-format` (locale mapping, verbatim fallback).
- Documented one boundary finding: `sanitizeNonNegInt` / `sanitizeOptionalMinutes` throw on `Symbol`s and null-prototype objects, which the JSON/CSV input path cannot produce — the property is scoped to the realistic JSON-value domain rather than hardening the function out of scope.

_No runtime/behavior changes._

## [0.37.1] — 2026-05-31

### Documentation
- README updated to the modern-layout era (version line; new **Layout & theme** and **Printing** rows in the feature table).
- Regenerated the five `docs/CODEMAPS/*` architecture maps for 0.29.0–0.37.1 (modern sidebar shell, full-page edit/Settings views, shared style constants, scoped printing).
- In-app **Help** gains a “Layout & theme” section (modern sidebar vs Classic mode, theme, URL-hash deep-linking) — EN + DE.

_No runtime/behavior changes._

## [0.37.0] — 2026-05-31 "Kowal"

### Fixed
- The Gantt **export** dropdown is no longer painted over by the sticky date row — it now stacks above the frozen header (`z-40`).

### Changed
- **Open Points (modern):** the task table now fills the available height instead of sitting in a fixed-height, manually resizable box.
- **Classic layout:** the page is now a viewport-height column — only the content area scrolls and the footer stays visible at the bottom (no more scrolling the whole document to reach it).
- **Pane consistency:** Reports, RAID, Budget, and Chat now share the same bordered surface card as the Open Points pane, and the Resources sub-tables match the main table styling. Gantt stays full-bleed by design.
- **Printing:** printing a report (Reports, RAID Report, Resources Report) or the Activity log now prints just that view — the sidebar, top bar, banners, and other panes are hidden. The Activity pane also gains a **Print** button.
- **Settings (modern):** the Jira section is always expanded in the full-page Settings view (the redundant collapse toggle is gone).
- **Address book:** the Outlook contacts import button is renamed **“Sync with Outlook”** (EN) / **„Mit Outlook synchronisieren“** (DE).
- The sidebar version line now reads **“Version x.y.z”**.

## [0.36.0] — 2026-05-31 "Hurley"

### Changed
- The task form (both the modern full-page edit view and the classic modal dialog) now presents its fields in 5 stacked, numbered sections — Details, Scheduling, Effort & Classification, Relationships, Status & Notes — instead of one long list. Same fields, same validation; just grouped for easier scanning.

## [0.35.0] — 2026-05-31 "Muir"

### Changed
- All remaining data-table headers (Reports ×3, Roles modal, Budget panel, Jira-conflicts modal, Resource calendar) now use the shared Dark-Blue `TABLE_HEAD_CLASS`, completing the Phase 3/4 header sweep. In-header sort buttons use the green accent hover; the resource-calendar frozen corner and default day cells paint dark blue with white text (today/holiday tints preserved).

### Internal
- Generalized the `table-head-sweep` guard to a `FORBIDDEN_HEADS` list and added the five swept files, so these headers cannot drift back to bespoke styling.

## [0.34.0] — 2026-05-30 "Novik"

### Added
- The modern layout now shows the Due, Birthday, and Jira-token reminder banners at the top of the content area (previously only the Classic layout showed them).

### Internal
- Extracted the shared header action cluster (Voice, Export, Help, Version) into a single `ActionMenus` component used by both the Classic header and the modern top bar, with a sweep test that guards against the two drifting apart. In the Classic header the Voice button now sits alongside Export/Help/Version (a minor reorder); behavior is unchanged.

## [0.33.0] — 2026-05-30 "Wells"

### Added
- Full-page Settings view in the modern layout, with a left section rail (Appearance, Language & Holidays, General, Notifications, AI Assistant, Jira, Storage, Integrations).

### Changed
- Modern-layout Settings is now reached via the sidebar "Settings" item, which opens the full-page view; the gear-icon Settings popover has been removed from the modern top bar. The Classic layout is unchanged and keeps its gear popover.
- Settings sections are now shared components under `settings-sections/`, consumed by both the classic popover and the new full-page view (single source of truth).

### Internal
- Extracted `Settings` types/defaults into `settings-types.ts` (re-exported from `settings-menu.tsx`).
- Added an import-parity guard test ensuring the popover sources every section from `settings-sections/`.

## [0.32.1] — 2026-05-30

### Fixed
- The responsive sidebar no longer flashes its expanded state for a frame on narrow viewports before collapsing — the media-query hook now reads the match during render (via `useSyncExternalStore`) instead of correcting it in an effect after the first paint.

### Changed
- All Microsoft 365 sign-in consumers (Settings, the sidebar footer, storage configuration, and the storage backend) now share a single session store, so signing in or out anywhere updates everywhere immediately and MSAL initializes only once. No change to the sign-in flow itself.

### Internal
- The shell palette guard now also rejects off-palette gradient color-stop utilities (`from-`/`to-`/`via-[#hex]`), and gained self-tests for its detection patterns.

## [0.32.0] — 2026-05-30 "Jemisin"

### Added
- Responsive sidebar: a collapsible **icon rail** that auto-collapses on narrow screens, a top-bar menu button, and a persisted collapse preference.
- Sidebar footer with the theme toggle, storage status, and M365 account / sign-out.
- Accessibility: a skip-to-content link and a labelled `#main-content` landmark in the modern shell.

### Fixed
- The sidebar collapse button is no longer a no-op — it is now wired through the modern shell.

## [0.31.0] — 2026-05-30 "Leckie"

### Changed
- **Table restyle (Dark-Blue headers).** Every primary data table — Open Points, RAID and the RAID Report, the Activity log, the Resource Directory / Workload / Planning / Rollup grids, and the Resources Report — now has a Dark-Blue header row with white, uppercase labels, sourced from one shared style so the look stays consistent. Header sort buttons highlight in green on hover.
- **Zebra striping on the Open Points list.** The LOP table now alternates a Light-Grey tint on every other row for easier scanning. Selected, in-edit, and completed rows keep their existing emphasis. This is Phase 3 of the sidebar-layout redesign.

## [0.30.0] — 2026-05-29 "Liu"

### Added
- **Full-page task editor (modern layout).** Opening a task — or clicking **New task** — now opens a full-viewport edit view instead of the overlay dialog: a Dark-Blue section heading, a two-column field grid in the AIPM palette, and **Save** (green) / **Cancel** in the top bar. The editor reuses the same fields, state, and validation as before, and returns you to the view you came from on save or cancel. **Classic mode** and all pop-out windows keep the dialog. This is Phase 2 of the sidebar-layout redesign (a table restyle follows).

## [0.29.0] — 2026-05-29 "Okorafor"

### Added
- **Modern left-sidebar layout — now the default.** A new app shell with a Dark-Blue left sidebar carrying grouped, nested navigation (Open Points, Chat, Gantt, Resources + Address Book/Resource Report, Budget, RAID + RAID Report, Reports, Activity, Settings), a top bar showing the active view title and actions, and a full-viewport content area that shows one view at a time. URL-hash deep-linking (`#gantt`, `#raid`, …) and browser back/forward navigation are supported. This is Phase 1 of the redesign (chrome only; a full-page edit view and table restyle follow).
- **Layout toggle in Settings → Layout.** Switch between the new sidebar layout ("Modern") and the prior layout ("Classic") at any time; the choice is persisted per device.

## [0.28.1] — 2026-05-29

### Security
- **Jira proxy SSRF hardening.** The server-side Jira proxy (`/api/jira/*`) now accepts HTTPS site URLs only — plaintext `http://` is rejected (Atlassian Cloud is always HTTPS, and this guarantees Basic credentials are never sent in the clear) — and the private-host filter now also blocks IPv6 unique-local (`fc00::/7`), IPv6 link-local (`fe80::/10`), and IPv4-mapped (`::ffff:`) addresses.

### Changed
- **Internal code-quality pass — no user-facing behavior change.** De-duplicated the eight `/api/jira/*` route handlers behind a shared `parseJiraRequest` entry point; extracted shared UI (`combobox-shared.tsx` for the combo/labels inputs, `modal-edit-fields.tsx` for the absence/shift/resource editors, plus a `ReportTableShell` wrapper and a `useSortableFilter` hook for the report tables); removed dead code and unnecessary exports; fixed lint warnings; and added test coverage for the RAID report panel.

## [0.28.0] — 2026-05-29 "Chambers"

### Added
- Link to turso.tech in the Turso storage configuration section.
- Mouseover help tooltips on every field in the Settings menu (storage, integrations, Jira, AI, notifications, and more).

### Changed
- Switching to a Turso backend when the server is down or the database is unreachable now shows a clear "storage unreachable — is the server running?" message instead of a raw network error. The switch is aborted and your current data is preserved (no switch, no data loss). A reachable but empty database is still initialized automatically.

## [0.27.0] — 2026-05-29 "Wells"

### Changed
- **Switching the storage format now converts and writes your workspace.** Instead of loading whatever was already in the target backend, the app serialises your current workspace and writes it to the newly-chosen format (JSON, CSV, Markdown, SharePoint, or Turso) after a confirmation dialog — overwriting the target. Startup load and the explicit "open file" action are unchanged; all formats remain fully two-way. No new dependencies.

## [0.26.0] — 2026-05-29 "Leckie"

### Changed
- **Turso storage is now relational.** The Turso backend stores your workspace across per-entity tables (tasks, raid, absences, shifts, resources, roles, disciplines, grades, budget_buckets, plan, fx_rates) — scalar fields as columns, nested fields (task dependencies/labels, resource utilization, budget allocations, fx rates) as encoded TEXT columns — instead of a single JSON blob, so it's queryable in SQL. Existing single-blob Turso databases (0.25.x) are imported automatically on first load. Works with Turso Cloud and a local/self-hosted `tursodb`.

## [0.25.1] — 2026-05-29

### Changed
- **Turso backend now works with a local / self-hosted `tursodb`, not just Turso Cloud.** The config resolver accepts a plaintext `http://` URL for loopback hosts (`localhost` / `127.0.0.1`) and treats the auth token as optional there; the backend omits the trailing pipeline `close` frame (newer libSQL engines reject it) and only sends the `Authorization` header when a token is configured. Remote endpoints still require `https` + a token — a Bearer token is never sent over plaintext to a non-loopback host. Run e.g. `tursodb mydb.db --sync-server 127.0.0.1:8080`, then set the Turso URL to `http://127.0.0.1:8080` (token blank) in Settings → Integrations.

## [0.25.0] — 2026-05-29 "Okorafor"

### Added
- **Turso storage backend (T1).** A new **Turso database** option in Storage Configuration stores your entire workspace as a single JSON row in a Turso (libSQL) database via the HTTP pipeline API. Enable Turso in Settings → Integrations and add your database URL + auth token (or set `NEXT_PUBLIC_TURSO_DATABASE_URL` / `NEXT_PUBLIC_TURSO_AUTH_TOKEN`). The token is stored in the browser — use a scoped token.

### Changed
- The **Turso** sub-toggle in Settings → Integrations is now interactive — **the original Microsoft 365 + Turso request is now complete** (M365 auth, SharePoint storage, Outlook contacts, Outlook calendar, Turso storage).

## [0.24.0] — 2026-05-29 "Hopkinson"

### Added
- **Outlook calendar import (M4).** With Microsoft 365 enabled and signed in, an **Import from Outlook** button on Resources › Calendar fetches your time-away events (all-day and Out-of-Office) from your Outlook calendar (Microsoft Graph `/me/calendarView`, `Calendars.Read`). A preview dialog lets you pick events and set each one's absence type (vacation / sick / training / other); selected events become absences on the resource calendar, attributed to your account. Events already present (matched by date range) are skipped.

### Changed
- The **Outlook calendar** sub-toggle in Settings → Integrations is now interactive — **all Microsoft 365 integrations (auth, SharePoint storage, Outlook contacts, Outlook calendar) are now live.**

## [0.23.1] — 2026-05-29

### Fixed
- **Microsoft 365 incremental consent.** Acquiring a Graph token for a scope you haven't consented to yet (e.g. `Contacts.Read` on first Outlook import, or `Files.ReadWrite` on first SharePoint save) previously failed silently. `useMsAuth.acquireToken` now accepts an opt-in `{ interactive: true }` and falls back to an interactive consent popup when the silent attempt fails. The Outlook contacts import and SharePoint load/save opt in; background readiness probes stay silent, so they never trigger an unexpected popup.

## [0.23.0] — 2026-05-29 "Bujold"

### Added
- **Outlook contacts import (M3).** With Microsoft 365 enabled and signed in, an **Import from Outlook** button in Resources › Directory fetches your personal Outlook contacts (Microsoft Graph `/me/contacts`, `Contacts.Read`). A preview dialog lets you pick which to import; selected contacts populate the rich resource directory (name, email, title, department, phone, company, location, birthday) and seed the assignee address book.
- Contacts already in the directory are matched by email, pre-checked, and **updated** from the latest Outlook values (uncheck to leave them alone).

### Changed
- The **Outlook contacts** sub-toggle in Settings → Integrations is now interactive (was gated "Available in 0.22.0+"). Outlook calendar remains gated for a future release.

## [0.22.0] — 2026-05-28 "Willis"

### Added
- SharePoint storage backend: store your workspace as a single JSON or CSV file in a SharePoint Sites library via Microsoft Graph. Enable SharePoint in Settings → Integrations (the sub-toggle is now interactive), then in Storage Configuration pick "SharePoint JSON" or "SharePoint CSV" and paste the SharePoint file URL. First save creates the file; concurrent edits use last-write-wins (no ETag tracking). Reuses M1's MSAL foundation; sign-in is gated behind the M365 master toggle and triggers an incremental-consent popup for `Files.ReadWrite` on first SharePoint access.
- New version highlight: "SharePoint storage" (`versionHighlightSharepointStorage`) in both EN and DE.

### Changed
- `StorageConfig` for `sp-json` / `sp-csv` no longer carries per-config `clientId` / `tenantId` — MSAL config is centralized at the M1 foundation. New shape: `{ kind, hostname, sitePath, itemPath }`. Existing settings without sp-* StorageConfig are unaffected.

## [0.21.0] — 2026-05-28 "Cherryh"

### Added
- Microsoft 365 integration foundation: a new Integrations section in Settings with a "Sign in with Microsoft" button gated behind a master toggle (defaults OFF). When the toggle is OFF, the `@azure/msal-browser` bundle is not loaded — zero cold-start cost. Configuration resolves from `NEXT_PUBLIC_MSAL_CLIENT_ID` / `NEXT_PUBLIC_MSAL_TENANT_ID` env vars first, then falls back to Client ID / Tenant inputs in the panel. Sub-toggles for SharePoint storage, Outlook contacts, and Outlook calendar render disabled with "Available in 0.22.0+" — they will be wired in subsequent minor releases.
- A Turso storage-backend toggle is present in the Integrations panel (disabled, "Available in 0.22.0+") — the Turso backend itself is the T1 sub-project, tracked separately.
- New version highlight: "Microsoft 365 auth foundation" (`versionHighlightM365Auth`) in both EN and DE.

## [0.20.0] — 2026-05-28 "Tiptree"

### Added
- Print button on Reports, RAID Report, and Resources Report popouts. Click to open the browser's print dialog with the report body laid out for DIN A4. Toolbars, toggles, filter inputs, and the print button itself are hidden via @media print; surface-token backgrounds strip to white for ink efficiency; semantic accent colors (overdue=pink, completed=green, tile values=dark-blue) survive the strip.
- New version highlight: "Print on reports" (`versionHighlightPrintReports`) in both EN and DE.

## [0.19.0] — 2026-05-28 "Russ"

### Added
- Reports popout: the By Assignee, By Group, and By Label tables are now sortable and filterable. Click any column header to cycle through ascending / descending / off. Type in the search input above each table to narrow rows (case-insensitive match on the name column); click × to clear. Default sort is by Total descending.
- New version highlight: "Reports sort + filter" (`versionHighlightReportsSortFilter`) in both EN and DE.

## [0.18.1] — 2026-05-28

### Changed
- Report popouts (Resources Report, Reports, RAID Report) no longer show the read-only-mirror banner — these views are read-only by their nature and the banner was redundant. Editing popouts still show it as before. Confirmed that due-task / birthday / Jira-token reminder banners remain hidden in every popout.

## [0.18.0] — 2026-05-28 "Shelley"

### Added
- RAID Report: a steering-committee popout opened from the RAID panel's "Open RAID Report" button. Shows four headline tiles (open counts per RAID category) and six summary tables (By Severity, By Status, By Owner, Top 10 Open, By Category, By Aging). A Summary / Full Detail toggle at the top of the report drills down to a full read-only sortable item table.
- New version highlight: "RAID Report" (`versionHighlightRaidReport`) in both EN and DE.

## [0.17.1] — 2026-05-28

### Fixed
- Gantt now opens with today centered in the viewport — scroll left for past tasks, right for future. Previously the chart opened at the leftmost data column regardless of where today fell, often hiding the most relevant bars off-screen.

## [0.17.0] — 2026-05-28 "Jemisin"

### Added
- Column-width resize on every table — Directory, Workload, Planning + Rollup, RAID, Activity Log, Reports, Budget, Resources Report sub-tables, and the jira-conflicts + roles modal tables. Drag the right edge of any header to widen or narrow a column; widths persist per table in localStorage. Tall tables (Directory, Workload, Planning, RAID, Activity Log, Reports, Budget) gain a "Reset column widths" button in their toolbar.
- New version highlight: "Column widths now resizable" (`versionHighlightTableResize`) in both EN and DE.

### Changed
- Task form modal default height bumped to 900 px (clamped to 95 vh) with a 480 px floor — twice the previous content-driven height, still user-resizable via the modal's native resize handle.

## [0.16.2] — 2026-05-28

### Fixed
- Main app shell width: the layout cap moved from `max-w-6xl` (1152px) to 1536px so the app uses more of the viewport on large displays (≥1440px wide). One-line className change in `task-manager.tsx`.

## [0.16.1] — 2026-05-28

### Changed
- Resources panel: Directory / Planning / Report tables now share the Workload tab's table chrome — sticky uppercase header, consistent padding and density. Closes sub-project B from the 2026-05-27 batch (the AIPM design system + table consistency are now both complete across the app).

## [0.16.0] — 2026-05-28 "Butler"

### Changed
- Completed the AIPM design-system rollout (sub-project E): the final 16 menus + chrome + misc components — settings/jira/storage/export/help/version menus, notifications, chat panel, activity log, workspace section, voice button, read-only-mirror banner, page/error/markdown wrappers, effort-progress-bar — now use the surface-token foundation, the green accent on focus, dark-blue fills, and no shadows or gradients. The AIPM palette now covers the entire app.

### Added
- New version highlight: "Full AIPM palette rollout" (`versionHighlightPalette`) in both EN and DE.

## [0.15.7] — 2026-05-28

### Changed
- Continued the AIPM design-system rollout: the Gantt now uses the AIPM palette and surface tokens — consistent light/dark surfaces, no drop shadows; the High-severity bar icon switched from amber to purple (completing the priority ramp); absence column tints recoloured to the palette (vacation=blue, sick=pink, training=purple); overdue ring and the destructive button now in pink.

## [0.15.6] — 2026-05-28

### Changed
- Continued the AIPM design-system rollout: the RAID panel now uses the AIPM palette and surface tokens — consistent light/dark surfaces, no drop shadows, R/A/I/D category chips remapped (Risk=pink, Action=blue, Issue=purple, Decision=green), severity ramp recoloured cold-to-hot (Low=green, Medium=blue, High=purple, Critical=pink), RAG health dots in pink/purple/green, stale/aging indicators in purple, error box in pink.

## [0.15.5] — 2026-05-28

### Changed
- Continued the AIPM design-system rollout: the tasks table (including the task row, sticky headers and toolbar), the task-form input controls (combo, contact, labels, dependencies), the reports panel and the shared task-manager UI helpers now use the AIPM palette and surface tokens — consistent light/dark surfaces, no drop shadows, task-row priority chips remapped to the palette (Medium=blue, High=purple, Urgent=pink), and the reports RAG chart in pink/purple/green.

## [0.15.4] — 2026-05-28

### Changed
- Continued the AIPM design-system rollout: all editor modals (resource, shift, absence, roles, budget bucket, task, Jira conflicts, bulk edit) now use the AIPM palette and surface tokens — consistent light/dark surfaces, no drop shadows, destructive (Delete/Discard) actions in pink, and the task RAG status indicator mapped to pink (Risk) / purple (Amber) / green (Green).

## [0.15.3] — 2026-05-27

### Changed
- Continued the AIPM design-system rollout: the resource calendar now uses the AIPM palette — absence types in blue (vacation), pink (sick), purple (training) and grey (other), today highlighted in green, holidays in purple, weekends muted. Fixes a long-standing bug where the "today" highlight used an undefined color and rendered invisibly.

## [0.15.2] — 2026-05-27

### Changed
- Continued the AIPM design-system rollout: the Resources tabs (directory, workload, report, planning) and the Budget panel now use the AIPM palette and surface tokens — consistent light/dark surfaces, no drop shadows, and status colors mapped to the palette (overdue → pink, positive margins → green, absence overrides → purple).

## [0.15.1] — 2026-05-27

### Changed
- Began the AIPM design-system rollout: introduced semantic surface tokens (light & dark) and migrated the shared controls — segmented controls, modal headers, and the app header — to the AIPM palette (green accent, dark-blue fills, no drop shadows). A new `docs/DESIGN-TOKENS.md` documents the tokens and color rules. The remaining screens follow in later updates.

## [0.15.0] — 2026-05-27

### Added
- **Light / Dark / System theme.** A new theme control in Settings lets you pick light, dark, or follow your operating-system setting. Your choice is remembered on this device and applied instantly on load (no flash). Dark mode is now class-based and switchable, replacing the previous OS-only behavior.

## [0.14.3] — 2026-05-27

Assignee names in the resources calendar and planning grids are now clickable.

### Added

- **Clickable assignee names in Calendar and Planning.** Clicking an assignee
  name in the resources **calendar** or **planning** grid opens the resource
  edit modal directly (same hover style as the Directory and Workload tabs). In
  the **calendar**, clicking a name that does not yet match a resource opens
  **Add Resource** prefilled with that name (via `splitName`).

## [0.14.2] — 2026-05-27

RAID table columns are now sortable by clicking the header.

### Added

- **RAID header sorting.** Clicking a RAID column header cycles through
  ascending → descending → off. The "off" state restores the default order,
  which always keeps closed/terminal items at the bottom. Severity sorts by
  rank (Low → Medium → High → Critical); missing target dates sort last.
  Implemented in `raid-panel.tsx`; sort comparator lives in `compareRaid`
  (`raid.ts`).

## [0.14.1] — 2026-05-27

Global percent/hours utilization toggle in the resources planning header.

### Added

- **Global utilization-mode toggle.** A percent/hours segmented toggle in the
  resource-planning panel header (alongside the existing month/week granularity
  toggle) switches all resources between percent and hours mode in one click.
  Entered values are converted between units per-period using working hours
  (`convertUtilization` in `resource-capacity.ts`).

### Changed

- **Per-resource `onSetUtilizationMode` chain removed.** The never-used
  per-resource mode handler (prop-drilled from ResourcesPanel through the
  planning grid down to individual rows) has been deleted; the global header
  toggle supersedes it.

## [0.14.0] "Atwood" — 2026-05-27

Editable budget buckets: a draggable edit-bucket modal with a role picker,
wired to "Add bucket" and a new per-card Edit button.

### Added

- **Edit-bucket modal (`BudgetBucketModal`).** Draggable modal for editing a
  bucket's name, PO number, type (T&M / Fixed), currency, fixed-price amount,
  start/end dates, spillover successor, and manual FX-rate override — with
  full field validation.
- **Role picker inside the modal.** Add and remove role allocation lines; assign
  resources (capacity) per role directly within the editor.
- **Edit button on bucket cards.** Each existing bucket card now exposes an
  Edit button that opens `BudgetBucketModal` pre-populated for that bucket.
- **"Add bucket" opens the editor.** Creating a new bucket immediately opens
  `BudgetBucketModal` on the fresh shell instead of leaving an uneditable
  placeholder. Per-period hours are still edited in the panel grid.
- **Gantt task-name → open editor.** Clicking a task's name label in the
  Gantt chart opens the task editor modal for that task, consistent with
  the task-list row hover behaviour.

## [0.13.1] — 2026-05-27

Effort progress bar and task-form/UI polish within the Bradbury milestone.

### Added

- **Effort progress bar.** `EffortProgressBar` (`effort-progress-bar.tsx`) renders
  in the task editor (and wherever effort fields are visible). The bar fills
  left→right proportionally to time-spent vs original estimate; turns red and
  displays the percentage when time spent exceeds the estimate; shows greyed
  when no estimate is set. Ratio derived from the new `effortProgress` helper
  in `duration.ts`.

### Changed

- **Task form reflow.** Group field now sits beside the Last update date field.
  Original estimate and Time spent share a single row; the effort progress bar
  spans the full width beneath them.
- **Task list hover.** The row highlight-hover now applies to the ID cell and
  Task-name cell; the assignee column shows as plain text (no hover highlight).
- **Budget UI.** "Add bucket" button style now matches the "Add task" button.
  "Close" and "Remove" bucket buttons use the same highlight-hover style as
  resource-assignee controls.

## [0.13.0] "Bradbury" — 2026-05-27

UI polish batch: draggable modals with in-modal voice, task effort tracking,
removable/reorderable budget buckets, resource-planning fixes, sortable roles
columns, and a suite of small UX improvements across the app.

### Added

- **Draggable modal windows.** A shared `ModalHeader` component (`modal-header.tsx`)
  provides a drag handle on every modal. Drag logic lives in `use-draggable.ts`.
- **In-modal voice commands.** `VoiceCommandContext` (`voice-command-context.tsx`)
  makes the voice dispatcher available inside modals, so every modal now
  supports the same voice commands as the main view.
- **Task effort fields.** Optional "Original estimate" and "Time spent" fields
  on the task form, using `w/d/h/m` notation (Jira basis: 1w = 5d, 1d = 8h).
  New `duration.ts` helper parses and formats duration strings and round-trips
  with Jira minute values. "Est." and "Spent" columns in the tasks table are
  hideable and sortable.
- **Budget bucket removal.** Each bucket can now be deleted; any CCI/win-loss
  calculations based on a removed bucket reset to 0.
- **Budget bucket reorder.** Buckets support drag-to-reorder; the chosen order
  is persisted via a new `order` field on `BudgetBucket`.

### Changed

- **Tab order.** Budget now sits between Resources and Activity.
- **Assignee hover styling** unified across Directory, Workload, and Task views.
- **Resource planning — week view from month entry.** The "weeks" view now
  derives week capacity from the month-level entry (read-only when granularity
  is set to month), fixing the previously empty weeks display.
- **Resource planning — tooltips.** Explanatory tooltips added to rollup totals
  and the utilization input.
- **Roles & rates.** Discipline, Grade, Internal, and External columns are now
  sortable. A visual divider separates the rate card from the add-combo row.
  Discipline and Grade selects show a "—" placeholder. Manage-roles and Report
  buttons gained leading icons.
- **ECB "refresh rates" button** restyled to match the Jira-sync button, with a
  spinner while the fetch is in progress.

## [0.12.0] "Huxley" — 2026-05-26

Adds a project budget planner: named PO-line budget buckets (T&M or fixed-price)
that span roles, draw planned hours from the resource engine, track entered
actuals, and report a three-value CCI plus win/loss — with multi-currency
display backed by ECB rates and remaining-budget spillover on close.

### Added

- **Budget tab + planner.** Create budget buckets (name, PO number, type
  T&M/fixed-price, currency EUR/USD/GBP, start/end dates, successor). Each
  bucket holds per-role allocations (role + feeding resources + per-period
  budget/actual hours). `budget-panel.tsx`.
- **CCI panel (×3).** Contribution margin, cost performance, and consumption —
  each as amount + percent, at bucket and project level. Win/loss in hours and
  currency. Pure engine in `budget-report.ts`.
- **Planned-from-resources, actuals entered.** Planned hours derive from the
  existing resource capacity/utilization engine for the resources listed on each
  allocation; actuals are entered per bucket/role/period.
- **Spillover.** Closing a bucket rolls its remaining budget (hours + amount)
  into a named successor (computed, reversible on reopen).
- **Multi-currency via ECB.** New `/api/ecb` route fetches ECB daily reference
  rates (cached in the workspace); per-bucket manual rate override wins while
  present, else the cached rate, else EUR. `fx.ts`, `ecb.ts`, `use-fx-rates.ts`.
- **Bucket end-date reminders** via the existing reminder lead-time, surfaced as
  a toast (`getBucketReminders`).

### Changed

- **Workspace schema v6.** Additive `budgets` + `fxRates`, with an idempotent
  v5→v6 migration; full round-trip across IndexedDB, JSON, CSV, and Markdown,
  and inclusion in manual CSV/MD exports. `budgets`/`fxRates` are optional on
  the `Workspace` type for backward compatibility.

## [0.11.0] "Orwell" — 2026-05-26

Pop-out windows become read-only mirrors (closing a data-loss path), every
search/filter control gets a proper tooltip, and Jira gains token-expiry
reminders with clearer sync messages.

### Added

- **Jira token-expiry reminders.** Record your API token's expiry date in
  Settings → Jira ("Token expires on"). A banner warns when it is within your
  reminder lead time and once it has expired (`getJiraTokenAlert` in
  `jira-token-status.ts`, reusing the snooze/banner infrastructure;
  `ReminderKind` gains `"jiraToken"`). A 401/403 from a sync or Test-connection
  also raises the banner until a successful sync/test clears it.
- **Descriptive control tooltips.** Every search, filter, and sort control —
  and every field of the RAID edit modal — now has its own descriptive tooltip
  across Gantt, RAID, Resources, Activity, and Tasks (~40 new EN + DE strings).
  `SegmentedControl` gained an optional `title` passthrough.
- **Read-only mirror banner** in pop-out windows, plus `makeEditGuard`
  (`read-only-guard.ts`) and `ReadOnlyMirrorBanner` (`read-only-mirror-banner.tsx`).

### Changed

- **Pop-out windows are read-only mirrors.** They receive live state over
  `BroadcastChannel` but never broadcast and never persist. `useBroadcastSync`
  gained a `canSend` flag (the receive listener always registers; only the send
  effect is gated), and `use-storage-backend.ts` passes `canSend={!isPopout}` to
  all nine calls. Edit affordances are locked in pop-outs: commit handlers no-op
  with a toast, the chat dispatcher refuses mutating tools, and the Gantt "Add
  Task" button is hidden.
- **Clearer Jira sync messages.** `classifyJiraError` maps failures to
  actionable info messages — a recorded-past expiry blocks the sync ("paused"),
  401/403 → "token rejected", network/unreachable → "couldn't reach Jira" —
  while other HTTP errors keep the generic message. `JiraApiError` is now
  exported.
- **Tasks column headers** match the Resources directory header hover and gain a
  "Sort by …" tooltip (`SortableTh` gained a `lang` prop).
- **README** version badge → 0.11.0.

### Fixed

- **Data loss when closing a pop-out.** A pop-out's load no longer broadcasts its
  state to the main window (which then persisted it); combined with `writeHandle`
  now aborting the swap-temp on a blocked `write`/`close`, a Chrome
  security-policy-blocked write can no longer delete the local workspace file.
- **Leaking resize tooltip.** The "drag the bottom-right corner to resize this
  workspace pane" hint no longer appears on the Gantt/RAID/Resources/Activity
  search & filter controls (or the RAID modal fields): it was a `title` on the
  wrapping `<section>`, which HTML shows on any title-less descendant. Replaced
  with an inert corner glyph.

## [0.10.0] "Nabokov" — 2026-05-25

Everything built on top of the Resource Utilization release: a Resource
Address Book, a unified working-day-shifted reminder lead, and persisted
reminder snooze — plus two data-integrity fixes and a project-wide lint pass.

### Added

- **Resource Address Book.** `Resource` splits the single `name` into
  `firstName` / `lastName` and gains contact fields: title, business phone,
  location, department, email, company, birthday (month-day only), and
  free-text notes (`splitName` / `resourceDisplayName` in
  `resource-foundation.ts`).
- **Four-tab Resources pane** — Directory | Workload | Calendar | Planning.
  The new **Directory** tab (`resource-directory.tsx`) is an address-book
  table (one row per resource); clicking a name opens the resource edit modal
  (`resource-edit-modal.tsx`) with all address-book fields, and "+ Add
  resource" creates a new entry. The **Workload** tab is rekeyed to managed
  resources with a separate "Unlinked" group for assignees that have no
  resource (`resource-workload-rows.ts`, `buildResourceWorkload`).
- **Address-book pop-out window** — an "Open address book" button launches the
  Directory in its own window (`?popout=address-book`), live-synced via the
  existing `BroadcastChannel` plumbing.
- **Birthday reminders** — `getUpcomingBirthdays` (year-wrap aware) drives a
  banner plus a once-per-load toast.
- **Create a contact from the task form** — a "+" beside the Assignee opens the
  address-book add-entry modal seeded with the typed name/email; saving creates
  the resource and fills the task's assignee.
- **Persisted reminder snooze** — both reminder banners (due-date + birthday)
  gain a Snooze control (In 1 hour / In 1 day), stored per-kind in
  `localStorage` (`reminder-snooze.ts`, `useReminderSnooze`) and re-shown
  automatically when it elapses. While snoozed, the banner is hidden and the
  load toast is suppressed.

### Changed

- **Unified reminder lead with working-day shift.** A single "days ahead"
  control (`reminderLeadDays`) replaces the separate birthday lead-days and
  due-date work-day threshold. A reminder whose trigger would fall on a
  weekend, holiday, or absence day is shifted earlier onto the prior working
  day so it fires during the work week (`shiftToWorkingDay` / `absenceDayMap`
  in `due-dates.ts`; settings migrated in `use-settings.ts`).
- **Shared `localeFor` / `shortDateRange`** extracted into `date-format.ts`.
- **README** version badge → 0.10.0; Resources / Notifications feature rows
  updated.

### Fixed

- **Pop-out data loss** — a pop-out window broadcast its initial (empty) state
  on mount, which the main window then persisted, truncating the synced file.
  Windows no longer broadcast their first value (`broadcast-sync.ts`).
- **Soft-archive round-trip** — `active="false"` on a serialized resource is
  now honored on load instead of coercing back to `true`.
- **File-picker stickiness** — each local format (JSON / CSV / Markdown)
  carries its own picker `id`, so switching formats no longer reopens the
  previous format's picker.
- **Workload tab double render** — empty-state and empty-table no longer both
  render.
- **Toast freshness** — the once-per-load due/birthday alert reads the holiday
  set + absences via refs so the toast matches the (reactive) banner.

### Quality

- **ESLint: 75 → 0 problems, no config weakened.**
  `react-hooks/set-state-in-effect` prop-sync effects rewritten with the
  set-during-render previous-value pattern; genuine SSR-hydration effects kept
  with documented disables; render-time `useRef` writes moved into effects
  (`filters-context.tsx`, `task-manager.tsx`); test mocks typed properly and
  hook-calling test helpers renamed `probe → useProbe`; unused vars + stale
  `eslint-disable` directives removed; Gantt bar resize handles
  `role="slider"` → `role="button"`.

### Tests

- New test files for birthdays (`birthdays.test.ts`), the address-book workload
  rekey (`resource-workload-rows.test.ts`), the `date-format` helpers, and
  reminder snooze (`reminder-snooze.test.ts`, `use-reminder-snooze.test.tsx`).
  Full suite green: 389 tests across 54 files.

## [0.9.0] "Mann" — 2026-05-24

Resource Utilization feature — turns the Resources tab from a derived
read-only view into a first-class capacity & cost planner. Built spec-first
across five phases (foundation → roles & rates → capacity engine →
cost layer → report pop-out) plus a polish round.

### Added

- **First-class `Resource` entities** with two-dimensional `Role`
  (discipline × grade) carrying internal/external hourly rates. Seeded
  presets — disciplines: Developer / Business Analyst / Consultant /
  Project Manager; grades: Junior / Associate / Consultant / Senior /
  Lead / Principal. Both lists are editable (add custom, rename) and
  `Role` combos are created on demand when a resource is assigned.
- **Roles & rates manager modal** (`roles-modal.tsx`) — discipline × grade
  rate card with editable internal/external rates and on-demand role
  creation; opened from the Resources tab header.
- **Per-resource role assignment** in the Resources roster (controlled
  discipline + grade selects per resource).
- **Editable per-period Planning grid** (third view in the Resources tab):
  - Per-resource utilization input per period (week or month).
  - Percent mode (0–100) or hours mode (per resource).
  - Per-row capacity totals (days).
  - Per-cell absence override (auto-derived hours as placeholder; clearing
    reverts to auto).
  - Planning-window date controls (From / To) and week/month granularity
    switch.
- **Capacity engine** (`resource-capacity.ts`, pure) — period generation
  (calendar months + ISO weeks Mon–Sun), workdays minus weekends and
  holidays, absence accounting (auto from the `Absence` entity or manual
  override), and the capacity formula:
  - percent mode: `(util / 100) × max(0, possibleHours − absenceHours)`
  - hours mode: `max(0, util − absenceHours)`
- **Cost layer** (`resource-cost.ts`, pure) — `internalCost = hours × rate`,
  `externalCost = hours × rate`, `margin = external − internal`. Internal /
  external / margin columns + footer totals in the Planning grid;
  formatted via `Intl.NumberFormat(locale, { currency })` from
  `plan.currency`.
- **Read-only week ↔ month rollup table** in the Planning view — toggles
  the non-canonical granularity as a read-only re-bucketing, leaving the
  canonical editable grid untouched.
- **Resources report pop-out** (`resources-report.tsx`) — read-only report
  launched via a "Report" button in the Resources header. Summary tiles
  (total capacity, internal cost, external cost, margin), per-period
  table, per-discipline / per-grade / per-role-combo breakdowns, and a
  per-resource table (role, avg utilization, capacity, costs).
  Unassigned-role resources are flagged and excluded from the breakdowns
  (still counted in capacity totals). Opens as a separate window via
  `?popout=resource-report`; live cross-window data sync via the existing
  `BroadcastChannel` plumbing.
- **`workdayHours` setting** (default `8`) under Settings → Resources.

### Changed

- **Storage schema → v5.** `Workspace` now also carries `resources`,
  `roles`, `disciplines`, `grades`, and a `plan` singleton
  (`ResourcePlan { startDate, endDate, granularity, currency }`). Four
  new IndexedDB stores (`resources`, `roles`, `disciplines`, `grades`)
  plus a `resource-plan` entry in the existing `kv` store. CSV /
  Markdown / JSON file backends gain matching sections; the dynamic
  `utilization` / `absenceOverride` maps serialize as a single encoded
  cell via the new period-map codec.
- **Additive `resourceId?` on `Task` and `Absence`** — the free-text
  `assignee` is preserved as the display value, the Jira-sync field, the
  search/filter key, and a fallback join. `resourceId` is authoritative
  when present (Approach A — non-destructive).
- **Idempotent v5 migration** (`migrateWorkspaceV5`) — seeds preset
  disciplines/grades and a default plan, and on first load backfills one
  `Resource` per distinct case-folded `assignee` across tasks + absences,
  stamping `resourceId` onto those records. Re-running over a populated
  workspace is a no-op (reference equality).
- **`Resource Planner` Features row in the README** updated to reflect
  the new roles, planning grid, capacity/cost, rollup, and report.
- **Storage Backends row** updated to schema v5 + new stores.
- **`src/app/version.ts`** — `APP_VERSION` `"0.9.0"`, `APP_BUILD_DATE`
  `2026-05-24`, prepended highlight comment.
- **CODEMAPS** (`architecture.md`, `frontend.md`, `data.md`) refreshed for
  the new entities, schema v5 layout, new modules, and the
  resource-report popout target. `backend.md` / `dependencies.md`
  freshness-only (no API routes or runtime/dev deps added).

### Fixed

- Two long-standing pre-existing `tsc` errors in test fixtures
  (`settings-menu.test.tsx`: self-referential `makeProps` type;
  `use-due-alerts.test.ts`: stale `StorageConfig` shape). Project now
  type-checks fully clean (`npx tsc --noEmit` → 0 errors).

### Tests

- **`resource-capacity.test.ts`** — 13 tests including the Excel golden
  fixture from `docs/patterns/Book1.xlsx`: Andre Weiß, Feb 2026 (20
  workdays), 95 % utilization, 5.5-day absence override (44 h) →
  `110.2 h` / `13.775 days` — matches the spreadsheet's `D4 = 13.775`.
- **`resource-cost.test.ts`** — 5 tests (percent/hours costs, unassigned,
  currency formatter incl. invalid-code fallback).
- **`resource-foundation.test.ts`** — 7 tests (preset seeding, default
  plan window, assignee backfill, `findRoleByCombo`, `roleLabel`,
  `nextId`).
- **`resource-report.test.ts`** — 2 tests (totals + breakdowns for an
  assigned resource; unassigned excluded from breakdowns but counted in
  totals + per-resource).
- **`storage-serialization.test.ts`** — 4 tests (v5 migration idempotency
  + assignee backfill; CSV and Markdown round-trip preserve all new
  entities including encoded period maps).
- **`sanitize.test.ts`** — extended for period-map codec, `sanitizeResource`
  (object + encoded-string map forms, percent / hours clamping), `Role`,
  `Discipline`, `Grade`, and `sanitizePlan`.
- **`resources-panel.test.tsx`** — 10 tests covering the planning view's
  edit flow, "Manage roles" + "Report" buttons, per-resource role
  assignment, planning-window control, absence-override editing, and the
  read-only rollup toggle.
- **`roles-modal.test.tsx`** — 3 tests for the rate card.
- **`resources-report.test.tsx`** — render test for tiles, breakdowns,
  and the per-resource table.
- **`use-resource-planner.test.tsx`** — extended to 32 tests (added: role
  CRUD + on-demand creation, discipline/grade add/rename, utilization
  set, mode switch, absence override set/clear, plan window/granularity
  setters).

Full suite: 296 tests across 43 files, all green.

## [0.8.4] "Lorca" — 2026-05-22

### Refactored
- Extract `AppModals` from `task-manager.tsx`: renders `DueBanner`, `TaskFormModal`, `DueDatesModal`, `JiraConflictsModal`, `AbsenceEditModal`, `ShiftEditModal`, `<footer>`, and toast
- `TasksSection` builds `rowContextValue` internally: calls `useSettings()` + `useHolidaySet()`; receives 8 row-handler callbacks + `jiraSiteUrl` as explicit props instead of a single opaque `RowContextValue` prop
- `task-manager.tsx`: −~140 lines

## [0.8.3] "Kafka" — 2026-05-22

### Refactored
- Extract `WorkspaceTabContext` (`TopTab` type + `WorkspaceTabProvider` + `useWorkspaceTab` hook) from `task-manager.tsx`
- Extract `AppHeader` component (app `<header>` block, ~90 lines) from `task-manager.tsx`
- Extract `WorkspaceSection` component (workspace `<section>` block, ~250 lines) from `task-manager.tsx`
- `useTaskRowHandlers` now reads `setActiveTab` from `WorkspaceTabContext` instead of receiving it as a prop
- `task-manager.tsx`: −377 lines (1,038 → 661)

## [0.8.2] "Joyce" — 2026-05-21

Extract `TabButton`, `Th`, `SortableTh`, `ResetSizeIcon`, `ResetColWidthsIcon`,
`EraserIcon` to `task-manager-ui.tsx` and the entire tasks `<section>` JSX to
`tasks-section.tsx`. `TasksSection` reads `useFilters()`, `useWorkspace()`, and
`useTaskForm()` from providers internally; receives 31 explicit props for state
that originates outside those contexts (column manager, resizable table, row
state, Jira, task actions, bulk operations). 3 smoke tests. `task-manager.tsx`
−520 lines; now ~1,049 lines. Slice 14 of the decomposition.

## [0.8.1] "Ibsen" — 2026-05-21

### Refactored
- Extracted `useTaskSubmit`: error state, `handleSubmit` (validation + create/update + Jira push), `handleCancelEdit`, `openEditModal`
- Extracted `useGanttHandlers`: `handleGanttBarUpdate` (drag-edit with start ≤ due clamping)
- Circular dep resolved via `onPushToJiraRef` forwarding-ref pattern (mirrors `handleCancelEditRef` in slice 12)
- Dropped dead sanitize imports and `upsertContact` from `task-manager.tsx`
- `task-manager.tsx` −165 lines; 8 new unit tests

## [0.8.0] "Hemingway" — 2026-05-21

### Refactored
- Extracted `useHolidaySet`: async holiday load with cancellation flag
- Extracted `useTaskRowHandlers`: 9 row callbacks + `expandedNotes`/`pushingIds` state
- Eliminated `handleEdit` duplicate; `useBulkOperations` consumes `onEdit` from hook
- Removed dead `settingsRef`/`todayRef` (leftover from Slice 11)
- Exported `TopTab` from `task-manager.tsx` for hook type sharing
- `task-manager.tsx` −120 lines; 9 new unit tests

## [0.7.9] "García" — 2026-05-21

### Refactored
- Extracted `useToast` hook: toast state, `showToast` factory, auto-dismiss timer
- Extracted `useDueAlerts` hook: banner/modal state, session-once due-date alert effect
- `task-manager.tsx` net −48 lines

## [0.7.8] "Faulkner" — 2026-05-21

### Refactored
- Extracted `useColumnManager` hook (~110 lines): column widths, hidden columns, column-config dropdown, resize-drag interaction; localStorage load/persist (debounced 250 ms for widths)
- Extracted `useContacts` hook (~45 lines): contacts address-book lifecycle, seed-from-tasks on first load, localStorage load/persist
- Extracted `useWorkspaceCollapsed` hook (~25 lines): workspace-panel collapsed boolean, localStorage load/persist
- `task-manager.tsx` ~−175 lines; now ~2,010 lines

### Tests
- `use-column-manager.test.ts`: 7 tests — initial state, localStorage hydration, resetColWidths, debounced persistence
- `use-contacts.test.ts`: 4 tests — initial state, hydration gate, localStorage load, handleRemoveContact
- `use-workspace-collapsed.test.ts`: 4 tests — initial state, localStorage load, persist true/false

## [0.7.7] "Elias" — 2026-05-20

### Refactored
- Extracted `useSettings` hook (~100 lines): settings state, localStorage load/persist, `hydrated` + `i18nReady` gates, i18n loading
- Extracted `useActivityLog` hook (~50 lines): activity log state, localStorage load/persist, `logActivity`, `handleClearActivityLog`
- `task-manager.tsx` ~−150 lines; now ~2,145 lines

### Tests
- `use-settings.test.ts`: 6 tests — initial state, hydration gates, localStorage load/persist
- `use-activity-log.test.ts`: 6 tests — state-init, logActivity append, handleClearActivityLog confirm variants

## [0.7.6] "Duras" — 2026-05-20

### Refactored
- Extracted `useResourcePlanner` hook (~350 lines): RAID CRUD, absence CRUD (with modal state), shift CRUD (with modal state), `handleCreateMitigationTaskFromRaid`
- Extracted `useBulkOperations` hook (~270 lines): `selectedIds` state, bulk edit, `handleCommand` (voice dispatcher), `handleClearAll`, `handleBulkSendInquiry`
- `task-manager.tsx` −518 net lines; now ~2,295 lines

### Tests
- `use-resource-planner.test.tsx`: 13 tests — modal state, RAID/absence/shift CRUD, auto-issue on Risk→Realized, mitigation-task creation
- `use-bulk-operations.test.tsx`: 13 tests — selection toggle, bulk edit validation, clearAll confirm, handleCommand dispatch, bulk inquiry mailto

## [0.7.5] "Calvino" — 2026-05-20

Internal refactor. Slice 7 of the task-manager.tsx decomposition extracts
the storage backend logic into a dedicated useStorageBackend hook, and
widens WorkspaceContext (Phase A) to own raid, absences, and shifts state.
Net: task-manager.tsx −164 lines.

### Refactored

- **useStorageBackend hook** (`src/app/use-storage-backend.ts`): ~167 lines
  moved from task-manager.tsx. Owns all storage, broadcast-sync, and
  file-handler logic.
- **WorkspaceContext** widened (Phase A) to own `raid`, `absences`, and
  `shifts` state so downstream consumers can read these without prop-drilling.
- **task-manager.tsx** −164 net lines; all storage, broadcast-sync, and
  file-handler logic now lives in the hook.

### Tests

- `use-storage-backend.test.tsx`: 14 tests covering state-init, load effect,
  save effect, and file handlers.
- `workspace-context.test.tsx`: assertions for new raid/absences/shifts
  defaults.
  Suite total: 110+ tests.

## [0.7.4] "Bradbury" -- 2026-05-20

Internal refactor. Slice 6 of the task-manager.tsx decomposition extracts
the Jira sync logic into a dedicated useJiraSync hook, reducing
task-manager.tsx by ~315 lines.

### Changed (internal)

- **useJiraSync hook** (src/app/use-jira-sync.ts): owns jiraSyncing +
  jiraConflicts state, handleJiraSync, and handleResolveConflicts. Reactive
  values (tasks, settings, lang, today) routed through refs so useCallback
  deps stay [showToast, logActivity] only.
- **loadJiraApi** lazy-load cache moved from task-manager.tsx to
  use-jira-sync.ts and re-exported for onPushToJira.
- **task-manager.tsx** calls useJiraSync({ settings, today, lang, showToast,
  logActivity }) and destructures the five return values.
  Net: -303 lines (3289 -> 2986).

### Tests

- 12 new unit tests in src/app/use-jira-sync.test.tsx covering state-init,
  no-credentials guard, jiraSyncing flip, pull, push, conflict detection,
  create-issue, error toast, and conflict resolution paths.
  Suite total: 96 tests across 13 files.

## [0.7.3] "Adams" — 2026-05-20

Internal refactor + a visible performance win. Slice 5 of the
`task-manager.tsx` decomposition extracts the Claude chat-tool dispatcher
into its own custom hook with a stable identity, which lets us memoize
`ChatPanel`. The chat panel no longer re-renders on every task-form
keystroke.

### Changed (internal — single user-visible side effect)

- **`useChatDispatcher` hook** (`src/app/use-chat-dispatcher.ts`): consumes
  `useWorkspace` / `useTaskForm` / `useFilters` directly. Four internal
  refs (`tasksRef`, `settingsRef`, `todayRef`, `editingIdRef`) absorb every
  reactive value the dispatcher reads, so the `useMemo<ToolDispatcher>`
  has empty deps and its identity never changes after first render. The
  dispatcher synchronously updates `tasksRef.current` before calling
  `setTasks` so back-to-back chat tool calls in one turn see each other's
  writes.
- **`task-manager.tsx`** now calls `useChatDispatcher({ settings, today,
  setSelectedIds, setSettings })` instead of inlining ~240 lines of refs,
  helpers, and the dispatcher `useMemo`. Net: −228 lines (3517 → 3289).
- **`ChatPanel` wrapped in `React.memo`** (`src/app/chat-panel.tsx`).
  Combined with a `useCallback` for `onAcceptConsent` and the now-stable
  dispatcher, all four `ChatPanel` props are reference-stable for any
  parent re-render that doesn't change `lang` or `settings.ai` — so the
  Chat tab skips re-renders during, e.g., task-form input. **This is the
  visible performance win.**

### Added

- **`src/app/test-providers.tsx`** — small test helper composing
  `FiltersProvider` → `WorkspaceProvider` → `TaskFormProvider`, with a
  one-shot `Seeder` child for initial tasks. Used by the new hook tests.
- **15 unit tests for `useChatDispatcher`** covering each of the 10
  dispatcher methods plus two identity-stability tests that pin the
  empty-deps invariant the slice is designed around. Test count: 69 → 84.

### Moved (small refactor opportunities exposed by extraction)

- `isValidEmail` moved from a private function in `task-manager.tsx` to
  an exported member of `src/app/sanitize.ts`. Behaviour identical at all
  10 existing call sites.
- `greetingName` moved from a private function in `task-manager.tsx` to
  an exported member of `src/app/contacts.ts` (also pulled in
  `isValidEmail` from `./sanitize`). Behaviour identical at all 3
  existing call sites.

### Fixed

- The "ChatPanel memoization (gated on dispatcher useMemo deps audit)"
  open item in `.reports/codemap-diff.txt` is now closed. The dispatcher's
  `editingId` dep — the last reactive value preventing identity
  stability — is routed through `editingIdRef.current`.

## [0.7.2] "Banks" — 2026-05-19

Activity-log confirm dialog, three Rules-of-Hooks / hydration bug fixes,
and a large internal refactor that cut `task-manager.tsx` by ~700 lines
without changing any user-visible behaviour.

### Added

- **Activity log — confirm before clear**: "Clear log" now shows a native
  `window.confirm` dialog with the entry count before wiping. Consistent
  with the existing confirm-before-delete pattern on "Delete all tasks"
  (`handleClearAll`) and single-task delete (`handleDelete`). Help text
  updated in EN and DE.
- **Next.js 16 error boundaries** (`src/app/error.tsx`,
  `src/app/global-error.tsx`): React 19 render-error boundaries.

### Fixed

- **Rules of Hooks — `TaskManagerInner`**: `rowContextValue useMemo` was
  declared after the `!i18nReady` early return; moved before the gate so
  the hook count is stable across renders.
- **Rules of Hooks — `ReportsPanel`**: `groupHealth useMemo` was declared
  after the `stats.total === 0` early return; same fix.
- **Hydration mismatch on `<html>`**: added `suppressHydrationWarning` to
  `layout.tsx` to silence false mismatches when browser extensions (e.g.
  LanguageTool) inject attributes before React hydrates.

### Changed (internal — no user-visible behaviour change)

- **Slice 4 — modal extraction**: `TaskFormModal` (~491 lines) and
  `BulkEditModal` (~354 lines) extracted from `task-manager.tsx` into
  standalone files with component-level tests. Net −707 lines from the
  god-component.
- **Slices 1–3 — context extraction**: `FiltersProvider`,
  `WorkspaceProvider`, and `TaskFormProvider` pulled out of
  `task-manager.tsx` into dedicated context files, each with full test
  coverage.
- **Slice 2b — `TaskRow` extraction**: the per-row `<tr>` and its
  sub-components (`TaskActions`, `NotesCell`, `DependencyChips`,
  `RaidBadge`) extracted into `src/app/task-row.tsx` with `React.memo`
  isolation.
- **Shared `<Modal>` shell** extracted from duplicated modal JSX into
  `src/app/modal.tsx`.
- **`useDebounce` hook** extracted into `src/app/use-debounce.ts`.

## [0.7.1] "Kennedy" — 2026-05-17

Developer test scaffolding. Dev-only change — no user-visible behavior
difference vs 0.7.0.

### Added

- **Vitest** unit/component test runner. Config: `vitest.config.ts` (jsdom env, `@` path alias, `@vitejs/plugin-react`); setup: `vitest.setup.ts` (registers `@testing-library/jest-dom` matchers, RTL cleanup). Tests live alongside their sources as `src/**/*.test.{ts,tsx}`. v8 coverage threshold at 80% for lines / functions / branches / statements.
- **Sample unit tests**: `src/app/sanitize.test.ts` (14 cases), `src/app/due-dates.test.ts` (6 cases), `src/app/segmented-control.test.tsx` (3 cases).
- **Playwright** E2E runner. Config: `playwright.config.ts` (Chromium-only by default; Firefox / WebKit commented in). Auto-starts `npm run dev` on port 3000; reuses an existing local dev server. Traces, screenshots, and video retained on failure. Tests live in `e2e/**/*.spec.ts`.
- **Sample E2E test**: `e2e/smoke.spec.ts` — root page loads, title matches, `<main>` visible.
- **Scripts**: `npm run test`, `test:run`, `test:coverage`, `e2e`, `e2e:ui`, `e2e:install`.
- **`.gitignore`**: `/test-results`, `/playwright-report`, `/playwright/.cache`, `/blob-report`.
- **8 new devDependencies**: `vitest`, `@vitest/coverage-v8`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `@playwright/test`. No runtime deps added.

### Changed

- `README.md` and `CONTRIBUTING.md` scripts tables extended with the six new commands.
- `CONTRIBUTING.md` "Testing" section rewritten from "there is currently no test suite" to describe the new Vitest + Playwright setup.
- `src/app/version.ts` comment block prepended with a 0.7.1 entry; `APP_BUILD_DATE` unchanged (already today).

### Not changed (intentional)

- In-app `HelpMenu` and `APP_HIGHLIGHT_KEYS`. Test infrastructure is developer-facing; end-user help and version popover stay focused on user features.

## [0.7.0] "Heinlein" — 2026-05-17

Resource Planner + Activity Log release. Adds per-assignee absences and
shift patterns, a chronological CRUD audit log, a persisted contacts
address book, and a per-request CSP nonce middleware. Also lands
SharePoint storage backend stubs (UI present, MSAL not yet wired).

### Added

- **Resource planner** (Phases 1–4): per-assignee absences (vacation / sick / training / other), weekly shift patterns, and a 30-day calendar view. New `Absence` and `Shift` types in `src/app/types.ts`; new IndexedDB stores `absences` (v3) and `shifts` (v4).
- **Activity log**: chronological CRUD record for tasks, RAID, absences, and shifts. 21 `ActivityKind` values; capped at 500 entries; persisted to `localStorage` key `lop-app:activity-log` and explicitly excluded from any file export.
- **Contacts address book**: persisted to `localStorage` key `lop-app:contacts`; capped at 500 entries; survives task deletion and Jira sync churn.
- **Per-request Content-Security-Policy nonce** via Next.js 16 middleware (`src/proxy.ts`). `script-src` and `style-src-elem` are nonce-strict in production; `style-src-attr 'unsafe-inline'` is retained for React inline `style={{...}}` props. `connect-src` whitelists `https://api.anthropic.com`.
- **SharePoint storage backend stubs** (`sp-json`, `sp-csv`). Surfaced as "Coming soon" in Settings; factory returns a stub that throws `StorageNotImplementedError("sharepoint-coming-soon")`. No MSAL/Graph SDK pulled in yet.

### Changed

- ADF (Atlassian Document Format) ↔ plain-text conversion extracted from the Jira proxy helpers into `src/app/adf.ts` so the client-side import/export paths can share it without dragging server-only code into the browser bundle.
- Hand-rolled STORE-method ZIP writer extracted from `export-ooxml.ts` into `src/app/zip.ts`.
- Version metadata (`APP_VERSION`, `APP_BUILD_DATE`, `APP_HIGHLIGHT_KEYS`) extracted from `version-menu.tsx` into a dedicated `src/app/version.ts`.
- `src/app/page.tsx` now `await connection()` so the CSP nonce attached at SSR matches the runtime middleware header.
- `next.config.ts` now only emits the static security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`); the CSP moved out to `src/proxy.ts` because per-request nonces aren't supported in static `headers()`.
- All six workspace panels (Chat, Reports, Gantt, RAID, Resources, Activity) now load via `next/dynamic({ ssr: false })`; modals (`JiraConflictsModal`, `AbsenceEditModal`, `ShiftEditModal`) also dynamic-imported.

## [0.6.0] "Asimov" — 2026-05-15

May 2026 performance refactor. (Quoted from `src/app/version.ts`:
"0.6.0 captures the May 2026 performance refactor".)

### Changed

- **Lazy-loaded heavy modules**: OOXML export, German i18n dictionary, `date-holidays` (+ moment / moment-tz).
- **IndexedDB record-level storage** for tasks and RAID — saves diff per record against an in-memory baseline using reference equality; only changed records are written. One-time migration from legacy `localStorage` keys (`lop-app:tasks`, `lop-app:raid`).
- **Debounced search** (150 ms) with a precomputed lowercase task index; **column-width writes debounced 250 ms**.
- **Memoized RAID panel** (`React.memo` + stable `useCallback` handlers).
- **Conditional mount of Gantt and Reports tabs** instead of always-mounted.

## [0.5.0] "Clarke"

Prior feature-accretion milestone. (Quoted from `src/app/version.ts`:
"0.5.0 was the prior feature-accretion milestone".)

### Added

- Claude chat panel with tool calls for task CRUD.
- Voice commands via Web Speech API (English + German).
- Due-date notifications: banner, toast, and popup alerts.
- Reports tab.
- Labels and groups on tasks; bulk edit.
- Bidirectional Jira sync (pull + push) with conflict resolution.
- ADF (Atlassian Document Format) ↔ notes round-tripping.
- Resizable + collapsible workspace, resizable tasks table, header "+" task modal.

## [Unreleased]

_No unreleased changes._

[0.10.0]: # (no tag)
[0.9.0]: # (no tag)
[0.8.4]: # (no tag)
[0.8.3]: # (no tag)
[0.8.2]: # (no tag)
[0.8.1]: # (no tag)
[0.8.0]: # (no tag)
[0.7.9]: # (no tag)
[0.7.8]: # (no tag)
[0.7.7]: # (no tag)
[0.7.6]: # (no tag)
[0.7.5]: # (no tag)
[0.7.4]: # (no tag)
[0.7.3]: # (no tag)
[0.7.2]: # (no tag)
[0.7.1]: # (no tag)
[0.7.0]: # (no tag)
[0.6.0]: # (no tag)
[0.5.0]: # (no tag)
[Unreleased]: # (no tag)