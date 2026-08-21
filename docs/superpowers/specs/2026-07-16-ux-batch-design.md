# UX Batch (post-0.189.2) — Design Spec

**Goal:** Ship a 34-item UX/feature batch across 10 themed slices in one release: toast polish, M365 toasts + pull-contacts, modal chrome unification, RAID inquiry + assignee filter, open-points filters/bulk-delete/context-menu, undo/redo labeling, tips + saved-views global toggles, AI-assistant error UX + HTML/VTT, steering per-row push + report chrome, and singles (app rename, notes log, gantt milestone placement, etc.).

**Architecture:** Additive changes over the existing `src/app` flat feature codebase. Follow established patterns (deps-object hooks, per-entity CRUD hooks, `writeSettings` spread for per-device flags, `sanitizeX` validators, PopoverPanel portal, EditModalShell/useDraggable/useResizable modal chrome). Two changes touch the persisted data model (RAID `inquiriesSent`, Task `noteLog`) and carry the full 6-write-path + CSV/MD column + golden-fixture cost. One change is structural (modern task editor becomes a floating modal).

**Tech Stack:** Forked Next.js 16.2 / React 19.2 / TypeScript. GitLab CI  (GitLab) (lint `--max-warnings=0`, tsc EN/DE i18n parity, vitest coverage floors, size ratchet 800-line, jscpd dup gate, i18n-encoding literal-UTF-8, axe e2e gate). Release = bump `version.ts` + CHANGELOG + `APP_HIGHLIGHT_KEYS` EN/DE.

---

## Decisions locked (from brainstorming)

1. **Modern task editor → floating draggable/resizable/reset modal** (drop full-page `TaskEditView`).
2. **RAID send-inquiry = full parity** with tracked `inquiriesSent` (new persisted `RaidItem` field).
3. **Task-notes log = structured model** — new persisted `Task.noteLog: NoteLogEntry[]`.
4. **Gantt milestone placement = insert as a dated row** among tasks (toolbar toggle).
5. **Workload = resource planner/capacity** surface for absence-type colors.
6. **Open-points actions**: Edit inline; Send-inquiry / Push-Jira / Delete → `⋮` overflow.
7. **Note author = "I am this resource" per-device setting** (overridable per note).
8. **Global show/hide toggles live in Settings → Appearance** (mode-toggle+cog, tips, saved-views).
9. **One release**, sliced commits.

---

## Cross-cutting conventions (apply everywhere)

- **New per-device flag** → add to `settings-types.ts` (`Settings` + `defaultSettings`), persist via the `writeSettings` SPREAD (no allowlist edit — mirrors `showViewHints`/`dashboardDensity`), sanitize on load. OUT of exports/Turso.
- **New persisted Workspace/entity field** → SIX write paths (JSON/CSV/MD/Turso-single/Turso-tenant/IndexedDB). For a new COLUMN on an existing entity: extend `*_CSV_COLUMNS` (in `csv-codecs-core.ts` — covers CSV + Turso single/tenant + turso-migrate self-heal) + `*_MD_COLUMNS` (markdown codec) + the entity's `sanitizeX`; REGENERATE `__fixtures__/golden-*`; append the column to curated `sample-workspace` `.md`/`.csv`. Guard row in `entity-persistence-registry.test.ts`.
- **i18n**: every new string in `i18n.ts` (EN) + `i18n.de.ts` (DE), key sets identical (tsc enforces). DE via node utf8 write (Edit corrupts umlauts); literal UTF-8 only (`i18n-encoding` test bans `\u00XX` umlaut escapes). Positional `{0}`/`{1}` placeholders.
- **Palette**: only AIPM tokens; RAG-semantic colors via `--rag-*` tokens; no raw shadow/gradient except via `--shadow-*`/`--gradient-kpi`.
- **a11y**: new interactive control needs accessible name + keyboard op; row-unique labels in lists; toggle-button label pins to what it ENABLES with `aria-pressed`. Verify axe-scanned views (`e2e/a11y.spec.ts` 13 views) after IA changes.
- **react-hooks**: no `set-state-in-effect` (use render-time reconcile w/ nonce); no `Date.now()`/`new Date()` in render body (lazy `useState`); hoist `obj.member` deps to scalars before dep arrays.

---

## Slice 1 — Toasts & reload

**Files:** `use-toast.ts`, `toast-context.tsx`, the toast render component, `i18n.ts`/`.de.ts`; reload-project caller (storage/project-ops surface).

- **Duration** constant 4000 → **7000** ms (`use-toast.ts:17`). Extract as `TOAST_DURATION_MS`.
- **Hover/focus pause**: while pointer is over the toast OR a toast element has focus, clear the auto-dismiss timer; on `mouseleave`/`blur` restart a fresh timer. Implement per-toast (the timer currently lives in `showToast`). Refactor: track `hovered` per toast; render layer owns pointer handlers and signals the context to pause/resume. Keep API (`showToast`/`showToastAction`) unchanged.
- **Interaction states** on toast action buttons: append `INTERACTIVE` (from `interaction-styles.ts`) so hover/press read app-wide.
- **`"success"` kind**: `Toast.kind` gains `"success"` (green via `--rag-green`/token); `showToast("success", …)` no longer collapses to info. Callers that mean success switch to it.
- **Reload project**: on success → `showToast("success", reloadProjectSuccess)`, on error → `showToast("error", reloadProjectError)`; add a `title`/tooltip to the reload button (`title` + `aria-label`).

**Tests:** timer pause/resume on hover (fake timers); success kind renders green token; reload success/error toast fires.

---

## Slice 2 — M365 toasts + pull contacts

**Files:** `use-entity-calendar-push.ts`, `use-entity-calendar-pull.ts`, `use-outlook-calendar-push.ts`, `use-milestone-calendar-pull.ts`, `use-committee-outlook-push.ts` (audit only); `resources-panel.tsx` (pull button); `use-outlook-contacts.ts`, `outlook-contacts.ts` (reuse); `i18n`.

- **Toast audit**: every MANUAL (interactive) push/pull already toasts result/partial; confirm each also toasts on ERROR (catch → `showToast("error", …)`). Background auto paths STAY silent except the existing dedupe-guarded conflict-count toast. Fill any manual-path gap; do not add toasts to background paths.
- **Pull contacts** button in `resources-panel` header actions, gated on `m365Configured && !isPopout`:
  - Reuse `use-outlook-contacts` (`/me/contacts`, `Contacts.Read`, `mapGraphContact`).
  - Dedupe by email (case-folded) against existing resources; add only missing as new resources (functional `setResources(prev=>…)`, `nextEntityId`).
  - Result toast: `contactsPulledN` (added count) / `error`. Loading state on the button.

**Landmines:** Resources is axe-scanned — button needs aria-label. Adding resources persists (existing 6-path field), no new column.

**Tests:** dedupe skips existing email; adds new; toast on empty/added/error; button hidden when M365 off.

---

## Slice 3 — Modal chrome (audit all modals)

**Files:** `task-form-modal.tsx`, `task-manager.tsx` (editView wiring), `shell-chrome.tsx`/`modern-shell.tsx` (editView slot), `task-edit-view.tsx` (retire), `sharepoint-picker-modal.tsx`, `raid-edit-modal.tsx`, resource/absence edit modals, `modal-field-controls.tsx`, `edit-modal-chrome.tsx`, `modal-header.tsx`, new `use-autogrow.ts`, `settings-types.ts`, Appearance settings section, `i18n`.

### 3a. Modern task editor → floating modal
- Currently `useEditView = layout==="modern" && !isPopout` renders full-page `TaskEditView` in the `ModernShell editView` slot; classic/popout use `TaskFormModal` (already draggable/resizable/reset via its own `useDraggable("aipm-cockpit:modal-pos:task-form")` + `useResizable`).
- Change: **always** use `TaskFormModal` for editing (modern included). Remove the `editView` slot usage for the task editor; delete/retire `TaskEditView` and its `footerLeading` wiring, moving any modern-only affordance (Delete button, banners) into the modal footer (the modal already supports `deleteAction`).
- Update `task-manager.characterization.test.tsx` / any test asserting `TaskEditView` mount. Verify the Jira read-only banner still threads to the modal.

### 3b. Drag/resize/reset on missing modals
- Add `useDraggable(key)` + `useResizable(key)` + `ResetSizeIcon` reset to: **SharePoint-picker, RAID-edit, Resource-edit, Absence-edit**. RAID-edit already imports `ModalFieldControls`; wrap its body in the same `EditModalShell`/header pattern used by change/stakeholder where feasible, else attach the hooks directly to its `Modal`. Distinct storage keys per modal (`aipm-cockpit:modal-pos:<name>` / `:modal-size:<name>`). BUMP any pre-existing size key only if the default changes.

### 3c. Autogrow textareas
- Extract `useAutogrow(ref, value)` (`use-autogrow.ts`) from the `NarrativeEditor` pattern (reset height → read `scrollHeight` → set inline height; `onInput` + effect on value). `resize-none` on the textarea. jsdom `scrollHeight`=0 → tests stub it.
- Apply to multiline textareas in **task/raid/change/stakeholder/absence/resource** edit modals (description, mitigation, impact, resolution, notes). Coexist with dictation `onFocus`/`onBlur` (call autogrow after a dictation append too).

### 3d. Hide field-config controls
- `settings.showFieldConfig?` (default true) in Settings → Appearance. `ModalFieldControls` returns `null` when off. Gate at the render site(s) (task/raid/change/stakeholder headers). Persist via `writeSettings` spread.

### 3e. Reset-icon consistency
- Audit: every modal reset uses `ResetSizeIcon` (already the single standard). Replace any divergent reset glyph/text found during 3b with `ResetSizeIcon`.

**Landmines:** Modal stack topmost-only Escape/Tab — keydown effect deps `[open]` alone, `onClose` via ref (see modal.tsx). Task editor is the DEFAULT surface — thorough characterization-test update. Autogrow measure is jsdom-blind → stub `scrollHeight`.

**Tests:** modern edit opens the modal (not full page); each newly-draggable modal persists pos/size + reset; autogrow grows on input (stubbed height); `showFieldConfig=false` hides toggle+cog.

---

## Slice 4 — RAID

**Files:** `types.ts` (RaidItem), `sanitize-records.ts` (`sanitizeRaidItem`), `csv-codecs-core.ts` (`RAID_CSV_COLUMNS`), `markdown-codecs-*` (`RAID_MD_COLUMNS` + decode arm), golden fixtures, sample `.md`/`.csv`, `raid-panel.tsx`, `raid-panel-toolbar.tsx`, `raid-panel-rows.tsx`, `raid-edit-modal.tsx`, `use-chat-dispatcher.ts` or a raid inquiry handler, `calendar-sync-controls.tsx`, `entity-persistence-registry.test.ts`, `i18n`.

### 4a. 🔴 Send inquiry (tracked) — NEW PERSISTED FIELD
- Add `RaidItem.inquiriesSent?: number` (mirror `Task`). Full 6-write-path treatment: `RAID_CSV_COLUMNS` + `RAID_MD_COLUMNS` (+ MD decode arm) + `sanitizeRaidItem` (clamp ≥0) + golden regen + sample `.md`/`.csv` column + persistence-registry row.
- Inquiry handler mirrors task `sendInquiry`: build a mailto to the RAID owner (`ownerEmail` or resolved from `ownerResourceId`), bump `inquiriesSent` via functional setter. Button in `raid-panel-rows` (active items) + raid-edit modal footer.

### 4b. Assignee/owner filter
- Add an owner `<select>` to `raid-panel-toolbar` + `owner` key in `RAID_FILTER_DEFAULTS` + `usePanelFilters`. Options = distinct owners present (by `ownerResourceId` live name, else `owner` string). Filter derivation hoists `pf.filters.owner` to a scalar before the memo dep array; cast at the derive site.

### 4c. Push button restyle
- `calendar-sync-controls.tsx` (raid/changes/absence) currently `border-AIPM-dark-blue text-AIPM-dark-blue`; milestone uses `border-line bg-surface text-foreground` with leading icon. Change `CalendarSyncControls` to the milestone neutral style + leading icon so all four match.

**Landmines:** RAID + Changes + Milestones + Absence all axe-scanned or eye-verified — keep row-unique labels; new field guarded by registry test (codec-scoped). Sample edit: `.md` exact full-line replace, `.csv` via app codec round-trip.

**Tests:** inquiry bumps count + persists (round-trip); owner filter narrows rows; golden bytes updated (RAID-only diff).

---

## Slice 5 — Open points

**Files:** `filters-context.tsx`, tasks toolbar, `tasks-section.tsx`, `task-row.tsx` (`TaskActions`), `use-bulk-operations.ts`, `i18n`, PopoverPanel/`ActionOverflowMenu` reuse.

- **RAG status filter**: add `healthFilter: "all"|"red"|"amber"|"green"` to `FiltersValue` + a toolbar control (segmented or select). Derive a task's RAG via the existing health engine used by the "status"/Health dot column; filter rows on it. Row-unique nothing needed (single control).
- **Bulk delete selected**: `handleBulkDelete(selectedIds)` in `use-bulk-operations` (functional `setTasks(prev=>prev.filter(...))`); button in `BulkEditBar` (tasks already track `selectedIds`); `TypeToConfirmDialog` gated (type e.g. `"delete N tasks"`). Distinct from existing global "Clear all".
- **Context menu**: `TaskActions` keeps **Edit** inline; **Send-inquiry / Push-Jira / Delete** move into a `⋮` `ActionOverflowMenu` (PopoverPanel-based; row-unique aria-label `${overflow} – ${task.title}`). Preserve `stopPropagation` for in-`<tr>` controls; disabled states for Jira-synced.
- **First column**: shrink the `w-8` gutter (`tasks-section.tsx:817/827`) to `w-6` (or fold the Ask-Claude anchor into the title cell) to reclaim wasted space. Verify the inline "Ask Claude" popover still anchors.

**Landmines:** Open Points IS axe-scanned — the ⋮ menu + status filter need labels; per-row unique overflow name. Kanban board renders outside `RowContextProvider` — if the ⋮ is shared with cards, pass props not context.

**Tests:** health filter narrows; bulk delete removes only selected after confirm; overflow menu holds the 3 actions, Edit stays inline.

---

## Slice 6 — Undo/redo labeling

**Files:** `undo/` (undo entry type, `undo-control.tsx`, `capture-field-edit.ts`/`field-groups.ts`), task-manager undo wiring, `i18n`.

- **Human label per undo entry**: the undo entry type gains a `label` (e.g. `"Edit task \"X\""`, `"Delete 3 tasks"`, `"Reschedule milestone \"Y\""`) built at capture time from the operation + entity name. Redo mirrors.
- **Toast on undo/redo**: after an undo/redo, `showToast("info", undoneX / redoneX)` naming the label.
- **Nav undo dropdown**: `UndoControl` gains an Excel-style caret button opening a small popover (PopoverPanel/`usePopoverDismiss`) showing the **single next** undo entry's label (visualization only — no multi-select, no bulk undo). The main button still does one undo. Optionally mirror for redo. Caret has its own aria-label; popover item is non-interactive text (or a button that does the same single undo).

**Landmines:** undo control self-hides on empty stack — keep. Label must not leak huge text; truncate. No `set-state-in-effect`.

**Tests:** entry carries expected label per op; undo toast text; caret popover shows next label; empty stack hides.

---

## Slice 7 — Tips & saved-views toggles

**Files:** `view-callouts.ts` (`VIEW_CALLOUTS`), `view-callout.tsx` mount in stakeholder map, `stakeholder-map-panel.tsx`, `settings-types.ts`, Appearance settings section, saved-views controls (`saved-views-control`/`panel-views-control`/`reports-views-control`), `i18n`.

- **Influence/interest tips banner**: add a `VIEW_CALLOUTS` entry for the stakeholder-map view (text + `conceptId` in HELP_ENTRIES concepts — guard test) and mount `ViewCallout` atop `stakeholder-map-panel` (props-only, gated on `showViewHints && !isPopout && !dismissed`).
- **Disable tips globally**: `settings.showViewHints` already gates view-callouts; ensure the **dashboard tip card** ALSO honors a global tips flag. Add/confirm a single Settings → Appearance "Show tips" toggle covering both view-callouts and the tip-of-day card. (If `showViewHints` is the umbrella, wire the tip card to it; else add `settings.showTips?`.)
- **Disable saved-views globally**: `settings.showSavedViews?` (default true) in Settings → Appearance. When off, all three saved-views controls render `null`. Persist via `writeSettings` spread.

**Landmines:** Settings → Appearance is axe-scanned — new toggles need `ariaLabel`. Stakeholder map is NOT axe-scanned; eye-verify banner button label + palette. `VIEW_CALLOUTS` conceptId must exist in HELP_ENTRIES (guard test).

**Tests:** map renders callout when hints on; tip card hidden when tips off; saved-views controls hidden when off.

---

## Slice 8 — AI assistant

**Files:** `chat-panel.tsx` (error banner), `chat-api.ts` (`callClaude`), `ai-errors.ts` (`AiHttpError`, `safeAiErrorType`/new safe-message), `chat-attachments.ts`, `chat-panel.tsx`/`step0-import-panel.tsx` accept lists, `i18n`.

- **Closable error banner**: add an X button to the `role="alert"` error banner → `setError(null)`. Row-unique not needed; aria-label `dismiss`.
- **Show 400 response text**: `AiHttpError` gains an optional `safeMessage` extracted from the response body (`error.message`) — SAFE: Anthropic's error body carries no secret (the key is only in the request header, which we never read/log). Truncate to ~500 chars, strip control chars (`/[\x00-\x1f]/g`). Surface for `400`/`invalid_request_error` in the banner. Keep the STATUS-only message for other cases; never log the request body or key.
- **HTML + VTT ingestion**: add `text/html` + `text/vtt` (+ `.html`,`.htm`,`.vtt` extension fallback) to `chat-attachments` TEXT classification and to both accept lists (chat-panel input + step0-import). Read as UTF-8 text block (Claude reads natively).

**Landmines:** Chat NOT in axe views — eye-verify the X button. Security: only the RESPONSE body is surfaced; the request/key stay unlogged. `safeAiErrorType` unchanged for classification; add a parallel `safeAiErrorMessage(body)` that reads only `error.message`, can't throw.

**Tests:** X clears error; 400 with a message body surfaces the (truncated, control-stripped) text; non-400 still status-only; html/vtt classify as text + appear in accept.

---

## Slice 9 — Steering committee

**Files:** `steering-committee-panel.tsx`, `use-committee-outlook-push.ts`, `committee-report-panel.tsx` (report chrome), `i18n`.

- **Per-row push**: add a push button to each meeting row and each info-schedule row that pushes ONLY that entry to Outlook (single-entry reconcile — extend the hook to accept a target meeting/schedule id, or a thin per-entry wrapper over the existing reconcile). Keep a panel-level "push all". Row-unique aria-labels (`${push} – ${meeting.title}`); NOT axe-scanned (eye-verify). Gated on `m365Configured && !isPopout`.
- **Status-report chrome**: the committee report surface gains **resize** (`useResizable("aipm-cockpit:committee-report-size")`) + **reset-size** (`ResetSizeButton`/`ResetSizeIcon`) + **print** (`PrintButton` + `print-root`) + **cancel** (close) controls, mirroring the standard resizable content-pane shell.

**Landmines:** committee push status-only logs (never token/body); deleted meeting stashes `outlookEventId` in `pendingDeleteEventIds`. Per-entry push must not cross-delete other entries — respect the id-tracked `planCommitteeReconcile`.

**Tests:** per-row push targets one entry's reconcile; report surface resizes/resets/prints; panel-level push still pushes all.

---

## Slice 10 — Singles

**Files:** `i18n.ts`/`.de.ts` (`appTitle`, `resourcesEmpty`, new keys), `layout.tsx` (metadata title), `global-search-box.tsx`/`shell-chrome.tsx`/`top-bar.tsx` (search width), `reschedule-popover.tsx`, `types.ts` (Task `noteLog`), notes codecs + sanitize + golden, task form/notes UI, `settings-types.ts` ("I am" setting), `resource-planner`/capacity view (absence colors), shared absence-color util, `gantt.tsx`/`gantt-rows.tsx`/`gantt-engine.ts`/`use-gantt-prefs.ts`/`gantt-chrome.tsx`.

- **App rename** "AIPM Cockpit" → **"AI PM Cockpit"**: `appTitle` (EN+DE) + `layout.tsx` metadata title. Grep for other literal occurrences.
- **Directory empty text**: `resourcesEmpty` → "No contacts available." (EN+DE).
- **Search 2× wider**: widen the search slot container in `shell-chrome`/`top-bar` (input is `w-full`); give the slot a wider basis/`min-w` (both header mounts).
- **Reschedule current due date**: `reschedule-popover` shows the task's current due date (label) and prefills the date input with it. Thread the current due via the action/CTA (resolve from the task).
- 🔴 **Task-notes log** — NEW PERSISTED FIELD: `Task.noteLog?: NoteLogEntry[]` where `NoteLogEntry = { authorResourceId?: number, authorName?: string, timestamp: string /*ISO*/, text: string }`.
  - 6 write paths: JSON/IDB pass-through; CSV/MD via a JSON-encoded cell in `TASK_*_COLUMNS` (encode array → JSON string in one cell; decode back); golden regen; sample column; persistence-registry row. (Task has no sanitizer — validate the array on load in the codec/decoder: cap length, trim text, ISO-guard timestamp, control-char strip.)
  - UI: an "add note" input in the task editor prepends/append an entry; render one line per entry, visually distinct (`<author> <timestamp>: <text>`). Author defaults from the **"I am this resource"** per-device setting; overridable via a directory dropdown per entry. Keep existing free-text `Task.notes` as-is (the log is additive), or migrate — DEFAULT: keep `notes` for freeform, add `noteLog` for the structured log.
  - **"I am" setting**: `settings.selfResourceId?: number` in Settings (Appearance or a Profile row) — a directory dropdown; per-device, `writeSettings` spread.
- **Workload (resource planner/capacity) absence colors**: extract the calendar's `absenceCellBg`/`absenceGlyph` color+glyph map into a shared `absence-style.ts` (vacation=AIPM-blue/30, sick=AIPM-pink/30, training=AIPM-purple/30, other=AIPM-medium-grey/45 + legend). Apply in the resource planner/capacity view for upcoming absences (color the absence cells/markers by type + a legend). Reuse, don't re-derive.
- **Gantt milestone placement toggle**: `use-gantt-prefs` gains `milestonePlacement: "below" | "inline"` (default "below" = current). When "inline", `gantt-engine`/`gantt.tsx` inserts each non-achieved milestone as its own dated row at its chronological (due-date) position among the task rows; "below" keeps the current date|id-sorted section under tasks. Toolbar toggle in `gantt-chrome` (`GanttToolbar`), pinned-label + `aria-pressed` per the toggle rule; persist in gantt prefs (localStorage). Gantt IS axe-scanned — toggle needs a label; the brittle markup-order source test reads `gantt-chrome.tsx`.

**Landmines:** `noteLog` is the second heavy field — treat like `outlookEventId` additions but as a JSON-in-cell (not a scalar). Absence-color extraction must keep `resource-calendar` byte-behavior identical (shared util returns the same classes). Gantt inline insert must respect the self-dep/critical-path derivations; milestone rows are pure presentational (`GanttMilestoneRow`).

---

## Files created (new)

- `use-autogrow.ts` — shared autogrow hook.
- `absence-style.ts` — shared absence color/glyph map + legend data.
- `safeAiErrorMessage` (in `ai-errors.ts`) — safe response-body message extractor.
- Possibly a per-entry committee push wrapper (in `use-committee-outlook-push.ts`).

## Files retired

- `task-edit-view.tsx` (modern full-page editor) — folded into `TaskFormModal`.

---

## Testing strategy

- **Unit/integration (vitest)**: per-slice behavior tests above; round-trip tests for the two new persisted fields; codec golden regen verified (entity-scoped diffs only).
- **tsc**: run after every test edit (test-only type errors pass vitest+build but fail CI). EN/DE i18n parity.
- **axe e2e** (`e2e/a11y.spec.ts`): re-run affected scanned views (Open Points, RAID, Resources, Settings→Appearance/General, Gantt, Milestones, top bar) after IA/label changes.
- **size ratchet**: watch `tasks-section.tsx`, `raid-panel.tsx`, `gantt.tsx`, `task-manager.tsx` — extract to keep under 800 / net-neutral (retiring `task-edit-view` gives headroom).
- **jscpd**: reuse shared atoms (PopoverPanel, EditModalShell, absence-style, useAutogrow) to avoid new clones.

## Release

Bump `version.ts` (APP_VERSION + milestone codename — grep CHANGELOG for a unique codename + APP_BUILD_DATE), CHANGELOG entry, one `versionHighlight*` per user-visible theme appended to `APP_HIGHLIGHT_KEYS` + EN/DE strings.

## Execution order (suggested)

Data-model + structural first (fail fast on the risk-carriers), then polish:
1. Slice 4a + Slice 10 noteLog (the two heavy fields; golden regen once).
2. Slice 3a (task editor → modal; characterization tests).
3. Slice 10 gantt, Slice 3b/3c/3d modal chrome.
4. Slices 1, 2, 5, 6, 7, 8, 9, remaining singles.
5. Release bump.
