<!-- Split out of AGENTS.md, which is the always-loaded file (CLAUDE.md is `@AGENTS.md`).
     THIS file is NOT auto-loaded — open it when you work on this subsystem.
     Same conventions: ★ = a non-obvious rule, ★★ = has already caused a bug,
     ★★★ = has caused the same bug more than once.
     `npm run docs:symbols:check` gates this file exactly as it gates AGENTS.md:
     it proves a backticked NAME is real, never that a CLAIM about it is true.
     Every claim here was true when written and some have outlived their code —
     grep before relying on one, and correct what you disprove in the same commit. -->

# Guided tour · timezones · saved views · PWA · resource calendar meetings

[← AGENTS.md](../../AGENTS.md) · [doc set](../../AGENTS.md#the-doc-set--what-lives-where)

### Guided tour + demo

MODERN-shell-only onboarding (never classic/popout). Pure i18n-free `app-tour.ts` (`TOUR_STEPS` ~12 keys-only,
`visibleSteps(features)` drops steps whose `view` is a disabled module via `isViewEnabled`, `clampStep`).
`tour-overlay.tsx` = controlled component: centered modal OR anchored "spotlight" over a `[data-tour-id]`
element — ★ a MISSING anchor (gated/unmounted view) FALLS BACK to a centered modal (never points at nothing);
role=dialog/aria-modal/Escape-skips/focus. `use-tour.ts` (in task-manager, above the view): open/index +
per-device `settings.tourSeen` (written via `setSettings`→`writeSettings`, which spreads the whole object so a
new flag persists with NO allowlist edit) + ★ RENDER-TIME auto-launch (`if (eligible && !autoHandled) {
setAutoHandled(true); setIsOpen(true) }` during render — NOT a useEffect; set-state-in-effect is banned) gated
`hydrated && layout==="modern" && !isPopout && !tourSeen`. Overlay mounted ONCE in the modern tree; Help "Take
the tour" re-launch via `HelpMenu onTakeTour` (threaded through `ActionMenus`, passed only when modern &&
!popout). 4 `data-tour-id` anchors: sidebar tasks/actions (`NAV_TOUR_ID` map in `sidebar-nav.tsx`), Ask-Claude
`<span>` wrapper, project-switcher container.
★★★ **DEMO CTA MUST REGISTER A PROJECT, not just apply data.** The empty-state "Explore a demo project" loads
`sample-workspace-small.json` (lazy `import("../../sample-workspace-small.json")`; `resolveJsonModule` on). It
MUST go through `createDemoProject(ws)` (a `useStorageBackend` method) which REGISTERS a real project
(`addProject`+`commitRegistry`), because the empty-state gate is `showEmptyState =
registry.projects.length===0` (file mode) — an apply-only path (`applyRestoredWorkspace`+`startTour`) leaves
the registry empty so `showEmptyState`
stays TRUE → `modernTree` (which holds BOTH the views AND `TourOverlay`) never mounts → demo invisible + tour
never renders. Applying workspace data != showing it. `createDemoProject` uses the `browser`/IndexedDB backend
kind (NO file picker) + derives meta from `ws.project`. ★ Turso portfolio mode: a local demo can't flip the
turso-branch empty-state gate (it reads the Turso project LIST), so it persists
registry+settings+`savePortfolioMode("file")` and `window.location.reload()`s (mirrors `loadProjectFromFile`'s
switchPortfolioToFileOnSuccess) — ALL durable writes BEFORE the reload, SKIP the in-place
`applyWorkspace`/`setStorageConfig` (the reload discards them; avoids a mount-then-teardown flash); after
reload `tourSeen` is unset so auto-launch re-fires the tour. Demo CTA is empty-state-only; the demo is a normal
deletable project (non-destructive to any Turso DB). Tour view NOT in axe `A11Y_VIEWS` (eye-verified);
spotlight positioning eye-verified (jsdom rect=0).

### Timezones

Pure i18n-free `timezone.ts` (Intl only, NO dep): `todayInZone(now,tz)` (uses
`Intl.DateTimeFormat("en-CA").formatToParts` — date-line + DST correct, NOT offset math), `formatInZone`,
`isValidTimeZone`, `browserTimeZone()` (env read — a FUNCTION not a module const, SSR/test-safe), `tzZones()`
(shared picker list, guarded `Intl.supportedValuesOf` → `[browserTimeZone(), "UTC"]` fallback),
`resolveTimezone(overrideTz, projectTz)` = override ?? project ?? browser (each validity-gated, always returns
a valid zone).
- **Model + logic (TZ-1):** ★★ the effective tz = `resolveTimezone(settings.timezone,
  project?.operatingTimezone)` and the app's central `today` derives in it — `task-manager` `todayISO()` →
  `effectiveToday(tz)` = `todayInZone(new Date(), tz)` (a MODULE fn so `new Date()` isn't in a render body),
  so overdue/next-actions/reminders/due-date logic follow the zone. Secondary derivations:
  `use-resource-planner` takes `today` as a PARAM (fed the effective today); `use-bulk-operations` resolves tz
  in a callback. ★ The ~30 OTHER `new Date().toISOString().slice(0,10)` sites (export/codec/backend stamps,
  plan-start defaults, gantt/calendar DISPLAY) STAY UTC by design — none compares a UTC-today against the
  zone-today (verified: no off-by-one). ★★ `operatingTimezone` lives on `ProjectMeta`, NOT a top-level
  Workspace field — it rides the existing project-meta serialization via the single `PROJECT_CSV_COLUMNS` list
  (drives CSV cols + MD `projectFieldToString` generic arm + Turso TENANT DDL/insert), mirroring `jiraUrl`
  EXACTLY; add the column there + the decoder + `sanitizeProjectMeta` (validate via `isValidTimeZone`) +
  regenerate golden fixtures (the sample's project meta is SYNTHESIZED in `generate-sample-workspace.ts`, not
  the `.md`). ★ Adding ANY `ProjectMeta` key forces an `export-sections.ts` `PROJECT_FIELD_I18N_KEYS`
  exhaustive-`Record` entry + its i18n key (tsc-forced). ★ Turso SINGLE schema doesn't persist `ws.project`
  (tenant projects row via portfolio upsert); `turso-migrate` ALTER-adds the column. Per-device
  `settings.timezone?` (override; undefined = follow project/browser) + `additionalTimezones?`; persist via
  `writeSettings` (spreads, no allowlist edit). Settings picker:
  `settings-sections/timezone-settings-section.tsx` ("System default" value `""` → override undefined;
  row-unique remove labels — Settings/General is axe-scanned). Project form: operating-tz `<select>` (blank →
  undefined).
- **Display routing (TZ-2):** renders INSTANT timestamps in a session display zone over the TZ-1 effective
  zone. ★ DISPLAY-ONLY + EPHEMERAL: `display-timezone-context.tsx` holds an in-memory `override` (useState,
  NEVER persisted — resets on reload); `displayTz = override ?? effectiveTz`. `useDisplayTimezone()` →
  `{displayTz, effectiveTz, isOverridden, setDisplayOverride, resetDisplayTz}`. Shared formatter
  `tz-display.ts` `formatDisplayTimestamp(iso, tz, lang, {withSeconds?})` wraps `formatInZone` with
  `timeZoneName:"short"` — the ACTIVITY LOG passes `{withSeconds:true}`, history/trends use minute precision.
  ★★ ONLY instant-timestamp DISPLAYS convert (`activity-log-panel`, `history-panel` capturedAt labels,
  `trends-panel` capturedAt cell) — every `capturedAt` used as a SORT/dedup/column-width/row-SELECTION key
  STAYS on raw ISO (converting a shared display+key value is an ordering bug). Date-only fields, the gantt
  month-axis, and storage/export `toISOString` stamps are untouched. ★★ Switcher `display-tz-switcher.tsx`
  wired into BOTH headers (modern `topBarMenus` + classic `AppHeader` via the `trailing?` prop — AppHeader
  builds Ask-Claude internally so it had no element slot); NOT in popouts. The `DisplayTimezoneProvider` wraps
  BOTH task-manager return branches (popout + main) with `effectiveTz`, so popout timestamps convert to the
  effective DEFAULT. Options: Default(`value=""`→clears override) + UTC + `settings.additionalTimezones`
  (extras filtered to drop UTC/effective dups). `DisplayTzSwitcherConnected` is a MODULE-LEVEL wrapper;
  switcher `<select>` carries `aria-label` (top bar axe-scanned every view).
- **Calendar multi-tz (TZ-3):** a live multi-zone "world clock" strip atop the Calendar view. Pure
  `tz-clock.ts` `formatZoneClock(iso,tz,lang)` (wraps `formatInZone`; time + SHORT DATE so the date-line
  rollover shows). `tz-clock-strip.tsx`: live `now` via a LAZY `useState(() => new Date())` + a `useEffect`
  `setInterval(…,60_000)` cleared on unmount (NOT a render-body `new Date()`); renders the default zone + each
  additional zone; `role="region"` + `aria-label`; ★ DEDUPES the default out of the list (`[defaultTz,
  ...zones.filter(z => z !== defaultTz)]`) to avoid a double chip + duplicate React key. Wired in
  `workspace-section.tsx` ONLY when `activeTab==="calendar"` && `settings.additionalTimezones` non-empty;
  default = `resolveTimezone(settings.timezone, project?.operatingTimezone)` (the EFFECTIVE zone, NOT the TZ-2
  display override). Date-grid cells/logic untouched (the grid is date-only). Calendar is NOT in axe
  `A11Y_VIEWS` (eye-verified). ★ The TZ-1 settings editor also excludes the resolved default (`settings.timezone
  || browserTimeZone()`) from the add-additional list.

### Saved views

- **Tasks:** pure i18n-free `saved-views.ts` (per-device `aipm-cockpit:saved-views`, `MAX_SAVED_VIEWS=30`,
  `id=max+1`, validated load, oldest dropped at cap; `SavedViewPayload` = useFilters fields + sortKey/sortDir +
  `hiddenCols[]`, EXCLUDES colWidths/hideFinishedTasks/tasksViewMode/raidFilterTaskId). Hook `use-saved-views.ts`
  (functional-updater mutators + a `useEffect([views])` persist — no stale closure). `saved-views-control.tsx`
  in the tasks toolbar applies a view through every `useFilters` setter (+`setRaidFilterTaskId(null)`,
  `setHiddenCols(new Set(...))`); single labeled controls (select+save+delete) → no row-unique-label landmine;
  Open Points IS axe-scanned. ★ GLOBAL presets (not per-project) → applying one whose assignee/group isn't in
  the current project just yields an empty filter (graceful). OUT of exports/Turso, cleared by `clearAppConfig`.
  ★ The control renders in BOTH table and board modes (its filters+sort apply to the board too; the preset's
  hiddenCols are dormant in board and take visible effect on return to table).
- **Cross-view (RAID/Milestones/Changes/Stakeholders):** a SEPARATE generic stack — tasks' bespoke
  `saved-views.ts`/`filters-context`/`saved-views-control.tsx` path is UNCHANGED. Pure i18n-free
  `panel-views.ts` (per-device `aipm-cockpit:panel-views` — a DIFFERENT key from tasks' `aipm-cockpit:saved-views`;
  view-tagged entries `{id,name,view,state}`, `MAX_PANEL_VIEWS=30` PER view, `id=max+1` across the whole list,
  validated load). Generic `panel-filters-context.tsx` (`PanelFiltersProvider`/`usePanelFilters`) holds
  `{search, filters:Record<string,string>, sort:{key,dir}|null}` + setters/`applyState`/`reset`; seeded
  per-panel with `*_FILTER_DEFAULTS`. Hook `use-panel-views.ts` (`usePanelViews(view)`). `panel-views-control.tsx`
  reuses the existing `savedViews*` i18n keys (no new control strings). ★★ Each panel SPLIT into an outer
  wrapper rendering `<PanelFiltersProvider defaults={…}><XPanelBody/></…>` (body consumes the context instead
  of local `useState`); provider lifetime = panel mount, so filter-reset-on-unmount is unchanged. ★
  `pf.filters.X`/`pf.sort` are typed loosely (`Record<string,string>`, `sort.key:string`) — panels CAST to
  their own union (`sort.key as RaidSortKey`, `filters.category as RaidCategory`) at the `compareX`/derive call
  sites; HOIST each `pf.filters.X` to a scalar local before a `useMemo` dep array (exhaustive-deps bans
  `obj.member` deps). ★ RAID passes `onApply={() => onClearTaskFilter?.()}` so applying a preset drops the
  transient task backlink (mirrors tasks clearing `raidFilterTaskId`). ★ Milestones' sort is never null
  (default `{date,asc}`); its wrapper casts `dir as "asc"|"desc"` for `useSortableFilter` (report-table
  `SortDir` includes `"off"`, which the setter never emits). Column widths/pane size still persist separately
  (`useColumnResize`/`useResizable`). RAID + Milestones ARE axe-scanned; Changes/Stakeholders eye-verified. OUT
  of exports/Turso, cleared by `clearAppConfig`.
- **Reports:** dedicated bespoke store `reports-views.ts` (per-device `aipm-cockpit:reports-views`,
  `MAX_REPORTS_VIEWS=30`, `id=max+1`, validated load, oldest dropped at cap) — Reports' 3 tables
  (byAssignee/byGroup/byLabel) each carry `{filter, sort:{key,dir}|null}`, which the generic
  `PanelFiltersState` ({search,filters,sort}) can't hold, so this is SEPARATE from BOTH the tasks bespoke path
  AND the `panel-views.ts` generic stack. `useReportsViews` + props-based `reports-views-control.tsx` (NO
  context — `ReportsPanel` already centralizes the six sort/filter `useState`; the control takes
  `currentState`+`onApply`, instantiates the hook itself). Sort `dir` uses report-table's SortDir SUPERSET
  incl `"off"` (the Milestones landmine — a narrower union silently drops the view on reload). Apply guards
  each `sort` non-null and casts `key:string`→the table's key union (`as AssigneeSort`/`as GroupOrLabelSort`).
  Column widths/pane size persist separately. OUT of exports/Turso, cleared by `clearAppConfig`. Reports IS
  axe-scanned (single labeled controls).
- **Shared control shell (`SavedViewsMenu`, `saved-views-menu.tsx`):** all THREE controls
  (`panel-views-control`/`saved-views-control`/`reports-views-control`) render ONE shared presentational
  `SavedViewsMenu` (the select + save-as name/confirm/cancel + delete shell; owns the local UI state —
  selection, save-name draft, stale-selection `selectionValid` derivation). Each control is a THIN wrapper
  passing its `views` list + `onApplyView(id)`/`onSaveView(name)`/`onDeleteView(id)` — divergent STORE logic
  (which hook, apply/capture/delete) stays in the wrapper. Edit shared markup/a11y HERE, not in a wrapper.
  ★ the confirm button carries `aria-label={savedViewsSave}` (accessible name "Save current view" ⊇ visible
  "Save" — WCAG 2.5.3 ok); reused across the three so a control-level a11y change touches one file.

### Installable PWA

`public/manifest.webmanifest` + `public/sw.js` (static, NOT bundled → can't `import` TS modules) registered
from a CLIENT component (`service-worker-registrar.tsx`) — an inline `<script>` can't carry proxy.ts's
per-request CSP nonce. SW does NO caching / NO fetch handler (hashed bundles → precache would serve stale JS).
CSP needs explicit `worker-src 'self'` in `src/proxy.ts`: `script-src 'strict-dynamic'` makes browsers IGNORE
`'self'` for the SW load → without `worker-src` registration is blocked at RUNTIME (not caught by
tests/build). Periodic Background Sync deliberately NOT built (Chromium+installed+device-seal only; baseline
covers on open).

### Resource calendar meetings

Recurring meeting occurrences render on the Resource Calendar alongside the pre-existing absence grid. New
entity `CalendarEvent` (`calendar-event.ts`) — one stored date + an optional `RecurrenceRule` + per-instance
`EventException[]` overrides — is expanded at render time by pure, clock-free `recurrence.ts`
`expandOccurrences(event, windowStart, windowEnd)` (the window is always a param, never `new Date()`).
`Occurrence` carries BOTH `date` (rendered/possibly-moved) and `originalDate` (the date the RULE produced) —
exceptions key off `originalDate`, and so must every caller that resolves one back to an occurrence; keying
off the rendered date instead silently mints a duplicate. Expansion is hard-capped at `MAX_OCCURRENCES=1000`
(a `truncated` flag, never a silently-incomplete list) and searches `GENERATION_BUFFER_DAYS=366` past the
window so a MOVED occurrence whose rule-date falls outside it is still found. ★ A caller deriving "the first/
nearest occurrence" from `event.startDate` directly (skipping expansion) reproduces a real, fixed bug — a skip
or move exception on the very first rule-generated instance means `startDate` disagrees with what the
calendar actually shows; always derive it via `expandOccurrences`, never read the raw field.

- **`applyOccurrenceMove(event, originalDate, toDate)`** (`calendar-event.ts`) decides how a drag is recorded:
  a RECURRING series gets a `move` `EventException` keyed by `originalDate`, REPLACING any existing exception
  for that date rather than stacking a second one; a NON-RECURRING event has `startDate` rewritten directly
  instead — an exception on a one-occurrence event would be a second, potentially-disagreeing source of truth
  for the same date. A no-op (`originalDate === toDate`) returns the input BY REFERENCE. Does not itself
  validate that the dates it's given are well-formed — both callers (the band's drag, the editor's date
  input) can only ever produce valid ones.
- **Six write paths, one `ENTITY_SPECS` line for three of them.** `spec<CalendarEvent>({table:
  "calendar_events", wsKey:"calendarEvents", columns: EVENTS_CSV_COLUMNS, ...})` (`turso-schema.ts`) covers
  CSV + BOTH Turso schemas at once — see "New persisted `Workspace` field → SIX write paths" above; the other
  three are hand-wired: Markdown (`EVENTS_MD_COLUMNS` + `calendarEventsToMarkdown`, `markdown-codecs-core.ts`
  — reuses `calendarEventFieldToString` from the CSV side rather than re-deriving cell values, so the two
  formats can't drift on what a column contains), JSON (`workspaceToJson`/`jsonToWorkspace`, `workspace.ts` —
  ★ the ENCODER side is easy to miss when a plan only specs the decoder, since the two live as separate
  additive blocks), and IndexedDB (a `KV_CALENDAR_EVENTS_KEY` KV slot in `browser-backend.ts`, deliberately
  NOT a new object store — a store needs an IDB version bump + upgrade path; events number in the tens).
  `Workspace.calendarEvents?` also had to join `isWorkspaceEmpty` + `nonEmptyCollectionCount` +
  `workspaceRecordCount` (`workspace.ts`) — skip even one and an events-only project either reads as EMPTY
  (arming the data-loss guard against a legitimate save) or a mass-deletion of every event goes completely
  undetected by the save-path guard, the more dangerous of the two failure directions.
- `recurrence`/`exceptions`/`attendeeResourceIds` ride as JSON-in-cell (`encodeRecurrence`/`decodeRecurrence`
  etc.). ★★ UNLIKE note-log's decoders, these do NOT self-validate — `sanitizeRecurrence` needs `startDate`
  for the `until >= start` cross-field check, which a decoder alone has no access to. A decoded cell is
  UNTRUSTED; any caller assembling a `CalendarEvent` from decoded cells MUST re-run the whole object through
  `sanitizeCalendarEvent()` before using it.
- ★★ Every CSV/MD cell for an unset column decodes to a real `""`, never `undefined`, so
  `sanitizeText(...) || undefined` is the RULE for any optional string arm — a bare
  `typeof === "string"` check keeps the empty string as a value and it round-trips as one.
  `sanitizeCalendarEvent` needed it for `localModifiedAt`; `sanitizeAbsence` (`sanitize-entities.ts:100`)
  and `sanitizeShift` (`:185`) had the bare-check bug and were FIXED the same way in 0.202.1 — both now read
  `sanitizeText(raw.localModifiedAt, 1024) || undefined`. (Earlier revisions of this bullet said the bug was
  "still live" in those two; that text outlived the fix.) The `sanitizeResource`/`sanitizeRole`/
  `sanitizeNamedRef`/budget-bucket arms use the different `if (typeof x === "string" && x)` shape, which is
  truthiness-guarded and therefore already correct — don't "fix" those to match.
- The `calendarEvents` export section is a first-class `ExportSectionKey`, default **ON**, gated by
  `enabled("calendarEvents")` in BOTH the CSV (`csv-codecs-config.ts`) and Markdown (`markdown-codecs-core.ts`)
  encoders — the two briefly diverged mid-release (one still on the storage-only gate other config blobs use)
  before being reconciled; a future edit to one MUST touch the other or a user's export checkbox stops
  meaning the same thing in both formats.
- **Meeting CRUD logs + undoes like every other entity.** `use-calendar-events.ts` takes the same four
  OPTIONAL callbacks `useChangeLog` does (`logActivity`/`logActivityChanges`/`capture`/`captureFieldEdit`),
  threaded from `use-resource-planner.ts` in ONE line — that file sits at its size-ratchet baseline, so
  keep it one line. Kinds: `calendarEvent.created`/`.updated`/`.deleted`.
  ★★ `CALENDAR_EVENT_UNDO_GROUPS` binds **startDate + recurrence + exceptions as ONE unit** and must stay
  that way: `sanitizeCalendarEvent` clears `exceptions` whenever `recurrence` is absent, and
  `sanitizeRecurrence` cross-validates `until >= startDate`. Split into separate entries, an undo can
  restore a rule whose exceptions are gone, or an `until` the very next load strips again — the undo looks
  like it worked and then doesn't. The editor also warns (`calendarEventExceptionsDiscarded`, a `FieldHint`)
  before a de-recurring save discards them.
  ★★★ A NEW UNDOABLE ENTITY NEEDS **TWO** REGISTRATIONS, not one. Adding the `ActivityKind`s buys the
  activity log; the undo LABEL needs the kind's prefix added to `UndoEntityKey` + `ENTITY_SINGULAR` +
  `ENTITY_KEY_SET` (`undo/use-undo-stack.ts`) plus an `undoEntity*` EN/DE string. Miss it and
  `entityKeyFromKind` returns `null`, so `buildUndoLabel` hits its generic `"Deleted N item(s)"` fallback
  **without ever using `opts.name`** (it computes the trimmed name one line earlier, then returns without
  it) — the capture site's carefully-passed title is silently dropped from
  every undo/redo toast while restore itself still works perfectly. That is invisible to functional tests
  (calendarEvent shipped exactly that way and EIGHT review passes missed it; a ninth caught it). The
  lockstep is now pinned by a sweep test in `undo/use-undo-stack.test.tsx` that walks every row-entity
  prefix in `ACTIVITY_KIND_TO_KEY` and fails on any that resolves to the generic label — `settings` is the
  one legitimate exemption (a singleton config write, no row to name).

**The calendar surface** (`resource-calendar.tsx` orchestrator + `resource-calendar-rows.tsx` assignee rows +
`resource-calendar-band.tsx` meetings band — same orchestrator/presentational-pieces split as gantt's
`gantt.tsx` + `gantt-rows.tsx` + `gantt-chrome.tsx`) grew a lane-packed meetings band: an extra `<tbody>`
rendered ABOVE the assignee rows but INSIDE THE SAME `<table>`,
so shared columns keep the band aligned with the day headers below it. Shared day/assignee vocabulary
(`CELL_PX`/`ASSIGNEE_COL_PX`/`CalendarAssignee`/`CalendarDay`) lives in its own leaf
`resource-calendar-shared.ts`, owned by neither sibling — mirrors the `gantt-engine.ts` precedent, and is
necessary rather than stylistic: `CELL_PX`/`ASSIGNEE_COL_PX` are VALUE bindings (not type-only), so either
sibling importing them from the other would be a genuine circular VALUE import (a real TDZ/evaluation-order
risk). `packOccurrenceLanes` (`occurrence-lanes.ts`) is a pure greedy packer over the already date/time-sorted
output of `expandOccurrences`: it checks EVERY occurrence already placed in a lane (not just the last one), so
an out-of-order input still packs correctly.

- ★★ Band cells carry `data-band-cell`, NOT `data-cell` — the grid's roving-tabindex model (`onGridKeyDown` in
  `resource-calendar.tsx`) indexes `data-cell` by row/column and treats exactly ONE such element as the tab
  stop. ★ That invariant is scoped to the DAY-CELL MATRIX specifically, NOT a whole-table "exactly one
  focusable element" property. A band cell wrongly caught by the `[data-cell]` selector is still a real bug
  (it would get folded into the roving model's row/column indexing and desync arrow-key navigation), so keep
  guarding that — but verifying it needs the resolved `.tabIndex` IDL property, not a raw `tabindex="0"`
  ATTRIBUTE match: a native button with no explicit `tabindex` attribute still has `.tabIndex === 0` (it IS in
  the tab order), so an attribute-only query is blind to it and will silently pass regardless of whether the
  real invariant holds.
- ★★ **Band chips reschedule from the keyboard**, mirroring the day grid one row below: Alt+Left/Right ARMS a
  move and accumulates a day delta IN STATE, Enter commits it as ONE `onMoveOccurrence` call (one undo entry
  per intent, not one per keypress), Escape cancels. ★★ There is NO preview: `pendingMove` is read only in the
  handlers, never during render, and the live region emits a CONSTANT string that does not report the
  accumulated delta — so three Alt+Rights give no visual and no announced feedback before Enter commits. The
  day grid has the identical gap. Do not describe either as "previewing"; building a real preview (a ghost
  chip + a delta in the announcement) is the open follow-up. ★ Gated on `onMoveOccurrence` — with no handler (read-only popout)
  Alt+Left stays browser Back, which is what `band-roving.ts`'s modifier guard preserves. ★ While armed the
  handler returns EARLY, so a plain arrow cannot walk the roving cursor out from under the preview; Alt+Up/Down
  are ignored (occurrences are single-day and lanes are packing artefacts — no row axis, no resize gesture).
  ★★ Commit routes through the SAME `resolveOccurrenceDrag` the drop handler uses, keyed on
  `(eventId, originalDate)` — read `occurrence-drag.ts` before touching it; both of its documented identity
  bugs are reachable from the keyboard path too, and its no-op result must write nothing.
  ★★ The announcement lives in the PARENT: this component renders a `<tbody>`, which cannot host a live region,
  so it reports up via `onMoveModeChange` and `resource-calendar.tsx` folds it into the ONE `aria-live` region
  it already owns for the grid's identical gesture (the two are mutually exclusive — focus is in one or the
  other). A new band-level announcement goes through that prop, not a new region.
- ★★ **Focus survives a chip unmounting** (a reschedule, or an edit that relocates the occurrence): a
  `lastFocusedKeyRef` records the last focused `lane-iso`, and an effect re-focuses the clamped `focusIndex`
  chip when that key has VANISHED **and** `document.activeElement === document.body`. Both guards are
  load-bearing — the vanished-key check stops an unrelated re-render from grabbing focus, and the body check
  stops it yanking focus out of a control the user moved to. Side effect ONLY (a `.focus()` call), never
  setState; `set-state-in-effect` is fatal here. Deliberately NOT driven by tracking focus leaving the band:
  removing a focused node does not reliably fire blur, and a click on dead space blurs with no `relatedTarget`.
- ★ **Chip accessible names are de-duplicated in the `chips` memo** (the only place that sees every rendered
  chip at once). Base is `title – date time`; a COLLIDING name earns ` (#eventId)`, and one still colliding
  after that earns the `originalDate` — the same-series-twice-on-one-date case a move exception can create,
  where the event id cannot separate them. Unconditional suffixing was rejected: it makes every announcement
  noisier for a rare case. ★ A collision test needs a fixture with two genuinely same-title/date/time series
  or it proves nothing.
- ★★ **The band runs its OWN roving group** over `[data-band-cell]` (pure `band-roving.ts` `moveBandFocus` +
  local state in `resource-calendar-band.tsx`): ONE chip is a tab stop, Left/Right walk chips in reading order
  (lane-major, then date — crossing lane boundaries, clamped not wrapping), Home/End jump to the ends, and
  Up/Down cross to the nearest chip at-or-after the current date in the closest NON-EMPTY lane. So the table
  has TWO roving groups (band + day-cell matrix) = 2 tab stops, plus the row-header edit buttons which sit
  outside both by design (they were tab stops long before the band existed). Chips were natively tabbable
  until the R5 batch-2 follow-up — ~65 tab stops ahead of the grid on a quarter-wide window with one daily
  series.
  ★ Left/Right walk READING ORDER, so they cross lane boundaries — a horizontal key changing rows is the
  second (smaller) deviation from a strict `role="grid"` model, and it is deliberate: a sparse band reads as
  one sequence, not as rows a user navigates independently.
  ★ The band is deliberately NOT folded into the day-cell matrix: band cells are overwhelmingly EMPTY and, unlike
  an empty day cell (which is clickable — it adds an absence), an empty band cell does nothing, so a unified
  matrix would make arrows walk dozens of dead cells AND re-index every absence move/resize site in
  `onGridKeyDown` against an offset row space. ★★ `onBandKeyDown` navigates from `document.activeElement`, NOT
  from the `focusChip` marker — a click focuses a chip directly and the marker's own state update is not
  necessarily committed by the next keypress, so a marker-driven handler jumps the user somewhere they never
  were (caught by a test, not by review — and a mutation test confirms the ArrowDown lane-crossing case FAILS
  if it is reverted to the marker, so don't "simplify" it back). The marker exists only to place the tab stop
  and FOLLOWS focus via each chip's `onFocus`; it is clamped on read so a window change that shrinks the band
  can't strand it.
  ★★★ The chip-INDEX memo and the RENDERER must evaluate the SAME EXPRESSION — literally
  `occ && eventsById.get(occ.eventId)`, NOT an equivalent one. (`has()` and a truthy `get()` agree for every
  map the type permits, but they are two different questions; the code comment argues this, so don't
  "simplify" the memo toward `has()`.)
  `lanes` and `eventsById` arrive as INDEPENDENT props, so if the index counted a chip the renderer skips, the
  marker could point at a phantom index and NO rendered chip would get `tabIndex={0}` — a band unreachable by
  keyboard, strictly WORSE than the per-chip tab stops roving replaced. Enforced in the memo (with `eventsById`
  in its deps) + a test rendering an occurrence whose event is absent.
  ★ EVERY lane's `role="rowheader"` carries a name — lane 0 the visible "Meetings" label, lanes 2+ an `sr-only`
  "Meetings N". Arrow keys now move BETWEEN lanes, so an empty header is a row a keyboard user can land in that
  announces nothing (WCAG 1.3.1); it was only tolerable while the band was mouse-only.
  ★ `moveBandFocus` returns `null` for any Alt/Ctrl/Meta chord — a roving group inside a page must not swallow
  Alt+Left (browser Back). Shift is NOT excluded (it competes with nothing here).
- ★★ The absence resize grips reuse the shared `DragHandle` atom (`drag-handle.tsx`, extracted from the
  gantt/table-manager `ColumnResizeHandle`) in its DECORATIVE mode — no `ariaLabel`, so it renders
  `aria-hidden` with no role; the surrounding `<span title=...>` carries the accessible name instead. The
  ACCESSIBLE mode (pass `ariaLabel`) adds `tabIndex={0}` + `role="button"`, which would add TWO extra tab
  stops (start+end grip) to every rendered absence cell — the reason to keep grips decorative is that
  multiplying cost, not a strict "exactly one focusable element in the whole table" invariant (row headers and
  band chips already sit outside the day-cell roving set, deliberately, per the bullet above) — never pass
  `ariaLabel` to a grip that lives inside this grid.
- ★ React Compiler trap: `onGridKeyDown` is a hoisted, non-JSX function (not an inline handler) that reads a
  `useMemo`'d `Map` (`resourceByKey`). Calling `resourceByKey.get(key)` directly from inside it broke
  `preserve-manual-memoization` on that unrelated `useMemo` — fixed via a `useCallback` indirection
  (`resourceFor`) wrapping the `.get()`. Verified: reverting the indirection reproduces the lint error. Don't
  "simplify" it back to a direct `.get()` call from a hoisted function.
- **Series list sorting (`calendar-series-list.tsx`):** Title and Next are sortable via the shared
  `SortResizeTh` with NO `onResize` (this list persists no column widths); Recurs and Edit stay bare `<th>`s
  — a rendered recurrence phrase is not a scale, and the last column holds a control. ★ Default is
  `dir:"off"` = WORKSPACE order, and the asc→desc→off cycle makes it recoverable: the user's own record order
  is information no derived ordering can reconstruct. ★★ A series with no resolvable next occurrence sorts as
  UNKNOWN (held out of the comparison, appended in BOTH directions), never via a sentinel date — a sentinel
  that sinks such a row ascending FLOATS it to the top descending, the one place it must never be. Both
  fallbacks ("no further occurrences" and the truncated-search "unknown") are unknown for this purpose.
- A new entity's edit modal needs an entry in BOTH the `ModalId` union AND `MODAL_FIELDS`
  (`modal-fields.ts`, a `Record<ModalId, readonly ModalField[]>`) — tsc catches a forgotten `MODAL_FIELDS`
  entry immediately for a normal edit (the Record type ties the two together), but a caller reaching
  `EditModalShell` with an unregistered/type-asserted id loses that safety net: every consumer
  (`field-visibility.ts`, `modal-field-controls.tsx`) calls `.map()`/`.filter()` on `MODAL_FIELDS[modalId]`
  unconditionally, so an id that slipped past the union crashes on `undefined.map`.

