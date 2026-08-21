# Multi-surface feature roadmap — design

**Date:** 2026-07-24
**Status:** Approved (design), pending implementation plans
**Scope:** 18 feature requests across AI Assistant, Calendar, Time bookings, Knowledge, Open Points, Dashboard, Kanban, Landing page — sliced into 6 themed releases.

## Decisions (from brainstorming)

1. **Calendar model:** general datebox model — week/weekday headers, drag, and start>end clamp apply to absences AND a new recurring-meeting/event layer.
2. **Task created timestamp:** a real persisted `Task.createdDate` field (all 6 write paths + golden regen), not derived from the activity log.
3. **AI planning tool target:** writes **resource-planner allocations** (person/role × month capacity hours).
4. **Delivery shape:** themed multi-request releases (~6), not one-slice-per-request.

## Grounded facts (verified against current code)

- `BudgetBucket` already carries `startDate`, `endDate`, `successorId` + closed-bucket spillover chain (`budget-report.ts` `computeSpillover`). Burndown-follows-successor is pure engine + UI; **no schema change**.
- `Task` has **no** `createdDate` today — new field is a genuine 6-write-path + golden-regen chore.
- Calendar view = `resource-calendar.tsx`, an absence/shift grid (assignee rows × date columns). Already has an `includeExternals` flag. No week numbers, no meeting/event entries today.
- Resource calendar grid is `role=grid` (roving 2-D keyboard) — drag needs a keyboard fallback to preserve a11y.

---

## Release 1 — Polish batch (small, quick wins, zero cross-deps)

### 1.1 Chat input below output (req 1)
- **What:** move the AI Assistant composer beneath the transcript so it is always visible in a session.
- **Where:** `chat-panel.tsx`. Layout-only.
- **Notes:** chat view is NOT in axe `A11Y_VIEWS` — verify by eye. Keep scroll-to-latest behavior when a new message lands.
- **Accept:** composer sits below the output window at all transcript lengths; output scrolls independently; input never scrolls out of view.

### 1.2 Timelog remembers last fetched project (req 7)
- **What:** "Refresh bookings" recalls the last project fetched from.
- **Where:** per-device store `aipm-cockpit:timelog-last-project` (mirrors `timelog-actuals` conventions — out of exports/Turso, swept by `clearAppConfig`). Prefill the fetch target on mount.
- **Accept:** reopening the panel / refreshing pre-selects the last-used project; cleared by app-reset.

### 1.3 Apply-to-bucket confirm = card style (req 8)
- **What:** the "apply bookings to bucket" prompt should be a bordered card (outline), not a color-filled block; buttons properly styled.
- **Where:** `timelog-apply-confirm.tsx`. Swap background fill for `border border-line rounded-lg`; buttons → `Button` primitive (primary/secondary).
- **Notes:** palette-safe by construction (no off-palette fill/shadow).
- **Accept:** confirm bar reads as a card outline; buttons match the design-system.

### 1.4 Knowledge default-attach to project (req 9)
- **What:** stop enforcing a task link on a knowledge entry; default to attaching to the project (standalone).
- **Where:** knowledge add-link form. Default target = "Standalone" (existing `Workspace.knowledgeItems`); task link optional.
- **Accept:** a new knowledge item can be created with no task link and lands in the standalone library by default; task linking still available.

### 1.5 Landing/empty-state logo is themeable (req 18)
- **What:** the no-project landing (empty-state) logo becomes part of the theme/scheme and configurable.
- **Where:** move `logo` from GLOBAL `settings.branding` into per-scheme branding (schemes already own `slogan`/`footerSlogan`). Empty-state + sidebar read the ACTIVE scheme's logo; editable in Settings → Appearance.
- **Notes:** touches `mergeAppliedBranding` (apply replaces branding), boot keys, and the `sanitizeBranding` raster-only/data-URI guard (SVG excluded — XSS). A custom logo renders WITHOUT `brightness-0 invert`. Keep global logo as fallback when the active scheme owns none.
- **Accept:** switching scheme swaps the landing/sidebar logo; a per-scheme logo is settable and persists; reset restores the built-in mark.

---

## Release 2 — Open Points & Kanban

### 2.1 `Task.createdDate` (req 11)
- **What:** persisted creation timestamp per task; shown as an Open Points column.
- **Where:** NEW `Task.createdDate` field → SIX write paths (`CSV_COLUMNS` in `csv-codecs-core.ts` covers CSV + Turso single+tenant; `*_MD_COLUMNS`; JSON/IDB whole-object passthrough), `turso-migrate` self-heals existing DBs (ALTER ADD COLUMN), regenerate `__fixtures__/golden-*`, add to `sample-workspace-small.json` gen.
- **Set/backfill:** stamp on create (task-submit create path). Migrate-on-load (all 6 load paths): missing → fall back to `lastUpdateDate`, else today.
- **Notes:** new table column key (avoid collision with `taskStatus`/`status`). Column sortable.
- **Accept:** new tasks record creation date; existing tasks backfill; column renders + sorts; round-trips byte-stable after golden regen.

### 2.2 Filter out externals (req 10)
- **What:** an Open Points toggle to hide external resources' tasks; hidden externals are ALSO excluded from the people/assignee filter option list.
- **Where:** `task-filters.ts` add `hideExternal`; identify external via `resourceId` → `Resource.isExternal` (free-string assignee resolved through the effective-assignee link). When on: exclude those rows from `filteredSortedTasks` AND drop them from `uniqueAssignees` (and any people-derived option set). `resolveEffectiveFilters` stays coherent.
- **Notes:** an unlinked free-string assignee with no resource is NOT external (can't classify) — leave visible. Mirror the `resource-workload` `hideExternal` precedent (filter the BUILT rows, never the source list that other logic depends on).
- **Accept:** toggling hides external tasks; the assignee filter dropdown no longer lists hidden externals; clearing the toggle restores both.

### 2.3 Kanban person swimlanes (req 15)
- **What:** a toggleable Kanban view that keeps status as columns and adds person swimlanes (rows); dragging a card into a person's lane assigns the task to that person.
- **Where:** `task-kanban-board.tsx` — 2-D grid (status columns × person rows). Drag card → set `resourceId`/assignee via functional `setTasks(prev=>…)`. Renders OUTSIDE `RowContextProvider` → everything as props. Per-device toggle (extend `tasksViewMode` or a new `kanbanSwimlane` pref, scope-aware like the existing Table/Board toggle).
- **Notes:** row-unique a11y labels per card select/drag; Jira-synced tasks (`!!jiraKey`) read-only (no drag/assign). Board not in axe `A11Y_VIEWS` — eye-verify. Deep-link flash wiring already threads `containerRef`.
- **Accept:** toggle switches to swimlane view; dragging a card to a person lane reassigns; status column retained; synced tasks locked; keyboard assign path (per-card person select) available.

---

## Release 3 — Dashboard

### 3.1 Overdue "Open" → Open Points + assignee filter (req 12)
- **What:** in Dashboard Top-actions AND Next-actions, when a resource has overdue item(s), clicking Open navigates to Open Points and sets the assignee filter to that resource.
- **Where:** new request channel on `workspace-tab-context` carrying a filter payload (mirrors `requestOpen`; sets `open-points` active + applies assignee filter). Consumed by the tasks pane's filter setters. Depends on R2.2 filter work.
- **Notes:** render-reconcile + nonce pattern (no `set-state-in-effect`); sentinel-seed so a fresh mount honors a pending request.
- **Accept:** clicking Open on an overdue-resource action lands on Open Points filtered to that assignee (single or multiple overdue items); same from Next-actions rows.

### 3.2 Burndown follows bucket successor chain (req 14)
- **What:** budget burndown x-axis spans the first bucket's `startDate` to the terminal successor bucket's `endDate`; buckets must set `successorId` to chain. Warn the user when there are multiple unconnected buckets (burndown then covers only the first/oldest until a successor relation exists).
- **Where:** pure engine over existing `startDate`/`endDate`/`successorId`; `dashboard-panel` burndown card. Detect: >1 bucket with no successor chain → warning banner.
- **Notes:** all-or-nothing rollup precedent — do not silently sum disconnected buckets. Reuse `computeSpillover`'s chain walk semantics (single-hop links form the chain).
- **Accept:** connected buckets render one continuous burndown across the chained date span; disconnected buckets show only the first + a visible warning naming the gap.

### 3.3 Lean rich-text editor for status (req 17)
- **What:** the Dashboard status narrative uses the lean rich-text editor.
- **Where:** `NarrativeEditor` (`dashboard-narrative.tsx`) → shared `RichTextEditor variant="lean"`. Store HTML; sink-sanitize on render (noteLog stored-XSS defense pattern — `sanitizeNoteHtml`-style). Keep `aria-label` (not placeholder-only).
- **Accept:** status supports lean rich-text formatting; stored + rendered HTML is sanitized; empty renders nothing.

---

## Release 4 — AI planning & structure tools

### 4.1 Read tool: dashboard RAG + budget/cost (req 13)
- **What:** a read-only chat tool exposing the dashboard's current RAG values and budget/cost figures directly to Claude.
- **Where:** `get_dashboard_snapshot` tool (schema in `chat-tool-defs.ts`, route in `chat-tools.ts`, impl in `use-chat-dispatcher.ts`). Reads live `computeDashboard` (overall + budget/schedule/scope/resource RAG) + `budget-report` rollup (budgeted/actual/EV/CPI). NO write.
- **Notes:** read-only → no popout guard needed; ground nothing (derived from live workspace).
- **Accept:** Claude can answer "what's the current RAG / budget burn" from the tool; values match the rendered dashboard.

### 4.2 Planning tool: distribute hours to resource-planner allocations (req 6)
- **What:** natural-language planning — "distribute a budget of hours equally among a role", "assign X hours in a month to a resource" — writes resource-planner allocations.
- **Where:** plan-then-apply tool (forced-tool via `runForcedToolCall`; propose → preview → confirm). Target = resource-planner allocation cells (person/role × period). "equally among role" → split hours across resources holding that `roleId`; "X hours in month to resource" → set that resource's allocation for the month. Re-ground every role/resource id against the live workspace.
- **Notes:** functional setter; popout read-only; validate/coerce every proposed number; preview shows per-cell current → next before apply.
- **Accept:** the two phrasings produce a correct allocation preview; confirm writes; hallucinated ids can never touch a real allocation.

### 4.3 Relationship + WBS tools (req 16)
- **(a) Task dependencies:** `set_task_dependencies` tool — CRUD FS/FF/SS/SF links between tasks. Plan-then-apply; self-dep + cycle guards; re-ground task ids.
- **(b) WBS optimize:** `optimize_wbs` tool — extrapolate / refine / optimize the work breakdown. Scoped as **propose-and-review only**: Claude proposes a task breakdown/regrouping; user confirms; never auto-mutates. Plan-then-apply through existing task dispatcher.
- **Where:** `chat-tool-defs.ts` + `chat-tools.ts` + `use-chat-dispatcher.ts`; reuse the inline-ai-edit plan/preview engine.
- **Notes:** heaviest slice; keep WBS "optimize" bounded to task create/regroup/reorder — no destructive cascade without explicit confirm.
- **Accept:** dependency tool sets/clears typed links with cycle protection; WBS tool always previews before applying; both replay through the audited `runTool` path.

---

## Release 5 — Calendar overhaul (general datebox model)

### 5.1 Weekday + ISO-week headers (req 2)
- **What:** show weekday labels and calendar-week (ISO week) numbers on the calendar.
- **Where:** `resource-calendar.tsx` `CalendarDay` gains a weekday label; add an ISO week-number band grouping columns. New pure `iso-week` helper (Intl/date-math, no `new Date()` in render).
- **Accept:** grid header shows weekday + week number; correct across year/DST boundaries.

### 5.2 Start>end auto-clamp (req 5)
- **What:** when a date-range entry's start moves past its end, end auto-sets to the new start (end can't precede start).
- **Where:** shared pure helper reused by the absence editor AND the new meeting editor date pickers.
- **Accept:** editing start beyond end silently sets end = start; no invalid range can be saved.

### 5.3 Drag entries to reschedule (req 4)
- **What:** drag absences (and meetings) to other dates on the grid; duration preserved.
- **Where:** native HTML5 DnD on `resource-calendar` cells; drop = new start, keep span. Keyboard fallback (grid is `role=grid` — provide a move affordance so drag isn't the only path).
- **Accept:** dragging an entry reschedules it preserving duration; keyboard users have an equivalent move; a11y grid roving intact.

### 5.4 Recurring meeting series (req 3)
- **What:** Outlook-style recurring meetings on the calendar — end date, duration, cycle (freq/interval).
- **Where:** NEW lightweight `CalendarEvent` entity (title, start, duration, RRULE-lite: `freq` + `interval` + `until`|`count`) → 6 write paths + golden regen + sample coverage. Pure expansion engine (occurrences over a window; `today`/window passed in, no clock in module). Optional Outlook push via the existing type-scoped write-back engine (`categoryFor(pid,"event")` = `AIPM:<pid>:event`; a NEW type-scoped category so milestone/committee pushes never cross-delete).
- **Notes:** LARGEST single slice — sub-split during planning: (a) entity + persistence, (b) create/edit UI + render on grid, (c) recurrence expansion, (d) Outlook push/pull. New `CalendarEntityType` member for the write-back config.
- **Accept:** a recurring series renders its occurrences; edits to the series update future occurrences; series round-trips byte-stable; optional Outlook push respects the type-scoped category.

---

## Sequencing & dependencies

- **R2 before R3:** the assignee-filter channel (req 12) reuses R2.2's external-aware filter work.
- **R1 items** (chat input, timelog project memory, apply-card style, knowledge default, landing logo) have zero cross-deps — shippable anytime.
- **R4 / R5** are independent of R1–R3 — reorder by priority if desired.
- **R5.4** may become its own mini-roadmap (4 sub-slices) given the new entity + recurrence + Outlook sync.

## Cross-cutting constraints (apply to every slice)

- New persisted `Workspace`/entity field ⇒ SIX write paths + golden regen (reqs 11, 3).
- Per-device store ⇒ out of exports/Turso, swept by `clearAppConfig`.
- Any AI tool ⇒ plan-then-apply, forced-tool via `runForcedToolCall`, re-ground ids, functional setters, popout read-only, never log key/body.
- axe-scanned surfaces (Open Points, Dashboard, Resources, Settings) ⇒ row-unique accessible names, non-color RAG cues, run the axe gate before push.
- i18n EN + DE parity for all new strings; DE umlauts via node utf8 write.
- Palette: sanctioned AIPM/`ui-*` tokens only; card outlines via `border-line`, no off-palette fill/shadow/gradient.
