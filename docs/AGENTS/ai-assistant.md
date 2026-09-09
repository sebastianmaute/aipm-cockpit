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
  `systemBlocksText`, `stringifyResult`) lives in pure i18n-free `chat-api.ts` — import
  from there, NOT chat-panel. File-attachment reading/classifying/extracting is a separate pipeline,
  `ingestFile`/`ingestBytes` in `attachment-ingest.ts`, shared by chat-panel and the wizard's
  Step0ImportPanel (`readAttachmentData` used to live in `chat-api.ts`; it was retired when that
  pipeline was unified). Calls Anthropic directly (browser,
  `anthropic-dangerous-direct-browser-access`). `buildSystemPrompt` returns `SystemBlock[]`, NOT a string.
  ★★ Anthropic checks the prompt-cache prefix in the fixed order **`tools` → `system` → `messages`**, and an
  entry is reusable only while the prefix is byte-identical from the very start — so per-turn content placed
  ANYWHERE before `messages` makes the WHOLE transcript uncacheable, not merely the one segment it sits in.
  `buildSystemPrompt` is now a thin composition of two builders: `buildStableSystemBlocks` (the STABLE
  half — itself two blocks: fixed instructions + the always-on guide text, `cache_control`-terminated,
  then the current view's guide text with no marker of its own — see the two-block bullet under
  "View-scoped AI prompts" below) and `buildTurnContext` (the
  volatile half — today, task count, current view/mode, … — returned as a plain string). `chat-panel.tsx`
  calls the two separately and sends the volatile half riding the OUTGOING turn's last message, never
  `system`, via `chat-cache-layout.ts`'s `buildWireMessages`; `buildSystemPrompt` itself (both halves in
  `system`) survives only for `inline-ai-edit-call.ts`, a one-shot call with no transcript to protect. See the
  "**THE CACHE BOUNDARY**" bullet under "View-scoped AI prompts" below for the full shape, and
  `chat-cache-layout.ts`'s own header for the Anthropic reference citations this rule rests on. Operating
  guides live in a global store (`operating_guides`, out of TABLE_NAMES) surfaced by ONE `useOperatingGuides`
  instance in task-manager, threaded to both ChatPanel (chat) and AiSection (editor).
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
  `chat-api` imports it unchanged) and holds `runTool` routing + the `ToolDispatcher` type; tools are
  IMPLEMENTED in `use-chat-dispatcher.ts`. ★ The helpers it used to hold have been extracted for the
  800-line ratchet: the eight entity→summary projections to `chat-tool-summaries.ts` (RE-EXPORTED from
  `chat-tools.ts`, so no importer changed), the update path's coercions + patch builders + concurrency guard
  to `chat-tools-updates.ts`, and the `list_tasks` projection to `chat-tools-lists.ts` (those two are plain
  imports — a consumer wanting `ConcurrencyTokenError` imports it from `chat-tools-updates.ts` directly).
  Tasks/RAID/Changes/Milestones/Stakeholders all have create/update/delete; Resources now have create/get/update/delete + list
  (`create_resource`/`get_resource`/`update_resource`/`delete_resource`/`list_resources` — a task assigned to a
  name is NOT a directory entry; the AI must create the resource to populate the directory. `delete_resource`
  is filter-and-set with NO cascade — dangling `resourceId`/`ownerResourceId`/`resourceIds[]` refs are left as-is,
  mirroring the UI delete. Reference data — roles/disciplines/grades — has NO AI tools; assign a role via `roleId`).
  NEW entity write tool: add tool def (in `chat-tool-defs.ts`) +
  runTool case + `ToolDispatcher` method, then implement in the dispatcher `useMemo` — guard
  `if (args.isReadOnly) throw readOnlyError()` FIRST (popouts must not mutate), build the raw object and run
  it through the entity's `sanitizeX` (the SINGLE validator — `sanitizeRaidItem` enforces enums/dates/caps +
  per-category RAID-status defaulting), id = `mintId(kind, ref.current)` (session-scoped high-water mint, never
  reused), then update BOTH the ref AND
  call `setX` (ref keeps back-to-back tool calls consistent). `runTool` write cases use
  `requireId`/`patchWithoutId`, both of which now live in `chat-tools-updates.ts` (extracted from
  `chat-tools.ts` for the 800-line ratchet, not for a design reason). ★★ `patchWithoutId(input, kind)` takes
  the entity KIND as a second argument and strips THREE classes of key, not one: `id`, the control value
  `expectedToken`, and every field in that kind's `TOKEN_EXCLUDED` list. It has no whitelist — whatever the
  model emits is spread straight over the stored entity — so the strip is what keeps the ACCEPTED surface
  equal to the ADVERTISED one. `update_task` is the exception and does NOT use it: it goes through
  `buildPatch`, a whitelist, which drops any key it does not name. A NEW pass-through update tool that skips
  the strip reintroduces a false permit for exactly the excluded fields — see the concurrency-token bullet
  below.
  ★ R4 added THREE more: read-only `get_dashboard_snapshot` (live RAG + progress + EVM + budget rollup, via
  `ai-dashboard-snapshot.ts`) and read-only `list_allocations` (planner grid) — both zero-arg, NO `isReadOnly`
  guard (reads) — plus the write tool `set_task_dependencies`. Derived data reaches the dispatcher as
  un-memoized GETTERS on `ChatDispatcherArgs` (`getDashboardModel`/`getBudgetRollup`/`getAllocationsSnapshot`),
  each read through its own ref so an unused read tool costs nothing per render. Build the getter in
  `task-manager.tsx` beside the others. ★ This used to say the dep array "stays `[args.isReadOnly]`", which
  is no longer true — it is `[args.isReadOnly, documentTools]`, because `documentTools` is a REAL dep rather
  than a ref-routed value (a `useMemo`'d object captured by the spread, whose identity must change when a
  popout toggles read-only). The RULE — route reactive values through refs, do not add them as deps — is
  what survives; verify the literal array in `use-chat-dispatcher.ts` rather than trusting a quoted one.
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
- **Optimistic concurrency on SEVEN write tools:** the six entity updates — `update_task` ·
  `update_raid_item` · `update_change` · `update_milestone` · `update_stakeholder` · `update_resource` —
  plus `set_task_dependencies`, each REQUIRING an `expectedToken` input beside `id`.
  ★★★ **ENUMERATE THE GUARDED SET BY WHAT A SCHEMA ADVERTISES, NEVER BY THE `update_*` NAME.** The seventh
  is why: `set_task_dependencies` is a WHOLE-LIST REPLACE of `dependencies` — a field that IS in
  `CSV_COLUMNS`, is NOT in `TOKEN_EXCLUDED.task`, and comes straight from model input — whose own schema
  tells the model to `list_tasks` first, i.e. to perform exactly the read-reason-write sequence the token
  exists to make safe. It shipped unguarded through the slice that introduced the token, because every
  enumeration (this bullet, the carve-out comment in `ai-entity-token.ts`, and the anti-vacuity case in
  `ai-entity-token.test.ts`) keyed on the NAME. The companion case in that test file now enumerates every
  tool carrying `expectedTokenField`, which is a property of the tool rather than of its name. `runTool` resolves the row, re-derives the token from it with
  `entityToken(kind, row)` (`ai-entity-token.ts`) and throws a `ConcurrencyTokenError` on mismatch — and on
  ABSENCE. Before this, an `update_*` call was an id plus a patch with NO staleness check of any kind: the
  model's write silently overwrote whatever a human, a background sync or a second tab had done in the
  meantime.
  ★★★ **THE TOKEN IS DERIVED, NOT STAMPED, AND THAT IS THE DESIGN.** The obvious alternative —
  `Task.localModifiedAt`, which already exists and is already described as sync-conflict bookkeeping — was
  rejected: a stamp is only as good as the set of writers that remember to set it, and a write path that
  forgets leaves the field UNCHANGED after a real edit. The guard then compares two identical values,
  concludes nothing moved, and permits the exact overwrite it exists to prevent — a false PERMIT, which is
  the dangerous direction. `entityToken` instead hashes the entity's own content through the byte-stable
  CSV projection (`CSV_COLUMNS`/`fieldToString` and their five peers), so a change by ANY writer, including
  write paths added years from now, is visible by construction.
  ★★ CONSEQUENCE worth recognising rather than debugging: adding a column to any `*_CSV_COLUMNS` array
  invalidates every outstanding token for that entity at once, because the projection changed. Safe
  direction — a stale token is refused, never silently accepted — but it looks like a burst of spurious
  conflicts right after such a change.
  ★★ `TOKEN_EXCLUDED` (per entity) holds the bookkeeping columns left OUT of the hash — `localModifiedAt`,
  `lastSyncedAt`, `outlookEventId`, `inquiriesSent`, `noteLog`. A field may be excluded ONLY if no `update_*`
  tool lets the MODEL choose its value; excluding one the model can set reintroduces a false permit for
  exactly that field. "Lets the model CHOOSE" is load-bearing and every shorter wording of it has been
  false — the handlers themselves stamp `localModifiedAt` over the patch, and `send_inquiry` and
  `set_task_dependencies` write excluded fields too. In every such case the EXCLUDED FIELD's value is
  computed by the app, so the token is deliberately blind to THAT FIELD: what is lost is a counter or a
  timestamp, never a field of content.
  ★★★ THAT IS A STATEMENT ABOUT THE FIELD, NOT ABOUT THE TOOL, and reading it as a clearance for
  `set_task_dependencies` is precisely what left that tool unguarded for a release — it also writes
  `dependencies`, which is token-COVERED and model-supplied. See the seven-tool note above.
  `ai-entity-token.test.ts` asserts the exclusion set is disjoint from what the tools ACCEPT, driving the
  real dispatch path rather than the advertised schema.
  ★★ NOT-FOUND IS RESOLVED BEFORE THE TOKEN, structurally rather than as a preference: the token can only be
  derived from the stored row, so there is nothing to compare until the row is in hand. It is also the better
  error — a deleted entity reports "not found" instead of "changed since you read it", which would send the
  model re-reading a row that is gone.
  ★★ ABSENCE IS REFUSED, not read as "skip the check": otherwise a model bypasses the guard by omitting one
  field, and the guard protects only the callers that already cooperate. `required: ["id", "expectedToken"]`
  in the schema is ADVISORY — nothing in the API rejects a call that omits it, so `requireToken` on the
  ACCEPTED surface is the actual enforcement. The advertised field (`expectedTokenField`) is declared beside
  `requireToken` in `chat-tools-updates.ts`, not in the schema file, so the two cannot drift.
  ★★ FIVE new row getters on `ToolDispatcher` exist ONLY to derive the token and are never a model-facing
  read: `getRaidRow`/`getChangeRow`/`getMilestoneRow`/`getStakeholderRow` (`use-register-tools.ts`) plus
  `getResourceRow` (`use-chat-dispatcher.ts`). The SUMMARY projections the model actually reads
  (`listRaid`/`get_resource` and their peers) cannot substitute: they drop the rich fields an edit is most
  likely to touch (`description`, `mitigation`, …), so a token hashed from a summary would be a false permit
  for every dropped field. Tasks need no such getter — `getTask` already returns the stored row.
  ★ MATCH ON `ConcurrencyTokenError`, NEVER ON ITS MESSAGE. Both messages are model-facing recovery
  instructions returned as a `tool_result` and may be reworded at any time. The type exists so a caller can
  tell "refused, nothing was written" apart from every other tool failure — see the insight-replay note below.
  ★ TWO write tools are deliberately NOT token-guarded, and both are named in `NOT_TOKEN_GUARDED` in
  `ai-entity-token.test.ts` (whose exhaustiveness case turns red if the field is spread onto either):
  `update_settings` is not an entity with a projection, and `update_document` persists as a meta-blob with no
  CSV projection, so `entityToken` structurally cannot cover it — documents carry their own per-block
  optimistic concurrency instead. ★★★ **THAT EXEMPTION IS NOT A HOLE, AND THIS LINE SAID IT WAS** (it read
  "through `DocOp`'s `expect`, which is currently NOT advertised on the tool schema" — true when written,
  false since 2026-09-03, `docs/open-followups.md` §349). `update_document` now REQUIRES a per-block
  `expectHash` on `replace`/`delete`/`move`, refused on absence or blankness at the tool boundary
  (`requirePayload`) in the same spirit as `requireToken`; `get_document` hands out a
  parallel `blockTokens` array to satisfy it.
  ★★ NOT "exactly as `requireToken` refuses the six entity tools", which this line said and which is
  wrong twice. `requireToken` covers SEVEN tools — the six `update_*` plus `set_task_dependencies`
  through `requireTaskWriteToken`; enumerate them rather than trusting a count with
  `awk '/case "/{c=$0} /requireToken\("|requireTaskWriteToken\(/{print c}' src/app/chat-tools.ts`.
  And `requirePayload` is STRICTLY STRONGER, not a mirror: `requireToken` tests
  `typeof sent !== "string" || sent.length === 0`, so `"   "` is ACCEPTED and then fails a layer down
  as "changed since you read it" — the misleading-reason failure `requirePayload`'s own trim exists to
  avoid.
  ★★★ THE TOKENS DO NOT SURVIVE THE WRITE THEY GUARD, and nothing hands out fresh ones:
  `DocumentUpdateResult` carries no tokens, so after any applied op every token the model still holds
  for a changed block is stale and every index at or after an insert/delete/move has shifted. The
  protocol is to re-read with `get_document`, and the `update_document` tool description is the only
  place the model is told so. ★★ The MECHANISM differs and that is deliberate: a HASH
  (`blockToken`), not the full-block `expect` echo, because `blockChanged` is structural `deepEqual` and a
  model cannot reproduce rich HTML byte-for-byte. ★ The ENGINE (`document-ops.ts`) stays permissive on an
  absent `expectHash` — the hand block editor shares those arms — so the strictness lives at the tool
  boundary alone.
  ★★★ **THE READ PATH EMITS THE TOKEN, AND IT RIDES EVERY ROW.** Eight read tools carry an `expectedToken`
  field: `get_task` and `get_resource` on the returned object, and `list_tasks` / `list_raid` / `list_changes`
  / `list_milestones` / `list_stakeholders` / `list_resources` on EACH ROW. `withToken` / `withRowTokens`
  (`chat-tools-lists.ts`) attach it; `patchWithoutId` strips it back off on the write, so a model may echo a
  read row straight into an `update_*` call. ★★ IT HAD TO RIDE THE LIST, and that is not a convenience:
  RAID, changes, milestones and stakeholders have NO `get_*` tool at all (`grep -oE 'name: "get_[a-z_]+"'
  src/app/chat-tool-defs.ts` returns `get_task`, `get_resource`, `get_app_state`, `get_dashboard_snapshot` —
  no register among them), so attaching the token to single-entity reads alone would leave four of the six
  guarded entities permanently unwritable. ★★ ADJACENCY OVER A SIDECAR MAP: an `{id: token}` map beside the
  rows would ask the model to pair a token with a row through a second structure, and every mispairing it
  makes is a token that is valid for SOME row and wrong for THIS one. ★★★ EVERY TOKEN IS DERIVED FROM THE
  FULL STORED ROW, NEVER FROM THE ROW THE MODEL SEES — that is why `withToken` takes the two as separate
  arguments and why the five row getters below exist. Deriving from the `*Summary` (or, for `list_tasks`,
  from the markup-stripped item) is a false PERMIT for every field the projection drops, and it is the
  easiest way to reintroduce the defect the whole guard exists to stop.
  ★★ THIS GAP SHIPPED ONCE AND THE ROUND TRIP IS WHAT NOW PINS IT. The guard landed with every refusal
  tested and NOTHING asserting that a read hands out a token the write accepts, so every chat-driven
  `update_*` was refused for want of a value the chat path never produced — a full green suite over a
  permanently broken write path, unrecoverable because the token is a 16-hex hash of an internal projection
  no model can compute. The "the read path hands out a token the write path accepts" block in
  `chat-tools.test.ts` reads through each of the eight tools, takes the token OUT OF THE RESPONSE and spends
  it on the matching update, for all six entities. ★ Its `toBe(FRESH_*_TOKEN)` lines are not redundant with
  the write succeeding: a bug deriving BOTH halves from the summary would round-trip perfectly.
  ★ RESPONSE COST, measured over the 14 tasks of `sample-workspace-small.json`: `list_tasks` is **10673**
  bytes with tokens against **10183** without and **12153** before the envelope/slimming projection — so the
  token gives back about a quarter of that saving (~35 bytes per row, net −12.2% rather than −16.2%).
  ★★ SUPERSEDED ON THE ABSOLUTE FIGURES 2026-09-09 — THE RATIO CLAIM ABOVE STILL HOLDS, THE TOTALS DO NOT.
  Dropping the note log from the list path (the envelope bullet below) took that same 14-task response from
  10671 to **7909** bytes, so `list_tasks` no longer costs 10673 anywhere. Re-running the pre-drop code today
  gives 10671, two bytes off the number above — near enough to confirm it, not near enough to pretend it was
  re-derived. Read all three of those numbers as the record of what the row token cost when it landed.
  ★ `withRowTokens` does one `find` per row via the full-row getter. Stated, not optimised: these registers
  are project-scale, and an id→row Map per call buys nothing at that size.
  ★★ THE TWO IN-APP CALLERS DIFFER IN *WHEN* THEY DERIVE, and in both cases that is the whole design.
  (1) Inline "Ask Claude" edit takes the token in `submit`, from the SAME object serialized into the prompt,
  so the window it covers is the AI round-trip PLUS the user's read of the preview and their click on Apply
  (`use-inline-entity-edit.ts`). (2) Insight recommendations stamp it when the proposal is STORED
  (`stampRecommendationTokens`, `insights/recommend-tokens.ts`), covering the window from storage to confirm —
  a background-generated recommendation can sit unreviewed for days. It does NOT cover the model round-trip
  itself, because the entities handed in are the caller's live render-scope arrays. ★★★ Deriving in EITHER
  case at APPLY time — the obvious-looking simplification — is VACUOUS BY CONSTRUCTION: you would compare a
  token against the very read it came from, so `requireToken` could never refuse. That is not a weaker guard,
  it is no guard, reported as protection.
  ★★ A REFUSED INSIGHT REPLAY MUST NOT ADVANCE THE INSIGHT. `use-insight-recommendations.ts` counts stale
  refusals separately from hard failures: when nothing committed and every failure was a refusal, the insight
  is left where it was and the recommendation stays `proposed` (toast
  `insightRecommendationStale`), so the user can regenerate against the moved data; a mixed run still advances
  but reports `insightRecommendationStalePartial`. The unconditional advance-on-failure rule exists because a
  failed call MAY have committed and a retry would duplicate `create_*` entities — a `ConcurrencyTokenError`
  is thrown before the dispatcher is reached, so that reasoning does not apply to it, and folding it in makes
  a correctly-refused recommendation silently unretryable.
- **`list_tasks` returns an envelope, not a bare array:** `{items, total}`, plus `limit` echoed back ONLY when
  the caller passed a usable one (`listTasksEnvelope`, `chat-tools-lists.ts`). `total` is the count BEFORE the
  slice, so "how many tasks exist?" is answerable from ONE call even when the model asked for a page. `limit`
  is optional and untrusted — anything that is not a positive finite number is treated as absent, and an
  absent one returns everything, key for key as before, so no existing prompt sees a shape it was not written
  against. It used to be `return d.listTasks()`: the whole array, no total, every rich field in full.
  ★★ THE NARROWING TARGET IS `Task.description` AND `Task.noteLog`, AND NOTHING ELSE — do NOT restate this as
  "the seven rich fields were slimmed", which would be false. Every other entity list tool already projects
  through `chat-tool-summaries.ts` to a `*Summary` type carrying no rich HTML at all (reproduce:
  `grep -n "description\|mitigation\|noteLog" src/app/chat-tool-summaries.ts` returns nothing), so
  `list_tasks` was the ONLY tool returning full rows. `slimTaskForList` keeps every other field of `Task`
  untouched.
  ★★★ THE TWO ARE HANDLED DIFFERENTLY, AND `noteLog` IS NOT SLIMMED BUT DROPPED. `description` is projected
  through `htmlToPlainText`. `noteLog` is omitted from the list payload ENTIRELY: it was 37.8% of the
  STORED ROWS on a 140-task project — the largest field by a factor of five, though only 26.4% of what the
  list path was really sending, since that path already stripped each entry's markup (re-measured below) —
  while the operating guide told the
  model four times that it has no note tool, so the app was paying to ship data it had forbidden the model
  to use. ★★ An earlier cut projected each entry to a text-only shape and kept it on the list; that type and
  its projection helper were REMOVED rather than left callable, so a reader cannot restore the field by
  reaching for them. ★★ The capability was RELOCATED, not deleted — `get_task` returns the full note log
  with its HTML on demand, and its tool description carries the read-only constraint.
  ★★ ONLY THE LIST PATH IS NARROWED. `get_task` keeps full fidelity ON PURPOSE — an assistant about to EDIT a
  description needs the markup it is editing, and it is the list side that carries the volume justifying the
  projection. `chat-tools.test.ts` holds a control asserting `get_task` keeps the note log and the markup
  the list projection strips; without it, narrowing BOTH paths would satisfy every other assertion in that
  block.
  ★★ SIZE EFFECT, RE-MEASURED 2026-09-09 — THE INHERITED −16.2% IS NOT REFUTED, IT IS SUPERSEDED. That
  figure (12153 → 10183 bytes over the 14 tasks of `sample-workspace-small.json`) belongs to the EARLIER
  change — full rows to envelope-plus-projection, back when the note log was SLIMMED rather than dropped —
  so its "after" is THIS change's "before" and nobody should read it as today's cost. Today: the real
  response with row tokens over the same 14 tasks goes 10671 → **7909** bytes
  (−25.9%). At the projection level, before the envelope and the tokens, at 2.92 chars/token: small
  3479 → 2534, big 10641 → 7803, and the 140-task project 35793 → **26334** — a saving of **9459 tokens,
  26.4%**. Nothing pins any of these, no test asserts them, and every one moves with the sample.
  ★★★ 26.4% IS THE SAVING; THE 37.8% ABOVE IS THE RAW-ROW BOUND, AND THE TWO ARE NOT INTERCHANGEABLE. The
  bound is the note log's share of the STORED rows, which is what the spec measured (its 15719-token figure
  is the same arm — this run puts it at 42101 → 26334, −37.5%, on the 140-task project). But the shipped list
  path had ALREADY stripped each entry's html and kept its canonical text, so the drop removes the smaller,
  already-projected payload and the honest number is the one against that baseline. Quoting the bound as the
  saving puts it at 15767 tokens against a real 9459 — 67% too high.
  ★ Reproduce (scratchpad script, deliberately never committed): read `sample-workspace-<size>.json` directly
  rather than through `jsonToWorkspace`, which needs a DOM; map the rows through `slimTaskForList` and,
  for the old arm, through the pre-change copy of that same function recovered with
  `git show <sha>~1:src/app/chat-tools-lists.ts` (recovering it beats hand-copying the deleted projection,
  which is the step that would quietly re-introduce the raw-row arm as if it were the old one); compare
  `JSON.stringify(...).length`. The with-tokens arm calls `listTasksEnvelope` on each side instead.
  ★ The guide's denials went from FOUR to TWO in the same slice, and the survivors are the true ones: RAID
  and Changes really have no note access, because `chat-tool-summaries.ts` carries no note log at all
  (reproduce: `grep -c "noteLog" src/app/chat-tool-summaries.ts` returns 0). The two that were removed
  denied a capability `get_task` has always had.
  ★ `chat-tools-lists.ts` is pure and DOM-free: `htmlToPlainText` is regex-only and never reaches DOMPurify,
  so the module is safe to import from the tool layer, which runs in the browser and in bare node under
  vitest.
- **AI document tools (five):** `list_documents` · `get_document` · `create_document` · `update_document` ·
  `delete_document`. Schemas in `chat-tool-defs-documents.ts` (`DOCUMENT_TOOL_DEFS`, spread into `TOOL_DEFS`);
  routing + boundary validation in `chat-tools-documents.ts` (`isDocumentTool` → `runDocumentTool`, dispatched
  from `chat-tools.ts`'s `runTool`); the implementation is the `useDocumentTools` hook, wired in
  `use-chat-dispatcher.ts`.
  ★★ **The "both files were split for the 800-line ratchet" reason is only HALF true**, and
  `chat-tools-documents.ts`'s own header states it for both. Re-measured 2026-08-16 with the gate's own
  counter (`split("\n").length`, i.e. `wc -l` + 1): both `chat-tools.ts` and `chat-tool-defs.ts` now sit
  within a handful of lines of the 800 cap, `chat-tools.ts` against ~139 lines of routing — so that split
  is genuinely forced and both files are nearly full. Anything added to either belongs in
  `chat-tools-updates.ts` or `chat-tools-lists.ts`, which have room.
  ★★★ **NO NUMBER IS QUOTED FOR EITHER, DELIBERATELY, AND RESTORING ONE IS A REGRESSION.** This line
  carried **791**/**9** for `chat-tools.ts` while the file measured **794**/**6** — and it went stale
  inside the very docs commit that RE-MEASURED the `chat-tool-defs.ts` figure sitting on the next line,
  which is the whole argument: a per-file tally rots one edit at a time and the reader cannot tell a
  fresh number from a fossil. Earlier fossils here read **766**/**34** and **631**/**169**, and two more
  are dated below. Read today's with the gate's own counter, which is `wc -l` + 1:
  `node -e "console.log(require('fs').readFileSync('<file>','utf8').split('\n').length)"`
  ★★★ **AND "WOULD HAVE FIT COMFORTABLY INLINE" IS NOW HISTORY, NOT ADVICE — the split was not
  ratchet-forced when it was made and IS load-bearing today.** The `DOCUMENT_TOOL_DEFS` block measures
  **73** lines, over the 800 cap: the defs file can no longer absorb the schemas it
  gave away. A reader acting on the old sentence would fold them back and break the gate.
  ★★ **THE GATE HALF IS SUPERSEDED 2026-09-03 — the cap is now 1600, doubled from 800.**
  `chat-tool-defs.ts` measures 790, so folding the 73-line block back lands at ~863: over the OLD
  cap, comfortably under the current one. It would no longer break the gate. ★ The split is still
  worth keeping on cohesion grounds — that is the "load-bearing today" claim above, and it does not
  depend on the ratchet — but do not cite the gate as the reason any more.
  ★★ Those two numbers were **763** and
  **596** when measured on 2026-08-07 and both had drifted by the next feature — B2a's `search_history`
  work spent **28** of `chat-tools.ts`'s remaining 37 lines between them, leaving 9 **as of that date** —
  a dated record, not today's headroom, which is smaller still. Do not cite the
  ratchet as the reason the defs file was CREATED, and do not trust ANY number here; re-derive all three
  (the counter is `split("\n").length`, i.e. `wc -l` + 1) with
  `node -e "for (const f of ['src/app/chat-tools.ts','src/app/chat-tool-defs.ts','src/app/chat-tool-defs-documents.ts']) console.log(f, require('fs').readFileSync(f,'utf8').split('\n').length)"`
  or `npm run size:check` before assuming any of them is tight. The version model these writes snapshot into lives in
  [`documents.md`](documents.md); this bullet covers only the AI surface.
  ★★★ **`chat-tools-documents.ts` IS THE VALIDATION BOUNDARY, and the only one.** Everything downstream is
  deliberately permissive — `applyDocMutation` is pure and treats its input as already-shaped, and the entity
  sanitizers degrade unknown shapes rather than throwing. Malformed model output refused anywhere else silently
  becomes a legal-looking write, and chat tool writes have **NO undo capture**, so the version log is the only
  thing behind them — and it records what a mutation REPLACED, not what the caller meant.
  ★★★ **`requireOps` validates ops ARRAY-NESS at the tool boundary** (the `set_task_dependencies` shape above),
  but **the consequence here is NOT a wipe and the plan claimed it was.** MEASURED by deleting the check: a
  non-array degrades to `[]`, `applyOps` returns null for an empty list, and `applyDocMutation` refuses to touch
  the blocks — nothing is destroyed. What actually happens is that the model's ops are SILENTLY DISCARDED while
  the tool reports success: with no title the call throws anyway, and WITH a title the rename lands, resolves,
  and every edit the model asked for vanishes with no rejection shown. Keep the guard — it is a
  refusal-that-reads-as-success, just not the data-loss story. ★ Recording it accurately matters: an
  overstated severity is the kind of claim someone later disproves and then discounts the whole guard over.
  ★ `undefined` is the ONE legal non-array and means "no ops" (a title-only rename); `null`, a string and an
  object are all refused, since none can be an honest empty list.
  ★★ **`sanitizeAiDocBlocks` (`ai-document-blocks.ts`) is the model-input allow-list** and is DOM-BOUND on
  purpose — which is why it is NOT in `document-model.ts`, whose DOM-free contract a source scan enforces.
  Two layers, both load-bearing: `sanitizeProjectDocuments` enforces STRUCTURE and cannot sanitize, so
  `sanitizeAiDocumentRichText` runs over `paragraph.html` first. ★★★ **`sanitizeAiDocumentRichText`, NOT its
  sibling `sanitizeAiRichText`** — both are the same two layers, and the differences are the allow-list, the
  data-attribute policy and the CAP.
  ★★★ **THE REASON THIS BULLET USED TO GIVE IS DEAD, AND IT WAS FALSE IN THE REASSURING DIRECTION.** It said
  the sibling "narrows documents to the TEMPLATE list, which UNWRAPS `mark`/`s`/`code`/`pre`/`blockquote`/
  `hr`/`sub`/`sup` at the write", with the worked example `"<p><mark>keep</mark></p>"` stored as
  `"<p>keep</p>"`. There is no TEMPLATE list any more, and that example is now wrong in the direction that
  reassures: measured 2026-08-11 on dompurify 3.4.13,
  `sanitizeAiRichText("<p><mark>keep</mark></p>")` returns `"<p><mark>keep</mark></p>"` BYTE-IDENTICAL, and
  every one of those eight tags survives the rich allow-list — all eight are in `RICH_ALLOWED_TAGS`, which
  `DOCUMENT_ALLOWED_TAGS` now SPREADS (`[...RICH_ALLOWED_TAGS, "img"]`), so the lists differ by ONE tag.
  Telling a reader the sibling strips formatting it in fact KEEPS invites the opposite error — "then the
  wider one is only a nicety". ★★ No gate could see this: the dead concept was never a backticked symbol and
  the worked example is prose, so `docs:symbols:check` stayed green over the whole false claim while both
  function names in it remained real.
  ★★★ **The two still must not be swapped — and §140 (2026-08-13) CLOSED the one difference that used to
  widen.** Before §140, `sanitizeRichHtml` kept DOMPurify's default `ALLOW_DATA_ATTR: true`, so wiring a
  document boundary to it newly admitted arbitrary `data-*` — the widening third of the old list. §140
  turned that default off on `sanitizeRichHtml` too, under the same `ATTR_VALUES` value allow-list
  `sanitizeDocumentHtml` already used, so an UNLISTED `data-*` is now dropped identically by both:
  measured, `sanitizeRichHtml('<p data-foo="1">a</p>')` → `<p>a</p>`, `sanitizeDocumentHtml(...)` →
  `<p>a</p>`. That row did not narrow — it is GONE.
  ★★★ **TWO differences survive, and NEITHER widens.** Wiring a document boundary to `sanitizeAiRichText`
  (a) drops `<img>` — NARROWS; it is the one-tag list delta, and `img` is VOID so it vanishes rather than
  unwrapping; and (b) cuts the cap from `MAX_HTML_TEXT_CHARS` (20 000) to `TEXTAREA_MAX` (5 000) — NARROWS
  DESTRUCTIVELY, because `capHtmlText`'s truncation branch returns `plainToHtml(text.slice(...))` and
  FLATTENS every mark to escaped plain text instead of merely shortening.
  ★ A third, NARROWER `data-*` difference remains and is not a revival of the closed one:
  `sanitizeDocumentHtml` additionally admits `data-asset-id` (§117b, a future images slice) under its own
  charset/length predicate — one bounded, value-guarded name, not the unconstrained pass-through the
  closed row described. `sanitizeRichHtml` does not carry that name at all: measured,
  `sanitizeRichHtml('<p data-asset-id="a1-B2">x</p>')` → `<p>x</p>`, `sanitizeDocumentHtml(...)` → keeps it.
  Both symbols are real, so `docs:symbols:check` is
  green either way — NO gate can see any of this. ★★ It is not the ONLY warning against swapping them
  though, and claiming so was itself an unenumerated "only": `sanitizeAiDocumentRichText`'s own docstring
  ("A SEPARATE FUNCTION, NOT A PARAMETER on `sanitizeAiRichText`") and AGENTS.md's ★★★ "THE TAG DELTA IS
  ONE; THE BEHAVIOUR DELTA IS TWO" block both carry it. Two prose warnings, zero gates — which is the real
  point, and stronger than the false one it replaces. ★ "The sibling must STAY narrow" is no longer a standalone instruction either: because
  `DOCUMENT_ALLOWED_TAGS` spreads it, widening `RICH_ALLOWED_TAGS` to help documents widens the six rich
  raid/change/milestone fields in the SAME edit, retroactively.
  ★ Apply it to the model's INPUT only, never to the
  merged/stored document — re-running an allow-list over stored bytes rewrites content the call never touched
  (same rule as `withAiRichFields`). ★ `paragraph.html` is the only `DocBlock` field reaching a render sink as
  markup, so sanitizing just that block type is complete.
  ★★ **Every write refuses in a read-only popout** (`isReadOnly` → `readOnlyError()`), mirroring
  `use-chat-dispatcher`'s own per-tool guards. No undo capture means a popout mirror must never reach
  `mutateDocuments` at all.
  ★★ **`use-document-tools.ts` is deliberately NOT in `vitest.config.ts`'s `coverage.exclude`**, unlike the
  render-scope UI-glue hooks beside it. It holds real decisions — which mutation kind a call becomes, what is
  sanitized, how each result is shaped — and is tested through `use-chat-dispatcher.test.tsx`'s existing
  `renderDispatcher`/`runTool` harness. Excluding it would drop that logic out of the coverage floors.
  ★★★ **TWO `isDocumentTool` FUNCTIONS EXIST AND MUST NOT BE MERGED.** The exported one
  (`chat-tools-documents.ts`) tests a LOCAL literal `Set`, deliberately NOT derived from `DOCUMENT_TOOL_DEFS`:
  a module-eval `new Set(IMPORTED_CONST)` comes out EMPTY if an import cycle puts that module first, and an
  empty set routes every document tool into `runTool`'s "unknown tool" throw. A test cross-checks the two lists
  instead. The private one (`chat-tool-block.tsx`) reads `DOCUMENT_TOOL_DEFS` LIVE inside the function for the
  same reason, solved the other way. Both are correct; "deduplicating" them reintroduces the trap.
  ★ `DocumentUpdateResult.title` is REQUIRED, not optional, so the chat file card's obligation is a compile
  error rather than a rendering disappointment. The routing layer deliberately does NOT runtime-guard it —
  failing an applied write over a cosmetic card would be the worse trade.
- **Project recall — `search_history` over the activity log (B2a):** a READ-ONLY tool answering "what
  CHANGED and WHEN"; the `list_*` tools answer "what is TRUE NOW". Schema in `chat-tool-defs.ts`, routed in
  `chat-tools.ts`'s `runTool`, fed by `getActivityLog()` on `ToolDispatcher` — implemented in
  `use-chat-dispatcher.ts` as a `useRef` mirrored in an effect, exactly like every other workspace slice in
  that hook, so the dispatcher `useMemo` stays ref-routed and an unused read tool costs nothing per render.
  The log ITSELF — persistence, the six write paths, `logMode`, entry-id minting, the
  `isWorkspaceEmpty` exclusion — is owned by AGENTS.md's Activity log bullet; this bullet covers only the AI
  surface.
  ★★★ **`activityLog` MUST NEVER JOIN `getSnapshot()`.** `runTool`'s `get_app_state` case returns the
  snapshot VERBATIM and the model calls it freely, so a field added there rides EVERY snapshot read.
  ★★★ **The reason is NOT that the log is unbounded — it is capped at `ACTIVITY_MAX_ENTRIES` (500)**,
  enforced in three places: `sanitizeActivityLog` on LOAD, `appendActivityEntry` on WRITE (which
  `appendActivity` delegates to) and `mergeActivityLogs` on MERGE. Reproduce:
  `grep -rn "ACTIVITY_MAX_ENTRIES" src/app --include="*.ts" | grep -v "\.test\."`. The B2a plan and an
  earlier revision of the code comment BOTH justified the guard by calling the log unbounded, and a false
  justification is worse than none: the next reader discovers the cap, concludes the guard was cargo-cult,
  and deletes it. The real argument is SIZE — 500 audit entries, each carrying up to `MAX_FIELD_CHANGES`
  (12) field-level before/after diffs, is far more than belongs in the context window on every call.
  `chat-tools.test.ts`'s "keeps activityLog OFF the app-state snapshot" is the only test that would go red
  for that edit; the rest of the suite stays green, which is exactly why it exists.
  ★★★ **A BOUNDED DERIVED SUMMARY IS NOT THE LOG, AND ONE IS ON THE SNAPSHOT NOW.** `getSnapshot()`'s
  return type (inline on `ToolDispatcher`, `chat-tools.ts`) carries an optional `activitySummary`, produced
  by `summarizeForRecap` (`activity-recap.ts`, called from `use-chat-dispatcher.ts`) — a fixed-shape
  `ActivitySummary` (`total`, `byActor`, `latestAt`, `days`), i.e. five counts, one stamp and a window,
  CONSTANT in the size of the log. The rule above is about SIZE, so
  this does not violate it and the two must not be conflated: **the raw `activityLog` array never joins the
  snapshot; a derived roll-up over it may, as long as its size does not grow with the log.** A reader
  diffing this bullet against `chat-tools.ts` sees an activity-shaped field on the snapshot and needs that
  distinction spelled out — the guard test still pins the array, not the summary. Reproduce the shape with
  `grep -n "activitySummary" src/app/chat-tools.ts` and the builder with
  `grep -rn "summarizeForRecap" src/app --include="*.ts" | grep -v "\.test\."`. ★ Adding a field carrying
  per-ENTRY content (a list of recent summaries, the newest N entries) WOULD violate it, cap or no cap —
  the test is "does this grow with the log", not "is it activity-derived".
  ★★ **THE LAYER SPLIT — `activity-prompt.ts` MAY import `t`; `history-search.ts` MAY NOT.**
  `renderActivityEntry(entry)` → `{at, summary, detail?}` is the RENDER layer and pins the locale to
  `"en-US"`: the model-facing view must not change when the UI switches to German (the EN dict is static —
  only DE is lazily loaded — so no `loadI18n` call is needed). `searchHistory(entries, query)` is the pure
  engine, i18n-free by contract.
  ★★ **The engine is i18n-free but NOT render-free.** It takes RAW entries and calls `renderActivityEntry`
  ITSELF, because the substring filter has to run over the rendered `summary` + `detail`. Do NOT "restore
  the split" by making the caller pass rendered lines — the engine would then be unable to filter on message
  text at all, which is the tool's primary query mode. (It renders AFTER the cheap kind/date filters, so the
  per-entry interpolation is paid only on structural survivors.)
  ★ The `detail` line emits the RAW entity field key (`dueDate`), NOT the Activity panel's
  `humanizeFieldName` output ("due date"): the model WRITES with those exact names, and the humanized form
  both lowercases and splits camelCase, so it is lossy and not uniquely invertible. Do not "align" the two
  renderers — `activity-prompt.ts`'s header carries the full reasoning.
  ★★ **`truncated` means "more matched than you are seeing", NEVER "a limit was applied".** A cap that
  happened to cut nothing must report `false`; the model reads this field to decide whether it may claim a
  complete answer, and the tool description instructs it to say so out loud.
  ★★★ **`truncated` COVERS ONE OF THREE WAYS AN ANSWER CAN BE INCOMPLETE, so the tool description carries
  the other two and they are NOT hedging bloat.** It reports what the CAPPED, CHAT-BLIND log held — never
  what never entered it, nor what the cap already dropped.
  ★★★ (a) COVERAGE — **CLOSED IN 0.244.0, AND THIS PARAGRAPH SHIPPED ITS OWN REFUTATION FOR A RELEASE.**
  It read: "`logActivity` is threaded … handed to `useDocumentTools` ALONE, so every chat entity write …
  mutates state and logs NOTHING. Reproduce with `grep -n "logActivity" src/app/use-chat-dispatcher.ts` —
  **one** hit." That command now returns **28**, so the doc carried the command that disproves it — which is
  the gate working in the only way an ungated doc can be gated, and only if somebody runs it. Every chat
  entity writer now ends its SUCCESS path with `logActivityAs?.("ai", …)`: **23 call sites** spanning **21
  distinct kinds** (tasks · raid · change · milestone · stakeholder · resource, plus `settings.updated`,
  `bulk.inquiries` and the NEW `bulk.delete`). Re-derive both numbers rather than trusting them:
  `grep -cE 'logActivityAs\?\.\("ai"' src/app/use-chat-dispatcher.ts` → 23, and
  `grep -oE 'logActivityAs\?\.\("ai", "[a-z.]+"' src/app/use-chat-dispatcher.ts | sort -u | wc -l` → 21.
  ★★ The coverage caveat therefore came OUT of the tool description in the same release, exactly as the
  ★★ below required. RETENTION (b) is unchanged and stays in.
  ★★ **`ai.inlineEdit` NO LONGER FIRES FROM ANYWHERE, and the kind is deliberately still in the union.**
  This bullet used to say it "fires from `use-inline-entity-edit.ts`"; `0fc004c3` deleted both writers,
  because an inline "Ask Claude" edit was writing TWO entries — the per-`runTool` entity row this branch
  added (`actor: "ai"`) plus an `ai.inlineEdit` summary carrying the same entity id, title and actor, i.e. a
  strict subset. The kind survives in `ActivityKind` and in `activityMessageKey` because logs written before
  0.244.0 still carry it and `sanitizeActivityEntry` keeps unknown kinds — removing it would render those
  rows as `activityUnknownKind`. Verify there is no writer:
  `grep -rn '"ai.inlineEdit"' src/app --include=*.ts --include=*.tsx` → the union member, the key map and one
  test, **zero** call sites. `ai.allocationPlan` (`use-alloc-plan.tsx`), `ai.raciSuggest`
  (`use-raci-suggest.tsx`), `ai.taskDedup` (`use-tasks-dedup.tsx`) and `ai.insightRecommendation`
  (`task-manager.tsx`) are still live and are app AI FEATURES reached from a panel, never from a chat tool
  call — so "the log has `ai.*` kinds" still does not mean "the log covers the chat assistant"; the
  `logActivityAs` sites above are what mean that.
  (b) RETENTION: `ACTIVITY_MAX_ENTRIES` drops the oldest, so an empty result for an OLD range is
  indistinguishable from a quiet period.
  ★★ Both WERE fixed in the DESCRIPTION rather than the wiring, on the reasoning that logging chat writes
  is a feature with its own design questions (which kinds, what args, how it interacts with the fact that
  chat writes take no undo capture) and half-wiring it would produce a log that is wrong in a new way. That
  feature landed, so the coverage caveat came out of the description in the same release and the description
  now DISCLOSES the actor instead: its OPENING clause names all three sources of change in one breath (the
  app's own UI, its integrations, and the user), and a later sentence tells the model never to attribute an
  entry whose `actor` is absent — giving the causes as EXAMPLES, never as a closed list, because a THIRD
  cause is already latent: `sanitizeActivityEntry` keeps an unknown-but-string `actor` for forward compat
  while `renderActivityEntry`'s `knownActor` drops it, so an entry a newer client stamped with an actor
  value this release does not know reaches the model with none. RETENTION is
  still description-only and still true. ★★ `chat-tools.test.ts` pins the retired sentence's ABSENCE **and**
  the actor disclosure's PRESENCE — an absence assertion alone is vacuous (it passes against an empty
  description), so the pair is the guard; `chat-tool-defs.ts` carries the same note at the constant.
  ★★★ **DESCRIBED, NOT QUOTED — AND THAT IS THE FIX, NOT A STYLE CHOICE.** This paragraph used to carry a
  quotation of the description, and the very next slice rewrote the text out from under it: the fragment it
  quoted began "It also records changes made by YOU" — a sentence a later rewrite DELETED outright when it
  folded the three sources into the OPENING clause. Confirm with
  `grep -rn "It also records changes made by" src` → no hits. ★ Scope that grep to `src`: run it over the
  repo and it matches THIS line, which quotes the retired sentence in order to record its retirement. That is the SECOND time this one
  description has moved, and **no gate can see a doc quoting a string literal** — `docs:symbols:check`
  proves identifiers exist, not prose. Worse, the surviving half of that quotation was never byte-exact
  either (it lower-cased a sentence-initial "Never"), so it would have failed a check nobody could run.
  Read the live text rather than trusting any rendering of it here:
  `sed -n '/name: "search_history"/,/input_schema/p' src/app/chat-tool-defs.ts`.
  ★ `view-ai-scope.ts`'s `activity` entry told the model "You cannot read this log — there is no tool for
  it" until this was caught (a RETIRED string, quoted here deliberately — the source comment at the entry
  quotes it too, for the same reason). It now points at `search_history` and mirrors the description's
  actor caution and retention limit — the two live limits, which are NOT the coverage/retention pair (a)
  and (b) named above, since (a) is closed. The mirroring is LITERAL, and the SPAN has to be stated exactly:
  the shared run starts at "an absent actor is unattributable" and ends at "and it is " — the PARENTHESIS is
  byte-identical in both — and the very next token DIVERGES in case, "not evidence" in `reading` against
  "NOT evidence" in the description. So substring-test the parenthesis, never the sentence; that is what
  "one claim, two surfaces" means at `chat-tool-defs.ts`. ★★★ An earlier revision of THIS line said the
  "whole parenthetical clause" was byte-identical, which fails ~143 characters in — the identical over-claim
  the retracted quotation two sentences up was retracted FOR, and a case drift both times. A doc sentence
  asserting byte-identity is itself a claim to substring-test. ★★ THE TWO ARE NOT EQUALLY
  GREPPABLE, and assuming they were is how this bullet got a claim wrong once already: `reading` is a SINGLE
  one-line string literal, so `grep` finds any span of it, while the `search_history` description is a
  multi-part `" +` concatenation, so no `grep` can match a span that crosses a join. Reconstruct that one
  before comparing — join the parts, then substring-test. Same rot the `documents`
  entry had when `DOCUMENT_TOOL_DEFS` landed, and pinned by the same test shape in `view-ai-scope.test.ts`.
  ★★ **THE `kinds` COERCION IS LOAD-BEARING AND AN EMPTY-LOG TEST CANNOT SEE IT.** A model may send a
  non-array — the string `"nope"`. A bare pass-through reaches the engine's `new Set(q.kinds)`, which
  iterates the STRING into a set of CHARACTERS matching no kind: zero events returned while reporting a
  filter that never existed. `runTool` coerces-or-drops every field instead (a non-array `kinds` becomes
  `undefined` = no filter, the honest reading of garbage from a caller that cannot be asked to retry).
  ★★ The B2a plan's malformed-args test ran against an EMPTY log, where `{events: [], truncated: false}` is
  the correct result whether the guard works or not — VACUOUS for `kinds`, and caught only by mutating
  against a POPULATED log. Any test of this guard needs entries the broken path would wrongly exclude.
  ★ `resolveLimit` FLOORS before the non-positive test, not after: `limit: 0.5` is reachable model input,
  and testing `raw <= 0` first lets it through to a cap of ZERO — `{events: [], truncated: true}`, the one
  output combination that actively lies (no rows, while asserting rows were withheld). `Infinity` therefore
  yields the DEFAULT rather than `MAX_HISTORY_LIMIT`, failing the finite test before it can reach the clamp.
  Its own docstring carries the reasoning and a test pins each branch.
  ★★★ **CHAT-THREAD SEARCH IS NOT DEFERRED ANY MORE — this line used to say it was, and stood through the
  branch that shipped it.** It read "deliberately NOT here — deferred to B2c", and B2c falsified BOTH of its
  halves: the feature exists, and it reached the dispatcher WITHOUT the restructuring the paragraph called
  the price of it. `docs:symbols:check` cannot catch that class — every backticked name in the sentence
  (`useChatThreads`, `useChatDispatcher`, and the two files) is still real, which is all that gate ever
  proves. ★★ The STRUCTURAL observation survives, and it is the whole reason the transport looks the way it
  does: `useChatThreads` is called in `chat-panel.tsx`, which mounts BELOW `useChatDispatcher` (called in
  `task-manager.tsx`), so thread state sits UNDER the point where the AI snapshot is assembled and cannot
  reach the dispatcher as a prop without moving that ownership. What was wrong was the conclusion drawn from
  it. The answer was never to lift thread state — it was to stop routing it through the render tree at all:
  `chat-threads-registry.ts` is a module-level single slot the panel PUBLISHES into and the dispatcher READS
  at send time. See the B2c bullet below for what that buys and what it costs. Nobody should "complete"
  either slice by hoisting `useChatThreads`.
- **Ambient activity recap + the two recall toggles (B2b):** `buildActivityRecapBlock` (`activity-recap.ts`)
  emits ONE sentence — "Recent project activity: N changes in the last D days (…; latest YYYY-MM-DD). Use
  search_history to read them." — inside `buildTurnContext`'s output, beside the `Today is …` line, never
  `buildStableSystemBlocks`'s cached half. ★★ That placement is the whole design: the counts change on every
  turn, and for the chat panel `buildTurnContext`'s string never enters `system` at all — it rides the
  outgoing turn's last message via `chat-cache-layout.ts`'s `buildWireMessages`. Putting per-turn content
  like this ahead of `messages` would not just cost one cache segment, it would make the ENTIRE transcript
  uncacheable on every send — see the CACHE BOUNDARY bullet under "View-scoped AI prompts" below.
  `chat-api.ts` carries the reasoning at the call.
  ★ It is a COUNT, not a recap of content — `search_history` fetches content when the model wants it — and
  the actor split ("9 by the user, 3 by the AI assistant") is load-bearing rather than decorative: it is what
  stops the model reading its OWN writes back as new user information and acting on them twice.
  ★★ **TWO INDEPENDENT DEFAULT-ON TOGGLES, and their four combinations are all reachable.**
  `settings.ai.activityRecap` decides whether the SENTENCE exists (gated upstream in `summarizeForRecap`, so
  switching it off skips the scan rather than hiding its result); `settings.ai.historySearch` decides whether
  the TOOL exists. Both read `!== false` because `sanitizeAiConfig` stores only an explicit `false` and
  leaves every other value `undefined` — a truthiness test would switch the feature off for every user who
  never opened Settings.
  ★★ **THE SHAPE-MATE IS `actionSuggestions` ALONE — NOT `groundInGuides`,** and an earlier revision of
  this bullet named both. `groundInGuides` is a different shape entirely: a REQUIRED `boolean` on
  `AiConfig` with a real default, which `sanitizeAiConfig` ALWAYS fills (`obj.groundInGuides !== false`),
  so it is never `undefined` post-sanitize and every read site is a plain truthy read — `checked={…}` in
  both settings sections, `ai.groundInGuides && !guidesReady` in `chat-panel.tsx`, and a `boolean`
  parameter into `buildSystemPrompt`/`inline-ai-edit-call.ts`. Citing it as precedent for a `!== false`
  read is citing the wrong mechanism. Sweep with
  `grep -rn "groundInGuides" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."` — 19 hits. Piping
  that through `grep -- "!== false"` returns TWO, and neither is a read: one is the sanitizer's own fill
  line, the other is the `activity-recap.ts` comment stating this very rule. No READ site compares it to
  `false`. ★★ The sanitizer DOES store `actionSuggestions` — `actionSuggestions: obj.actionSuggestions
  === false ? false : undefined`, verify with
  `sed -n '/^export function sanitizeAiConfig/,/^}/p' src/app/settings-types.ts | grep -n actionSuggestions`.
  It was MISSING from that literal for the field's whole life, so every explicit `false` was dropped on
  load and the Action Center's AI toggle silently reverted to ON at the next reload — §165, now CLOSED.
  ★★★ This sentence asserted that defect was LIVE while the commit fixing it sat in the same change set,
  which is the failure mode this file warns about twice over: a correction is a new claim, and an entry
  marked CLOSED does not update the prose that points at it. The loss was on READ, not write —
  `writeSettings` persisted the `false` correctly — so a reader who trusts a stale "the sanitizer does not
  store this" reaches the wrong diagnosis first. `activity-recap.ts`'s header carries the same three-way
  split.
  ★★★ **RECAP-ON + HISTORY-OFF IS THE COMBINATION THAT SHIPPED A LIE**, on every turn of every conversation:
  a prompt whose closing clause named a tool the request did not carry. The fix is that the block's closing
  sentence is emitted ONLY when `offeredTools.has("search_history")`, and `offeredTools` is
  `toolNamesFor(toolFlags)` — the set DERIVED from the very arrays `toolsFor` returns, resolved ONCE in
  `buildSystemPrompt` and shared with `buildViewScopeBlock`. So "what the model is told it has" and "what the
  request carries" come from one decision and cannot drift. The COUNTS survive the suppression — they still
  orient the model when it cannot go read the rows. Reproduce the derivation with
  `grep -n "toolNamesFor\|toolsFor" src/app/chat-api.ts`.
  ★★ Turning `historySearch` off removes `search_history` from the request ENTIRELY (`toolsFor` returns a
  different memoized array), and the memo yields ONE array per flag combination so the two live settings share ONE identity
  and the cache breakpoint is stable. ★ **`activity-recap.ts` is its own module because of a RUNTIME CYCLE,
  not tidiness** — it needs the VALUE `summarizeRecentActivity` from `history-search.ts`, which already
  imports the VALUE `renderActivityEntry` from `activity-prompt.ts`; hosting it in `activity-prompt.ts` would
  close the loop with values on both arcs. Its `offeredTools` is a plain `ReadonlySet` for the same reason:
  importing from `chat-api.ts` (which imports this module) would close another.
  ★ It is i18n-free on purpose — `ACTOR_PHRASE` holds English literals rather than i18n keys, because unlike
  `renderActivityEntry` this line has no UI counterpart to stay in step with and routing it through `t` would
  add dictionary entries that only a machine reads. `latestAt` renders in the PROJECT zone (`dayInZone` over
  the snapshot's branded `timezone`), matching every other instant the model is handed.
  ★★ **`search_history` now returns an `actor` PER EVENT**, conditionally spread so a pre-0.244.0 entry's
  rendered shape is byte-unchanged (`{actor: undefined}` on every row is not the same as an omitted key, and
  `toBeUndefined()` cannot tell them apart). `knownActor` narrows through an own-property check on
  `KNOWN_ACTORS` and returns `undefined` for anything else — REQUIRED, because `sanitizeActivityEntry` keeps
  an unknown-but-string actor, so `actor: "toString"` reaches this projection and a bare index resolves a
  `Function.prototype` method. The tool description tells the model never to attribute an actor-less entry:
  absence means "older than the field, or written by a path that could not tell", never "the user did it".
  ★ **`inline-ai-edit-call.ts` deliberately carries NO `historySearch` field and blanks `activitySummary`**
  (alongside `viewDigest`) out of the snapshot it forwards — an inline edit is a one-shot forced tool call,
  so an ambient count of unrelated project churn is noise, and suppressing the sentence while still OFFERING
  the tool would re-create the mismatch above from the other direction. The file's own comments state both.
- **Chat-thread recall — `search_chats` + the ambient chat pointer (B2c):** a READ-ONLY tool over this
  project's OTHER stored chat threads, answering "what did we DISCUSS" where `search_history` answers "what
  CHANGED" and the `list_*` tools answer "what is TRUE NOW". Pure i18n-free, clock-free, DOM-free engine
  `chat-search.ts` (`searchChats` · `summarizeChatThreads` · `threadTitle`), schema in `chat-tool-defs.ts`,
  executor `chat-search-tool.ts` (`runChatSearch`) routed from `chat-tools.ts`'s `runTool`, dispatcher
  wiring in `use-chat-search-bindings.ts`, prompt sentence in `chat-recap.ts` (`buildChatPointerBlock`).
  It shares `resolve-limit.ts` with `search_history` rather than re-deriving a second clamp.
  ★★★ **THE TRANSPORT IS A MODULE REGISTRY, NOT A PROP, AND THE PROP CHAIN IS WHY.** `chat-threads-registry.ts`
  is a single slot keyed by project id: `publishChatThreads` from the chat panel's publish effect,
  `readChatThreads` from the dispatcher bindings, a miss answered with a doubly-frozen `EMPTY`. Threading a
  ref down instead would cost lines on `task-manager.tsx`, `workspace-section.tsx` and `chat-panel.tsx`, and
  **all three sit AT OR ONE LINE UNDER their `docs/baselines/file-sizes.json` row**, where the ratchet's
  failure mode is `grew from baselined` — i.e. no usable headroom. ★★ This said "all three sit at
  EXACTLY their row"; it was already false at the 0.259.0 branch point and `task-manager.tsx` moved
  again during it, so the sentence rots on any commit touching any of the three. Do not trust these
  numbers; re-derive both sides with
  `node -e "const b=require('./docs/baselines/file-sizes.json');for (const f of ['src/app/task-manager.tsx','src/app/workspace-section.tsx','src/app/chat-panel.tsx','src/app/use-chat-dispatcher.ts']) console.log(f, require('fs').readFileSync(f,'utf8').split('\n').length, b[f])"`
  → the command prints `<file> <lines> <baseline>`; read today's off it rather than from here. When
  last run, `workspace-section.tsx` and `chat-panel.tsx` were exactly at their rows and
  `task-manager.tsx` one line under, and `use-chat-dispatcher.ts` was at **799** with
  NO baseline row, so the bare 800 cap applies and it has ONE line of headroom. That last number is why the
  bindings and the pointer sentence live OUTSIDE that file — but it is not why they exist.
  ★★ **SUPERSEDED 2026-09-03 ON BOTH NUMBERS.** The cap is now 1600 (doubled from 800), and
  `use-chat-dispatcher.ts` measures **645**, not 799 — so "the bare 800 cap applies" and "ONE line of
  headroom" are each false, and the size pressure that placed those bindings outside the file is gone.
  The ★★★ below is the reason they must STAY outside, and it is untouched by any of this: it is about
  LIVENESS, not lines. Run the command above for today's figures rather than trusting either number
  in this paragraph.
  ★★★ **`use-chat-search-bindings.ts` EXISTS FOR LIVENESS, NOT LINES.** `useChatDispatcher` builds its
  dispatcher inside a `useMemo`, so anything read straight off `args` in that closure is FROZEN at the
  render which last rebuilt it — and the chat project id is exactly such a value: a project switch changes
  it without changing a dep. The read then fails CLOSED (`readChatThreads` answers a key mismatch with
  `EMPTY`, so there is no cross-project leak) but `search_chats` would report "cannot look" for the rest of
  the session and the pointer would silently vanish. Ref-routing every reactive value is the answer that
  file already gives, which is why its `useMemo` needs no entry for the object this hook returns.
  ★ `use-chat-search-bindings.ts`'s own header says that file has TWO lines of headroom while
  `chat-recap.ts`'s says ONE; **799** is what the counter returns today.
  ★★ **NO `useSyncExternalStore`, no listener set, no equality function** — the `project-appearance-prefs.ts`
  precedent needs all of that because components RENDER from it. Nothing renders from chat search: the
  dispatcher reads the slot at SEND time. Adding reactivity here would be machinery with no consumer.
  ★★★ **ONE SLOT STOPS A STALE KEY BEING READ, NEVER A STALE PAYLOAD BEING WRITTEN.** The store cannot tell
  whose threads a payload holds, so **the PUBLISHER owns payload/key agreement** — and it did not, once:
  `threads` is not reset synchronously when `projectId` flips, so the effect published p1's still-populated
  rows under p2's key and `readChatThreads("p2")` handed the dispatcher another project's conversation text,
  searchable and marked available. The gate is `threadsMatchProject` (`loadedProjectId === projectId`) in
  `use-chat-threads.ts`, which publishes an EMPTY list until the load for the LIVE project has settled. ★★ A
  "have we loaded at all" boolean would NOT do — it is true from p1's load onward, which is the leaking
  state itself. ★ `clearChatThreadsFor` is the UNMOUNT path and is SCOPED to the id that run published:
  withdrawing AI consent unmounts the chat panel and nothing else clears the slot, so an unscoped clear
  would let a late cleanup for the old project wipe a live value.
  ★★★ **`available` IS TURSO REACHABILITY, NEVER `threads.length > 0`, and it is a THREE-way split.** Three
  states all present as an empty array and they do not make the same claim: load IN FLIGHT → available (we
  CAN look, there is nothing to show YET); load FAILED → NOT available; settled and genuinely empty →
  available. `searchChats` turns the flag into `coverage`, whose only values are `"turso"` and
  `"unavailable"`, and `chat-tool-defs.ts` tells the model that `turso` means past conversations WERE
  searched — so collapsing the split makes the assistant assert a topic was never raised to a user who is
  looking at a failure banner, or tell every file-mode user it searched their past conversations and found
  nothing. ★★ `threadsError` is ALSO raised when a SAVE or DELETE fails, where the list in hand may be a
  fine read, so the flag is deliberately slightly over-broad: "I could not look" forecloses an invented
  answer and costs a retry. Do not add a second flag to reclaim it.
  ★★ **ONE PREDICATE FOR ADVERTISEMENT AND ENFORCEMENT.** `chatSearchEnabled` (`settings-types.ts`,
  `chatSearch !== false`, so default-ON survives a user who never opened Settings) is read by `variantKey`
  (what the request CARRIES) and by `runTool`'s `search_chats` case via the dispatcher's
  `isChatSearchEnabled` (what the executor SERVES) — the §162 shape, where only the advertisement gate
  existed, one config slip from a switch that advertises off and serves on. It gates the POINTER too, in
  `use-chat-search-bindings.ts`. ★ Sweep with `grep -rn "chatSearchEnabled" src/app --include=*.ts
  --include=*.tsx | grep -v "\.test\."`; the Settings checkbox is deliberately NOT in that list — it spells
  `settings.ai.chatSearch !== false` inline, mirroring its `historySearch` neighbour, and it is a DISPLAY
  read, not a gate. ★ `isChatSearchEnabled` reads the ref LIVE rather than capturing: a value read once at
  dispatcher construction would keep serving for the whole session, which is the mid-conversation case
  enforcement exists for.
  ★★★ **`ToolFlags` IS ONE OBJECT BECAUSE TWO ADJACENT BOOLEANS ARE THE §159 SHAPE.** `historySearch` and
  `chatSearch` are both `boolean | undefined`, so a positional pair typechecks TRANSPOSED — the §159 defect
  passed 337 tests plus tsc. `toolsFor`/`toolNamesFor`/`callClaude`/`buildSystemPrompt` all take the
  `Pick<AiConfig, "historySearch" | "chatSearch">` object and read the flags by NAME, which removes the
  hazard rather than guarding it. ★★ The old pair of frozen constants became a MEMO — `TOOL_VARIANTS` keyed
  by `variantKey`'s two bits, i.e. four variants, seeded with `CACHED_TOOLS` at key 0 — because the rule was
  always ONE ARRAY IDENTITY PER SETTINGS COMBINATION (the list ships on every request and must stay
  referentially stable for a whole conversation), and that invariant outlives its old spelling. ★ The cache
  breakpoint is RECOMPUTED per variant, never assumed to sit where it sits in the full list: removing a tool
  that precedes it does not move it today, but a tool appended after it later would make that assumption
  silently wrong, and a lost breakpoint is invisible except as a bill.
  ★★★ **THE POINTER RIDES `buildTurnContext`'s OUTPUT AND MUST NEVER ENTER `buildStableSystemBlocks`'S
  CACHED HALF.** Thread state changes on every turn, so inside `stableText` it would not merely invalidate
  one breakpoint — for the chat panel `buildTurnContext` never touches `system` at all, it rides the
  outgoing turn's last message via `chat-cache-layout.ts`'s `buildWireMessages`, and per-turn content placed
  ahead of `messages` instead makes the WHOLE transcript uncacheable (see the CACHE BOUNDARY bullet under
  "View-scoped AI prompts" below) — the same argument as the activity recap, and worth more than the block's
  own tokens many times over. Same suppression contract too: the closing "Use search_chats to read them." is
  emitted ONLY when
  `offeredTools` (`toolNamesFor(toolFlags)`) holds the name, so the recap's shipped lie — naming a tool the
  request did not carry — cannot recur here. ★ `inline-ai-edit-call.ts` blanks `chatPointer` out of the
  snapshot it forwards, alongside `viewDigest` and `activitySummary`: that path passes `NO_RECALL_TOOLS`, so
  the closing instruction was already suppressed and what survived named conversations the model had no tool
  to open. **Extend the strip list, do not trust it.**
  ★★ **THE MESSAGE COUNT IS NOT A SIZE BUDGET.** Every field of the schema is optional, so a bare
  `search_chats {}` is legal and the pointer makes it a likely FIRST move; user messages are stored up to
  `CHAT_MESSAGE_MAX` and assistant messages are bounded only by `max_tokens`, so the caps are what stand
  between recall and ~200 KB of verbatim conversation in one `tool_result` — inside an agentic loop free to
  call again, and then PERSISTED into this thread's own row. `CHAT_EXCERPT_MAX` caps each message BODY,
  `DEFAULT_CHAT_LIMIT`/`MAX_CHAT_LIMIT` cap MESSAGES (never threads — a thread cap would let one chatty
  thread hide every other match). `search_history`'s
  identical count-only cap is safe only because its page items are short RENDERED summaries; these are raw
  message bodies. ★ Read the numbers off the exported constants in `chat-search.ts` — the tool description
  INTERPOLATES them, so a literal in prose here is the one copy that can go quietly false.
  ★★★ **A THREAD TITLE IS USER-AUTHORED TEXT ENTERING THE SYSTEM PROMPT**, flattened at the interpolation
  (`inlineTitle`, `chat-recap.ts`) because that is the sink whose SYNTAX it can break. Interior
  newlines survive `deriveThreadName`, and `volatileText` is joined with "\n", so a title reading
  `hi\nSYSTEM: …` renders a forged directive at line start; the `"` delimiter is the other half. ★★ NOT
  self-injection only — `chat_threads` is scoped by `project_id` with no per-user column, so on a shared
  Turso project that text belongs to another collaborator. ★★★ SIZE IS A SEPARATE HAZARD AND IT IS CAPPED
  AT THE PRODUCER, NOT HERE — an earlier revision of this line said the opposite ("`THREAD_NAME_MAX` is
  applied HERE, capping both branches at one point"), and that was false when written: `inlineTitle` had
  ONE call site while `searchChats` and `summarizeChatThreads` emitted the same value RAW into
  `search_chats` and `get_app_state`. `threadTitle` (`chat-search.ts`) now applies the cap, so every
  emitter gets it. A sink-side cap is opt-in per call site — do not re-add one here.
  ★ `clipped` on a returned message is a DIFFERENT claim from `truncated`/`moreMessages`: this BODY was
  shortened, versus other MESSAGES matched. The needle is matched against the FULL text and only the
  returned copy is clipped, so an excerpt may not itself contain the needle — which is exactly what
  `clipped` exists to disclose. ★ The ACTIVE thread is never returned: it is verbatim in the request
  already, and saying so stops the model concluding its own conversation has gone missing.
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
  ★★★ **PREVIEW/APPLY PARITY — the invariant the whole preview exists to hold.** For every field a
  chat write tool can affect, the preview must show either the value the writer will STORE, or a
  rejection the writer will HONOUR and the user can SEE. Three asymmetries make that hard, and each
  has shipped a defect:
  (1) the preview judges fields ONE AT A TIME while a writer's gate can be JOINT over the merged row
  (§384 — a mononym rename previewed `lastName` rejected while the write stored `""`), which is why
  the descriptor carries `requiredNonEmptyGroups`;
  (2) a write ALIAS rewrites fields that are not in `diffFields` at all (§372 — `resource.name` →
  `splitName`), so the preview MIRRORS that projection before its diff loop, and a second copy of
  that rule is how the two drift apart again;
  (3) the full-record sanitizers REBUILD the row, so a value they refuse is not merely un-applied —
  the key is omitted and a populated field is CLEARED, while the preview refuses the same value and
  the card reads "unchanged". That last one is closed at the MERGE SITE, never in the sanitizer:
  `dropUnacceptedRaidFields` / `dropUnacceptedChangeFields` / `dropUnacceptedMilestoneFields` hoist
  each sanitizer's OWN predicate to the patch level, because those sanitizers also run on the load
  paths where there is no prior value to preserve.
  ★★ **WHICH CONSUMER LOSES DATA DEPENDS ON THE DIRECTION OF THE DIVERGENCE.** For a preview that
  shows a value apply will not store, the REBUILDING consumer (`use-inline-entity-edit.ts`, which
  reconstructs its patch from `plan.updates`) is the one that misfires; for a preview that REJECTS
  what apply stores, it is the two REPLAYING consumers (`chat-proposal-apply.ts`,
  `use-insight-recommendations.ts`), which resend the original `ProposedCall.input` and never read
  the plan. Neither is "the" data-loss path, and assuming one is how §384 was mis-scoped.
  ★★ `tool-input-coverage.test.ts` fails when a DECLARED tool input is neither previewable nor
  excluded with a written reason — the property is enforced rather than maintained. ★★★ Read its
  reach exactly, because it is WIDER than it was and still bounded (§401, CLOSED 2026-09-06). It now
  carries a SECOND scan that reads the task write path's SOURCE for `input.<name>`, so an input
  `buildPatch` accepts that no schema advertises — `update_task`'s legacy `notes` — is caught as
  well. That scan reads ONE file, and `update_task` is the only update tool whose accepted surface is
  enumerable from source at all, because it alone is built by a whitelist; the other five go through
  `patchWithoutId`, which forwards whatever the model emits minus `id`, `expectedToken` and the
  token-excluded fields. So a green run means "every declared input is covered, and every input the
  TASK write path reads" — never "every accepted input on all six tools is covered".
  ★★ `plan.sanitizer-parity.test.ts` compares the preview against the SANITIZER;
  `plan.write-path.test.ts` replays through the REAL dispatcher. The second exists because the first
  structurally cannot see a dispatcher-level derivation — and because a reader built on a raw
  sanitizer is blind to a merge-site guard, which once left four CLOSED defects being excused as
  open gaps by a fully green gate.

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
  (image/document) from pure `chat-attachments.ts` (classify by mime+extension, build the Anthropic
  block — PDF/image as base64 `source`, text as `{type:"text"}` document source; NO parsing lib, Claude reads
  natively). ★★ READING the bytes is NOT here and no longer uses `FileReader` at all — that claim stood in
  this file after the pipeline moved: `attachment-ingest.ts` (`ingestFile` / `ingestBytes`) owns it and reads
  via `file.arrayBuffer()`. It is the single entry point for the consumers; see the attachment-ingest
  bullet in `AGENTS.md` for the rules that gate it. ★ There are TWO size caps, not one —
  `MAX_ATTACHMENT_BYTES` (20 MB) for a flat file and `MAX_MAIL_BYTES` (64 MB) for mail — and six kinds, not
  two: `pdf` · `image` · `text` · `office` · `html` · `mail`. A user turn with attachments sends `content` as
  `ContentBlock[]` (text block first, then attachments) not a string, and for a mail that is
  `flattenIngestBlocks(node)` — the whole tree, not the envelope. CSP already allows `api.anthropic.com`.
  Chat view is NOT in axe `A11Y_VIEWS` — verify chat controls by eye.
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
  natively via `chat-attachments`, NO parsing lib). File AND SharePoint both call `ingestFile` / `ingestBytes`
  and push `flattenIngestBlocks(node)`. The panel's own `readFileData` and `arrayBufferToBase64` are GONE
  (REMOVED with the pipeline move — do NOT reintroduce either), as is `mimeForKind`, whose per-kind
  `image/png` guess is replaced by a per-EXTENSION fallback inside the orchestrator. ★★ `mimeForKind` still
  greps as present because a comment in `attachment-ingest.test.ts` names it; `docs:symbols:check` counts a
  comment as existence, so a grep-says-it-exists is not evidence the code does. ★ Its error narrowing is
  exhaustive on purpose — an annotation spelling the variants out as literals: a new
  `IngestResult` error member must be handled here rather than silently joining the throw that abandons the
  WHOLE import batch. ★★ It guards which variants may reach that branch and says NOTHING about how any of
  them is RENDERED — "encrypted" was in the annotation while both call sites still rendered it as the
  generic source failure (`docs/open-followups.md` §352). SharePoint:
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
  ★★★ **THE CACHE BOUNDARY, REWRITTEN FOR THE PROMPT-CACHE-LAYOUT SLICE.** This bullet used to argue
  cache placement per block — "invariant per view" vs "invariant per conversation", each block priced
  against the last. That whole framing was too narrow, and the narrowness was itself the bug it never
  found: Anthropic checks the prefix in the fixed order **`tools` → `system` → `messages`**, and a cache
  entry is reusable only while the prefix is byte-identical from the very start. So per-turn content
  placed ANYWHERE before `messages` makes the WHOLE transcript uncacheable, however many breakpoints the
  messages themselves carry — not merely the one prefix segment each earlier revision here argued about.
  That is what every volatile block below was doing while `buildSystemPrompt` put both halves in
  `system`: every message of every conversation was billed as fresh input on every turn. The full
  ordering argument and the Anthropic reference citations it rests on live in `chat-cache-layout.ts`'s
  file header — read that before reasoning about any of this from scratch again; this bullet only
  summarises the shape.
  ★★★ **THE FIX: `buildSystemPrompt` split in two, and the chat panel stopped putting the volatile half
  in `system` at all.** `buildStableSystemBlocks` returns the cached half only — `stableInstructions` +
  the guide block, `cache_control`-terminated — and is call-invariant except for the model's language.
  `buildTurnContext` returns the volatile half as a plain **string** (today, task count, app context,
  view scope/state, insights, the activity recap, the chat pointer) and is never followed by its own
  breakpoint. `chat-panel.tsx` sends `system: buildStableSystemBlocks(...)` and hands the turn-context
  string to `chat-cache-layout.ts`'s `buildWireMessages(messages, turnContext)`, which appends it as a
  trailing text block on the OUTGOING COPY of the last user message — after any `tool_result` blocks,
  which the API requires to lead — and never touches the persisted `messages` array (persisting it would
  leave stale "Today is …" lines down the transcript AND rewrite history's tail on every send, destroying
  the byte-identical prefix the next send depends on). `buildSystemPrompt` still exists as a thin
  composition of both halves in `system`, kept ONLY for `inline-ai-edit-call.ts` — a one-shot forced tool
  call with no transcript to protect, where relocating the volatile block would tune a working prompt for
  zero gain (see that file's own comment).
  ★★★ **A `cache_control` MARKER IS WRITE-POSITION METADATA, NOT PART OF THE BYTES THE CACHE MATCHES
  AGAINST.** Moving a marker off a message does NOT invalidate the cache entry that message sits inside —
  this is Anthropic's own stated behaviour ("strip `cache_control` markers before diffing: the moving
  marker always differs between adjacent requests and is not an invalidator"), and is now **measured
  against a live account, not only documented** — see the dedicated bullet below for the run. **Getting
  this backwards cost the slice a wrong rewrite once**: an earlier pass measured a marker-inclusive byte
  diff, concluded the cache was thrashing, and replaced the correct moving-boundary breakpoint with
  power-of-two bucket quantization to "fix" a cost that was never real — itself expensive (coverage
  between doubling points converges to ln 2 ≈ 0.69 average / 0.50 worst case vs ~0.11× for a boundary
  that moves every turn, roughly 3.4× more spent on history than necessary, plus a write point that
  could leave a short conversation under a model's minimum cacheable prefix and cache nothing,
  silently). `chat-cache-layout.ts`'s `stripCacheControl` test helper exists so nobody re-derives that
  same wrong conclusion from the same wrong assertion shape again.
  ★★★ **THE LIVE MEASUREMENT, RUN 2026-09-08.** Model `claude-sonnet-5`, one process, two arms of four
  turns each: OLD = the pre-slice layout (volatile block inside `system`, plain message array), NEW =
  this layout (`buildWireMessages` appending turn context to the last user message). Turn 1 is excluded
  from every cross-arm comparison — both arms share a byte-identical tools+system prefix, so whichever
  arm runs first pays the cache WRITE (1.25×) on it and the second merely READS it (0.1×); that
  asymmetry is turn ordering, not layout. From turn 2 on: OLD's `input_tokens` grows every turn (2480 →
  2683 → 2872) because the transcript is re-billed fresh each time, while NEW's stays flat (304 → 304 →
  304) because the transcript left full-price input; OLD's `cache_read_input_tokens` stays flat (18740
  flat) while NEW's grows (18740 → 21305 → 21487) as the transcript itself joins the cached prefix.
  NEW's `cache_creation_input_tokens` is 2565 on turn 2 (the transcript so far), then 182 and 182 —
  only that turn's incremental exchange. **The crossover is turn 3, and turn 2 alone is ~24% MORE
  expensive under the new layout** — token-equivalents at fresh×1.0 / write×1.25 / read×0.1: turn 2 OLD
  4354.0 vs NEW 5384.3; turn 3 OLD 4557.0 vs NEW 2662.0 (~42% cheaper); turn 4 OLD 4746.0 vs NEW 2680.2
  (~44% cheaper); cumulative turns 2–4 OLD 13657.0 vs NEW 10726.5 (~21% cheaper). A conversation that
  ends by turn 2 costs MORE under this layout; a longer one costs progressively less, and the gap widens
  because OLD's fresh input grows ~196 tokens/turn while NEW's stays flat. **Limits, read before
  generalising:** one model, one hand-built workspace snapshot (not a real one — `jsonToWorkspace` needs
  a DOM the harness didn't provide), one short follow-up conversation shape, and turn 1 excluded as
  arm-order contaminated. It says nothing about longer conversations, other models, or a real snapshot's
  volatility. **The harness that produced this is NOT in this repo** — it takes a live API key and lives
  in a session scratchpad, so this bullet is the only durable trace of the run; no path to it is
  recorded here on purpose, since a scratchpad path is machine- and session-specific and would rot
  immediately.
  ★★★ **THE ANSWER-QUALITY EVAL WAS RUN 2026-09-08 (`claude-sonnet-5`, 5 probes × 2 arms × 3 reps =
  30 live requests) AND FOUND NO REGRESSION — 30/30 hits under BOTH layouts, zero tool reaches.**
  The plan's Task 11 Step 5 and the spec's §6 call for a five-prompt eval comparing OLD vs NEW by
  inspecting the model's ANSWERS, which is a SEPARATE verification from the cost measurement above —
  that run counts tokens and cache flags and never once opens an answer. Each of the five moved
  blocks (today's date, view scope, insights, the activity recap, the chat pointer) carried a
  planted nonsense token no other part of the prompt can emit, so a hit is proof the block was read
  rather than a prose judgement. ★★★ **READ THE RESULT AS A CEILING, NOT A CLEAN BILL: OLD scored
  3/3 on every probe, so the eval had NO HEADROOM and can only ever have detected a LARGE
  regression** — a block the model stopped reading outright. At 3 reps a one-hit difference is
  inside noise, and nothing here speaks to subtler degradation. ★★ The harness is NOT in this repo
  and deliberately so (it takes a live key); it refuses to spend unless it first proves each planted
  token is present in BOTH arms and in the structurally different place each arm puts it — OLD
  inside `system`, NEW absent from `system` and present on the turn. A probe missing from the prompt
  would otherwise report a confident "no regression" while measuring nothing.
  ★★ **ONE REAL DIFFERENCE DID SHOW, and it is not a content loss: NEW is less terse.** On the
  insight probe — whose prompt says "exactly as written" — OLD answered with the bare token in all
  three reps and NEW answered with a full elaborated sentence in all three. ★★ **3–0 at n=3 per arm
  is SUGGESTIVE, NOT ESTABLISHED — Fisher two-sided p = 0.10**, i.e. a split this clean turns up one
  time in ten under the null. An earlier revision of this bullet called it "not noise", which applied
  a lax standard to the finding it wanted to be real two sentences after applying a strict one to the
  finding it wanted to be null. Content accuracy was identical; what shifted is adherence to a
  terseness instruction. It costs OUTPUT tokens, billed at 5×. Not filed as a defect — one probe, and
  a mechanism for it would be a story invented to fit n=3 — but do not cite "30/30" as evidence that
  nothing about the answers changed.
  ★★ **And "no change to the bytes the model receives — only their position" (the spec's own framing)
  undersells what moved.** The bytes are byte-identical, but they moved from a `system` block into a
  trailing text block of the last `user` message — that changes the ROLE under which the model reads
  every one of them (today's date, task count, view scope/state, insights, the activity recap), not
  merely their offset in the prefix. ★ No size figure is quoted here on purpose: the "1–3 KB" a
  reader will find nearby describes the GUIDE block, a different payload, and reusing a neighbouring
  number for this one is how an unmeasured figure acquires a citation. The eval above is what bears
  on this, and within its stated ceiling the role change cost no CONTENT. The spec names the fallback
  if a future eval goes badly: keep the view-scope block's output in `system` and take the smaller
  cache win. Not needed on this evidence; still available.
  ★★★ **THAT EVAL IS NOW IN-REPO AS `npm run ai:eval`** (slice H), and the two-file split IS the
  design. `scripts/ai-eval-lib.mjs` holds EVERY decision — probes, the seeded anchor, token minting,
  scoring, the graded axes, pre-flight, the verdict, the spend refusals — and is unit-tested with no
  network, no key, no clock and no filesystem, so every judgement the harness makes is checkable
  without spending anything. `scripts/ai-eval.ts` is I/O only and runs under `npx vite-node`
  precisely so it can import the app's REAL builders (`buildStableSystemBlocks`, `buildTurnContext`,
  `buildWireMessages`, `toolsFor`, `builtinSeeds`): a harness that rebuilds the prompt measures its
  own copy of it. Dry run is the default and spends nothing, but is NOT a degraded mode — it
  assembles every arm and runs every pre-flight assertion, so a moved symbol or a leaking token
  surfaces with no key at all. Spending needs an explicit `AI_EVAL_SPEND` opt-in and is refused
  outright under CI.
  ★★ **EXIT 2 IS THE LOAD-BEARING CODE**, the same split every other gate in this repo uses: 0 pass,
  1 a real regression, 2 the harness could not do its job (an incomplete run, a negative control that
  leaked, a null arm that itself fell). A run that measured NOTHING must never report 0 — that is a
  green light nobody earned; reporting a broken instrument as 1 is the same mistake from the other
  side, blaming a slice for the harness.
  ★★★ **THE POSITION ASSERTION IS THE LANDMINE HERE — ITS FIRST CUT WAS FALSE FOR THIS APP AND WAS
  SILENTLY SWITCHED OFF.** It was written to assert "arm A's target sits in `system`". Measured
  against the real builders, that is false for every probe: `buildStableSystemBlocks` contains NONE
  of the relocatable block builders and `buildTurnContext` contains ALL of them, so every relocatable
  block travels in the volatile half — which `buildWireMessages` places in the MESSAGES array, never
  in `system`. The false assertion was then buried under an `expectRelocated: false` escape hatch and
  read as passing, which is how a load-bearing check ends up permanently disabled. It now works the
  other way round: each arm DECLARES an `expectedHalf` (`"system"` or `"turn"`), and pre-flight
  asserts the target occurs exactly once in the declared half and ZERO times in the other. A missing
  or unknown half is a FAILURE, never a skip — a check that does not know where to look passes
  everything. The flag was removed; do NOT reintroduce it. ★★ **ITS LIMIT, stated because the first
  version's whole failure was an assertion nobody could state the limits of: when both arms declare
  the SAME half, those checks pass WITHOUT proving the arms differ.** Relocation is proven only when
  the two declared halves DIFFER. Until a gated slice registers a real variant, arm B is an alias of
  arm A and a green run is an honest A/A self-test of the machinery, not evidence about a candidate.
  ★★ **THE FOUR GRADED AXES REPORT, THEY DO NOT GATE, AND TWO OF THEM CANNOT BE READ ALONE.**
  `adherence` is counted over HITS ONLY and is recorded with its denominator `adherenceOf`: a run
  that collapses to zero hits scores `adherence: 0`, which on a higher-is-worse axis reads as
  perfect — the worst possible run taking the best possible value. Never read it without the
  denominator. `outputTokens` carries the same shape of trap and NO denominator can fix it: a model
  that gives up tersely scores better than one that succeeds and explains itself, so a fall here
  ALONGSIDE a fall in hit rate is very plausibly one failure showing up twice, not a wash.
  ★★ **WHAT THE UNIT SUITE PINS THAT NOTHING ELSE COULD** — each was a SILENT failure, found by
  probing the lib rather than by reading it. (1) Planted tokens were not collision-free: 11 of salts
  1..5000 produced a within-run collision, including a target equal to its own decoy on the anchor
  arm, which `scoreResponse` can only ever call ambiguous, silently, forever. `plantedToken` now
  regenerates a candidate against every earlier id in a declared ORDERED id universe, so it is
  collision-free BY CONSTRUCTION, and an unknown id throws rather than losing the guarantee quietly.
  (2) `buildAnchorPrompt` silently dropped a token at boundary inputs; it now asserts as a
  POSTCONDITION that target and decoy each occur exactly once — one assertion on the OUTPUT subsumes
  every way the inputs could produce a bad text. (3) `verdict` returned PASS on a run that measured
  nothing (an empty probe list, or a probe whose arms were undefined); it now refuses, while a
  genuine `0` is still treated as measured. (4) The negative control is deliberately NOT handed to
  `preflight` — it is the arm whose target was REMOVED, so it would fail by construction, and the
  only way to make it pass would be to weaken the check for A and B too. It gets its own two
  assertions instead: target zero times, decoy exactly once.
  ★★ **NOTHING TYPECHECKS THE CLI.** `tsconfig.json` excludes `scripts`, proved by mutation in BOTH
  directions — the same deliberate type error yields zero errors inside `scripts/` and a TS2322 at
  the repo root — so a green `npx tsc --noEmit` says nothing whatever about `scripts/ai-eval.ts`.
  The one-off that does check it:
  `npx tsc --noEmit --ignoreConfig --strict --skipLibCheck --module esnext --target es2022 --moduleResolution bundler --jsx react-jsx --esModuleInterop --resolveJsonModule --lib es2022,dom,dom.iterable --allowJs --types node scripts/ai-eval.ts`
  ★ And `vitest.config.ts` globs only `scripts/**/*.{test,spec}.mjs`, so a `.ts` test placed beside
  the lib would silently never run — keep the harness's tests `.mjs`.
  ★★★ **STATUS: IT HAS NOW RUN LIVE ONCE, AND THAT RUN WAS UNUSABLE — read the recorded artifact,
  never this paragraph.** An earlier revision here said it had never run and that no
  `docs/baselines/ai-eval-*` artifact existed; both files were committed the same day and the claim
  survived, which is the ordinary way a status line rots. What the run said: `claude-sonnet-5`, salt
  1, 5 reps, 60 requests. Four probes behaved (arm A hit rates 1.0 / 1.0 / 0.8 / 1.0) and
  **`chatPointer` scored 0.0 on BOTH arms**, with `wrongBlock` at zero everywhere. The negative
  control scored 0 on all five, so the probes genuinely require their block, and the anchor scored
  1.0. Pre-flight passed, so the token WAS in the prompt exactly once in the declared half. That is a
  probe-calibration finding, not a finding about the app — and it is exactly the failure mode the
  2026-09-08 manual run had from the other side (3/3 everywhere, no headroom). Do not cite the
  existence of this harness, or a green run of it, as evidence that anything about the answers is
  proven.
  ★★★ **THAT `wrongBlock: 0` WAS THE INSTRUMENT LYING, AND AN EARLIER REVISION OF THIS PARAGRAPH
  READ IT THE WRONG WAY** — it said the model "produced no target at all rather than returning the
  decoy", which is literally true and invites precisely the wrong conclusion. The filtered diagnostic
  found three arm-A reps returning, identically, the DATE block's token: the model was not failing to
  reach the block, it was returning the most SALIENT code. Two defects, both fixed 2026-09-09, and
  neither is visible from a score. **(1)** All five blocks introduced their token as a "reference
  code" and every question asked for "the reference code carried by <description of the block>", so
  the model had to tell five IDENTICALLY-labelled codes apart from prose alone and the vaguest
  description lost every time — a probe measuring salience while claiming to measure reachability.
  Each block now carries a DISTINCT label (calendar / view / finding / activity / transcript code),
  read from `PROBES` by `labelOf` so the prompt text and the question cannot be edited apart, and a
  unit test asserts each question names its OWN label and none of the other four. The decoy,
  placement, nonsense tokens and "exactly as written" are unchanged: difficulty still comes from
  depth and distraction. **(2)** `scoreResponse` knew the target and that probe's DESIGNATED decoy
  only, so a reply carrying a THIRD probe's token scored `absent` — "read nothing" and "read the
  wrong thing" were the same number, and blind in exactly the case that matters. It now takes the
  whole planted set and returns `{outcome, otherBlocks}`; `gradeArm` adds `wrongBlockFrom` tallying
  WHICH block was returned instead. ★★ `ambiguous` still outranks `hit` and the widening makes that
  rule STRONGER — ANY foreign planted token demotes a hit now, not merely the designated decoy — and
  that is the rule stopping a context-dumping model scoring a perfect run. ★★ Widening the scan to
  five substrings created a new silent failure with it: one planted token CONTAINING another would
  score every correct answer `ambiguous` forever, so `tokenSubstringConflicts` asserts it at
  pre-flight. It is an ASSERTION and deliberately not a change to `plantedToken`: a re-mint at the
  same salt would make the rolling replay miss every time and read as catastrophic drift. Rotate
  `AI_EVAL_SALT` if it ever fires.
  ★★★ **THE RELABELLED RUN THEN PASSED AT 1.0 ON EVERY PROBE, WHICH IS ITS OWN PROBLEM.** A binary
  score at saturation detects a total block failure and essentially nothing else — the exact
  limitation of the manual eval this slice exists to escape, arriving from the other direction.
  `PROBE_HARDENING` (`ai-eval-lib.mjs`) is the ONE place difficulty is tuned: three switches per
  probe, from which the block text, the question and the planted-token universe are ALL derived, so
  a knob cannot drift away from the prompt it governs. `competitor` plants a near-miss code in the
  SAME block ("previous <label>" against the target's "current <label>"); `fillerBefore` puts
  realistic code-free items ahead of the target; `composition` makes the answer depend on a fact in
  a DIFFERENT block. ★★ **THE RULE THAT GOVERNS EVERY KNOB: DIFFICULTY COMES FROM RETRIEVAL EFFORT,
  NEVER FROM AMBIGUITY.** An ambiguous probe is not a hard probe, it is a broken one, and it fails
  in a way that looks identical to a regression — which is what the two runs above cost. Every
  question must keep exactly one answer a careful reader would agree on.
  ★★ `composition` is ON FOR ONE PROBE ONLY (pinned by a test) and implemented for `chatPointer`
  alone, whose block is the one that naturally holds a LIST to select from; the CLI REFUSES at
  pre-flight if it is switched on elsewhere, rather than asking a question with no answer. It is
  also the only mechanism that changes WHAT the probe measures — it now needs two blocks, so a
  failure does not say which was missed.
  ★★★ **INSIGHT ORDER IS SEVERITY, NEVER ARRAY POSITION, and getting that wrong buries nothing or
  drops the target outright.** `buildInsightsPromptBlock` SORTS by `INSIGHT_SEVERITY_RANK` and then
  SLICES to `MAX_PROMPT_INSIGHTS` — so an array ordered to bury the target does nothing, and an
  array longer than the cap silently drops entries, which for the target is a probe measuring
  nothing. The harness plants the target at `low`, its competitor at `medium` and the filler at
  `high`.
  ★★★ **ADD A TOKEN ID BY APPENDING TO `TOKEN_IDS`, NEVER BY INSERTING.** `plantedToken` regenerates
  a candidate only against ids EARLIER in that list, so appending leaves every existing token
  byte-identical at every salt — which is what keeps the committed rolling reference replayable and
  the recorded runs comparable. An insert can change a later id's token on some salt, and the replay
  then misses every time and reads as catastrophic drift. Pinned by a test asserting the five
  original salt-1 tokens verbatim.
  ★★★ **THE ROLLING REFERENCE IS COMPARED AGAINST WHAT THE LAST RUN *WROTE*, NEVER WHAT IT READ, and
  it was the wrong one until 2026-09-09.** A run recorded `rollingHash` = the hash of the file it
  READ at start and then OVERWROTE that file, so the next run read different bytes and pre-flight
  reported "the stored drift reference is not what the last run wrote" — refusing to spend at all.
  It could only ever pass while the prompt was UNCHANGED, i.e. in exactly the case where the check
  had nothing to catch, which is why three green runs went by without exposing it. Measured: the
  committed rolling file hashed to `ca4466cd…` while the last recorded run carried `ab7cea71…`.
  Runs now record `rollingWrittenHash` (null when they wrote nothing — a filtered or incomplete run
  must not blank the reference the run before it left), and the comparison is against the most
  recent non-null one. ★★ `buildRunRecord` copies an EXPLICIT field list, so this field was silently
  dropped on its first cut and every later run would have found no reference at all; that is now
  pinned by its own test. Records written before the field existed carry none, so the check stays
  quiet until a run writes one.
  ★★★ **THE HARDENING DID NOT WORK, AND THAT IS THE FINDING — RECORD IT RATHER THAN BUYING MORE
  RUNS AGAINST IT.** The calibration sweep (arm A, 3 reps) came back `date` 1.0, `viewScope` 1.0,
  `insights` 1.0, `activityRecap` 1.0. Near-miss competitors ("current" vs "previous" code) and
  burying the target four lines down are both trivial for `claude-sonnet-5`: **those two levers are
  spent.** Combined with the pre-hardening run (all five at 1.0) and the 2026-09-08 manual eval (3/3
  everywhere), the honest reading is that this model sits at 1.0 on ANY unambiguous single-hop
  retrieval from a ~31k-token context, and that distractor DENSITY would be spent for the same
  reason — it is still one-hop string matching against a distinct label. ★★ **SATURATION IS ONLY A
  DEFECT AGAINST A GOAL THIS HARNESS DOES NOT HAVE.** Its stated purpose is telling whether a
  prompt-layout change STOPPED the model reading a block; for that, a baseline pinned at 1.0 is the
  best possible baseline, because any drop is signal and `verdict`'s hard fail (arm B zero where arm
  A was not) is exactly the right gate. It becomes a defect only if the aim shifts to detecting
  PARTIAL degradation, which needs resolution the rep count cannot buy — at 5 reps the per-probe
  resolution is 0.2 and the standard error at p≈0.8 is 0.18, so a 0.2 drop is one SE.
  ★★ **DO NOT REACH FOR THE OBVIOUS FIXES.** Reducing label distinctness, semantic indirection, or
  making the answer require inference about content all reintroduce AMBIGUITY, and an ambiguous
  probe fails in a way indistinguishable from a regression — that lesson has been paid for twice
  (`chatPointer` at 0.0 for two runs). The one mechanism worth trying is a FINER RULER rather than a
  harder task: one question asking for all five codes at once, scored 0-5 per reply. That gives 25
  observations per arm at 5 reps instead of 5, for FEWER requests, introduces no ambiguity because
  the labels are already distinct, and degrades in exactly the way a relocation would (one code goes
  missing, the rest stay). It needs a partial-credit outcome shape `hitRate`/`verdict` do not have,
  so it is its own decision, not a tweak.
  ★★★ **THE OUTPUT CAP IS PART OF THE INSTRUMENT, AND 64 WAS MEASURING ITSELF.** `chatPointer`
  scored 0.0 on all three sweep reps at EXACTLY 64 output tokens — `MAX_OUTPUT_TOKENS` — with empty
  text and zero tool uses. A probe colliding with the ceiling scores `absent` whether or not it
  found the block. Raised to 512; worst case if every reply ran to it is 65 × 512 = 33,280 output
  tokens, 166,400 weighted against a recorded full run's 681,288 (about +24%, and nowhere near it at
  11-13 tokens per answer). ★★ Every record now carries `maxOutputTokens`, because `outputTokens` is
  a MEAN compared across runs and the cap bounds what it can reach — a rise after a cap change can
  be headroom rather than behaviour. ★★ And every reply now records `stop_reason` plus a census of
  the content-block TYPES returned (types and counts only). Nothing recorded could say what those
  three empty replies had carried instead of text, which cost a spend to find out; the census
  settles it on the next run. A `thinking` block is the obvious candidate for a reasoning model —
  **that is a hypothesis the census will confirm or refute, not a claim.** The CLI also warns on
  stderr when any reply stops at `max_tokens`.
  ★★★ **THE RUN COULD NOT SAY WHY, WHICH IS WHY THE ARTIFACT NOW RECORDS `samples` AND `usage`.**
  Scores alone make a refusal, a paraphrase and an answer to a different question the same number,
  and telling them apart cost a whole second run. Each record now carries every NON-HIT reply's text
  plus ONE exemplar hit per (probe, arm), truncated — the reply text ONLY, never anything from the
  request, which is regenerable from the salt and the builders anyway. ★★ It also recorded
  `input_tokens` (1605) and dropped both cache fields, so a harness whose PURPOSE is measuring prompt
  cost could not say what the run cost: `input_tokens` is the UNCACHED REMAINDER, not the prompt, and
  a ~31k-token prefix read from cache is invisible in it — the same defect the app's own meter
  carried before 0.295.0. All four billed classes are now recorded per arm and summed, weighted
  through `ai-usage.ts`'s own `usageCostEquivalent` (never a local copy of the ratios), with
  `USAGE_COST_WEIGHTS` stored beside the figure so a later weight change shows up in the series
  instead of silently rewriting every earlier run. Deliberately NOT converted to currency.
  ★★★ **THE DIAGNOSTIC FILTER AND WHY IT CANNOT REPORT PASS.** `AI_EVAL_PROBES=<id,...>`,
  `AI_EVAL_REPS=<n>` and `AI_EVAL_ARMS=<A,B,X,N,R>` narrow a run, so iterating on one broken probe
  costs a request rather than sixty. A filter that reported a normal verdict would be the precise
  failure this whole harness exists to prevent — a confident green over a measurement of almost
  nothing — so it is refused structurally, not by convention: `verdict` and `shouldWriteRolling` both
  REQUIRE the flag (absent THROWS; a defaulted field would make the one line a caller forgets the
  line that turns a one-probe diagnostic into a green light), `buildRunRecord` derives the verdict
  from the SAME `filter` argument it records so the two cannot disagree, the narrowing is written
  into the artifact, and a filtered run never overwrites the rolling drift reference. ★★ A filter
  naming EVERY probe and arm is still a filter: proving one equivalent to the standard run means
  re-deriving the plan, and a check that re-derives what it guards drifts away from it. ★ An unknown
  probe id or arm REFUSES rather than being ignored, before anything is spent.
  ★★★ **`CACHED_TOOLS` (`chat-api.ts`) closes the FIRST segment of the prefix** — the LAST tool carries
  `cache_control`, so an edit to block 0 (a guide toggled, `groundInGuides` flipped, or the fixed
  instructions changed) re-caches only the smaller system slice after it, never the whole `tools`
  payload. Without it the only marker ahead of `messages` would be block 0's own, so `tools` sits
  INSIDE that one segment and a block-0 edit forces the whole `tools`+block-0 prefix to rewrite
  together, even though no tool schema changed.
  ★★ THAT IS NOT WHAT PROTECTS A VIEW SWITCH ANY MORE, and an earlier revision of this bullet gave that
  as the reason ("a per-view guide swap … re-caches only the smaller system slice … the guide swap
  would rewrite the entire tool payload on every view switch"). The reason changed under it once
  `buildStableSystemBlocks` split into two blocks and moved the per-view guide text into block 1, AFTER
  both the `tools` marker and the block-0 marker (see that function's own two-block doc comment) — a
  view switch now changes only block 1, so it never reaches either marker regardless of whether `tools`
  carries a breakpoint of its own. `chat-cache-layout.ts`'s
  `buildWireMessages` adds up to `MAX_MESSAGE_BREAKPOINTS` (2) more breakpoints inside the message
  history itself: a moving BOUNDARY (the last message before the turn-context tail — this is what buys
  most of the coverage, and a moving marker is the cheap, recommended shape per the fact above, not a
  defect) plus a fixed ANCHOR at the largest power-of-two prefix length (bounded distance from the start,
  so it survives Anthropic's 20-block breakpoint lookback window even after a long tool loop pushes the
  boundary mark out of range). Four breakpoints total is Anthropic's own per-request cap; `tools` and
  `system` already claim one each, which is why the message layer is capped at two.
  ★ **Measure the SERIALIZED tool payload, not a file on disk.** `JSON.stringify(TOOL_DEFS)` is ~45 KB
  across **52** tools (2026-09-08; `chat-tool-defs.ts`'s own literal holds **47** and spreads
  `DOCUMENT_TOOL_DEFS` (**5**) from `chat-tool-defs-documents.ts` as its last element — re-derive with
  `grep -c '^    name: "' src/app/chat-tool-defs.ts src/app/chat-tool-defs-documents.ts`, and the byte
  figure with a two-line `vite-node` script importing `TOOL_DEFS` and logging
  `TOOL_DEFS.length, JSON.stringify(TOOL_DEFS).length` — `vite-node` has NO `-e` flag and cannot load a
  script from outside the repo root, so write the temp file inside the repo, run it, delete it, never
  `git add` it). Both counts have grown before and will again; re-run rather than trust either number
  here. Nothing in this repo counts tokens — any token figure quoted near this is a ~4-bytes/token
  estimate, not a measurement.
  ★★★ **`buildStableSystemBlocks` RETURNS TWO BLOCKS AND ONLY THE FIRST CARRIES A MARKER.** Block 0
  is the instructions plus every always-on guide; block 1 is the current view's guides alone. The
  split exists because the guide payload is dominated by content that does NOT vary by view — and
  the comparison that matters is per-REQUEST, never against the whole feature-guide corpus, because
  only ONE view-scoped guide is ever active at a time: the unscoped leadership guide alone runs
  ~8x the largest single view guide, even though the 22 view-scoped guides are comparable to
  leadership ALONE (1.14x — not leadership plus App overview, which is not part of either side of this
  ratio) — which is exactly why view scoping saves far less than the 22-of-23
  guide-count ratio below suggests. Measured 2026-09-09 via a `vite-node` script importing
  `builtinSeeds` from `use-operating-guides` and summing `content.length` grouped on whether
  `scope.views` is empty-or-absent: always-on (leadership + App overview) = 35,788 chars, estimated at
  the time via chars÷3.6 as ≈9.9k tokens; the 22 view-scoped guides total 28,977 chars, largest single
  guide 4,103 chars — re-run rather than trust these numbers. ★ That chars÷3.6 estimate and the measured
  figure below are NOT the same SCOPE, and reading them as directly comparable overstates the ratio's
  share of the gap. The estimate covers the always-on GUIDE TEXT alone (35,788 chars → 9,941 tokens at
  3.6); the live cache measurement below is of BLOCK 0 — that guide text PLUS the fixed instructions
  ahead of it (38,791 chars) — at a measured 13,305 tokens, a real ratio of 2.92 chars/token for that
  larger payload. Of the 3,364-token gap: ~69% (~2,334 tokens) is the ratio correction (3.6 was too
  generous), ~31% (~1,030 tokens) is the added scope (fixed instructions the original estimate never
  counted). At the measured ratio the guide text alone is ~12,275 tokens (35,788 × 13,305 ÷ 38,791 —
  assumes uniform character density, unverified). Meanwhile `assembleGuideBlocks`' predecessor put a
  varying guide COUNT in a single shared header ahead of all of it, so a view switch re-wrote what is
  now measured at 13,305 tokens of byte-identical block-0 text at 1.25x (the ~9.9k figure earlier here
  was the narrower guide-text-only estimate, not this payload). Measured before the change: the
  longest common prefix of the assembled block across all 34 nav-reachable views was 9 characters
  (`AppView` has 35 members; `learning-insights` is deep-link-only and was not probed — including it
  could not raise the figure, since a common prefix only shrinks as strings are added).
  ★★ Block 1 has no marker ON PURPOSE — all four breakpoints are already committed (tools 1,
  system 1, messages 2) — and it still sits inside whatever a LATER marker covers, so it is not
  necessarily uncached, merely never the boundary of a cache lookup by itself. Adding a fifth marker
  is an API error, not a silent no-op.
  ★★ THE HISTORY IS STILL RE-WRITTEN ON A VIEW SWITCH, because block 1 precedes the messages in the
  prefix. That is this slice's ceiling, not an oversight; the successor that removes it (moving the
  view-scoped guides onto the turn tail) is slice G2 in
  `docs/superpowers/specs/2026-09-08-ai-guide-block-cache-split-design.md` and is gated on the
  answer-quality eval, because it is a `system`-to-`user` role change.
  ★★★ **MEASURED 2026-09-09 — THE SAVING IS CONFIRMED, WITH STATED BOUNDS.** A live two-arm run against
  the real Anthropic API (`claude-sonnet-5`, `max_tokens: 64`) replayed a canned 4-turn conversation
  carrying the real 24 guides from `builtinSeeds` and the real 52-tool array from `toolsFor`, with a
  view switch between turn 2 and turn 3 (`budget` → `raid-report`, chosen because the guide COUNT
  differs between them) — one request per arm per turn, 8 requests total, reading
  `cache_read_input_tokens`/`cache_creation_input_tokens` off each response. The OLD arm reconstructed
  the pre-split single system block; the NEW arm is `buildStableSystemBlocks` + `buildTurnContext` +
  `buildWireMessages` on this branch. At the switch (turn 3): cache read rose 17,796 → 31,101
  (+13,305), cache write fell 13,836 → 563 (−13,273), billed cost (fresh-input 1.0x / cache-write
  1.25x / cache-read 0.1x / output 5x token-equivalents) fell 19,632.6 → 4,381.9 (**−77.7%**). Two
  independently-derived readings agree on the moved amount: the NEW arm's turn-1 cache WRITE (13,305)
  and the NEW−OLD cache-READ delta at the switch (31,101 − 17,796 = 13,305) are the same number — that
  is block 0. The `tools` entry alone is a measured 17,796 tokens (both arms read exactly that whenever
  only `tools` survives in cache). Over turns 2–4 (turn 1 excluded — see below), cumulative cost fell
  27,295.9 → 13,027.2 (**−52.3%**).
  ★★ **Steady state within one view is NOT free.** Turn 4 (no switch since turn 3) cost 3,670.5 (OLD)
  vs 3,688.7 (NEW) — NEW is **0.5% worse**, the price of the extra per-request header bytes the
  two-block layout adds. A conversation that never switches view mid-session pays slightly more.
  ★★★ **DO NOT quote a turn-1-inclusive cumulative figure.** The harness's own turn-1-through-4 total
  (−51.4%) is contaminated: in this measurement session the NEW arm's turn 1 read the `tools` segment
  warm from the OLD arm's prior run, while OLD's turn 1 paid a cold write — turn 1 is not comparable
  between arms, only turns 2–4 are.
  ★ **Limits, stated with the result, not separately:** n=1 per arm (no repetition), one model, one
  canned conversation, one view pair, and output tokens carry a 5x cost multiplier while varying
  30–64 tokens across the eight requests — the per-turn cache-read/cache-write token counts are the
  deterministic part; the cost column inherits that output-token noise. This measured CACHE BEHAVIOUR
  ONLY — nothing here evaluates answer quality, and this slice never changed what the model is told,
  so attach no eval claim to it. Reproduce with a script importing `buildStableSystemBlocks`,
  `buildTurnContext`, `toolsFor` and `buildWireMessages`, replaying a canned multi-turn conversation
  across a view switch and reading the two cache fields off each response — the harness itself is a
  throwaway scratchpad script, not part of this repo.
  ★★★ **THE VIEW-SCOPED GUIDE (BLOCK 1) STAYS IN `system` FOR NOW, AND THAT IS A DECISION WITH A NAMED
  SUCCESSOR, NOT AN OPEN QUESTION.** Only block 1 of `buildStableSystemBlocks`'s output is
  view-dependent — block 0 (the always-on half, carrying the marker) is not; see that function's own
  two-block doc comment. `settings.ai.groundInGuides` defaults to **true** (`settings-types.ts`, a
  missing key reads as true), and most `BUILTIN_FEATURE_GUIDES` are view-scoped — **22 of 23** measured
  2026-09-08, corrected from a stale "20 of the 21" that had rotted by two; don't trust either number,
  re-run it:
  `node -e "const s=require('fs').readFileSync('src/app/operating-guide-builtin.generated.ts','utf8');const b=s.slice(s.indexOf('BUILTIN_FEATURE_GUIDES'));console.log((b.match(/\"name\":/g)||[]).length,(b.match(/\"views\":/g)||[]).length)"`
  (a bare `grep -c scope` answers 27 and is worthless — the guide prose discusses project scope). So
  `selectActiveGuides` still swaps a 1–3 KB block-1 payload on every view switch, and under the new
  layout **a mid-conversation view switch still invalidates the transcript cache**, because block 1
  precedes `messages` in the checked order above — block 0 and `tools` are untouched, but the byte
  sequence leading up to `messages` differs, so the transcript segment cannot be read from cache
  either way. Moving block 1 onto the turn tail too — closing that remaining gap — is no longer an
  open question sitting here with nobody assigned to it: it is slice G2, specced in
  `docs/superpowers/specs/2026-09-08-ai-guide-block-cache-split-design.md`, deliberately not shipped
  alongside this split because it is a `system`-to-`user` role change and is gated on the
  answer-quality eval (see that bullet above for what "gated" means in practice). The tradeoff this
  bullet used to pose as unresolved — cheap for a user who never switches views mid-conversation vs.
  fresh-every-send for everyone — is G2's to weigh, not a guess to make here. Settle it with the usage
  meter below (cache-write volume vs view-switch frequency) — that measurement is what slice G2
  (named above) needs before it can be built, not a separate `docs/open-followups.md` entry; none
  exists for this and none should be minted on a branch (a follow-up number is reserved only once
  merged to `origin/main`).
  ★★ **A head-trim of history would destroy the whole property.** Dropping the oldest turns changes the
  first message, invalidating the entire prefix on every send and paying a cache WRITE (1.25×) each
  time — worse than not caching at all. Any future history budget must be coarse and hysteretic;
  `chat-cache-layout.ts`'s header carries the reasoning.
  ★★ **The usage meter this slice made honest is not honest on every path, and that is known, not an
  oversight.** `chat-panel.tsx`'s `recordUsage` call is skipped entirely on the `catch` path (an aborted
  or errored send) and gated behind `!cancelledRef.current` on the success path — so a send that errors,
  or is cancelled, after earlier turns in the same multi-turn loop already burned billed tokens records
  NOTHING for that send. Pre-existing control flow, deliberately unchanged by this slice — read this
  before citing "the meter is now honest" as unconditional.
  ★★ **`ai-usage-context.tsx`'s `loadBucketsAndSeedBasisNotices` normalizes each field (via `ai-usage.ts`'s
  `normalizeUsage`) instead of casting, and that closes a real trap** — a usage blob persisted before this
  slice has no `cacheWrite`/`cacheRead`, and an un-normalized legacy bucket would silently stop firing a cap
  forever (the NaN mechanics are under "AI usage caps run on a COST basis" below). Never replace the
  per-field normalize with a plain object cast.
  ★ `buildViewScopeBlock` and `buildViewStateBlock` output both sit inside `buildTurnContext`, scope
  before state — a readability choice (what the surface IS, then what is on it), not a cost one, since
  the tools breakpoint plus the message-level breakpoints above are where the saving comes from.
  ★★ Things that would silently raise cost and break **nothing visible**, so they are what to guard:
  dropping `CACHED_TOOLS` back to a bare `TOOL_DEFS`; moving `buildTurnContext`'s output into `system` (or
  anywhere ahead of `messages`) for a consumer that has a transcript to protect; reintroducing a per-turn
  history trim; or persisting the turn-context string onto `messages`. `chat-api.system-prompt.test.ts`
  ("marks exactly the LAST tool…", "puts the view scope in the UNCACHED block…", "puts the digest in the
  UNCACHED block…", "buildSystemPrompt split into buildStableSystemBlocks + buildTurnContext") and
  `chat-cache-layout.test.ts` ("appends the turn context to the final user message", "never places more
  than two breakpoints on the messages") are what would catch each.
  ★★ **This bullet was wrong twice before this rewrite, in opposite directions** — first asserting the
  scope block belonged in the cached prefix, then asserting that moving it out bought a read. Both were
  reasoned from arithmetic that was internally correct and priced against a baseline nobody checked.
  Before changing anything here, verify what `buildStableSystemBlocks` and `buildTurnContext` actually
  produce AT RUNTIME for a default install — do not reason from this prose alone.
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
  - **The Settings view-scope list is invisible to the axe gate** — `AiViewsSection`
    (`settings-sections/ai-views-section.tsx`) is its own entry in the Settings rail, nested under AI
    Assistant, and the axe gate scans Settings → **General** only, so this section is never reached. Its
    unit tests are the only coverage.
    ★★ It is **no longer a disclosure**. It was `AiViewScopeDisclosure` in
    `ai-view-scope-disclosure.tsx` and reused `ToggleButton`'s `variant="disclosure"`; that component and
    file are GONE, and every view's scope now renders always-visible in a plain list with no per-row
    toggle at all. `ai-views-section.test.tsx` pins the absence of any button. Do NOT reintroduce a
    per-view expander here.
    ★★ `variant="disclosure"` itself still exists on `ToggleButton` and remains the correct choice for a
    genuine disclosure (`aria-expanded`+`aria-controls` instead of `aria-pressed` — a disclosure REVEALS
    content, it doesn't change application state, so the stateful on/off semantics don't apply). But this
    section was its **only** production consumer, so as of 2026-08-07 the variant has **no call site
    outside `toggle-button.tsx` itself** (reproduce: `grep -rln 'variant="disclosure"' src/app
    --include=*.tsx | grep -v test`). It is kept deliberately, not by oversight — deleting it would mean
    the next real disclosure gets hand-rolled `aria-expanded`, which is the failure this variant exists to
    prevent. Do not "clean it up" as dead code.
- **AI usage caps run on a COST basis, not a raw token count:** `usageCostEquivalent` (`ai-usage.ts`)
  weights each of the four usage classes by its Anthropic billing ratio against the base input price —
  `USAGE_COST_WEIGHTS` is input **1**, cache write **1.25**, cache read **0.1**, output **5**. Those ratios
  hold across every current model (Sonnet $3/$15, Haiku $1/$5, Opus $15/$75 — all 1:5 input:output, cache
  write 1.25x and cache read 0.1x everywhere), so the basis needs NO price table and NO per-model branch and
  cannot go stale when a published rate moves. ★★ The one thing that would make the design wrong is a future
  model breaking the ratio; at that point the basis has to become model-aware.
  ★★ THE WEIGHTS ARE APPLIED AT COMPARISON TIME, NEVER BEFORE PERSISTENCE — buckets store the API's own raw
  counts and are priced on read. ★ The record path (where `record()` writes those raw counts), the advisory
  notices and the retired write-time multiplier setting are owned by [`platform.md`](platform.md)'s
  "Usage-limit notices + counting knobs" bullet; this one owns only the basis.
  ★★★ THE OLD UNWEIGHTED SUM WAS DELETED RATHER THAN RE-BODIED. It added the four fields flat, so a cached
  turn — billed at a tenth — consumed exactly as much of a cap as a fresh one, which is the over-counting this
  change exists to fix. A reader meeting a function named for a total expects a plain sum, so leaving that
  name callable would have let the raw sum back into a cap comparison by accident; removing the name makes
  the mistake unavailable instead of merely discouraged.
  ★★ EVERY READER MUST DEFAULT A MISSING FIELD TO 0. A bucket persisted before this change carries only the
  input and output counts; multiplying an absent one by its weight yields NaN, and NaN fails BOTH the
  below-threshold and at-threshold comparisons — so a cap fed a legacy bucket would stop firing forever, with
  no error anywhere. That is a silently disabled cap, the worst outcome available here, which is why
  `normalizeUsage` is one shared helper rather than a defaulting step repeated at each call site. Never
  replace it with a plain object cast.
