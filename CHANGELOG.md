# Changelog

All notable changes to **Project Management Tracker** are recorded here.
The format is loosely based on [Keep a Changelog](https://keepachangelog.com/);
versioning follows [Semantic Versioning](https://semver.org/).

This file is the authoritative per-version history. The current version and
build date are exported by [`src/app/version.ts`](src/app/version.ts), which no
longer carries its own changelog comment.

## [0.103.0] - 2026-06-19 "Watts"

AI-orchestration roadmap **SP3** — an "Use AI" fast-path for creating projects.

### Added
- **AI project-creation fast-path ("Use AI").** When an Anthropic API key is configured, the
  create-project wizard opens on a new "Describe" step: write a plain-language brief and Claude
  proposes the project setup (name, dates, products, feature modules) plus optional starter content
  (risks/issues, milestones, key stakeholders, opening tasks). The proposal pre-fills the normal
  3-step wizard for review and edit — nothing is written until you create. Choosing a stored template
  instead replaces the AI-generated starter content (shown inline). Skip the step any time to set up
  manually. One structured Claude call; every proposed record passes the same per-entity validators
  as manual entry.
- **Configure the AI assistant from the new-project window.** The first-run empty state now offers a
  "Configure AI assistant" button alongside Turso and M365 setup — add your Anthropic API key before
  any project exists, which unlocks the "Use AI" describe step in the create wizard.
- **Reset to clean slate (Settings → General).** A danger-zone "Reset to clean slate" button, gated by
  a type-to-confirm dialog (type "yes, reset everything"), detaches every project and erases all
  browser-local app data — settings, secrets (including the Anthropic API key) and layout — then
  reloads to a fresh empty state. Project files and databases are NOT deleted; they are only detached
  and can be re-opened later.

## [0.102.0] - 2026-06-18 "Tepper"

AI-orchestration roadmap **SP2** — the embedded Claude assistant gains write tools beyond tasks,
plus document ingestion.

### Added
- **AI write tools for the whole register** — Claude can now create, update, and delete RAID items
  (Risks/Assumptions/Issues/Dependencies), change-control items, milestones, and stakeholders, and
  list stakeholders — not just tasks. Each entity routes through its existing sanitizer (enum/date/
  cap validation, per-category RAID status defaulting) and the popout read-only guard refuses every
  write in mirror windows, same as task edits.
- **Document ingestion** — attach a PDF, image (PNG/JPEG/GIF/WebP), or text file (.txt/.md/.csv) to
  the AI Assistant. PDFs and images go to Claude as native multimodal blocks; text files are inlined.
  Claude reads the document and, on request, extracts tasks/risks/milestones/stakeholders and creates
  them with the matching write tool. 20 MB per-file cap; unsupported types are rejected with a clear
  message. No new parsing dependency — this uses Claude's native document/image support.

### Changed
- The AI system prompt now briefs Claude on the RAID/Change/Milestone/Stakeholder tools and on the
  attach-and-extract workflow, and the confirm-before-delete rule now covers every delete tool.

### Removed
- The **Duplicate** button on built-in templates (Settings → Templates). Built-ins remain display-only;
  user templates are still created via "Save current project".

## [0.101.0] - 2026-06-18 "Kress"

UI/UX + secrets-management batch.

### Added
- **Manual document links** — the Documents view's "Add document" button is now always available
  (previously hidden unless SharePoint was enabled) and offers a manual name + URL entry (validated)
  for linking any document; the SharePoint picker still appears when M365 + SharePoint is on.
- **Stored-secret removal & passphrase confirm** — the Claude API key and Turso token settings now
  have a confirm-passphrase field (Save is disabled until both match) and a "Remove stored secret"
  button that forgets the ciphertext entirely.

### Changed
- **Reliable passphrase unset** — un-ticking "Require a passphrase to unlock" now always works
  (previously the AI-key toggle silently snapped back when the value was locked): it re-seals the
  value device-wrapped if it is in memory, otherwise forgets the locked-and-unknown secret.
- **Project delete moved off the active row** — the current/non-archived project no longer shows a
  destructive Archive/Delete button; those actions now live on the *other* (non-current) project rows
  so you cannot destroy the project you are in.
- **Full-width Milestones & Documents** — both views now fill the pane (were centered half-width) and
  scroll their content. Their resize-size storage key was bumped so a stale half-width size can't
  override the new full-width default (the pane is still user-resizable from the new baseline).
- **History compare restore** — per-row "Restore this" now also appears in the two-version and
  side-by-side compares (reverts the record to the older version); "Restore selected" moved up beside
  the per-row restores in the compare-with-current view; all compare/restore buttons gained tooltips.
- **Task editor alignment** — the "Edit task" heading and the control bar now line up with the field
  sections (the extra inset was removed).

### Fixed
- **Next-action button hover** — row CTA buttons now hover to a brand-blue tint distinct from the
  row's own hover, so the button affordance stays visible while the pointer is over the row.
- **Comm-template discoverability** — the template-category heading has a tooltip explaining the rows
  are clickable, and the rows themselves gained a hover effect.
- **Scrollbar gap** — added the standard content↔scrollbar gap to the Projects list, the Resources
  roll-up table, and the (now scrollable) Milestones table.

## [0.100.0] - 2026-06-18 "Hobb"

UI/UX consistency batch across many views, plus deeper version-history controls.

### Added
- **Whole-version restore** — every row in Version history now has a "Restore this state" button
  that reverts the entire workspace to that version (it diffs against the current state and restores
  all changes), alongside the existing selective restore.
- **Per-record restore in a comparison** — when comparing a version with the current state, each
  changed record now carries a "Restore this" button to revert just that record.
- **Side-by-side compare** — a "Compare side by side" button (beside "Compare selected") shows the
  two selected versions in two columns instead of an inline before→after diff.
- **Gantt → Milestones "Add milestone"** — clicking Add milestone in the Gantt now switches to the
  Milestones view and opens the New milestone dialog directly (previously the dialog was swallowed
  on the freshly-mounted view).
- **Milestones column-width reset** — the Milestones table gained the same "reset column widths"
  button the other tables have.
- **Task editor** — the full-page task editor now shows an "Edit task" / "New task" heading top-left
  and a ✕ close button beside the field cog; Jira-synced tasks get a "Sync with Jira" button beside
  Cancel; and several fields (group, dependencies, blockers, health) gained explanatory tooltips.

### Changed
- **Rounded table headers** — every data-table header now has rounded top corners on both ends
  (previously the right corner stayed square), unified via the shared header style.
- **Consistent scrollbar gap** — Budget, Open Points, Stakeholders, RACI, RAID, Change log, Activity,
  Manage Roles, Gantt and Calendar now keep a gap between their content and the scrollbar, matching
  the Dashboard.
- **Next-actions priority dots** now use the same Red/Amber/Green status colours as Open Points.
- **Change report** moved under the Reports nav group, beside the Budget and RAID reports.
- Next-actions action buttons show a pointer cursor on hover; the Re-baseline and Snooze dialogs
  close on an outside click (as well as Escape).

### Fixed
- **"Learning is on/off" deep-link** — clicking the Action Center learning pill now actually opens
  Settings → Next-actions (the request was being swallowed on the freshly-mounted Settings view).
- **Resource workload over-extension** — the Workload table no longer stretches a mostly-empty table
  far below a short resource list; it sizes to its content and scrolls only when it overflows.

## [0.99.1] - 2026-06-17 "Brackett"

### Security
- **Encrypted local credentials** — the Anthropic API key and Turso auth token are no longer
  stored in plaintext. They are encrypted at rest with WebCrypto AES-256-GCM using a non-extractable
  device-bound key (default), and can optionally be locked behind a per-secret passphrase
  (PBKDF2-SHA-256). Existing plaintext credentials are migrated automatically on first load; a
  passphrase-locked Anthropic key prompts to unlock in the chat panel, and a passphrase-locked Turso
  token prompts at startup before the workspace loads. No recovery — a forgotten passphrase means
  re-entering the value. (Same-origin code can still read a decrypted secret at runtime; this protects
  against storage theft, profile sync, backups, and shared machines — not XSS.)

### Fixed
- **Turso empty state after archiving the last project** — when the portfolio is in Turso mode and the
  last active project is archived, the empty-state screen now offers a way forward instead of trapping
  the user. It lists archived projects with a one-click **Restore** **and a type-to-confirm Delete
  (permanent)**, and the **Load from file** button is shown (in Turso mode it switches the portfolio to
  file mode and reloads, keeping the `portfolioMode === "turso" ⇔ storageConfig.kind === "turso"`
  invariant intact). Previously "Load from file" was hidden in Turso mode and no restore/delete path
  existed on this screen.
- **Sample-workspace data polish** — populated the previously-empty project `status` (overall RAG +
  PM narrative) so the dashboard status summary demos real content; linked tasks #3/#9/#10 to their
  matching resources (Aria/Sample were half-linked); corrected the Alex Example contact email to her real
  Acme address (marked synced); and aligned the David Okoro stakeholder organization to the
  project customer (Northwind Retail Group). Regenerated the `-big`/`-huge` datasets, the Turso SQLite
  exports, and the golden serializer fixtures.

### Changed
- **"Ask Claude" placement** — the Ask-Claude pill now sits in the top bar's left cluster, directly
  beside the project switcher, in both the modern and classic layouts (its dropdown now opens to the
  right so it never clips). Previously it sat in the right-hand control cluster.
- **Influence/Interest map is interactive** — clicking a stakeholder chip on the map now opens that
  stakeholder's editor (deep-link), instead of being inert text.
- **Scaled demo datasets read as genuinely larger** — `scaleWorkspace` now gives replicated
  stakeholders distinct names (and drops the now-stale shared-resource link) and qualifies replicated
  work-item titles by workstream, instead of appending a "(2)"/"(3)" numeric suffix to identical rows.

## [0.99.0] - 2026-06-17 "Brackett"

### Added
- **Dashboard variance summary** — an embedded, Turso-gated summary on the dashboard shows headline KPI
  deltas against the baseline (no snapshots required).
- **Resizable panes with right-aligned reset buttons** across Dashboard (fixing a broken reset), the
  Action Center, and Documents; the Milestones reset-size button moved to the right of its header, and an
  Influence/Interest reset-size button was added.
- **Documents as a centered pane** — the Documents tab now renders as a centered, padded Milestones-style
  pane; the Add-document button is gated behind an active M365 + SharePoint connection.
- **Reports nav grouping** — the Budget and RAID reports are now grouped under the single Reports nav item.
- **Ask Claude pill** — the "Ask Claude" control now leads the top-bar controls as a clearly labeled pill.

### Changed
- Removed the resize corner-hint glyph and added a scrollbar gap to pane scroll regions for cleaner chrome.
- Restyled the Trends snapshot links to match the Open Points link style.
- Strengthened the Next-actions CTA hover affordance; the Action Center learning flag now has an explanatory
  tooltip that deep-links to the Next-actions settings.

### Fixed
- Influence/Interest dark-mode contrast.
- Dashboard status summary: the Clear button now resets the textarea to its default height, and the
  textarea auto-shrinks as content is removed.

## [0.98.0] - 2026-06-17 "Pohl"

### Added
- **Foundational one-tap prompts** — the AI Assistant now offers a row of one-tap prompts
  (What's next? / Status overview / Prioritize) that send to Claude on click, no typing required.
- **"Ask Claude" top-bar menu** — a shared, context-aware menu in the header surfaces view-specific
  suggested prompts for whatever you are looking at; picking one opens the chat seeded with that prompt
  and auto-sends it.
- **Chat-seed channel** — a new `requestChat` entry on the workspace tab context lets any surface open
  the AI Assistant pre-filled with a prompt (and optionally auto-send it).

## [0.97.0] - 2026-06-16 "Gaiman"

### Added
- **Operating-guide library** — a global store (localStorage + optional Turso, kept outside `TABLE_NAMES`
  so saves never wipe it) holds named operating guides. Each guide has a priority, an enable toggle, and
  optional scope tags (mode / module / view) that narrow when it is injected. A built-in leadership guide
  is seeded as an editable default on first use.
- **App-context awareness** — the AI system prompt now receives the current app mode (simple / modular /
  advanced), the list of enabled modules, and the active view. Claude uses this context to act as a senior
  project & program manager and tailor advice to what is visible on screen.
- **"Ground Claude in operating guides" master toggle** — a new AI settings control lets users enable or
  disable guide injection globally. An in-app guide editor (scope + priority + body) and a token-budget
  warning are shown alongside the toggle.
- **Prompt caching of guide text** — the stable portion of the system prompt (guides + role context) is
  marked for prompt caching to reduce latency and token cost on repeated turns.

## [0.96.0] - 2026-06-16 "VanderMeer"

### Added
- **Outlook calendar write-back** — a "Push to Outlook" button on the Milestones view reconciles the
  current project's milestones into your Outlook calendar as all-day events (create / update / remove),
  tagged so a re-push stays idempotent. One-way (the app owns milestone dates); opt-in under
  Settings → Integrations → Microsoft 365. Requires M365 sign-in + Calendars.ReadWrite consent.
- **Scalable sample datasets** — the bundled sample workspace is now `sample-workspace-small.*`, with
  generated `-big` (3×) and `-huge` (10×) variants (JSON + SQLite) for testing larger projects. A pure
  `scaleWorkspace` helper replicates every entity with id-offset + full FK remap (no dangling refs).

### Changed
- **Settings IA** — General now hosts the Appearance and Storage sections (divider-split sub-sections)
  instead of separate rail entries; Communication Templates moved directly below Templates and is
  Expert-mode only.
- **Action Center polish** — each action row shows a per-source icon with a tooltip carrying its
  calculated score; tiers sort by score (highest first); an Expert-mode "Learning is ON/OFF" status
  pill in the header links to the Next-actions settings.
- **Influence/Interest matrix** — readable text contrast (labels on solid chips, decoupled from the
  quadrant tint); stakeholders with a pending communication show a "needs communication" marker that
  jumps to the Action Center.
- **Dashboard** — the Trends show/hide toggle moved to the top toolbar; the status-summary buttons sit
  below an auto-growing textarea; the budget-burn section now shows CPI.
- **New-project wizard** — an informational note recommends the Turso backend (richer features, more
  complete data model, more automation than file storage).

## [0.95.0] - 2026-06-16 "Hopkinson"

### Added
- **Action Center learning layer** — the Action Center now learns from how you respond to suggested
  actions (act / snooze / dismiss) and applies a bounded, safety-capped bias to ranking so it surfaces
  fewer, higher-value next-best-actions. Opt-in (Settings → Next actions); a per-row hint explains any
  adjustment; a learning-insights view shows per-kind stats with manual Auto/Surface/Suppress/Off
  overrides. Learning data lives in this browser or, optionally, in Turso (shared across devices).
  Urgent items are never hidden.

## [0.94.0] - 2026-06-16 "Mieville"

### Added
- **Desktop notifications for urgent actions** — opt-in browser notifications raised when a new
  urgent ("now") Action Center signal appears while the app tab is in the background. One popup per
  new signal (deduped); a burst coalesces into a single "N new urgent actions" summary. Enable it in
  Settings -> Notifications (requests browser permission). Browser-only; the tab must be open.

## [0.93.0] - 2026-06-16 "Cadigan"

### Added
- **Re-baseline CTA (Action Center):** drifting rows now carry a one-click "Re-baseline" action. Slipping/overdue milestone rows open a confirm popover with the new target date prefilled to the linked-task forecast (editable) and move `milestone.date` on confirm — works on every backend. Schedule-slipping and budget-worsening rows capture the project's current state as a new Turso snapshot baseline (Turso-gated; the previous baseline is kept in history). Surface-only; the next-actions engine is unchanged. Execution-depth roadmap slice 5.

## [0.92.0] - 2026-06-16 "Asaro"

### Added
- **Escalate action** — at-risk RAID items in the Action Center now have an "Escalate" button. It raises the item's severity one level (Issue/Assumption/Dependency; Risks and already-Critical items are notify-only since Risk severity is matrix-derived) and opens a prefilled escalation email to a chosen recipient, in one confirm step.

## [0.91.0] - 2026-06-15 "Stross"

### Added / Changed
- **Communication templates HTML send (SP4)**: send templates as real HTML email
  via Microsoft 365 Graph — an Outlook-draft mode (creates a reviewable HTML draft)
  or an in-app preview-then-send mode, switchable in settings. The plain-text email
  app (mailto) remains the default and the fallback when M365 is unavailable. This
  completes the editable communication-templates roadmap.

## [0.90.0] - 2026-06-15 "Russ"

### Added / Changed
- **Communication templates versions (SP3)**: save named versions of a template,
  compare any two as a rendered plain-text diff, and restore an earlier one — the
  current draft is auto-snapshotted before a restore so nothing is lost. Versions
  live in an append-only Turso table (out of the workspace save cycle). This
  completes the editable-templates roadmap ahead of the optional Graph HTML-send slice.

## [0.89.0] - 2026-06-15 "Bujold"

### Added / Changed
- **Communication templates rich-text editor (SP2)**: the Turso-only template
  Settings pane now edits bodies in a lazy-loaded Tiptap editor — bold, italic,
  underline, headings, bullet/numbered lists, and links — with the merge-field
  chips inline. Authored HTML is sanitized with DOMPurify on save. The body is
  still stored as HTML and flattened to plain text on send (rich HTML send
  arrives with the Graph slice). SP3 (named versions + compare/restore) is next.

## [0.88.0] - 2026-06-15 "Niven"

### Added / Changed
- **Communication templates (SP1)**: author named, categorized email templates
  (status inquiry, stakeholder update) with `{{merge-field}}` placeholders in a new
  Turso-only Settings pane. Each category has a default template that the "draft
  email" send flows (status-chase + stakeholder message) use automatically, rendered
  to plain text for the `mailto:` body. Off-Turso, the existing i18n body templates
  remain the fallback. Templates are stored globally (shared across projects) in a
  dedicated `comm_templates` table, kept out of the workspace save/load cycle.
- Foundation for later slices: SP2 will add a rich-text (Outlook-like) editor, and
  SP3 named template versions with compare/restore.

## [0.87.0] - 2026-06-15 "Wells"

### Added / Changed
- **Draft message from Action Center**: task-due and stakeholder-comms inbox rows
  now show an inline "Draft message" CTA that opens a prefilled `mailto:` in your
  mail client. Task-due reuses the existing status-inquiry flow; stakeholder-comms
  composes a new mailto addressed to the stakeholder (surface-only change; engine
  untouched).
- **Third execution-depth slice**: following assign-owner (0.86.0) and create-task
  (0.85.0), this slice continues resolving Action Center signals directly in the
  inbox, reducing modal navigation for common triage actions.

## [0.86.0] - 2026-06-15 "Hamilton"

### Added / Changed
- **Assign owner from Action Center**: RAID risks without an owner now show an
  inline "Assign owner" CTA in the Action Center inbox row. Clicking it opens a
  `ResourcePicker` popover that writes the owner field immediately — no editor
  round-trip required (surface-only change; engine untouched).
- **Second execution-depth slice**: following the create-task CTA (0.85.0), this
  slice continues the pattern of resolving Action Center signals directly in the
  inbox, reducing modal navigation for common triage actions.

## [0.85.0] - 2026-06-14 "Liu"

### Added / Changed
- **Tooltip clamp**: long tooltips across planning, RAID, and settings surfaces are
  now clamped to a max-width so they never overflow the viewport.
- **Manage Roles / Projects / Milestones resize controls**: each table panel gains
  explicit column-resize handles, consistent with the rest of the application.
- **Stakeholder matrix contrast**: row/column header cells meet WCAG AA contrast
  requirements; chip colours updated to pass the a11y gate.
- **Report drag-reorder**: reports in the composable-reports panel can be
  reordered by dragging, replacing the old up/down button approach.
- **Snapshot delete** (single + bulk): individual snapshots can be deleted from
  the Trends detail view; the bulk-delete action clears all snapshots for a
  project in one step.
- **Next-actions formula explainer**: the ranking-weight sliders in
  Settings → Next actions now include an inline formula preview so the combined
  score is transparent.
- **Dedicated Storage settings section**: Turso/IndexedDB/file storage options
  have been extracted from Integrations into their own Settings rail entry.
- **Dashboard layout**: the Changes and Top-actions columns are now independently
  resizable; column order has been rationalised.
- **Dashboard Trends toggle**: a new toggle on the Dashboard lets users
  show/hide the Trends mini-chart without leaving the view.
- **Calendar row height**: the calendar view respects a compact/comfortable
  density setting, matching the task-table density control.
- **Budget date/stepper alignment**: date pickers and numeric steppers in the
  budget editor are now vertically aligned with their labels.
- **Budget CPI/Consumption percent display**: CPI and budget-consumption values
  are shown as percentages with one decimal place throughout the budget report.
- **Budget-report tooltips (hidden in print)**: metric-explanation tooltips on
  the budget report are suppressed in print/PDF output to avoid clutter.
- **RAID-report aging layout**: the aging column in the RAID report has been
  tightened and aligns consistently with the status and priority columns.
- **A11y fixes**: several interactive elements across the wizard, settings panel,
  and report tables received missing `aria-label` / `role` corrections surfaced
  by the Playwright axe gate.

## [0.84.0] - 2026-06-14 "Cherryh"

### Added / Changed
- Action Center gains a **"Create task" CTA** on every signal card (except
  task-due, which already links to an existing task). Clicking it opens the
  task editor pre-seeded with a title derived from the signal and a "From"
  note explaining why the action fired — no blank-form hunting required.
- RAID-originated signals (no owner, overdue review) automatically populate
  **linkedTaskIds** on the new task, so the RAID item shows the follow-up
  task as linked once the editor is saved.
- The flow is **propose-then-confirm**: the editor opens pre-filled but fully
  editable; the task is only created when the user saves, preserving the
  normal task-creation guardrails and validation.

## [0.83.0] - 2026-06-14 "Robinson"

### Added / Changed
- The Action Center now ranks suggested actions by **confidence** — how
  actionable a signal is — using a hybrid score. A clarity bonus and a
  static-signal penalty mean a clear, actionable item can now outrank a vague,
  static red, instead of ordering purely by raw severity.
- Snapshot-trend awareness for the **budget** and **schedule** signals: a metric
  that is actively worsening (compared to the previous snapshot) is ranked higher
  than one that is merely bad but stable.
- Root-cause **why-text** (magnitude + trend) is now attached to the budget,
  schedule, and RAID-no-owner actions, so each suggestion explains *why* it
  fired rather than just *that* it fired.
- New configurable **ranking weights** under **Settings → Next actions**, letting
  you tune how clarity, trend, and severity combine into the final ranking.
- The inbox now has a collapsible **"monitor"** group, separating
  keep-an-eye-on items from the ones that need action now.

## [0.82.0] - 2026-06-14 "Jemisin"

### Added / Changed
- The empty-state (no project yet) "Load from file" now accepts any supported
  file format — JSON, CSV, or Markdown — in a single picker and detects the
  format from the chosen file's extension, instead of only loading JSON. This
  also applies to the "Load from file" actions in the project switcher and the
  Projects panel.
- Moved the **History** navigation entry from the Overview group to the System
  group, directly below **Activity**.
- The Manage Roles pane is now manually resizable (drag the bottom-right corner)
  while still scaling to its content by default, with a reset-size button that
  returns it to the content-fit default.
- The Archive action in the Projects panel now has a tooltip explaining that an
  archived project can be permanently deleted from the archived list.
- The Settings rail is now sorted alphabetically, with **Information flows**
  pinned to the bottom under a divider.
- Manage Roles now has a reset-column-widths button, matching the other tables.
- Added an **Expert mode** toggle to Settings. The advanced sections (Mode,
  Templates, Notifications, Next actions, Export) and the toolbar's
  save-as-template / apply-template actions are hidden unless expert mode is on.
  The connectivity sections (AI assistant, Jira, Integrations) are now grouped
  together above Information flows, each under its own divider.
- New **Settings → Next actions** section to override the signal-firing
  thresholds of the suggested-next-actions engine: pending-changes count, the
  schedule SPI warn / critical levels, the workload over-allocation % (and its
  critical level), and the overload overdue-task count (and its urgent level).
  Each field shows its default and there is a reset-to-defaults button; invalid
  values fall back per-field. Day-based lead times stay under Notifications.
- Explanatory InfoTooltips on non-obvious table-column headers across the app
  (RAID Severity; Change Impact; Stakeholder Influence / Interest; Trends
  Baseline / Delta; Resources report Capacity / Internal / External / Margin /
  Avg util.; the Inquiries count; RAID report Age) — matching the Manage Roles
  rate-card headers. `SortHeaderButton` gained an optional `hint` prop.

### Fixed
- Settings changes now propagate across the whole page without a reload. The app
  has several independent `useSettings()` instances (the canonical shell, the
  standalone workspace/pop-out section, and read-only consumers); previously a
  change made through one — e.g. accepting the AI-usage policy, or toggling a
  setting in the Settings menu — did not reach the others until a reload. Each
  instance now broadcasts changes to the others. This also fixes the chat
  consent screen ("I understand") not opening the assistant.
- Snapshot auto-capture no longer throws `StorageNotReadyError` on mount when
  the storage kind is "turso" but the URL/token are unset or quarantined: the
  trends-active gate now requires a non-null Turso config, and `useSnapshots`
  defensively skips the load when no config is present.
- Version-history auto-capture no longer writes an empty version when a save
  only bumped bookkeeping timestamps (`localModifiedAt`): the auto trigger now
  checks the meaningful diff (which ignores volatile fields) instead of raw
  byte equality, so an interval with no real change produces no version.

## [0.81.0] - 2026-06-14 "Wolfe"

### Added / Changed
- Trends tables now have resizable columns and match the rounded table style.
- Suggested-action chips show a tooltip explaining why each is flagged and open
  the relevant item (task / RAID / change / milestone / stakeholder) when clicked.
- The RACI picker is now compact: it shows the selected role and expands to all
  roles (plus clear) on click, collapsing on outside-click.
- New **Documents** tab: every linked file across tasks, RAID, changes,
  milestones, stakeholders, and the project in one place — open a link, jump to
  its source, remove it, or attach a new one to any item.

### Fixed
- Manage Roles header tooltips read in normal case and are no longer clipped by
  the table border; the Manage Roles pane fits its content without exceeding the
  viewport.
- The Manage Roles rate fields now show the project's currency symbol (from the
  budget plan's currency) instead of a hard-coded €.

## [0.80.2] - 2026-06-14

### Fixed
- Accessibility: error / validation / RAG-red text used the bright brand pink
  (~3.76:1 on white, below WCAG AA). Added a darker `pink-strong` shade (mirroring
  the existing `green-strong`) and applied it to those text uses; the bright pink
  is unchanged for fills, borders, and text on dark surfaces.
- Toast notifications now use a colour-tinted background (pink for errors, blue
  otherwise) with accent text — matching the in-app error boxes — instead of the
  plain bordered surface, while staying AA-readable in both light and dark themes.

## [0.80.1] - 2026-06-14

### Fixed
- Accessibility: toast notifications now use a coloured left-accent border on a
  readable surface background instead of white-on-colour fills — the error
  toast's white-on-pink combination failed WCAG AA contrast.

## [0.80.0] - 2026-06-14 "Kress"

### Added
- **Two new suggested-action signals.** A **schedule** warning surfaces when the
  project trends behind plan (EVM schedule performance index below 1.0), and
  **workload** alerts flag people who are over-allocated (>100% planned) or
  carrying several overdue items. Both appear in the Action Center and as inline
  chips, clickable straight to the dashboard / workload view.

## [0.79.2] - 2026-06-14

### Fixed
- Accessibility (WCAG AA contrast): info-bearing green text on light backgrounds
  now uses the darker `green-strong` shade; the RACI chips are readable in both
  selected and unselected states; and the Milestones table got the standard dark
  header (it was the only table still using a light one, which made its green
  sort label fail contrast). The automated accessibility gate now also covers the
  Stakeholders, Changes, Milestones, Reports, and Activity views.

## [0.79.1] - 2026-06-14

### Fixed
- Components added since the 0.16.0 palette sweep had reintroduced legacy grey
  chrome utilities; re-swept them to semantic surface tokens. No change in light
  mode; dark mode now renders these surfaces correctly, and a stray off-palette
  border was removed. A new guard test prevents the chrome greys from drifting
  back.

## [0.79.0] - 2026-06-14 "Willis"

### Added
- **Inline action chips:** the most urgent next action(s) for a view now appear
  as compact chips at the top of that view (RAID, Open Points, Budget, …) and on
  each Reports section. Click a chip to jump straight to the item; `+N more` opens
  the Action Center. Completes the "suggested next actions" feature.

## [0.78.0] - 2026-06-13 "Hopkinson"

### Changed
- The due-dates, RAID-review, and stakeholder-comms **reminder banners and
  modals are gone** — those nudges now live in the **Action Center** as ranked
  actions. The header bell opens the Action Center. Snooze any action for 1 hour
  or 1 day; it returns when the timer lapses. (Birthday, Jira-token, storage, and
  safe-mode banners are unchanged.)

## [0.77.0] - 2026-06-13 "Russ"

### Added
- **Action Center.** A new "Next actions" view turns the project's signals
  (overdue tasks, open Critical/High RAID + reviews due, pending changes,
  overdue/at-risk milestones, budget overruns, stakeholder-comms due) into a
  ranked queue grouped Now / Soon / Monitor — click a row to jump straight to
  the item. Plus a "Top actions" card on the Dashboard and a nav badge counting
  the urgent ("now") items. (Consumes the next-actions engine.)

## [0.76.0] - 2026-06-13 "Delany"

### Added
- Color-coded RACI chip picker (replaces the dropdown) with an aligned legend.
- Field tooltips across the Manage Roles, Edit Resource, New Absence, Budget,
  Edit RAID, Edit Change, and Edit Stakeholder editors.
- RAID-style clickable rows on Stakeholders, Directory, Workload, and Planning —
  click a row to open its editor (inline inputs unaffected).
- Currency (€) symbol next to the Manage Roles rate fields.

### Changed
- Resource Calendar now uses the full resizable pane (was a smaller centered
  pane), matching Workload's size.
- Planning's absence-override input matches the utilization input's size.
- Removed the New-task button from the modern top bar.

### Fixed
- Edit Change / Edit Stakeholder / Edit Task modals now show correct headings
  ("Edit change" / "Edit stakeholder" / "Edit task") instead of the view names.

## [0.75.0] - 2026-06-13 "Nagata"

### Added
- **Emergency recovery / safe mode.** Boot the app into a clean configuration
  without losing data:
  - `?safe=1` (also `?safe` / `#safe`) boots on the browser/file backend at the
    empty state, ignoring stored config in memory — nothing is read or written.
  - A standalone `/recovery` page (isolated from the main app tree) to download
    the current config, reset to a clean slate, or restore the last config.
  - Reset is **non-destructive**: the three config keys (`settings`,
    `portfolio-mode`, `turso-current-project`) are moved to timestamped backup
    keys, never deleted. Project data, the registry, IndexedDB, and any Turso
    cloud database are untouched.
  - A top-level error boundary replaces white-screen crashes with a recovery
    fallback.

### Fixed
- Turso portfolio: "Move to Turso" and the Integrations portfolio switch now
  persist `storageConfig.kind="turso"`, so the workspace backend follows the
  portfolio instead of staying on the local file (which broke snapshot capture).

## [0.74.0] - 2026-06-13 "Niven"

Create-project wizard & empty-state overhaul — a wider, resizable modal, a
focused required-field form with the rest tucked behind an optional section, a
mandatory Contacts field, a unified storage selector with Turso configuration at
creation time, and a first-run backend-setup surface.

### Added
- **Storage selector with Turso.** The create form's "File format" selector is
  now "Storage" and offers Turso alongside JSON/CSV/Markdown. Picking Turso opens
  a backend-config modal (Turso database URL/token, M365 sign-in, portfolio
  storage mode) so you can set it up without leaving the wizard; the new project
  is then created on the Turso backend.
- **First-run backend setup.** On a fresh install (no projects yet) the
  empty-state offers "Configure the Turso backend" and "Configure M365
  integration" buttons — the only way to reach those settings before a project
  exists. The dead, non-functional ✕ on that non-dismissable modal is gone.
- **"Link to Jira"** project field (joins Salesforce / SharePoint / Confluence),
  persisted across JSON/CSV/Turso.
- Field tooltips across the project form, including a Contacts tooltip explaining
  the "Add manually" picker, the email field, and the Add button.
- A stepped identity-count datalist (50 … 1,000,000,000) suggesting common scales.

### Changed
- **Mandatory Contacts, optional stakeholders.** At least one contact person
  (linked from your resources / address book, or typed in) is now required;
  internal and external key stakeholders became optional and moved into the
  optional section. Existing projects saved without contacts still load.
- **End date is optional** (it was required, and was the cause of the Next button
  staying disabled on an otherwise-complete form).
- The new-project modal is wider (960px) and **resizable** (drag the corner; a
  reset-size button restores the default). Non-mandatory fields are collapsed by
  default under an **"Optional details"** disclosure. Regulatory requirements
  render in two columns.

### Notes
- The sample workspace (`sample-workspace.json` / `.sqlite3`) was regenerated to
  include the project's Jira link and a second contact.

## [0.73.0] - 2026-06-12 "Bester"

Template suggestion — the creation wizard recommends and preselects the best-fit
template from the project's parameters.

### Added
- Deterministic template suggestion at project creation: the wizard's Template
  step scores the project's parameters (team size, regulated flag, deployment,
  duration, identity scale) and preselects + badges the recommended template,
  with a reason line explaining why it fits. You can still pick any other
  template or start from Blank.

### Notes
- Completes the 4-part templates feature: field visibility (0.70.0), project
  templates (0.71.0), per-project functions + creation wizard (0.72.0), and
  template suggestion (0.73.0).

## [0.72.0] - 2026-06-12 "Zelazny"

Per-project functions — each project keeps its own enabled modules (reactive, no
reload) plus a 3-step creation wizard.

### Added
- Enabled functions (modules) are now stored on each project rather than globally.
  Switching projects applies that project's functions reactively — the navigation
  and automation update without a page reload.
- A 3-step project-creation wizard (Details → Template → Functions) that applies
  a template's field visibility, optionally appends its starter content, and sets
  the chosen functions, all at creation time.

### Changed
- The Settings → Mode section now configures the current project's functions
  (it no longer toggles a global setting or triggers a reload).
- Resolves the "coming soon" note from 0.71.0: a template's feature mode is now
  applied when you create a project from it (via the wizard).

### Fixed
- Per-project field visibility (introduced in 0.70.0) and the new per-project
  functions are now persisted in multi-project Turso mode and in the default
  IndexedDB backend; previously these were dropped on reload in those modes.

## [0.71.0] - 2026-06-12 "Bear"

Project templates — reusable project setups (mode + field visibility + optional starter content).

### Added
- A cross-project library of reusable project templates: three built-in starters
  (minimal, standard, and full delivery skeletons) plus a "Save current project
  as a template" action that snapshots the current setup.
- A Templates section in Settings to manage your saved templates — list, rename,
  duplicate, and delete (built-in templates are read-only).
- An "Apply template" entry in the actions menu sets the project's field
  visibility and optionally appends the template's starter content with re-id'd
  entities. Applying is non-destructive — your existing items are kept.
- User templates are persisted in settings (localStorage).

### Changed
- Applying a template never overwrites existing data; starter content is appended
  with fresh ids and internal references rewired.
- Upcoming: applying the feature mode at project creation and template
  suggestions are planned for a future release.

## [0.70.0] - 2026-06-12 "Heinlein"

Per-modal field visibility — Simple / Advanced / Full views with a configurable cog.

### Added
- Every entity editor (task, RAID, change, milestone, stakeholder, resource,
  absence, and budget) now has a Simple / Advanced / Full field-visibility
  switch, plus a cog to show or hide individual fields. The default view is
  Advanced.
- The chosen view and per-field overrides are persisted per project across all
  storage backends (File, CSV, Markdown, and Turso).

### Changed
- Required fields are always shown regardless of the selected view, and hiding a
  field only changes what you see — it never deletes the underlying data.

## [0.69.0] - 2026-06-11 "Simmons"

Version history — retention, module toggle & polish (Turso only; final slice).

### Added
- A configurable retention setting (Settings → "Version history: keep N
  versions"; minimum 50, in steps of 10, up to 1000) controls how many automatic
  versions are kept per project; named checkpoints are always kept.
- Version history is now a toggleable feature-module — turn the History view on
  or off like the other modules. While off, no versions are captured (it still
  requires the Turso backend either way).

### Changed
- Restoring now records an immediate version checkpoint of the restored state
  (no waiting for the next autosave).
- Naming a manual checkpoint uses an inline themed input instead of a browser
  prompt.

## [0.68.0] - 2026-06-11 "Brin"

Version history — selective restore (Turso only; third slice).

### Added
- From a "Compared with current" view you can now restore selectively: tick whole
  records or individual fields and click "Restore selected". Restoring reverts a
  changed field to the version's value, brings back a record deleted since the
  version, or removes a record added since — only for what you tick. Restore is
  non-destructive: it applies to your current data (saved as a new version) and
  is recorded in the activity log.

## [0.67.0] - 2026-06-11 "Niven"

Version history — compare (Turso only; second slice).

### Added
- The History view can now compare versions: click "Compared with current" on a
  version to see what changed versus the current data, or tick two versions and
  "Compare selected" to compare them with each other (ordered oldest→newest).
  Changes are grouped by type (tasks, RAID, milestones, resources, budget, …) and
  each record expands to show field-level before→after.
- The timeline now captions each version with a short summary of what changed
  (e.g. "3 Tasks, 1 RAID").

## [0.66.0] - 2026-06-11 "Egan"

Data version history — capture & timeline (Turso only; first slice).

### Added
- On the Turso backend, the app now keeps a per-project version history. Edits
  are captured automatically a few minutes after they settle (rapid changes
  coalesce into one version), and you can save a named checkpoint at any time
  via "Save version now". A new **History** view (shown only on Turso) lists the
  timeline. Comparing versions and restoring are coming in the next releases.
- Automatic versions are pruned to the most recent 50 per project; named
  checkpoints are kept. (A configurable retention setting arrives in a later
  slice.)

### Notes
- Backward compatible: version history is a separate append-only table; existing
  workspaces, exports, and the relational data are unaffected — no schema change
  to existing tables and no migration. The feature is hidden and inert on the
  file/IndexedDB backends.

## [0.65.0] - 2026-06-11 "Cherryh"

Resource-linked project contacts — the final slice of the person-identity
normalization (SP4).

### Added
- A project's contact persons can now link to a Resource. The add control is a
  resource-aware picker (registry people suggested first, the address book as a
  fallback): picking a registry person links the contact via a new
  `resourceId`, while a free-typed name (with an optional email) stays an
  external contact. Linked contacts show a small indicator in the list. This
  completes the resource-normalization of every person surface — tasks, RAID
  owners, shifts, stakeholders, and now project contacts.

### Notes
- Backward compatible: unlinked contacts serialize exactly as before (the
  resource link is stored only when set), so existing workspaces, exports, and
  Turso databases are unaffected — no schema change and no migration.

## [0.64.0] - 2026-06-11 "Hamilton"

Per-resource RAID ownership rollup (identity normalization SP3).

### Added
- The workload/people view now shows an "Open RAID" count per resource — how many non-terminal RAID items each person owns, resolved by the owner link set in 0.63.0 (falling back to the owner name into the unlinked bucket). The first view to consume the resource-ownership links.

## [0.63.0] - 2026-06-11 "Bujold"

Resource-aware people pickers across RAID, shifts, and stakeholders (identity normalization SP2).

### Added
- The RAID owner and shift assignee fields are now resource-aware autocompletes (registry-first, contacts fallback, "+ Add as resource"), linking to a Resource via `ownerResourceId` / `resourceId`.
- The stakeholder name field is a resource-aware typeahead that links to a Resource or leaves the stakeholder external — replacing the separate link-to-resource dropdown. External stakeholders (no link) remain a first-class state.

### Changed
- `ResourcePicker` gains an optional `onCreateResource`; omitting it yields the link-only variant used by stakeholders.
- Removed the now-dead shift assignee datalist (`shiftKnownAssignees`) — superseded by the picker.

## [0.62.0] - 2026-06-11 "Liu"

Resource-aware people picker (identity normalization SP1).

### Added
- The task assignee is now a resource-aware autocomplete: registry people are suggested first (picking one links the task to that Resource via `resourceId`), remembered contacts remain as a fallback, and "+ Add as resource" creates and links a new resource inline. A linked assignee shows the resource's current name/email — edit the person once on the resource and it updates everywhere — and a broken link can be cleared. The Resources → Workload view already resolves people by this link.

### Changed
- `ContactInput` is replaced by the new shared `ResourcePicker` component.

## [0.61.0] - 2026-06-11 "Robinson"

Resource-identity normalization for RAID owners and shift assignees.

### Added
- `RaidItem.ownerResourceId` and `Shift.resourceId` — stable foreign keys linking a RAID item's owner and a shift's assignee to the Resource registry, mirroring the existing `Task.resourceId` / `Absence.resourceId`. Both are optional and additive; the denormalized name/email strings are kept as a display cache.
- A schema migration (workspace v11) that back-fills these two new keys and the previously-unused `Absence.resourceId` by matching each record's email against `Resource.email` (case-folded, email-only — no name guessing). Idempotent: already-set links are never overwritten.

### Changed
- Schema versions bumped: workspace 10 → 11, Turso single-tenant 10 → 11, Turso multi-project 11 → 12.

### Known limitation
- **Existing Turso databases need their `raid` and `shifts` tables recreated.** The new columns are not auto-added to an already-deployed Turso schema (the relational tables use `CREATE TABLE IF NOT EXISTS`), so the first save after upgrading would reference a missing column and fail. To migrate a live single-tenant or multi-project Turso database, clear and re-save the workspace (or re-import it) so the tables are recreated with the new columns. The default browser (IndexedDB) and file-based backends migrate automatically with no action needed.

## [0.60.5] - 2026-06-11 "Stephenson"

Security documentation (refactor Batch E — final batch of the v0.60.x refactor plan).

### Changed
- The AI consent screen now states explicitly that the API key is stored unencrypted in the browser's localStorage and sent directly to api.anthropic.com, and recommends a dedicated spend-limited key.
- All three credential fields (Anthropic API key, Jira API token, Turso auth token) show a storage note: unencrypted localStorage — don't use production credentials on shared machines.
- README gained a "Security Model" section documenting the local-first BYO-key architecture: what is stored where, what leaves the browser, and credential recommendations.
- Verified (audit item S2): credentials never appear in workspace exports, the activity log, or console output.

## [0.60.4] - 2026-06-11 "Stephenson"

Performance + reliability (refactor Batch D).

### Performance
- Turso autosaves are now proportional to what changed: only tables whose data actually changed are rewritten (a status-only edit drops from ~535 statements / ~590 KB to ~20 statements / ~4 KB on a 500-task workspace), and a save with zero changes skips the network round-trip entirely.
- The three hottest React context providers (workspace, task form, filters) memoize their value objects — unrelated panels no longer re-render on every keystroke.
- Gantt dependency arrows use a precomputed row-index map instead of per-edge linear scans (O(n²) → O(n) per frame).
- Browser (IndexedDB) saves and loads run their independent store operations in parallel (~17 sequential awaits → one `Promise.all`), with all-or-nothing baseline semantics pinned by tests.

### Reliability
- A failed project-registry write (localStorage quota/disabled) now shows a toast instead of silently risking the project list.
- A pending debounced save is flushed immediately when the tab is hidden or closed (`visibilitychange`/`pagehide`) — edits made in the last 500 ms before closing are no longer lost.
- Multi-tab Turso writes are serialized via the Web Locks API (per DB + project, 20 s bounded wait). Simultaneous editing in two tabs remains last-write-wins per table and is documented as unsupported in the README.
- Turso project operations (create, update, archive, restore, delete, repoint) now surface failures as toasts instead of failing silently; the logic moved from `task-manager.tsx` into a tested `use-turso-projects.ts` hook, and the feature-mode redirect logic is now a tested exported function in `feature-modules.ts`.

## [0.60.3] - 2026-06-11 "Stephenson"

Structural refactor (Batch C — zero behavior change; on-disk format byte-stability proven by the golden fixtures at every step).

### Changed
- `storage.ts` split from a 3,466-line god module into a 126-line facade over seven focused modules: `workspace.ts` (Workspace type, migrations, JSON codec), `idb.ts`, `fs-access.ts`, `csv-codecs.ts`, `markdown-codecs.ts`, `browser-backend.ts`, `local-file-backend.ts`. All existing imports keep working via re-exports.
- The two Turso backends merged into one `TursoBackend(config, projectId?)` — single-tenant and multi-project modes share one class; `turso-tenant-backend.ts` removed.
- `RaidEditModal` extracted from `raid-panel.tsx` (1,493 → 703 lines) into `raid-edit-modal.tsx`, matching the other entity modals; shared labels moved to `raid-labels.ts`.
- Pure Gantt logic (preferences, date helpers, bar derivation, critical-path algorithm) extracted from `gantt.tsx` (1,967 → 1,493 lines) into React-free `gantt-engine.ts`.
- `settings-menu.tsx` no longer re-exports settings types; 29 files import `settings-types.ts` directly.

### Fixed
- Four module-import cycles dissolved (`storage ↔ settings-types`, `storage ↔ sharepoint/turso backends`, `settings-menu ↔ jira-settings`, `settings-menu → jira-settings → jira-api`); the storage layer is now a strict DAG (workspace/idb leaves → codecs → backends → facade).

## [0.60.2] - 2026-06-10 "Stephenson"

Cleanup release (refactor Batch B — zero behavior change, net −491 lines).

### Added
- Golden-file fixtures (`src/app/__fixtures__/golden-workspace.{csv,md}`) plus a guard test pinning the byte-exact storage serializer output (no-config CSV/Markdown path). Any refactor that changes a single emitted byte of the on-disk format now fails loudly. Fixtures are `-text` in `.gitattributes` so git never converts their line endings (CSV is CRLF per RFC 4180; Markdown is LF).

### Removed
- `version.ts`'s 770-line changelog comment (this file is the authoritative history; coverage was verified before deletion).
- Dead code: unused `HealthPill` component, unused `siteByPathUrl` Graph URL builder (+ its tests), 23 unused i18n keys (EN + DE), unused `TopTab` type, and the single-use `AppShell` wrapper (ternary inlined at its one call site).
- Three inline `nextId()` duplicates replaced by the shared helper from `resource-foundation.ts` (verified semantically identical).

## [0.60.1] - 2026-06-10 "Stephenson"

Reliability + security hardening (refactor Batch A — no new features).

### Fixed
- Turso pipeline requests now time out (15 s default, 10 s for loads) instead of hanging forever on an unresponsive endpoint; a timeout surfaces through the existing storage-unreachable banner, so unsaved changes are no longer silently at risk behind a hung autosave.
- A transactional Turso batch that fails mid-pipeline now sends a best-effort `ROLLBACK`, so a concurrent reader can no longer observe a half-written workspace while the server-side transaction lingers.
- Jira proxy (10 s) and ECB exchange-rate (8 s) upstream fetches time out instead of holding the server route for the platform limit; timeouts surface as the existing network-error handling.

### Security
- SharePoint Graph IDs are percent-encoded in all URL builders, and `@odata.nextLink` pagination links are origin-checked (shared `isSafeGraphLink` predicate) — a spoofed Graph response can no longer pivot authenticated requests off the Graph origin.
- `/api/ecb` joins the shared per-IP rate limiter (60/min, now scope-keyed per route with stale-bucket eviction).
- `Strict-Transport-Security` header added (1 year, includeSubDomains); `Permissions-Policy` now restricts the microphone to same-origin (`microphone=(self)`) — the voice feature is unaffected.

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