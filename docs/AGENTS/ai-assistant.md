<!-- Split out of AGENTS.md, which is the always-loaded file (CLAUDE.md is `@AGENTS.md`).
     THIS file is NOT auto-loaded — open it when you work on this subsystem.
     Same conventions: ★ = a non-obvious rule, ★★ = has already caused a bug,
     ★★★ = has caused the same bug more than once.
     `npm run docs:symbols:check` gates this file exactly as it gates AGENTS.md:
     it proves a backticked NAME is real, never that a CLAIM about it is true.
     Every claim here was true when written and some have outlived their code —
     grep before relying on one, and correct what you disprove in the same commit. -->

# AI Assistant

[← AGENTS.md](../../AGENTS.md) · [doc set](../../AGENTS.md#the-doc-set--what-lives-where)

### AI Assistant

- **Wire layer:** `chat-panel.tsx` is the React surface; the non-React WIRE LAYER (Anthropic protocol types
  `TextBlock`/`ContentBlock`/`SystemBlock`/`ApiMessage`/`DisplayItem`, `callClaude`, `buildSystemPrompt`,
  `systemBlocksText`, `readAttachmentData`, `stringifyResult`) lives in pure i18n-free `chat-api.ts` — import
  from there, NOT chat-panel. Calls Anthropic directly (browser,
  `anthropic-dangerous-direct-browser-access`). `buildSystemPrompt` returns `SystemBlock[]`, NOT a string.
  ★★ Anthropic prompt caching is PREFIX-based: stable/cacheable content (instructions + operating-guide text)
  MUST come FIRST with `cache_control:{type:"ephemeral"}` breakpoint after it, and volatile data (today, task
  count, current view/mode) MUST come AFTER — mixing volatile data into the cached block (or putting the big
  guide block last) means the cache never hits. Operating guides live in a global store (`operating_guides`,
  out of TABLE_NAMES) surfaced by ONE `useOperatingGuides` instance in task-manager, threaded to both
  ChatPanel (chat) and AiSection (editor).
- **App-feature guide:** view-scoped built-in operating guides that teach the assistant the APP's features
  (so it answers "how do I …?"). Source `lib/app-feature-guide.md` = `## Overview` (no marker → always-on) +
  per-view `## Title` each followed by `<!-- views: <AppView ids> -->`, each ending with a truthful `AI:` line
  (what it can/can't do via TOOLS — don't over-claim). `scripts/gen-operating-guide.mjs`
  `parseFeatureGuide(md, VALID_VIEWS)` (exported, pure) → emits `BUILTIN_FEATURE_GUIDES` (`builtin-app-overview`
  scope {} + `builtin-feature-<view>` scope {views:[…]}) into `operating-guide-builtin.generated.ts`. ★★ the
  generator's `writeFileSync` is inside `if (isMain)` — so a vitest `import { parseFeatureGuide }` does NOT
  rewrite the generated file (don't move the write to top level). ★★ the generator NORMALIZES its output to
  LF (`out.replace(/\r\n/g,"\n")`) and `.gitattributes` pins `operating-guide-builtin.generated.ts` to
  `eol=lf` — WITHOUT this the emitted file mixed CRLF (template-literal lines on a Windows autocrlf checkout)
  with LF (`JSON.stringify`), so `prebuild` regeneration showed phantom line-ending drift. Don't drop either.
  Prebuild regenerates; the
  `operating-guide-builtin.test.ts` sync-guard re-parses the md + `toEqual`s the committed array (drift fails
  CI; keep the test's `VALID_VIEWS` == the generator's, == nav-config `AppView`). ★ Adding a section: TAG it
  (`<!-- views: … -->`) with REAL AppView ids — `parseFeatureGuide` THROWS on an unknown id AND on an untagged
  non-Overview section. Seeded by `use-operating-guides` `builtinSeeds()`/`reconcileBuiltins()`: on every load
  it refreshes built-in content/name/scope but PRESERVES the user's `enabled`/`priority` (no toggle-clobber on
  upgrade); all built-ins undeletable via `BUILTIN_IDS`. `selectActiveGuides` loads overview + the current
  view's guide into the cached prompt prefix (view change re-caches that slice). Guide content is
  ENGLISH-ONLY (no i18n). Knowledge only — adds NO new AI tools.
- **AI model picker:** `CHAT_MODELS` (`settings-types.ts`) is the SINGLE source for the dropdown; `ChatModel` is widened to
  `string` (open — pick any live model), sanitized on load by `/^claude-[\w.-]+$/` (≤64 chars, else `defaultAiConfig.model`).
  `use-chat-models.ts` `useChatModels(apiKey, enabled, currentId)` → `{options, loaded}` fetches Anthropic
  `GET /v1/models?limit=1000` browser-direct (live `claude-*` newest-first; key never logged). ★★ v0.165: NO
  offline pre-fill — `buildModelOptions(reg, live, currentId, {registryAsBase:false})` keeps the dropdown EMPTY
  (bar the current selection, still registry-labelled) until a live poll SUCCEEDS; `loaded` gates the
  `aiModelNeedsKey` hint (`ai-section.tsx`). Pure
  `chat-models.ts` `buildModelOptions`/`isValidAnthropicApiKey` (format `sk-ant-…`). ★ the AI key seals only when
  format-valid and is DISCARDED on blur with a toast (`ai-section.tsx`).
- **Per-project setting overrides (`Workspace.settingsOverrides`, v0.190.42):** a "This project" Settings section
  (`settings-sections/project-overrides-section.tsx`, SectionId `projectOverrides`, hidden in popouts) overrides
  otherwise-per-device settings. SPLIT storage: POLICY overrides (nextActions/notifications/timezone) travel WITH
  the project = `Workspace.settingsOverrides` blob (storage-only, all 6 paths, gated `config===undefined &&
  hasAnyOverride`, EXCLUDED from exports — mirrors `timelogLinks`; `sanitizeSettingsOverrides`+`hasAnyOverride` in
  `settings-overrides.ts`; rides the SAME save/load wiring as `knowledgeItems` incl. the autosave-effect DEPS
  array). APPEARANCE overrides (density + showViewHints + tasksViewMode; theme/scheme EXCLUDED) = per-device-
  per-project `project-appearance-prefs.ts` (key `aipm-cockpit:project-appearance`, reactive via
  `subscribeAppearance`/`getAppearanceSnapshot` + `useSyncExternalStore`). ★ tasksViewMode: the Open Points
  pane's own Table/Board toggle is SCOPE-AWARE — while this project's appearance override is on it writes the
  project store (`saveProjectAppearance`), else device `setSettings`; the pane reads `effective.tasksViewMode`
  so an override no longer snaps back when toggled. Pure `resolveEffectiveSettings(device,
  policy, appearance)` (`settings-effective.ts`) merges OVERRIDE-else-DEVICE (partial-merge nextActions/
  notifications, whole-replace timezone/appearance); `useEffectiveSettings(projectId)` is the reactive hook. ★★
  CONSUMERS read EFFECTIVE (task-manager: nextActions RANKING/`buildActionInput` + reminders + timezone/today;
  workspace-section: density/showViewHints/world-clock) — the next-actions/timezone EDITORS stay DEVICE; no
  override ⇒ identical to before. ★★ the appearance store's projectId MUST be `portfolioCurrentId` (= tursoProjectId
  in Turso mode), NOT raw `registry.currentProjectId` — SettingsView + workspace-section must agree or the override
  lands under the wrong key in Turso portfolio mode (a caught review HIGH). The "This project" UI REUSES
  `NextActionsSection`/`Notifications`/`TimezoneSettingsSection` fed effective + an override-writing onChange (Timezone
  passes `hideDisplaySwitcher` — the device-only switcher flag can't be captured into the override).
- **AI `update_settings` tool (safe-subset, v0.190.41):** a NON-entity write tool letting the assistant change
  a whitelisted slice of app settings on request — `dashboardDensity`, `showViewHints`, `tasksViewMode`,
  `enabledModules` (full desired set → `sanitizeFeatures`), and `nextActionsWeights` (each key coerced by the
  SAME `NEXT_ACTIONS_FIELD_COERCE` the settings UI + weight-suggestion flow use). Schema in `chat-tool-defs.ts`,
  routing in `chat-tools.ts` (`SettingsUpdateInput` + `updateSettings` on `ToolDispatcher`; the case throws if
  NO recognized field applied), impl in `use-chat-dispatcher.ts` (reads `settingsRef.current`, applies via
  `args.setSettings` → persists through the normal `writeSettings` effect, `isReadOnly` popout-guarded). ★★
  SECURITY: secrets / API keys / storage / integration config are DELIBERATELY unreachable — never widen this
  allowlist to a raw settings setter, and every value must stay routed through a validator/coercer. Guarded by
  `chat-tools.test.ts`.
- **AI write tools:** tool SCHEMAS (`TOOL_DEFS` + per-entity field-property helpers `taskFields`/`raidFields`/…
  + `ALL_RAID_STATUSES`) live in pure `chat-tool-defs.ts`; `chat-tools.ts` re-exports `TOOL_DEFS` (so
  `chat-api` imports it unchanged) and holds `runTool` routing + the `ToolDispatcher` type + arg-coercion/
  summary helpers; tools are IMPLEMENTED in `use-chat-dispatcher.ts`. Tasks/RAID/Changes/Milestones/
  Stakeholders all have create/update/delete; Resources now have create/get/update/delete + list
  (`create_resource`/`get_resource`/`update_resource`/`delete_resource`/`list_resources` — a task assigned to a
  name is NOT a directory entry; the AI must create the resource to populate the directory. `delete_resource`
  is filter-and-set with NO cascade — dangling `resourceId`/`ownerResourceId`/`resourceIds[]` refs are left as-is,
  mirroring the UI delete. Reference data — roles/disciplines/grades — has NO AI tools; assign a role via `roleId`).
  NEW entity write tool: add tool def (in `chat-tool-defs.ts`) +
  runTool case + `ToolDispatcher` method, then implement in the dispatcher `useMemo` — guard
  `if (args.isReadOnly) throw readOnlyError()` FIRST (popouts must not mutate), build the raw object and run
  it through the entity's `sanitizeX` (the SINGLE validator — `sanitizeRaidItem` enforces enums/dates/caps +
  per-category RAID-status defaulting), id = `nextEntityId(ref.current)` (max+1), then update BOTH the ref AND
  call `setX` (ref keeps back-to-back tool calls consistent). `runTool` write cases use
  `requireId`/`patchWithoutId` (strips `id` from the update patch — a destructured `_id` would trip the
  no-unused-vars rule).
  ★ R4 added THREE more: read-only `get_dashboard_snapshot` (live RAG + progress + EVM + budget rollup, via
  `ai-dashboard-snapshot.ts`) and read-only `list_allocations` (planner grid) — both zero-arg, NO `isReadOnly`
  guard (reads) — plus the write tool `set_task_dependencies`. Derived data reaches the dispatcher as
  un-memoized GETTERS on `ChatDispatcherArgs` (`getDashboardModel`/`getBudgetRollup`/`getAllocationsSnapshot`),
  each read through its own ref so the dispatcher `useMemo` dep array stays `[args.isReadOnly]` and an unused
  read tool costs nothing per render. Build the getter in `task-manager.tsx` beside the others.
  ★★ **REPLACE-SEMANTICS TOOLS: OMISSION MEANS DELETION.** `set_task_dependencies` replaces a task's whole
  predecessor list, so it is the ONLY tool in `runTool` where what the model LEAVES OUT is destroyed
  (`update_task` is a patch — a sloppy model can only overwrite what it names). Chat tool writes have **NO undo
  capture**, so that loss is unrecoverable. Two guards are mandatory and any FUTURE replace-semantics tool needs
  both: (1) a wholly-refused write (every proposed entry rejected, e.g. all cyclic) must leave the stored list
  UNTOUCHED — writing the empty result deletes the existing graph while the model reports only "I couldn't add
  that"; (2) every real write returns `removed[]` (prior minus applied) so a model that sends only the NEW entry
  instead of the full list cannot delete the rest invisibly. Validate the array-ness at the TOOL boundary
  (`chat-tools.ts` throws, mirroring `requireId`), not in the pure resolver — a non-array must never be treated
  as "clear all". ★ TEST TRAP: `expect(getX(id)?.field ?? []).toEqual([])` against a fixture that never had the
  field passes whether the code preserves or erases. Seed a real prior value and watch the test FAIL first.
- **AI allocation planning ("Plan with AI", Resources → Planning toolbar):** plan-then-apply over the EXISTING
  `Resource.utilization` map — ZERO new persisted fields, backend write paths or golden regen. Pure engine
  `alloc-plan/alloc-plan.ts` (prompt digest · forced `propose_allocations` tool · parse · **ground** · apply ·
  the `list_allocations` payload); one forced call in `alloc-plan-call.ts` (shared `runForcedToolCall`);
  glue hook `use-alloc-plan.tsx`; presentational `alloc-plan-modal.tsx`. Mirrors `task-dedup/` throughout.
  ★★ **`periodCapacityHours` (`resource-capacity.ts:145`) does NOT return available capacity** — despite the
  name it MULTIPLIES by the resource's own stored utilization (`percent: (util/100) × max(0, possible −
  absence)`, `hours: max(0, util − absence)`), i.e. hours ALREADY ALLOCATED. Used as "what fits" it reports
  every unallocated resource as **zero capacity** and a 50%-allocated person as `42/84`. Use
  **`availableCapacityHours`** (`alloc-plan.ts`) — workdays − holidays − absences, no utilization applied —
  and mirror its absence-override precedence (`absenceOverride?.[key]` first, else computed absence days) or
  the planner and the planning grid disagree about the same person. A contract-pin test holds the two
  functions equal at 100% utilization across all three absence branches.
  ★★ An allocation is a KEY in `Resource.utilization`, and its UNIT depends on that resource's own
  `utilizationMode`. The model always speaks HOURS; conversion happens in `groundAllocationCells`, which is
  also the anti-hallucination gate: unknown `resourceId` dropped, a `periodKey` outside the plan window OR at
  the wrong granularity refused (`PERIOD_KEY_RE` would otherwise eat it silently on the next load), negative/
  non-finite hours refused, values clamped to the SANITIZER's own bounds (percent ≤ 100, hours ≤
  `HOURS_MAP_MAX`) with a `clamped` flag, and a percent cell with ZERO capacity skipped — never written as 0
  or 100. ★ Writes are SET, NAMED CELLS ONLY (never window-ownership — that is the `timelog-apply` defect
  class), applied in ONE functional `setResources` with ONE `bulk.edit` undo entry, and confirm drops any cell
  whose live value moved since propose. ★ Every cap that can hide data reports it: `parseAllocationProposal`
  returns `truncated` (the cap that actually fires — the ground-level one is defence in depth and cannot),
  `buildAllocContext` caps periods (`ALLOC_CONTEXT_MAX_PERIODS`; 120 resources × 104 weekly periods was ~52k
  input tokens per click), and `list_allocations` carries a PER-RESOURCE `truncated` so an omitted resource is
  distinguishable from a genuinely idle one.
- **AI "Suggest RACI" (RACI matrix toolbar, 0.211.0):** plan-then-apply, mirroring `alloc-plan/` — no
  free-text instruction, just the live stakeholders + milestones. Pure engine `raci-suggest/raci-suggest.ts`
  (`buildRaciContext` digest · `RACI_SUGGEST_TOOL` schema · `parseRaciProposal` · `groundRaciCells` —
  re-grounds every UNTRUSTED model-proposed `{stakeholderId, milestoneId, role}` cell against the LIVE
  stakeholders/milestones, capped at `MAX_RACI_CELLS=200` with a `truncated` flag); one forced call in
  `raci-suggest-call.ts` (`runRaciSuggestion`, through the shared never-log `runForcedToolCall`); glue hook
  `use-raci-suggest.tsx`; review modal `raci-suggest-modal.tsx` shows every grounded cell's current value next
  to the proposed one, ticked by default, and applies only the ticked subset as ONE undo entry
  (`logActivity("ai.raciSuggest", …)`).
  ★★ **THE FOLD-PER-STAKEHOLDER LANDMINE — distinct from the bulk-edit FUNCTIONAL-SETTER landmine above,
  and NOT covered by it.** `useStakeholders.handleSaveStakeholder` already IS a functional setter
  (`setStakeholders(prev => …)`), so this is not that bug. The defect sits one layer up: `onSave` (the
  stakeholders pane's save handler) takes a SINGLE stakeholder and writes the CALLER's object verbatim, while
  `setRaciRole` (`stakeholders.ts`) returns a pure copy of a SNAPSHOT. Calling `onSave` once per accepted CELL
  means two accepted cells on the SAME stakeholder (different milestones) each fold into the same stale
  snapshot — the second `onSave` call silently drops the first cell's RACI entry. `foldCellsByStakeholder`
  (`use-raci-suggest.tsx`) collapses every accepted cell into ONE updated `Stakeholder` per person BEFORE any
  save happens, so `onSave` runs exactly once per touched stakeholder. ★ TEST TRAP: a fixture with one cell per
  stakeholder passes whether or not the fold happens — seed TWO accepted cells on ONE stakeholder to make the
  defect (and the fix) observable.
  ★★ **AMBIGUITY IS MEASURED AGAINST THE WORKSPACE, NOT THE PROPOSAL.** `raci-suggest-modal.tsx` qualifies a
  colliding name as `Name (#id)` using counts over the LIVE `stakeholders`/`milestones` lists (the same
  case-folded tally as `raci-panel.tsx`'s `labelFor`), for BOTH the accessible name and the VISIBLE text.
  Scoping the check to the proposed cells looks equivalent and is not: one proposed "Ada" while a second
  "Ada" exists in the project renders bare, and the user cannot tell which person this write lands on. Neither
  can `Milestone.name` be assumed unique — the milestone half needs the same treatment. ★ TEST TRAP: every
  fixture that keeps BOTH colliding rows in `cells` gives the same answer under either scope, so it proves
  nothing — seed the collision with only ONE side proposed. ★★ Qualifying only the `aria-label` and leaving
  the visible text bare is its own bug: it leaves the sighted user with strictly LESS information than the
  screen-reader user, in a dialog whose entire job is choosing which rows to commit.
  ★★ **THE CONTEXT CAP MUST REACH THE USER.** `buildRaciContext` caps at `MAX_CONTEXT_STAKEHOLDERS`/
  `MAX_CONTEXT_MILESTONES` and returns `truncated`; the hook surfaces it as `contextTruncated`, which the
  modal renders as its OWN sentence. Keep it distinct from `truncated` (the RESPONSE cap): they have opposite
  causes, and a capped INPUT means a missing proposal may simply be someone the model was never shown —
  otherwise silence reads as "Claude decided they need no role". This flag was computed and dropped on the
  floor at first, with only its engine unit test consuming it — so the engine test passed while the product
  had no such behaviour. A flag whose sole consumer is its own test is not a feature.
  ★ The modal's zero-cell branch must NOT say "Claude proposed no assignments": the hook only opens the
  preview with zero cells when everything was SKIPPED, so that sentence is false exactly when it renders.
  ★ `groundRaciCells` refuses an Accountable HANDOVER within one proposal (demote A, promote someone else on
  the same milestone) — `accountableHolder` still holds the old id when the second cell is examined.
  Conservative and safe, but it silently discards a natural proposal.
- **Inline "Ask Claude" edit (SP1):** a per-item edit popover (✨ hover icon on the task table row + Kanban
  card, or the row menu) takes a natural-language instruction and INVERTS the chat loop: ONE bounded
  `callClaude` call proposes tool calls but nothing executes yet. Pure `inline-ai-edit/plan.ts`
  `describeToolCalls` turns the returned tool_use blocks into a preview `EditPlan` (field diffs + related-item
  creates — RAID/change/milestone/stakeholder) the user reviews before Confirm; Confirm replays each call
  through the EXISTING `runTool` dispatcher (same per-entity `sanitizeX`), so it's plan-then-apply layered ON
  TOP of the chat tool schemas — ZERO new AI tools, Workspace fields, or backend write paths. New modules:
  `inline-ai-edit-call.ts` (the bounded call), `use-inline-ai-edit.ts` (the propose→preview→confirm/cancel
  state machine), `inline-ai-edit-popover.tsx` (the UI), `use-tasks-inline-ai-edit.tsx` (tasks-pane glue — a
  `.tsx` hook, coverage-EXCLUDED like the other Phase-3 glue hooks, keeping `tasks-section` under the size
  ratchet). Gated `isAiEnabled && !isPopout && !task.jiraKey`. ★ a request-generation nonce discards a stale
  proposal/confirm if the popover is reopened with a new instruction before the in-flight call resolves. Logs
  a new `ai.inlineEdit` activity kind. Wired into `task-row.tsx` (`RowContextValue`) + `task-kanban-card.tsx`
  (props — the board renders outside `RowContextProvider`, see the Kanban board bullet above).
  ★★★ **`callInlineEdit` STRIPS `viewDigest` from the snapshot and must keep doing so.** Inline edit does
  NOT build its own snapshot — `use-inline-entity-edit.ts` calls the SAME `dispatcher.getSnapshot()` the
  chat panel uses, so it inherits whatever that carries. Left in, the VIEW STATE block lists up to 15
  NEIGHBOURING rows WITH IDS from the surface the editor was opened from, directly contradicting this
  call's own scope block ("Do NOT update or delete any OTHER item") — a mutation planner handed a menu of
  things it was just told not to touch. `inline-ai-edit-call.ts` therefore passes
  `{ ...args.snapshot, viewDigest: undefined }`. ★ Pinned by `inline-ai-edit-call.test.ts` ("strips the
  view digest…"); its control asserts `VIEW SCOPE`, NOT the item label — the label comes from `scopeBlock`
  independently of `buildSystemPrompt`, so controlling on it proves nothing. ★★ Any NEW consumer of
  `getSnapshot()` must make the same decision explicitly.
- **AI "Deduplicate & unify tasks" (Open Points):** a toolbar action that PROPOSES duplicate merge groups,
  the user reviews/confirms, then it applies — plan-then-apply layered ON TOP of the existing task path (ZERO
  new AI tools, Workspace fields, or backend write paths). Pure i18n-free contract in `task-dedup/dedup.ts`
  (compact task digest → forced `propose_task_merges` tool schema → parse the UNTRUSTED model output →
  ★★ `groundMergeGroups` RE-GROUNDS every keep/merge id against the LIVE task list, so a hallucinated id can
  NEVER touch a real task); the non-hook `runDedupProposal` (`task-dedup-call.ts`) mirrors
  `scheduled-job-analysis.ts` EXACTLY (ONE forced call, no agentic loop, NEVER logs/echoes the apiKey or
  response body — thrown errors carry only HTTP-status + safe body tokens). `use-tasks-dedup.tsx` is the
  propose→preview→confirm/cancel state machine (a `.tsx` glue hook, coverage-EXCLUDED like the other glue
  hooks); `task-dedup-modal.tsx` is the review modal (per-group deselect). ★★ Confirm folds the duplicates +
  applies the KEEP task's sanitized unified fields via a FUNCTIONAL `setTasks(prev=>…)` updater and records
  ONE undo entry (removed duplicates + edited keeps). Gated `isAiEnabled && !isPopout && tasks.length >= 2`;
  no duplicates → toast; usage-limit / API errors surface via the shared `classifyAiError`. New `ai.taskDedup`
  activity kind + EN/DE strings. Wired into the Open Points toolbar (`tasks-section.tsx` → `task-manager`).
- **AI doc ingestion / multimodal:** `chat-panel.tsx`'s `ContentBlock` union includes `AttachmentBlock`
  (image/document) from pure `chat-attachments.ts` (classify by mime+extension, 20 MB cap, build the Anthropic
  block — PDF/image as base64 `source`, text as `{type:"text"}` document source; NO parsing lib, Claude reads
  natively). The `FileReader` (readAsDataURL for binary, readAsText for text) lives in chat-panel (module
  stays pure). A user turn with attachments sends `content` as `ContentBlock[]` (text block first, then
  attachments) not a string. CSP already allows `api.anthropic.com`. Chat view is NOT in axe `A11Y_VIEWS` —
  verify chat controls by eye.
- **AI project creation:** Step 0 "Describe" in `CreateProjectWizard` (gated on a configured key) → ONE
  forced-tool Anthropic call (`tool_choice:{type:"tool",name:"propose_project"}`, no agentic loop) in
  `use-project-proposal.ts`; pure contract/transforms in `ai-project-proposal.ts`. The proposal pre-fills the
  form as a `Partial<ProjectFormDraft>` patch (`initialDraftPatch`), NOT a `ProjectMeta` —
  `sanitizeProjectMeta`/`draftFromMeta` need many fields + present arrays Claude can't infer (a sparse meta
  throws). Seed records run through each `sanitizeX` (temp id BEFORE sanitize) → `appendSeed`/`remapSeed`; no
  new Workspace field. Model-supplied URLs gated by `isSafeHttpUrl`. Empty-state offers "Configure AI
  assistant" (`BackendConfigModal` `children` + `AiSection hideUsage`). ★ The proposal seed NOW includes a
  `resources` list (`ProposalSeed`/`PROPOSAL_TOOL`/`TemplateSeed` all carry it) so the AI populates the
  directory; `remapSeed` id-maps the seeded resources and LINKS task `resourceId` / RAID `ownerResourceId` /
  stakeholder `resourceId` by case-folded name (or email) — an unmatched owner stays a plain-string assignee
  (FK undefined/null). When NO resources are seeded the person FKs are cleared exactly as before. Resource
  already round-trips all six paths, so no new write path / golden regen.
- **Create project from source:** the create wizard's Step 0 (extracted to `step0-import-panel.tsx`) adds
  Upload-file / SharePoint / Confluence-URL import alongside Describe; all funnel into
  `useProjectProposal().generate(...)` — widened to `string | ContentBlock[]` (multimodal: PDF/image read
  natively via `chat-attachments`, NO parsing lib). File: 20 MB cap + `classifyAttachment` reused. SharePoint:
  `SharePointPickerModal` → `fetchSharePointFileContent` via Graph `/shares/{u!base64(url)}/driveItem/content`
  (reuses `PICKER_SCOPES`, no extra consent). ★★ Confluence: `src/app/api/confluence/page/route.ts` MUST REUSE
  `api/jira/_helpers` (`parseJiraRequest`/`callJira`/`forwardJsonResponse`) — NEVER a raw `fetch` (that
  bypasses the SSRF allowlist to `*.atlassian.net` + Basic auth + timeout). Confluence is the SAME Atlassian
  host, just the `/wiki/rest/api/content/{id}?expand=body.view` path; validate `pageId` with `/^\d+$/`
  SERVER-SIDE before building the path (path-injection guard). Browser→`/api/confluence` is same-origin (no
  CSP host needed). ★ Gating: file+describe always, SharePoint on `isSharePointEnabled`, Confluence on FULL
  Jira config (`enabled&&siteUrl&&apiToken&&email`). ★ Error boundary: SOURCE failures → sanitized
  `importError`; the Anthropic `generate` failure → the hook's `aiError` (kept separate). No key/token/body
  ever logged or rendered.
- **Create-project multi-upload:** `step0-import-panel.tsx`'s file path takes `<input multiple>` → classifies + size-gates
  each into ONE `ProposalContent` (`MAX_IMPORT_FILES=10`, invalid/over-cap files skipped with a notice). A Timelog-style
  BLOCKING loading modal with a Cancel button aborts the in-flight call via a shared `AbortController` (`abortRef`);
  `generate(input, signal?)` + the wizard's `onIngest`/`runIngest(content, signal?)` forward the signal. ★ during the fast
  local READ phase `abortRef` is null so Cancel is a no-op.
- **AI Action Center suggestions:** Action Center "Analyze with AI" → ONE forced-tool call
  (`tool_choice:{type:"tool",name:"report_analysis"}`, no loop) in `use-action-analysis.ts`; pure contract/
  transforms in `action-ai.ts` (`parseAnalysis` validates untrusted model output; `groundEntity` RE-VALIDATES
  model entity ids against the live workspace before any `requestOpen` deep-link — hallucinated id → fall back
  to `requestChat`). ADVISORY only (no write tool; deterministic `next-actions/` engine untouched; no new
  Workspace field). Hook lives in `task-manager.tsx` ABOVE the view so the in-memory result survives view
  remounts; bundle is `isPopout ? undefined`. Gated on key + `ai.actionSuggestions !== false` (default ON).
  Rendered above the now/soon/monitor tiers; AI rows use a separate `ai-action-row.tsx` (NOT `ActionRow`).
- **AI scheduled jobs:** opt-in recurring portfolio-analysis. Pure i18n-free `scheduled-jobs/` engine
  (`isDue`/`nextRunAt`/`dueJobs`/`appendRun`; `now` ALWAYS passed in — no `Date.now()`/`new Date()` inside).
  Global `scheduled_jobs` store (JSON-blob row, Turso-gated + localStorage fallback) OUT of `TABLE_NAMES`.
  Runner `use-scheduled-job-runner.ts` lives in `task-manager` ABOVE the view; runs DUE jobs on
  mount/visibility/5-min-tick, SERIAL + overlap-guarded; fail-once-per-slot (a failed run still advances
  `lastRunAt` — avoids re-spamming a BILLED call). The call is the NON-hook `runJobAnalysis`
  (`scheduled-job-analysis.ts`) so the runner loops it; `use-action-analysis` delegates. ADVISORY only; never
  in popouts. Gated on key + `ai.scheduledJobs === true` (default OFF / opt-in — UNLIKE
  `actionSuggestions`'s `!== false`).
- **AI weight suggestions:** "Suggest with AI" in the next-actions settings → ONE forced-tool call
  (`suggest_weights`, forced, NO loop) in `weight-suggestion-call.ts` (the fetch now routes through the shared
  `runForcedToolCall` (`ai-forced-call.ts`) — the single never-log envelope; never logs/echoes apiKey or body; thrown
  errors carry only HTTP-status digits or `"parse"`). Pure contract `next-actions-tuning.ts` + `weight-suggestion-ai.ts`; hook
  `use-weight-suggestions.ts`. ★★ EVERY model-proposed value reaching `settings.nextActions` MUST pass
  `parseWeightSuggestions` → `NEXT_ACTIONS_FIELD_COERCE[field]` — the SAME per-field validators
  `resolveNextActionsConfig` uses (hoisted to a shared exported map in `settings-types.ts`; a
  hallucinated/out-of-bounds value can never land). Accept writes via the settings setter (→ `writeSettings`),
  never raw setItem. Targets the 3 confidence weights by default; opt-in
  `ai.suggestAllNextActionThresholds` (default OFF) widens to all 10. Learning history +
  `summarizeTrendsForPrompt(actionTrends)` = INPUTS; ephemeral result; popout read-only. ★ A pure rationale
  sanitizer regex is the SHARED `CONTROL_CHARS = /[\x00-\x1f]/g` (use `\x` HEX escapes — never type literal
  control bytes; they corrupt the file to binary).
- **No `settings.mode` field:** PM mode is DERIVED — `deriveMode(settings.features)` (same call the chat
  snapshot uses in `use-chat-dispatcher.ts`). Reading `settings.mode` is `undefined`; use `deriveMode`.
- **View-scoped AI prompts:** before this, the assistant was told only `Current view: <name>` — a bare
  string with no meaning attached. `view-ai-scope.ts` fixes that: `VIEW_AI_SCOPE` is a **total**
  `Record<AppView, ViewScope>` (`purpose` / optional `reading` / optional `toolHints`) describing what
  every one of the app's 34 views is for. ★ Total BY CONSTRUCTION — adding an `AppView` is a typecheck
  error until it is described here, which is why there is deliberately **no** "every view is present"
  test: such a test could not fail. `view-ai-scope-block.ts` formats the registry into two blocks:
  `buildViewScopeBlock` (what the surface IS — call-invariant per view) and `buildViewStateBlock` (what
  is currently ON it). `buildSystemPrompt`'s SIGNATURE was deliberately not changed — both blocks derive
  from the `snapshot` it already receives, so `chat-panel.tsx` is untouched.
  ★★ **The scope block is NOT gated by `settings.ai.groundInGuides` and NOT counted in
  `GUIDE_CHAR_BUDGET`.** It is deliberately **not** an `OperatingGuide`, even though that type carries a
  `builtIn` flag that makes routing built-ins through the guide store look natural — the whole guide
  block is gated by that one user preference, so doing that would let a user setting silently switch off
  shipped product behavior. `VIEW_AI_SCOPE`/`VIEW_AI_DIGEST` stay their own registries.
  ★★★ **THE CACHE BOUNDARY — BOTH BLOCKS ARE VOLATILE, and an earlier revision of this bullet said the
  opposite.** It claimed the scope block belonged in the cached prefix because it is "invariant per
  view". **Per-view invariance is not the property prompt caching rewards; per-CONVERSATION invariance
  is.** ★★★ **AND THE FIRST CORRECTION WAS ALSO WRONG — read this before repricing anything here.** It
  argued the move BOUGHT a cache read. It did not: `stableText` is `[stableInstructions, guideBlock]`,
  and `guideBlock` is view-filtered by `selectActiveGuides`. `settings.ai.groundInGuides` defaults to
  **true** (`settings-types.ts`, and a missing key reads as true), and **20 of the 21
  `BUILTIN_FEATURE_GUIDES` are view-scoped** (mean ~1 KB; Open Points ~2.9 KB), all seeded `enabled:
  true` and undeletable. So the cached prefix ALREADY changed on every view switch, by default, for
  every user — through a block an order of magnitude larger than the one being moved. Moving a
  ~100-token block out of a prefix that churns anyway saves nothing and costs ~100 tokens/message.
  ★★★ **`CACHED_TOOLS` (`chat-api.ts`) is what actually fixes it** — the LAST tool carries
  `cache_control`, closing a cache segment at the end of `tools` so the per-view guide swap re-caches
  only the smaller system slice after it. Without it the cached prefix is tools + `stableText` and that
  guide swap rewrites ~6.5k tokens of schemas on every view switch. ★ Measure the SERIALIZED payload,
  not the file:
  `JSON.stringify(TOOL_DEFS)` is ~26 KB / **~6.5k tokens** across 38 tools, while `chat-tool-defs.ts` on
  disk is ~24.8 KB — the two land close by coincidence (only ~16 KB of the file is the literal; comments
  and helpers do not ship, and property names expand on serialisation). ★ Reproduce by writing a two-line
  script that imports `TOOL_DEFS` and logging `TOOL_DEFS.length, JSON.stringify(TOOL_DEFS).length`, then
  `npx vite-node <file>` → `38 25942` (measured 2026-08-05). **`vite-node` has NO `-e` flag** — an earlier
  revision of this line gave a one-liner using it, which prints the help text and exits 1.
  Both `buildViewScopeBlock` and `buildViewStateBlock` output sit in the **volatile, uncached suffix**,
  scope before state — which is now a readability choice (what the surface IS, then what is on it), not
  a cost one, since the tools breakpoint is where the saving comes from.
  ★★ Three things would silently raise cost and break **nothing visible**, so they are the ones to
  guard: dropping `CACHED_TOOLS` back to a bare `TOOL_DEFS`; moving either block into `stableText`; or
  putting anything view-dependent AHEAD of the tools breakpoint. `chat-api.system-prompt.test.ts`
  ("marks exactly the LAST tool…", "puts the view scope in the UNCACHED block…", "puts the digest in the
  UNCACHED block…") is the only thing that would catch any of them.
  ★★ **This bullet has now been wrong twice in opposite directions** — first asserting the scope block
  belonged in the cached prefix, then asserting that moving it out bought a read. Both were reasoned
  from arithmetic that was internally correct and priced against a baseline nobody checked. Before
  changing anything here, verify what `stableText` actually contains AT RUNTIME for a default install;
  this file already said "view change re-caches that slice" (in the operating-guides bullet
  above) throughout both errors.
  ★ `view-ai-digest.ts`'s `VIEW_AI_DIGEST` is a **`Partial<Record<AppView, DigestFn>>`** on purpose,
  covering exactly four views (`open-points`, `workload`, `gantt`, `budget`) fed through
  `getSnapshot().viewDigest` in `use-chat-dispatcher.ts` — the other 30 views cost nothing and nobody
  should fill them in for symmetry. Pure, i18n-free, **clock-free** (`today` passed in, unread by all
  four digests today but kept required so the first date-based digest doesn't have to touch every call
  site to add it).
  ★★★ **The digest must describe what the user can actually SEE, and this took TWO corrections.** The
  input is assembled by **`use-view-digest.ts`**, not inline in the dispatcher — it needs pane state the
  dispatcher does not hold. ★★ Correction 1: an early revision fed the digest raw `tasks`. ★★★ Correction
  2 — and this bullet asserted the fix while it was still wrong — it then fed `filteredSortedTasks` and
  called that "the array the Open Points TABLE actually renders". **It is not.** The table renders
  `visibleTaskRows(filteredSortedTasks, healthFilter, hideFinished, …)`, and `visible-task-rows.ts`'s own
  header records this identical bug being fixed once before for select-all: reading `filteredSortedTasks`
  is "upstream of BOTH filters", so it "reported on — and acted on — rows the table was not rendering".
  The hook now calls that SAME shared function. ★ Never reintroduce a second copy of the narrowing.
  ★★★ **`TaskFilterValues` is ONLY `{assignee, group, label}`** — the table also applies a priority
  filter, a debounced search, hide-externals, the health filter and hide-finished. The digest therefore
  takes an **`extraFilters: readonly string[]`** built in `use-view-digest.ts`. Without it the digest
  printed "No filters active — the table shows every task" while a search hid all but a handful — worse
  than silence, because that sentence exists to tell the model it need not call a tool.
  ★★ `gantt`/`workload`/`budget` deliberately report **project totals, not visible rows**, because their
  panes filter through state this layer cannot reach without duplicating panel logic (Gantt alone: four
  prefs, a show-milestones toggle, and the rule that a task with no due date is never drawn). **Each
  digest LINE says so itself** — the shared `buildViewStateBlock` wrapper must NOT re-acquire a blanket
  "after their filters and sorting" claim, which is what it used to carry: one wrapper promise turned
  three honest counts into three false ones.
  ★★ The digest reads **`effectiveFilters`** for the assignee/group/label triple — never the RAW values —
  for the same reason the table and the `<select>`s do. The "no filter" sentinel is the shared
  **`FILTER_ALL`** (`"All"`, imported from `task-filters.ts`) — not an invented `"__all__"`. A local
  sentinel would have made every message from Open Points report three phantom active filters.
  ★★★ **THAT CLAIM IS SCOPED TO THOSE THREE, and an earlier revision of this line stated it flatly for
  the whole digest — which the `use-view-digest.ts` extraction falsified without touching the sentence.**
  The hook reads `healthFilter`, `priorityFilter` and `search` STRAIGHT from `useFilters()`, because
  `effectiveFilters` does not carry them (`TaskFilterValues` is only the triple).
  ★★ **It also reads `hideFinishedTasks`/`hideExternalTasks` off the RAW DEVICE settings** the dispatcher
  is handed, while `tasks-section.tsx` reads them off **effective** settings — whose own comment warns
  that reading device there "would silently re-open the drift the shared `visibleTaskRows()` exists to
  close". The two agree TODAY only because neither flag is overridable: `resolveEffectiveSettings`
  (`settings-effective.ts`) touches `nextActions`, `notifications`, `timezone`, `additionalTimezones`,
  `dashboardDensity`, `showViewHints` and `tasksViewMode`, and nothing else. ★★★ `tasksViewMode` JOINED
  that list once already, so this is a live risk, and a RUNTIME test cannot catch it — a future override
  key is simply absent from any fixture. `use-view-digest.test.tsx` therefore carries a **compile-time**
  guard ("neither hide flag is a per-project appearance override"): add either flag to
  `ProjectAppearancePref` and tsc fails there, pointing at the fix (thread effective settings in).
  ★★ It reads **`searchDebounced`, not the raw box value** — the rows it counts are filtered on the
  debounced one, so reading raw would under-report on CLEAR (raw empties instantly while the rows stay
  narrowed for ~150 ms, emitting "No filters active"). See the hook's own comment for the asymmetry.
  ★★ **Two registry entries disclose gaps rather than hinting at tools that cannot answer:**
  `portfolio-health` (`get_dashboard_snapshot` covers the active project only — there is no cross-project
  tool) and `raci` (RACI assignments are not tool-readable at all: `Stakeholder.raci` is absent from both
  `StakeholderSummary` and `MilestoneSummary`, the shapes `list_stakeholders`/`list_milestones` actually
  return). `activity` and `timelog` likewise state outright that the model cannot read them, rather than
  staying silent and risking an invented answer.
  - **The chip↔capability rule:** every view in `ASK_CLAUDE_PROMPTS` (`ask-claude-prompts.ts`) must have
    `toolHints` in `VIEW_AI_SCOPE` or a digest behind it in `VIEW_AI_DIGEST` — pinned by
    `ask-claude-prompts.test.ts` ("every chipped view has tool hints or a digest behind it"). A chip
    asking a question no tool can answer is a dead prompt; the same test file also pins that `timelog`
    and `activity` carry **no** chips at all.
    26 of 34 views carry chips (2026-08-05, reproduce:
    `grep -c "^  \"\?[a-z-]*\"\?: \[" src/app/ask-claude-prompts.ts` — or count the keys of
    `ASK_CLAUDE_PROMPTS`).
  - **The Settings disclosure is invisible to the axe gate** — `AiViewScopeDisclosure`
    (`settings-sections/ai-view-scope-disclosure.tsx`) lives in the AI section of Settings, and the axe
    gate scans Settings → **General** only, so this section is never reached. Its unit tests are the only
    coverage. It reuses `ToggleButton`'s new `variant="disclosure"` (`aria-expanded`+`aria-controls`
    instead of `aria-pressed` — a disclosure REVEALS content, it doesn't change application state, so the
    stateful on/off semantics don't apply).

