// 0.55.0 "Clarke" is a UI-refinement batch plus stakeholder communication
// reminders. UI: the i18n DE bundle is audited for literal-UTF-8 umlauts (a new
// encoding guard test); the dashboard Save/Clear buttons move beside the status
// text in the chat-input layout; the RACI legend is restyled; the app is rebranded
// "Project Management Tracker"; the stakeholder register gains Resources-Workload
// row hover, a dark-mode palette, and a chat-sized influence/interest matrix; the
// Milestones panel gains resizable columns, name+status filters, a Gantt-style add
// button, and workload hover (new pure filterMilestones helper); and the sidebar
// shows a current-mode pill. Stakeholder comms: RaidItem and ChangeItem gain an
// optional stakeholderIds link (mode-gated multi-select in both editors); a new
// pure stakeholder-comms.ts engine derives "reach out" reminders from a quadrant
// engagement policy (manage-closely stakeholders before due-soon milestones, open
// RAID items, and pending changes), surfaced via a banner, modal, once-per-load
// toast, and a Notifications settings toggle with snooze. Every comms source is
// silent when its module (stakeholders / milestones / RAID / changes) is off. New
// modules: stakeholder-comms.ts, use-stakeholder-comms.ts, milestones.ts helper.
// 0.54.0 "Herbert" ships Simple / Modular / Advanced mode. A new Settings →
// Mode section lets users pare the app down to Tasks, Chat, and Reports
// (Simple preset) and re-enable individual modules via per-module checkboxes
// (Modular), or keep everything on (Advanced). Explicit Save triggers a page
// reload so nav and automation settle on the new feature set. Disabled modules
// retain all data but pause automation: RAID-review alerts and Turso snapshot
// capture stop; the dashboard hides its top-band Budget and Scope pills and any
// section whose data source is off; the Gantt hides milestone overlays; the
// Change → RAID link control disappears from the change editor; the Reports
// picker and report cards respect the enabled set. Navigation is gated in both
// the modern sidebar and the classic tab strip. The default mode is Advanced
// (all modules on) and legacy settings migrate automatically. New modules:
// feature-modules.ts, settings-sections/mode-section.tsx.
// 0.53.0 "Asimov" is a stakeholder + UI refinement batch. A new addable
// Stakeholder report (summary tiles, influence/interest quadrant grid, RACI
// coverage with missing/multiple-Accountable warnings, and a register table)
// joins the Reports view. The stakeholder editor replaces the influence and
// interest dropdowns with a single clickable 3x3 matrix (X=interest,
// Y=influence) adapted from the RAID risk matrix — one click sets both. The
// RACI matrix and influence/interest map are now drag-resizable panes; the
// dashboard status summary gains a Clear button (clears + persists empty); the
// Change Log and Stakeholder add buttons are prefixed/labelled "+". The sample
// workspace now seeds milestones, stakeholders, and RACI so every stakeholder
// view is demonstrable out of the box. New modules: influence-interest-matrix.tsx,
// stakeholder-report-panel.tsx.
// 0.51.0 "Pratchett" adds RAID review reminders and a RAG/UI polish batch.
// A new pure raid-review.ts flags active RAID items overdue for review — past
// their target date or not reviewed within a configurable interval (a new
// Notifications setting, default on, 14-day interval) — surfaced via a banner,
// modal, and once-per-load toast nudge. Dashboard RAG polish: colorized R/A/G
// counts, RAG bubbles on the budget-burn tiles, boxed Progress + Budget-burn
// sections, and an explicit Save button + last-updated label on the status
// summary. The Budget Report gains a burn-down caption plus RAG bubbles on the
// Plan(h) / Actual(h) / Revenue figures. Reports can now remove an added report
// via a dropdown (alongside the × button). Chat: the reset-size button moves
// left (centered) and the input height matches the Send/Clear button stack.
// Help gains full-text search with section filtering, match highlighting, and
// jump-to-first-match (new pure help-search.ts). New modules: raid-review.ts,
// help-search.ts.
// 0.50.0 "Sanderson" adds a change-control Log: a RAID-sibling register of change
// requests. Each ChangeItem carries a type (Scope/Schedule/Cost/Quality/Other), a
// 6-state workflow (Proposed/Under Review/Approved/Rejected/Implemented/Deferred),
// an impact rating (reusing the RAID severity scale) with optional schedule-day and
// cost figures, requestor/approver + auto-filled decision date, and links to both
// tasks and RAID items. A sortable/filterable panel + draggable edit modal, a
// printable Change Report, and a Changes nav entry (Registers group) join the
// register; the new Workspace.changes entity round-trips through every backend
// (schema v7 additive migration). The dashboard gains its first computed Scope
// signal (Amber with any pending change, Red at a backlog threshold; manual
// override still wins) plus a Changes subsection. New modules: change-log.ts,
// change-panel.tsx, change-edit-modal.tsx, change-report-panel.tsx, use-change-log.ts.
// 0.49.1 polishes the Trends feature: the burn-down/KPI trend-chart gap-count
// caption is now localized (EN/DE) instead of English-only, and the Turso
// integration settings show a warning when snapshot recording is enabled but no
// Turso database URL is configured (auto-capture would otherwise fail silently).
// 0.49.0 "Le Guin" adds Baseline + Variance / Burn-down Trends. When the active
// storage backend is Turso, the app captures periodic KPI snapshots (remaining
// hours/cost, % complete, forecast end date, SPI/CPI, the four RAGs, and the
// per-period burn-down series) into dedicated append-only Turso tables, separate
// from the workspace save cycle. A new Trends view (Overview group) shows a
// baseline-vs-current variance table, KPI trend charts, and the snapshot list;
// the baseline defaults to the first snapshot and can be re-flagged. Capture is
// automatic once per cadence bucket (weekly default; daily/monthly configurable)
// plus a manual "Capture snapshot now" button. Switching away from Turso warns
// that recording stops but is retained, and resumes on switch back; missing
// cadence buckets render as highlighted gaps. New pure modules: turso-pipeline.ts
// (shared HTTP runner), snapshot.ts, snapshot-schema.ts (append-only tables,
// disjoint from the workspace TABLE_NAMES), snapshot-store.ts; the use-snapshots
// hook and trend-chart.tsx / trends-panel.tsx UI.
// 0.48.0 "Tchaikovsky" is a UI-refinements batch. Burn-down charts gain
// currency symbol + axis tick labels (hours / EUR). The dashboard prints
// with print-safe RAG colors, colorized Overall health text, Progress and
// Budget section captions, and a RAG thresholds legend on every print card.
// Margin RAG appears in both the Planning view and the Resource Report;
// the Resource Calendar gains a custom Today highlight color. The Planning
// table gains a filter/sort toolbar; the Budget panel gains role and
// discipline filter/sort controls. The Budget Report gains an Actual(h) RAG
// column. The RAID and Budget reports are now present by default (no "+ Add
// report" step required). Both task editors (full-page and modal) gain
// Cancel + Add/Save buttons in the top action bar. The Gantt Add-milestone
// button opens the milestone create form directly.
// 0.47.0 "Reynolds" adds RAG status across the budget surfaces and dashboard,
// plus a burn-down chart. A new pure budget-health.ts maps consumption / plan-
// and actual-hours (Amber >=90%, Red >100% of budget), cost performance (the
// EVM 0.8/0.9 index bands), and contribution margin (Green >=15%, Red <0) to
// Red/Amber/Green. budget-burndown.ts derives per-period remaining hours and
// EUR; a dependency-free SVG BurndownCharts renders twin remaining charts on
// the dashboard and in the Budget Report. The dashboard pills gain lettered
// RAG badges (and print as a static value + badge instead of dropdowns), the
// budget-burn tiles show the currency symbol, the register/activity sections
// are boxed, and clickable links use the directory hover. The budget panel
// shows RAG on every bucket metric, labels the Plan/Actual grid cells, and
// adds a per-cell and per-role RAG; the Budget Report gains RAG tiles and a
// status column.
// 0.46.0 "Banks" closes the deferred EVM follow-up and polishes the chrome.
// The dashboard Schedule and Budget RAGs now fold in the Earned Value indices:
// SPI feeds Schedule and CPI feeds Budget (worst-of with the existing task /
// milestone / budget signals; an index below 0.8 is Red, below 0.9 Amber, and
// a manual override still wins). CPI can surface a Budget RAG even when no
// budget buckets are configured. UI: the sidebar version line is now clickable
// and opens a version-history modal (shared with the Version popover); the Help
// window opens at double its previous size; and the full-page Settings view
// gains a footer with a version-history link and an Apache-2.0 license link
// (also added to the Help footer). Docs + package.json version refreshed.
// 0.45.0 "Robinson" adds task-effort Earned Value (EVM). A new pure evm.ts
// computes PV (estimate of tasks due by today), EV (estimate of completed
// tasks), and AC (time spent) from existing task data, deriving SPI=EV/PV,
// CPI=EV/AC, and the SV/CV variances (in hours, with an optional EUR overlay
// via the mean role internal rate). SPI/CPI tiles appear on the dashboard
// budget-burn band; the full PV/EV/AC/SPI/CPI/SV/CV table (hours + EUR) shows
// in the Budget Report. Informational only (no RAG change); purely derived —
// no new persisted state. Completes the 3-feature PM roadmap.
// 0.44.0 "Bujold" adds Milestones — zero-duration key dates distinct from
// tasks (name, date, optional description, manual achieved sign-off, and
// linked tasks). A new Workspace.milestones[] round-trips through every
// storage backend. Milestones render as diamond rows on the Gantt with
// linked-task connector edges and an at-risk ring (a linked task finishing
// after the milestone date); a dedicated Milestones view (Plan group) lists
// and edits them; the dashboard gains a Milestones subsection and folds an
// overdue/at-risk/due-soon contribution into the computed Schedule RAG.
// 0.43.0 "Cherryh" adds a consolidated Project-Health Dashboard — a single view
// (first in the Overview nav) that doubles as a live cockpit and a printable
// status report. Header shows overall RAG plus Schedule / Budget / Scope
// sub-status (computed, with manual override via inline selects); then a PM
// status narrative (commits on blur), % complete + R/A/G health counts, budget
// burn, top open RAID items, upcoming/overdue dates, and recent activity —
// rendered inside the shared ReportCard print card. A new persisted
// Workspace.status (ProjectStatus: four RAG overrides + narrative) round-trips
// through JSON / CSV / Markdown / Turso behind one sanitizer; pure aggregation
// lives in dashboard.ts (computeDashboard). RAID rows link to the register and
// task rows open the editor. First of a 3-feature PM roadmap (Milestones and
// Earned Value / SPI-CPI follow).
// 0.42.2 fixes a budget cost/revenue bug: buckets loaded from the CSV/Markdown/
// Turso backends with empty rate-override cells parsed those as a literal 0,
// which applied a spurious EUR0/hour override and zeroed their cost & revenue.
// Empty override cells are now treated as absent (an explicit 0 is still a valid
// non-billable override). Also seeds sample-workspace.md with five budget
// buckets (detailed/blended/override/fixed/spillover). Inherits "Le Guin".
// 0.42.1 scopes print orientation: reports (the shared ReportCard print-root)
// print A4 landscape via a named `@page landscape` + a `.print-landscape` class,
// while the default `@page` is portrait so the Activity Log (and any other
// print-root) prints portrait again. Inherits the 0.42.x "Le Guin" milestone.
// 0.42.0 "Le Guin" makes the Reports view composable: an "+ Add report" control
// appends the RAID, Budget, and Resource reports below the task analytics, each
// removable, the chosen set persisted in settings — all inside one print card.
// In-app printing now defaults to A4 landscape. (Folds in the 0.41.1 fix: the
// Budget empty-state "+ Add bucket…" prompt is now a real button.)
// 0.41.1 makes the Budget panel's empty-state "+ Add bucket…" prompt a real
// button: with no buckets, clicking it now creates a bucket and opens the
// editor modal (previously it was inert text). Inherits the 0.41.x "Okorafor"
// milestone. No other behavior change.
// 0.41.0 "Okorafor" adds a dedicated Budget Report. A new "Budget Report"
// sub-menu under Budget (mirroring RAID -> RAID Report) shows the current
// budget calculations across all buckets — role rates, blended discipline
// rates, per-bucket overrides, FX, and spillover — as a printable report with a
// project-level CCI rollup and a sortable per-bucket detail table (all figures
// in EUR). The budget block added to the task Reports view in 0.40.0 is removed
// and folded into this dedicated report. No budget-engine change.
// 0.40.0 "Leckie" adds per-bucket budget planning modes. A "Detailed budget
// planning" toggle switches a bucket between per-role allocations (detailed,
// the prior behavior) and per-discipline allocations that use the average
// (blended) rate of that discipline's grades. Buckets gain optional internal/
// external rate overrides (applied to every line). Entry fields show a unit
// suffix and tooltip; switching off detailed planning warns before discarding
// per-role hours. The Reports view gains a Budget section filterable by bucket
// and by minimum total budget, with total/used/free rollups. New pure module
// budget-rates.ts; the new fields round-trip through all storage backends.
// 0.39.0 "Tchaikovsky" makes the Resource Calendar's visible range selectable.
// A control row (Month / Week / Custom + ◀ / Today / ▶, with From/To date
// pickers in Custom mode) replaces the fixed 30-days-from-today grid: the
// calendar now renders an arbitrary inclusive [start,end] window, so PAST as
// well as future dates show. Like the Gantt, it scroll-centers today when it
// opens (and whenever the window changes), and always re-anchors to today on
// open (the window is not persisted). Month mode opens on the current month;
// Prev/Next step by month or week; Today re-centers. New pure helper
// `calendar-window.ts` (month/week/custom bounds, ±step, ~370-day clamp). Six
// new EN+DE strings; no new dependencies.
// 0.38.7 finishes the consistency work with two layout fixes. (1) The Gantt and
// RAID toolbars: their native <select> filters carried a ~35px min-height, so
// those toolbars were 5px taller than every other view's 30px header, pushing
// the chart/table down. The selects are now pinned to h-[30px], so the Gantt
// chart starts at the same offset (63px from the pane) as all other windows.
// (2) The modern sidebar bottom-aligns with the content card: the shell carries
// the 24px bottom inset (matching the card's) so the sidebar no longer extends
// past the bottom of the content window. No new strings; no new dependencies.
// 0.38.6 surfaces the minor-series milestone codename in the UI: the version
// now reads `0.38.6 "Chambers"` in the sidebar footer and the Version popover
// (previously the codename lived only in these release notes; patch releases
// inherit their minor's name). Adds a versionHighlightConsistency highlight
// summarizing the 0.38.3–0.38.5 UI-consistency sweep (uniform header spacing,
// control sizing, and dialog buttons/headers). Docs (README + CODEMAPS stamps)
// refreshed to 0.38.6. No new strings beyond the one highlight; no new deps.
// 0.38.5 unifies the modal/dialog system after an audit (the deliberately
// separate counterpart to the 0.38.3/0.38.4 view sweep). Footer action buttons
// are now one convention everywhere: the three "big" dialogs (Bulk Edit, Jira
// Conflicts, RAID edit) move from px-4 py-2 + borderless Save (hover:opacity-90)
// to the compact px-3 py-1.5 used by the task/resource/shift/absence/budget/
// outlook dialogs, with the Save button bordered + hover:bg-AIPM-dark-blue/90 to
// match every primary button app-wide. Hand-rolled dialog headers are aligned to
// the shared ModalHeader's classes: the two Outlook import dialogs gain
// sticky top-0 z-10 / bg-surface / gap-4, and the Due-Dates dialog gains z-10 /
// shrink-0. Field inputs and the shared Modal shell were already uniform. Class-
// string changes only; no new strings or dependencies.
// 0.38.4 extends the 0.38.3 header-spacing unification to the views it missed,
// after a full audit of every primary section. Header bottom-margins are now
// uniformly mb-2: Open Points (was mb-4), Reports/RAID Report/Resource Report
// (ReportCard, was mb-4), Activity (header + filter row, was mb-3), and Manage
// Roles (was mb-3). The RAID toolbar — previously the pre-0.38.3 Gantt style —
// now uses mb-2 (was pb-2) with its search + filter selects at text-xs (was
// text-sm), so it matches the Gantt toolbar exactly. Activity's search input is
// text-xs too. The Open Points "Jira sync" button matches Budget's "Refresh ECB
// rates" button (px-2.5 py-1.5 text-xs, was px-3/text-sm). Planning's control
// row uses gap-2 (was gap-3). Class-string changes only; no new strings or deps.
// 0.38.3 is a UI-polish point release unifying primary-view header spacing.
// Every primary pane now shares the same "from the top" rhythm: a ~30px header
// row followed by an 8px (mb-2) gap. Resources (Workload/Calendar/Planning):
// the header is items-center (was items-baseline) so the title and the reset
// buttons share a vertical centre, and the button cluster gap is gap-2 (was
// gap-3) to match the Directory toolbar. Budget: its header gained the missing
// mb-2 bottom margin, and the "Refresh ECB rates" button is text-xs to match the
// adjacent "Add bucket" button (header back to 30px). Gantt: the toolbar uses
// mb-2 (was pb-2) like every other pane, and its search + filter selects are
// text-xs (was text-sm) so the toolbar matches the standard control height. No
// new strings, no new dependencies.
// 0.38.2 is a UI-polish point release. Resources → Workload: the reset buttons
// now share one header line (column-resize lifted into ResourcesPanel) instead
// of stacking. Resources → Planning: the date pickers match the segmented-
// control height. Resources → Manage Roles: the rate-card table uses the same
// scroll-card + cell styling as the Directory/Workload tables, and the panel is
// centred + half-size like Chat (shared CENTERED_HALF_PANE_CLASS). RAID Report,
// Reports, and Resource Report show a left-aligned heading on the toolbar line
// (a ReportCard title slot). No new strings, no new dependencies.
// 0.38.1 is a classic-layout follow-up: the classic tab strip gains a secondary
// sub-tab row (driven by nav-config's subTabsFor) so Classic mode can reach the
// Resources sub-views (Directory/Workload/Calendar/Planning/Manage Roles) and
// the RAID Report that the modern sidebar already exposes; modern layout
// unchanged. No new strings.
// 0.38.0 "Chambers" is a comprehensive resize + resources-nav + report-parity
// batch (groups A–G). A–C: every primary pane (Open Points, Chat, Gantt, RAID,
// Resources views, Budget, Activity, Reports, and the RAID/Resource reports) is
// now drag-resizable — fill-height by default, drag the corner handle to resize,
// Reset-size button to restore; a shared VIEW_PANE_RESIZABLE_CLASS + useResizable
// hook back every panel; Chat is centred as a half-size card. D: the Budget pane
// gains a bucket-count heading row with right-aligned action buttons. E: the
// Gantt and RAID toolbars now place their add-button before the search field.
// F: RAID loses its in-panel "open report" button (the report is reachable from
// the sidebar). G: the Resources sidebar item now navigates to the Resource
// Report; its sub-menu is restructured — Directory (formerly Address Book),
// Workload, Calendar, Planning, and Manage Roles (now a full page, not a modal);
// the standalone Resource Report sub-menu entry was removed. The RAID and
// Resource reports adopt the Reports layout: sortable/filterable/column-resizable
// tables via a shared report-table kit. No new dependencies.
// 0.37.2 introduces property-based testing with fast-check (new dev dependency,
// no runtime/prod impact). Eight co-located *.property.test.ts suites assert
// invariants over generated inputs for the pure-logic layer: duration parse/
// format round-trips, FX conversion round-trips & rate positivity, resource-
// capacity period generation & bounds, due-date working-day math, the sanitize
// boundary guards (length caps, idempotence, encode/decode round-trips), the
// RAID comparator (antisymmetry, total order, monotonic severity), resource-cost
// identities, and date-format locale/formatting. The sweep documented one
// boundary finding: sanitizeNonNegInt/sanitizeOptionalMinutes throw on Symbols
// and null-prototype objects, which the JSON/CSV input path cannot produce — so
// the property is scoped to the realistic JSON-value domain. No source changes.
// 0.37.1 is a documentation refresh with no runtime behavior change: the
// README is brought up to the modern-layout era (version line + a Layout &
// theme entry and scoped-printing note in the feature table), the five
// docs/CODEMAPS/* architecture maps are regenerated for 0.29.0–0.37.1, and the
// in-app Help gains a "Layout & theme" section (modern sidebar vs Classic mode,
// theme, URL-hash deep-linking) — EN + DE. No source/logic changes.
// 0.37.0 "Kowal" is a UI polish batch (spec groups A–G). A: the Gantt export
// dropdown now stacks above the sticky date row (z-40). B: the modern Open
// Points table fills the available height instead of a fixed resizable box, and
// the classic layout is a viewport-height flex column so its footer is always
// visible (only the content scrolls). C: paneless views (Reports, RAID, Budget,
// Chat) are unified onto a shared VIEW_PANE_CLASS card and the resources inner
// tables onto INNER_TABLE_CLASS (a sweep guard prevents drift); Gantt stays
// full-bleed by design. D: report/activity printing is scoped to a .print-root
// node so a single view prints cleanly, and the Activity pane gains a Print
// button. E: the Jira section is always expanded (no collapse toggle) in the
// modern full-page Settings view. F: the Outlook contacts import button in the
// address book is renamed "Sync with Outlook" (EN/DE). G: the sidebar version
// line is prefixed with the "Version" label. No new dependencies.
// 0.36.0 "Hurley" splits the task form into 5 stacked, numbered sections
// (Details · Scheduling · Effort & Classification · Relationships · Status &
// Notes), defined once in the shared TaskFormFields so BOTH the modern full-page
// edit view and the classic modal render them identically. No fields added or
// reordered across groups; validation, Save/Cancel, and form wiring unchanged.
// 0.35.0 "Muir" is Phase 4 Workstream D of the modern layout: the divergent-
// table sweep. The five tables that still carried bespoke <thead> markup
// (Reports ×3, the Roles modal, the Budget panel, the Jira-conflicts modal, and
// the Resource calendar) now use the shared Dark-Blue TABLE_HEAD_CLASS, finishing
// the Phase 3/4 header unification. In-header sort buttons hover green; the
// resource calendar's frozen top-left corner and its default/weekend day cells
// paint dark blue with white text (today=green and holiday=purple tints kept).
// The table-head sweep guard was generalized to a FORBIDDEN_HEADS list and the
// five files added to SWEPT_FILES so they cannot drift back. No new strings.
// 0.34.0 "Novik" is Phase 4 Workstream C of the modern layout: shell DRY +
// banner parity. The header action cluster (Voice, Export, Help, Version) is now
// one shared ActionMenus component consumed by both the classic header and the
// modern top bar (a sweep test guards against drift). The modern layout now also
// shows the Due / Birthday / Jira-token reminder banners — previously only the
// classic layout did — rendered at the top of the content area on every view via
// a new ModernShell `banners` slot. No new user-facing settings or strings.
// 0.33.0 "Wells" is Phase 4 Workstream B of the modern layout: a full-page
// Settings view. In the modern layout, the sidebar "Settings" item now opens a
// dedicated full-viewport Settings page with a left section rail (Appearance,
// Language & Holidays, General, Notifications, AI Assistant, Jira, Storage,
// Integrations). All settings sections have been extracted into shared
// components under settings-sections/ and are consumed by both the classic
// gear-icon popover and the new full-page view (single source of truth). The
// gear-icon Settings popover has been removed from the modern top bar; the
// classic layout is unchanged and keeps its popover. Settings types and
// defaults are extracted into settings-types.ts (re-exported from
// settings-menu.tsx). An import-parity guard test ensures the popover sources
// every section from settings-sections/.
// 0.32.1 is an internal quality pass with one user-facing fix and no new
// feature surface: the responsive sidebar no longer flashes its expanded state
// for a frame on narrow viewports before collapsing (useMediaQuery now reads
// the match live via useSyncExternalStore instead of correcting in an effect);
// all useMsAuth consumers (settings, sidebar footer, storage config, storage
// backend) share one session store, so a Microsoft sign-in/out anywhere now
// propagates live everywhere and MSAL initializes once; and the shell palette
// guard also rejects off-palette gradient color-stops (from-/to-/via-[#hex]).
// 0.32.0 "Jemisin" is Phase 4 of the modern layout: responsive shell polish.
// The sidebar gains a collapsible icon rail that auto-collapses on narrow
// screens (with a persisted collapse preference) and a top-bar menu button to
// toggle it; the previously-inert collapse button is now wired through the
// modern shell. The sidebar footer is fuller — theme toggle, storage status,
// and the M365 account / sign-out. Accessibility: a skip-to-content link and a
// labelled #main-content landmark in the modern shell.
// 0.31.0 "Leckie" is Phase 3 of the modern layout: a table restyle. Every
// primary data table (Open Points, RAID + RAID Report, Activity, Resource
// Directory/Workload/Planning/Rollup, Resources Report) now has a Dark-Blue
// header row with white labels, sourced from one shared TABLE_HEAD_CLASS; the
// LOP list also gains Light-Grey zebra striping. Status badges were already on
// the AIPM palette and are unchanged. Header sort-buttons hover green.
// 0.30.0 "Liu" adds Phase 2 of the modern layout: a full-page task editor.
// In the modern layout, opening a task (or clicking "New task") now opens a
// full-viewport edit view styled in the AIPM palette (Dark-Blue section heading,
// two-column field grid) with Save (green) / Cancel in the top bar, instead of
// the overlay dialog. The editor reuses the exact same fields, state, and
// validation as before; Classic mode and all popouts keep the dialog.
// 0.29.0 "Okorafor" adds a modern left-sidebar layout as the new default: a
// Dark-Blue sidebar with grouped, nested navigation (Open Points, Chat, Gantt,
// Resources + Address Book/Resource Report, Budget, RAID + RAID Report, Reports,
// Activity, Settings), a top bar with the view title and actions, and a
// full-viewport content area showing one view at a time. The previous layout is
// preserved as a toggleable "Classic mode" (Settings -> Layout). URL-hash
// deep-linking (#gantt, #raid, ...) and back/forward navigation. Phase 1 of the
// redesign (chrome only; full-page edit view and table restyle follow).
// 0.28.1 is an internal security + code-quality pass with no user-facing
// behavior change: the Jira proxy now rejects plaintext http:// site URLs
// (HTTPS only, so Basic credentials are never sent in the clear) and blocks
// IPv6 unique-local / link-local / IPv4-mapped private hosts (SSRF hardening);
// the eight /api/jira/* routes share a parseJiraRequest entry point; shared UI
// was extracted (combobox-shared, modal-edit-fields, a report-table shell, and
// a useSortableFilter hook); dead code and unnecessary exports were removed;
// and the RAID report panel gained test coverage.
// 0.28.0 improves Turso network-failure UX: switching to a Turso backend when
// the server is down or the database is unreachable now shows a clear
// "storage unreachable — is the server running?" toast; the switch is aborted
// and current data is preserved (no switch, no data loss). A reachable but
// empty database is still initialized automatically. Also: a turso.tech link
// in the Turso configuration section and mouseover help tooltips on every
// field in the Settings menu.
// 0.27.0 converts the live workspace when you switch storage format: instead
// of loading whatever was already in the target backend, the app serialises
// your current data and writes it to the newly-chosen backend (JSON, CSV,
// Markdown, SharePoint, or Turso) after a window.confirm — overwriting the
// target. Startup load and the explicit "open file" action are unchanged.
// All formats remain two-way; no new dependencies.
// 0.26.0 reworks the Turso storage backend to a proper relational (hybrid)
// schema — one table per entity (tasks, raid, absences, shifts, resources,
// roles, disciplines, grades, budget_buckets, plan, fx_rates) with nested
// fields kept as encoded TEXT columns — instead of a single JSON blob.
// Existing single-blob Turso databases (0.25.x) are imported automatically on
// first load. Verified against a local tursodb (--sync-server).
// 0.25.1 lets the Turso backend talk to a local / self-hosted tursodb, not just
// Turso Cloud: the config resolver now accepts a plaintext http:// URL for
// loopback hosts (localhost / 127.0.0.1) and treats the auth token as optional
// there, and the backend drops the trailing pipeline "close" frame (newer
// engines reject it) and only sends the Authorization header when a token is
// set. Remote endpoints still require https + a token (no token over plaintext).
// 0.25.0 adds a Turso (libSQL) storage backend — store the whole workspace as a
// single JSON blob row in a Turso database via the HTTP pipeline API. Enable
// Turso in Settings → Integrations, add the database URL + auth token (or set
// NEXT_PUBLIC_TURSO_* env vars), then pick "Turso database" in Storage
// Configuration. Completes the original Microsoft 365 + Turso request.
// 0.24.0 adds Outlook calendar import (M4) — sign in with Microsoft, then pull
// time-away events (all-day + Out-of-Office) from your Outlook calendar into the
// resource calendar as absences. Preview-and-pick dialog from Resources ›
// Calendar with a per-row absence-type selector. Completes the M365 integration
// suite (auth, SharePoint storage, Outlook contacts, Outlook calendar).
// 0.23.1 hardens the MSAL token flow shared by the M365 integrations: when a
// caller explicitly opts into interactivity (Outlook contacts import, SharePoint
// load/save), a silent-token failure now falls back to an interactive consent
// popup, so first-time incremental consent for a new Graph scope completes
// instead of erroring. Background readiness probes stay silent — no surprise
// popups. No new feature surface.
// 0.23.0 adds Outlook contacts import (M3) — sign in with Microsoft, then
// pull your personal Outlook contacts (Graph /me/contacts) into both the
// resource directory and the assignee address book. Preview-and-pick dialog
// opened from the Resources › Directory toolbar; existing contacts (matched
// by email) are updated, new ones added. Reuses M1's MSAL foundation.
// 0.22.0 implements the SharePoint storage backend (sp-json / sp-csv) — store
// the workspace as a single JSON or CSV file in a SharePoint Sites library via
// Microsoft Graph. Reuses M1's MSAL foundation; paste the file URL in Storage
// Configuration after enabling SharePoint in Settings → Integrations.
// 0.21.0 lays the Microsoft 365 integration foundation — an Integrations
// panel in Settings, a Sign in with Microsoft button gated behind a master
// toggle that defaults OFF, and the lazy-loaded MSAL bundle that future
// SharePoint storage, Outlook contacts, and Outlook calendar features
// (0.22.0+) will build on. The MSAL bundle is NEVER loaded at cold start
// when integrations are off.
// 0.20.0 adds a Print button to Reports, RAID Report, and Resources Report
// popouts. The button opens the browser's print dialog with the report body
// laid out for DIN A4 — toolbars, toggles, and the print button itself are
// hidden via @media print, surface-token backgrounds strip to white for ink
// efficiency, and semantic accent colors (pink/green/dark-blue) are preserved.
// 0.19.0 makes the Reports popout's tables (By Assignee, By Group, By Label)
// sortable + filterable — click any header to cycle asc/desc/off, type in the
// search input above each table to narrow rows. Mirrors the steering-committee
// interaction added to the RAID Report at 0.18.0.
// 0.18.1 hides the read-only-mirror banner in report-style popouts
// (resource-report, reports, raid-report) where it was redundant.
// No change to editing popouts; reminder banners (Due / Birthday /
// Jira token) remain hidden in all popouts as before.
// 0.18.0 adds the RAID Report — a steering-committee popout opened from the
// RAID panel showing tile counts per category plus six summary tables
// (severity, status, owner, top 10, category, aging) and a drill-down to a
// full read-only sortable item table.
// 0.17.1 fixes the Gantt's initial scroll position — when the chart opens,
// today's date is centered in the viewport so past/future tasks are equally
// accessible. Single useLayoutEffect on mount; user's manual scrolling is
// preserved on subsequent renders.
// 0.17.0 "Jemisin" adds column resize to every table in the app — drag the
// right edge of any header; the Reset button restores defaults. Also doubles
// the task form modal's default height (h-[900px], still user-resizable).
// 0.16.2 widens the main app shell cap from max-w-6xl (1152px) to 1536px so
// the layout uses more of the available viewport on large displays. One
// className edit in task-manager.tsx; no behavior or markup change.
// 0.16.1 unifies the Resources panel's Directory, Planning (+ Rollup), and
// Resources Report tables to the Workload tab's table chrome — sticky
// uppercase header, consistent padding, text-sm density. Class strings only.
// 0.16.0 "Butler" closes out sub-project E (the AIPM palette rollout) — the
// final 16 menus + chrome + misc files migrated to surface tokens, the green
// accent, dark-blue fills, and no shadows or gradients. The AIPM design system
// now covers the entire app.
// 0.15.7 sweeps the Gantt onto the AIPM palette — surface tokens, no shadows;
// High-severity icon fills purple to complete the priority ramp; absence
// column tints (vacation=blue, sick=pink, training=purple) at /20 alpha;
// overdue ring + destructive button in pink.
// 0.15.6 sweeps the RAID panel onto the AIPM palette — surface tokens, no
// shadows; R/A/I/D category chips in pink/blue/purple/green; severity ramp
// (Low->Critical) in green/blue/purple/pink (cold->hot); RAG dots in
// pink/purple/green; stale/aging chips in purple; error box in pink.
// 0.15.5 sweeps the tasks UI + form inputs + reports onto the AIPM palette —
// surface tokens, no shadows, task-row priority chips remapped (Medium=blue,
// High=purple, Urgent=pink), reports RAG legend in pink/purple/green.
// 0.15.4 sweeps the modal layer (resource/shift/absence edit, roles,
// budget-bucket, task form, jira conflicts, bulk edit) onto the AIPM palette —
// surface tokens, no shadows, destructive actions in pink, RAG status in
// pink/purple/green.
// 0.15.3 sweeps the resource calendar onto the AIPM palette: absence cells in
// blue/pink/purple/grey + glyph, today=green wash, holiday=purple wash,
// weekend=muted; fixes the previously-undefined AIPM-light-blue token.
// 0.15.2 sweeps the Resources + Budget panels (directory, workload, report,
// planning, budget) onto the AIPM design tokens — surface/line/muted tokens,
// no shadows, status colors mapped (overdue->pink, positive CCI->green,
// absence override->purple). Calendar + modals follow.
// 0.15.1 lays the AIPM design-token foundation: semantic surface tokens
// (surface/muted/line/muted-foreground, light+dark) in globals.css, a
// DESIGN-TOKENS.md mapping doc, and the shared primitives (segmented control,
// modal header, app header) migrated to the palette (green accent, dark-blue
// fills, no shadows). Full app sweep follows.
// 0.15.0 "Le Guin" adds a Light / Dark / System theme: a class-based dark mode
// with a no-flash loader, persisted per device (localStorage "lop-theme"), and a
// 3-way control in Settings. (Palette/shadow cleanup follows in a later release.)
// 0.14.3 makes the assignee name clickable in the resources calendar and
// planning grids: a matched name opens the resource edit modal; an unmatched
// calendar name opens Add Resource prefilled — reusing the workload tab's
// hover-button style.
// 0.14.0 adds editable budget buckets: a new draggable BudgetBucketModal
// lets users edit a bucket's name, PO number, type (T&M / Fixed), currency,
// fixed-price amount, start/end dates, spillover successor, and manual FX-rate
// override — with validation. Role allocation lines (role + capacity) are
// managed inside the modal via a role picker. "Add bucket" now opens the editor
// on the new bucket (no more uneditable empty shells); each bucket card gained
// an Edit button; per-period hours are still edited in the panel grid.
// 0.13.0 polishes the UI across modals, resources, budget, and tasks:
//   - Draggable modal windows via a shared ModalHeader (use-draggable.ts).
//     Voice commands are now available inside every modal through
//     VoiceCommandContext (voice-command-context.tsx).
//   - Tab order: Budget sits between Resources and Activity.
//   - Assignee hover styling unified across Directory, Workload, and Task rows.
//   - Resource planning: explanatory tooltips on rollup totals and the
//     utilization input; the "weeks" view now derives week capacity from the
//     month-level entry (read-only when granularity is month).
//   - Roles & rates: sortable Discipline/Grade/Internal/External columns; a
//     visual divider between the rate card and the add-combo row; Discipline
//     and Grade selects show a "—" placeholder; Manage-roles and Report buttons
//     gained leading icons.
//   - Budget buckets: removable (calculations based on a removed bucket reset
//     to 0) and reorderable by drag (persisted `order` field).
//   - ECB "refresh rates" button restyled to match the Jira-sync button
//     (spinner while loading).
//   - Tasks: optional effort fields — Original estimate & Time spent — in
//     weeks/days/hours/minutes (Jira basis: 1w=5d, 1d=8h). Hideable, sortable
//     "Est." and "Spent" columns. New `duration.ts` helper: parse/format
//     duration strings, round-trip with Jira minute values.
// 0.12.0 adds a Project Budget Planner: named PO-line budget buckets (T&M or
// fixed-price, in EUR/USD/GBP) that span roles via per-role allocations (each
// naming a role + feeding resources + per-period budget/actual hours). Planned
// hours derive from the existing resource-capacity engine; actuals are entered
// per bucket/role/period. A three-value CCI panel (contribution margin, cost
// performance, consumption — each as amount + %) is computed at bucket and
// project level, together with win/loss in hours and currency. Closing a bucket
// spills its remaining budget (hours + amount) into a named successor (reversible
// on reopen). Multi-currency display is backed by ECB daily reference rates: a
// new /api/ecb route fetches and caches them in the workspace; a per-bucket
// manual rate override wins over the cached rate. Bucket end-date reminders fire
// via the existing reminder lead-time infrastructure. New modules: budget-report.ts
// (pure engine: active periods, planned hours, per-bucket report, CCI, spillover,
// project rollup, reminders), budget-panel.tsx (Budget tab UI), fx.ts + ecb.ts +
// api/ecb/route.ts + use-fx-rates.ts (ECB FX layer). Budget types added to
// types.ts; budget sanitizers in sanitize.ts; budgets + fxRates persisted in
// storage.ts (schema v6, additive migration from v5, full CSV/MD/JSON/IDB
// round-trip; budgets/fxRates are optional on Workspace for backward compat).
// 0.11.0 hardens pop-out windows, reworks control tooltips, and adds Jira
// token-expiry reminders.
//   - Pop-out windows are now read-only mirrors: they receive live state over
//     BroadcastChannel but never broadcast and never persist. This closes a
//     data-loss path where a pop-out's load broadcast its state to the main
//     window, which then triggered a redundant (and on Chrome sometimes
//     destructive) save of the local file. `useBroadcastSync` gained a
//     `canSend` flag (receive always; send gated), and `writeHandle` now
//     aborts the swap-temp on a blocked write so the original file can't be
//     deleted. Edit affordances are locked in pop-outs: commit handlers no-op
//     with a toast (`makeEditGuard`), the chat dispatcher refuses mutating
//     tools, the gantt "Add Task" is hidden, and a read-only banner shows.
//   - Tooltips: the workspace resize hint no longer leaks onto every
//     search/filter control — it lived as a `title` on the wrapping
//     `<section>`, which HTML shows on any title-less descendant. Removed in
//     favour of an inert corner glyph; every search/filter/sort control (and
//     the RAID edit-modal fields) now has its own descriptive tooltip, and the
//     tasks column headers match the resources directory hover. ~40 new EN+DE
//     strings; `SegmentedControl` gained a `title` passthrough.
//   - Jira: record the API token's expiry date (Settings → Jira) to get a
//     reminder banner before it expires and once it has (`getJiraTokenAlert`,
//     reusing the snooze/banner infra). Clicking Sync with an expired/invalid
//     token or no connection now shows a clear, actionable info message
//     (`classifyJiraError`): expired → paused, 401/403 → token rejected,
//     network → unreachable. A rejected token also raises the banner until a
//     successful sync/test clears it.
// 0.10.0 ships everything built on top of the Resource Utilization release:
// the Resource Address Book, a unified working-day-shifted reminder lead, and
// persisted reminder snooze, plus two data-integrity fixes and a project-wide
// lint pass.
//   - Address book: Resource splits `name` into firstName/lastName and gains
//     contact fields (title, business phone, location, department, email,
//     company, birthday MM-DD, notes). The Resources pane is now four sub-tabs
//     — Directory (address-book table; click a name to edit, "+ Add resource"),
//     Workload, Calendar, Planning — plus a pop-out address-book window.
//     Birthdays raise a banner + once-per-load toast.
//   - Task form: a "+" beside the assignee opens the address-book add-entry
//     modal seeded with the typed name/email; saving creates the resource and
//     fills the assignee.
//   - Reminders: a single "days ahead" lead (reminderLeadDays) replaces the
//     split birthday-leadDays / due-threshold settings; a reminder that would
//     land on a weekend, holiday, or absence day is shifted earlier to the
//     prior working day so it fires during the work week. Both reminder banners
//     gain a persisted Snooze (1 hour / 1 day) that also mutes the load toast
//     until it elapses.
//   - Fixes: pop-out windows no longer broadcast their initial (empty) state
//     (which could truncate the synced file); each local file format keeps its
//     own file-picker id so switching formats no longer sticks.
//   - Quality: project-wide ESLint pass to zero problems with no rule relaxed
//     (set-state-in-effect rewrites, render-time ref writes moved to effects,
//     test-mock typings).
// 0.9.0 lands the Resource Utilization feature: first-class Resource
// entities with two-dimensional Role (discipline × grade) carrying
// internal/external hourly rates; per-period utilization planning grid
// (week or month) computing capacity net of weekends, holidays, and
// absences; internal/external cost + margin columns; read-only
// week/month rollup view; per-cell absence-override editing; and a
// pop-out resources report (capacity, cost, margin; per-period /
// per-discipline / per-grade / per-role / per-resource breakdowns).
// Schema v5 with additive `resourceId` on tasks/absences and an
// idempotent migration that backfills resources from existing
// assignees and seeds preset disciplines/grades. Also: 2 long-standing
// test-file tsc errors fixed (project now type-checks fully clean).
// 0.8.4 extracts the modal layer (DueBanner, TaskFormModal, DueDatesModal,
// JiraConflictsModal, AbsenceEditModal, ShiftEditModal, footer, toast) from
// task-manager.tsx into AppModals. TasksSection builds rowContextValue
// internally (useSettings + useHolidaySet + tasksById from useWorkspace);
// receives 8 row-handler callbacks + jiraSiteUrl as explicit props instead of
// the compiled RowContextValue object. task-manager.tsx −~140 lines. Slice 16.
// 0.8.3 extracts WorkspaceTabContext (TopTab type + WorkspaceTabProvider +
// useWorkspaceTab hook) from task-manager.tsx. Also extracts AppHeader
// component (app <header> block, ~90 lines) and WorkspaceSection component
// (workspace <section> block, ~250 lines) from task-manager.tsx.
// useTaskRowHandlers now reads setActiveTab from WorkspaceTabContext instead
// of receiving it as a prop. task-manager.tsx −377 lines; now ~661 lines.
// Slice 15.
// 0.8.2 extracts 6 UI helper components (TabButton, Th, SortableTh,
// ResetSizeIcon, ResetColWidthsIcon, EraserIcon) to task-manager-ui.tsx
// and the entire tasks <section> JSX (~310 lines) to tasks-section.tsx.
// TasksSection reads useFilters(), useWorkspace(), and useTaskForm()
// internally; 31 explicit props for column manager, resizable table,
// row state, Jira, task actions, and bulk operations. 3 smoke tests.
// task-manager.tsx ~−520 lines; now ~1,049 lines. Slice 14.
// 0.8.1 extracts useTaskSubmit (~170 LoC) and useGanttHandlers (~25 LoC) from
// task-manager.tsx. Slice 13 of the decomposition: useTaskSubmit owns error
// state, handleSubmit (validation + create/update paths + Jira push via
// onPushToJiraRef forwarding-ref pattern), handleCancelEdit, and openEditModal.
// useGanttHandlers owns handleGanttBarUpdate (drag-edit with date clamping).
// ContactsMap type alignment; nextId retained in task-manager for TaskFormModal.
// 8 new unit tests. task-manager.tsx ~−165 lines; now ~1,705 lines.
// 0.8.0 extracts useHolidaySet (~25 LoC) and useTaskRowHandlers (~150 LoC)
// from task-manager.tsx. Slice 12 of the decomposition: useHolidaySet wraps
// the async holidaysForCountries utility with a cancellation guard.
// useTaskRowHandlers owns expandedNotes + pushingIds state and the 9 row
// callbacks (onToggleNoteExpanded, onJumpToRaid, onToggleComplete,
// onSendInquiry, onPushToJira, onEdit, onDelete, handleClearRaidTaskFilter,
// handleJumpToTaskFromRaid). handleEdit duplicate eliminated; openEditModal
// introduced as a stable useCallback in task-manager. TopTab exported.
// Dead settingsRef/todayRef removed. 9 new unit tests.
// task-manager.tsx ~−120 lines; now ~1,870 lines.
// 0.7.8 extracts useColumnManager (~110 LoC), useContacts (~45 LoC), and
// useWorkspaceCollapsed (~25 LoC) from task-manager.tsx. Slice 10 of the
// decomposition: all three are localStorage-backed UI-state hooks.
// useColumnManager owns column widths, hidden columns, the column-config
// dropdown, and the resize-drag interaction. useContacts owns the contacts
// address-book lifecycle (gated on hydrated + tasks for seeding).
// useWorkspaceCollapsed owns the workspace-panel collapsed boolean.
// 15 new unit tests. task-manager.tsx ~−175 lines; now ~2,010 lines.
// 0.7.7 extracts useSettings (~100 LoC) and useActivityLog (~50 LoC) from
// task-manager.tsx. Slice 9 of the decomposition: useSettings owns settings
// state, localStorage load/persist, i18n loading, and the hydrated + i18nReady
// gates. useActivityLog owns activityLog state, localStorage load/persist,
// logActivity, and handleClearActivityLog. 12 new unit tests. task-manager.tsx
// ~−150 lines; now ~2,145 lines.
// 0.7.6 extracts useResourcePlanner (~350 LoC) and useBulkOperations (~270 LoC)
// hooks from task-manager.tsx. Slice 8 of the decomposition: useResourcePlanner
// owns RAID CRUD, absence CRUD (with modal state), shift CRUD (with modal state),
// and handleCreateMitigationTaskFromRaid. useBulkOperations owns selectedIds state,
// bulk edit logic, handleCommand (voice dispatcher), handleClearAll, and
// handleBulkSendInquiry. 13 tests each covering modal state, CRUD ops, auto-issue
// on Risk→Realized, voice dispatch, and bulk inquiry. task-manager.tsx −518 net
// lines; now ~2,295 lines.
// 0.7.5 extracts useStorageBackend hook (~167 LoC) from task-manager.tsx.
// All storage, broadcast-sync, and file-handler logic now lives in the hook.
// WorkspaceContext widened (Phase A) to own raid, absences, and shifts state.
// 14 new unit tests in use-storage-backend.test.tsx; workspace-context.test.tsx
// gains assertions for new defaults. task-manager.tsx −164 net lines.
// 0.7.4 extracts the Jira sync logic (~315 LoC) out of task-manager.tsx into
// a new useJiraSync hook. handleJiraSync + handleResolveConflicts move into
// the hook with ref-based reactive reads (tasks, settings, lang, today).
// loadJiraApi lazy-load cache moves to use-jira-sync.ts and is re-exported.
// 12 new unit tests covering state-init, pull, push, conflict detection,
// create-issue, and conflict resolution paths. task-manager.tsx −303 lines.
// 0.7.3 extracts the Claude chat-tool dispatcher (~240 LoC) out of
// task-manager.tsx into a new useChatDispatcher hook with empty-deps useMemo
// + ref-based reactive reads. ChatPanel is now wrapped in React.memo; with
// the dispatcher's stable identity it no longer re-renders on task-form
// keystrokes. task-manager.tsx -228 lines. 15 new unit tests for the hook,
// including identity-stability pins. isValidEmail moved to sanitize.ts;
// greetingName moved to contacts.ts.
// 0.7.2 adds a confirm dialog before clearing the activity log, matching the
// existing confirm-before-delete pattern on "Delete all tasks" and single-task
// delete. Internal: TaskFormModal + BulkEditModal extracted from
// task-manager.tsx (slice 4 refactor, no user-visible change).
// 0.7.1 adds developer test scaffolding: Vitest + React Testing Library
// for unit/component tests (`src/**/*.test.ts(x)`) and Playwright for E2E
// (`e2e/**/*.spec.ts`). Coverage threshold set at 80%. Dev-only change —
// no user-visible behavior difference vs 0.7.0.
// 0.7.0 brings Resource Planner (per-assignee absences + weekly shift
// patterns + 30-day calendar view) and an Activity Log of task / RAID /
// resource changes. Also: persisted contacts address book, per-request
// Content-Security-Policy nonce via Next.js 16 middleware (`src/proxy.ts`),
// and SharePoint storage backend stubs (UI present, MSAL not yet wired).
// 0.6.0 captured the May 2026 performance refactor: lazy-loaded heavy
// modules (OOXML export, German dictionary, date-holidays), IndexedDB
// record-level storage for tasks/RAID, debounced search + colWidths,
// memoized RAID panel, and conditional mount of Gantt/Reports tabs.
// 0.5.0 was the prior feature-accretion milestone (Claude chat, voice
// commands, due-date notifications, reports, labels & groups, bulk edit,
// Jira bidirectional sync + push, ADF description ↔ notes, resizable +
// collapsible workspace, resizable tasks table, header "+" task modal).
// Date is the last build.
export const APP_VERSION = "0.55.0";
export const APP_BUILD_DATE = "2026-06-08"; // 0.55.0 UI batch + stakeholder comms reminders
/** Minor-series milestone codename (sci-fi/fantasy author names). The whole
 *  0.55.x line is "Clarke" (Arthur C. Clarke); patch releases inherit
 *  their minor version's codename rather than getting their own. */
export const APP_MILESTONE = "Clarke";
/** Version with its milestone codename for UI display, e.g. `0.39.0 "Tchaikovsky"`. */
export const APP_VERSION_LABEL = `${APP_VERSION} "${APP_MILESTONE}"`;
export const APP_REPO_URL = "https://www.example.com";

/** Open-source license (SPDX id) and its canonical reference URL, shown in the
 *  Settings footer and the Help panel. Mirrors package.json `license`. */
export const APP_LICENSE = "Apache-2.0";
export const APP_LICENSE_URL = "https://opensource.org/license/Apache-2.0";

/** Translation keys for the high-level feature highlights shown in the
 *  Version popover. Update both EN and DE in i18n.ts when you add to this. */
export const APP_HIGHLIGHT_KEYS = [
  "versionHighlightChat",
  "versionHighlightVoice",
  "versionHighlightStorage",
  "versionHighlightJira",
  "versionHighlightReports",
  "versionHighlightGantt",
  "versionHighlightRaid",
  "versionHighlightResources",
  "versionHighlightActivity",
  "versionHighlightContacts",
  "versionHighlightExport",
  "versionHighlightNotifications",
  "versionHighlightWorkspace",
  "versionHighlightSecurity",
  "versionHighlightPerformance",
  "versionHighlightBudget",
  "versionHighlightPolish",
  "versionHighlightBudgetEdit",
  "versionHighlightTheme",
  "versionHighlightPalette",
  "versionHighlightTableResize",
  "versionHighlightRaidReport",
  "versionHighlightReportsSortFilter",
  "versionHighlightPrintReports",
  "versionHighlightM365Auth",
  "versionHighlightSharepointStorage",
  "versionHighlightOutlookContacts",
  "versionHighlightOutlookCalendar",
  "versionHighlightTursoStorage",
  "versionHighlightTursoRelational",
  "versionHighlightStorageConvert",
  "versionHighlightStorageUnreachable",
  "versionHighlightModernLayout",
  "versionHighlightFullPageEdit",
  "versionHighlightTableRestyle",
  "versionHighlightSidebarPolish",
  "versionHighlightPaneResize",
  "versionHighlightConsistency",
  "versionHighlightBudgetModes",
  "versionHighlightBudgetReport",
  "versionHighlightComposableReports",
  "versionHighlightDashboard",
  "versionHighlightMilestones",
  "versionHighlightEarnedValue",
  "versionHighlightEvmRag",
  "versionHighlightBudgetRag",
  "versionHighlightUiRefinements",
  "versionHighlightTrends",
  "versionHighlightChangeLog",
  "versionHighlightRaidReview",
  "versionHighlightStakeholders",
  "versionHighlightStakeholderReport",
  "versionHighlightModes",
  "versionHighlightClarke",
] as const;
