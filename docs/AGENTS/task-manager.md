<!-- Split out of AGENTS.md, which is the always-loaded file (CLAUDE.md is `@AGENTS.md`).
     THIS file is NOT auto-loaded — open it when you work on this subsystem.
     Same conventions: ★ = a non-obvious rule, ★★ = has already caused a bug,
     ★★★ = has caused the same bug more than once.
     `npm run docs:symbols:check` gates this file exactly as it gates AGENTS.md:
     it proves a backticked NAME is real, never that a CLAIM about it is true.
     Every claim here was true when written and some have outlived their code —
     grep before relying on one, and correct what you disprove in the same commit. -->

# task-manager — the orchestrator's decomposition map

[← AGENTS.md](../../AGENTS.md) · [doc set](../../AGENTS.md#the-doc-set--what-lives-where)

Owns the map of what was extracted from `task-manager.tsx`: each deps-object hook and plain builder, whether it
is coverage-GATED or excluded, and why it keeps or drops its memoization. The extraction RULES themselves
("Extraction conventions", including "convention 1" that this map refers to) stay in AGENTS.md, which every
session loads; "above" and "below" in the text here refer to that file.

## The decomposition map

Moved verbatim from AGENTS.md on 2026-10-14; the always-loaded stub there keeps the ★★★ rule.

- **task-manager decomposition map (Phase 3):** the orchestrator's cross-cutting clusters were
  extracted into **deps-object hook factories** (see "Extraction conventions") called
  unconditionally before the single return, plus plain builders (render helpers and one handler builder). The wiring lives in:
  `use-calendar-integrations.ts` (ALL Outlook push/pull/background-auto-sync for milestones +
  committee + task/raid/change/absence), `use-action-center-handlers.ts` (assign / mark-done /
  clear-blocker / reschedule / draft / escalate / rebaseline / create-task CTAs), `use-ai-orchestration.ts`
  (Analyze-with-AI + weight-suggestion context + scheduled-job runner),
  `use-insight-recommendations.ts` (entity resolution + the insight-recommendation confirm/replay
  path), `use-insight-lifecycle.ts` (the insight detection input + the detect → reconcile runner + the acknowledge / act / logged-as-RAID /
  dismiss handlers), `use-outlook-imports.ts` (the Outlook contacts and calendar import flows), `use-portfolio-projects.ts`
  (the multi-project handlers, the mode-aware project lists, the key-facts snapshot effect and the `useTursoProjects`
  composition), `use-next-actions.ts` (the workload alerts, the next-actions engine run, its grouping and the
  group-aware snooze), `use-task-editor-create.ts` (the task editor's create-RAID and new-linked-task wiring and
  the create-mode buffer they stage into), `use-resource-quick-create.ts` (creating a resource from the picker or the
  task editor's address-book button), `use-settings-navigation.ts` ("open settings" routed by layout: the modern
  deep-link request, the classic header popover), `use-settings-change-log.ts` (the debounced, actor-less
  `settings.updated` row and its §160 AI credits), `use-turso-project-list.ts` (the Turso portfolio's active and
  archived project lists, their load-once flag and `refreshTursoProjects`), `use-version-history-wiring.ts` (the Turso
  version-history capture payload, the restore fan-out that is the SECOND load funnel, and the `useVersionHistory` call),
  `use-reminder-banners.tsx` (the Birthday and Jira-token banners and the budget-bucket toast),
  `use-trend-snapshots.ts` (the trend-snapshot recording gate, the `useSnapshots` call, `actionTrends` and the render-scope
  `dashboardModel`; coverage-GATED, pinned by its own `renderHook` test, memos kept on purpose — its header says why),
  `use-template-actions.ts` (the project menu's Save-as-template and Apply-template actions),
  `use-chat-dispatcher-wiring.ts` (the `useChatDispatcher` call and its `getBudgetRollup` / `getAllocationsSnapshot` /
  `getDashboardModel` read-tool getters), `use-storage-banner-reshow.ts` (the render-time reconciles that re-show a dismissed
  saving-paused banner on a NEW cause),
  `workload-triage-handlers.ts` (`buildWorkloadTriageHandlers` — a plain builder, coverage-GATED and tested: the Resources
  workload reassign/reschedule and clear-unlinked handlers, the last with its destructive-save arming), `shell-chrome.tsx`
  (`buildShellChrome` — a plain builder, NOT a hook — assembles BOTH header mounts), `buildTaskEditorChrome` in
  `task-editor-actions.tsx` (a plain builder for the task editor footer slots), `buildAppModalsBlock` in
  `app-modals-block.tsx` (a plain builder for `modalsBlock`, the overlay layer every returned tree renders once; its
  deps keys are all required, so a dropped optional prop is a tsc error), `buildAppBanners` in `app-banners-block.tsx` (a
  plain builder for `bannersEl`, the banner stack above the workspace, with its popout gates), and
  `calendar-summary-modals.tsx` (the four two-way pull-summary modals). ★★ The first three hook files are
  RENDER-SCOPE UI GLUE and are EXCLUDED from the coverage gate (`vitest.config.ts` `coverage.exclude`,
  same class as `.tsx`) — extracting a `use*` factory from task-manager into a NEW `.ts` file makes its
  handlers coverage-GATED, so either exclude the new file or expect a function-coverage drop. ★ A THIRD option, and the better one when the hook holds real logic rather than glue: TEST it. `use-view-digest.ts` (0.216.0) is a deps-object hook that assembles the AI view digest from live pane state; it is coverage-GATED and stays above the floors on its own tests, so it is deliberately NOT in `coverage.exclude`. Exclude glue, not logic. ★★ The fourth, `use-insight-recommendations.ts`, is NOT excluded: it was until §275 (closed), but its confirm path filters replayed calls through `ALLOWED_REC_TOOLS`, a security boundary, and an excluded file hides even an uncovered guard. Its own `renderHook` test pins that filter. A fifth, `use-insight-lifecycle.ts` (§491), holds the insight detect →
  reconcile runner and the four lifecycle handlers; it is also coverage-GATED, with the runner driven through
  `TaskManager` by `task-manager.guardrail-reconcile.test.tsx` and the handlers pinned by its own `renderHook` test. A sixth,
  `use-outlook-imports.ts` (§491), holds the Outlook contacts and calendar import flows (modal state, fetch, error-key
  mapping, confirm); it is coverage-GATED and pinned by its own `renderHook` test. A seventh, `use-portfolio-projects.ts`
  (§491), holds the multi-project wiring (the delete's survivor switch, the mode-aware lists, the key-facts snapshot
  effect); it is coverage-GATED and pinned by its own `renderHook` test, and it keeps its inline `useCallback`/`useMemo`
  memoization ON PURPOSE, against convention 1 below (move-only; its header says why). An eighth, `use-next-actions.ts`
  (§491), holds the next-actions wiring (the engine input, the comms-pending ids, the group-aware snooze and its store);
  it is coverage-GATED, pinned by its own `renderHook` test, and keeps its memoization on purpose because `nextActions` feeds downstream memos and effects (its header says more). A ninth, `use-task-editor-create.ts` (§491), holds the task
  editor's create-from-editor wiring (the create-RAID apply and its `raid.created` log, the linked-task create, the
  create-mode buffer); it is coverage-GATED, pinned by its own `renderHook` test, and keeps its `useCallback`s on purpose
  because the buffer's `flush` depends on both applies and feeds `useTaskBudgetLink` (its header says more). A tenth,
  `use-resource-quick-create.ts` (§491), holds creating a resource from outside the Resources view (the picker's
  one-step create and its `resource.created` log, the task editor's add-to-address-book and its fill-once assignee
  write-back); it is coverage-GATED, pinned by its own `renderHook` test, and keeps its `useCallback`s on purpose because
  `handleCreateResource` is a dependency of two memos in `use-action-center-handlers.ts` (its header says more). An
  eleventh, `use-settings-navigation.ts` (§491), holds the "open settings" routing (the modern deep-link request and its
  monotonic nonce, the classic popover's open state and its render-time clear on leaving classic); it is coverage-GATED,
  pinned by its own `renderHook` test, and keeps its `useCallback`s on purpose because `clearSettingsSectionRequest` (handed out as
  `sectionProps.onSectionConsumed`) is in the dependency array of settings-view.tsx's request-consuming effect. ★ It returns
  three handlers and three ready prop bags (`workspaceNav`, `classicMenu`, `sectionProps`) that task-manager spreads, never
  the raw state (its header says more). ★ `workspaceNav` also carries the Projects panel's
  `projectFunctionsRequest` (bumped by `openProjectFunctions`, which opens Edit project on its Functions part) and
  `onProjectFunctionsRequestConsumed`: a null-seeded monotonic nonce the panel clears once it has acted — the
  remount-swallow shape. A twelfth,
  `use-settings-change-log.ts` (§491), holds the debounced `settings.updated` logger (the hydration and initial-run skips,
  the §160 AI-credit counter it clears rather than decrements, the unmount-only cancel); it is coverage-GATED, pinned by
  its own `renderHook` test, and has no memoization to keep. ★★ It is the one site handed the RAW, actor-less
  `logActivity` — `task-manager.activity-actor.test.tsx` pins that through the real component. A thirteenth,
  `use-turso-project-list.ts` (§491), holds the Turso portfolio's project lists (the active and archived lists, the
  `tursoListLoaded` flag that flips only on a successful fetch, `refreshTursoProjects` and its first-load effect); it is
  coverage-GATED, pinned by its own `renderHook` test, and keeps `refreshTursoProjects`'s `useCallback` on purpose because
  its first-load effect and the handlers in `use-portfolio-projects.ts` and `use-turso-projects.ts` depend on it (its header
  says more). A fourteenth, `use-version-history-wiring.ts` (§491), holds the version-history wiring (`getVersionPayload`,
  `applyRestoredWorkspace`, the error bridge into the storage banner, the `useVersionHistory` call and the `notifySaved`
  hand-off); it reads the workspace slices from `useWorkspace()` rather than taking 46 deps fields, is coverage-GATED,
  pinned by its own `renderHook` test, and keeps its three `useCallback`s on purpose (its header says why). A fifteenth,
  `use-reminder-banners.tsx` (§491), holds the two reminder banners with their snooze and dismiss state and the
  bucket toast keyed on the ending-bucket ids; it returns the banner fragment that `bannersEl` renders first. It is
  NOT coverage-gated — a `.tsx`, so `vitest.config.ts`'s `src/app/**/*.tsx` exclusion covers it — and is pinned by its
  own test plus `task-manager.reminder-banners-callsite.test.tsx`. A sixteenth, `use-template-actions.ts` (§491), holds
  the template list and the Save-as-template and Apply-template actions; it reads the workspace setters and the
  template snapshot builder from context, takes `features` as a dep rather than reading `useSettings` (a second
  instance syncs only after a commit), is coverage-GATED, pinned by its own `renderHook` test plus
  `task-manager.template-notice.test.tsx`, and keeps its two `useCallback`s move-only. ★ Apply APPENDS a template's
  seed (`applyTemplate` keeps every existing row) and sets its features; an earlier comment in task-manager said
  features were not applied. A seventeenth, `use-trend-snapshots.ts`
  (§491), holds the trend-snapshot recording gate, the `useSnapshots` call, `actionTrends` and the render-scope
  `dashboardModel`; it is coverage-GATED, pinned by its own `renderHook` test, and keeps its two memos on purpose. An eighteenth,
  `use-chat-dispatcher-wiring.ts` (§491), holds the assistant's tool dispatcher: the `useChatDispatcher` call and the
  two derived read-tool getters, which read their slices from `useWorkspace()`. It is coverage-GATED, pinned by its own
  `renderHook` test, and memoizes nothing — the getters are rebuilt every render on purpose, because the dispatcher
  reads each through a ref. ★ It forwards the dispatcher's args field by field, checked `satisfies ForwardedArgs`, so a NEW
  `ChatDispatcherArgs` field, optional or not, is a tsc error there until forwarded (its header says why). A nineteenth,
  `use-storage-banner-reshow.ts` (§491), holds the three render-time reconciles that clear a saving-paused banner's
  dismissal when a NEW cause arrives (the incomplete load, keyed on the truncation object and the decode and malformed
  nonces; the refused destructive save; the §586/§587 load pause), with their null/0 seeds. It is coverage-GATED, pinned by
  its own `renderHook` test plus `task-manager.truncation-banner.test.tsx`, and has nothing memoized. ★ The three
  `*BannerDismissed` flags stay in task-manager: `onRevealSavingPaused`, handed INTO `useStorageBackend`, sets two of
  them, and this hook's inputs are that hook's outputs, so it cannot own them. The
  task-manager→WorkspaceSection prop contract is pinned by `task-manager.characterization.test.tsx`.
