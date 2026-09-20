"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBroadcastSync } from "./broadcast-sync";
import { t } from "./i18n";
import {
  type StorageConfig,
  type Workspace,
  StorageNotImplementedError, StorageNotReadyError, createBackend,
  getBackendFileHandle, requestWriteAccessForBackend,
} from "./storage";
import { isWorkspaceEmpty, nonEmptyCollectionCount, workspaceRecordCount } from "./workspace";
import { scheduleDebouncedSave, SAVE_DEBOUNCE_MS } from "./debounced-save";
import { backfillTaskResourceFks } from "./resource-foundation";
import { recordDataLossEvent } from "./dataloss-forensics";
import { logDiag } from "./diagnostics";
import { seedMintFromWorkspace } from "./id-mint-session";
import { saveRegistry, type ProjectsRegistry } from "./projects-registry";
import { saveHandle } from "./project-file-handles";
import { getTursoConfig } from "./turso-config";
import { loadCurrentTursoProjectId } from "./portfolio-mode";
import { isTursoLockTimeout, tursoErrorKind } from "./storage-error";
import { mergeActivityLogs } from "./activity-log-merge";
import { mergeBudgetHistories } from "./budget-history";
import { storageTargetKey } from "./storage-target-key";
import { useMsAuth } from "./use-ms-auth";
import { useWorkspace } from "./workspace-context";
import { useTursoProjectOps } from "./use-storage-turso-ops";
import { useFileProjectOps, useStorageFilePickerOps } from "./use-storage-file-ops";
import { useLoadTruncation } from "./use-load-truncation";
import { useDestructiveSaveGuard } from "./use-destructive-save-guard";
import type { ToastAction } from "./use-toast";
import type { UseStorageBackendArgs } from "./use-storage-backend-types";

export type { UseStorageBackendArgs } from "./use-storage-backend-types";

export function useStorageBackend(args: UseStorageBackendArgs) {
  const {
    tasks, setTasks,
    raid, setRaid,
    absences, setAbsences,
    shifts, setShifts,
    resources, setResources,
    roles, setRoles,
    disciplines, setDisciplines,
    grades, setGrades,
    plan, setPlan,
    budgets, setBudgets,
    fxRates, setFxRates,
    status, setStatus,
    project, setProject,
    fieldVisibility, setFieldVisibility,
    features, setFeatures,
    milestones, setMilestones,
    changes, setChanges,
    stakeholders, setStakeholders,
    steeringCommittee, setSteeringCommittee,
    timelogLinks, setTimelogLinks,
    knowledgeItems, setKnowledgeItems,
    insights, setInsights, documents, setDocuments, documentVersions, setDocumentVersions, activityLog, setActivityLog,
    budgetHistory, setBudgetHistory,
    settingsOverrides, setSettingsOverrides,
    calendarEvents, setCalendarEvents, documentAssets, setDocumentAssets,
  } = useWorkspace();

  // Reactive refs — synced via useEffect so effects don't re-register on every render
  const langRef = useRef(args.lang);
  const settingsRef = useRef(args.settings);
  useEffect(() => { langRef.current = args.lang; }, [args.lang]);
  useEffect(() => { settingsRef.current = args.settings; }, [args.settings]);

  const m365Enabled = args.settings.integrations?.m365?.enabled ?? false;
  const auth = useMsAuth(m365Enabled);

  // Active Turso project id (portfolio mode). Seeded from the localStorage cache;
  // switching/creating a Turso project updates it, which rebuilds the backend memo
  // so load/save scope to the per-project (tenant-mode) TursoBackend.
  const [tursoProjectId, setTursoProjectId] = useState<string | null>(loadCurrentTursoProjectId());

  // ★★★ §548 — THE TURSO URL AND TOKEN FEED THE BACKEND ONLY WHEN THE STORAGE KIND IS TURSO.
  //   `createBackend` reads `tursoConfig` for kind "turso" alone, but these two used to sit in the
  //   memo deps for EVERY kind — so on file or SharePoint storage an edit to either Settings field
  //   built a new (identical) backend, which re-armed the load hold and unmounted the Settings view
  //   under the user's cursor. `undefined` for every other kind keeps the deps still.
  //   `storageTargetKey` already ignores both fields for a non-Turso kind, so key and backend agree.
  const isTursoStorage = args.settings.storageConfig.kind === "turso";
  const tursoUrlForBackend = isTursoStorage ? args.settings.integrations?.turso?.databaseUrl : undefined;
  const tursoTokenForBackend = isTursoStorage ? args.settings.integrations?.turso?.authToken : undefined;

  // Backend instance — memoised on storageConfig identity
  const backend = useMemo(() => {
    const tursoConfig = getTursoConfig(tursoUrlForBackend, tursoTokenForBackend);
    return createBackend(args.settings.storageConfig, {
      acquireToken: auth.acquireToken,
      tursoConfig,
      tursoProjectId,
    });
  }, [
    args.settings.storageConfig,
    auth.acquireToken,
    tursoUrlForBackend,
    tursoTokenForBackend,
    tursoProjectId,
  ]);

  // §588/§589 — the backend of the CURRENT render, readable by any caller that
  // resumes after an await. Assigned during render ON PURPOSE: React runs every
  // effect cleanup before any effect body, so a ref mirrored in an effect still
  // holds the OLD backend at the one moment the save effect's cleanup reads it.
  // ★★★ WHERE THIS WRITE IS PINNED, AND WHY THE OBVIOUS PLACE IS THE WRONG PLACE TO LOOK. Deleting
  //   the write does NOT turn §588's four RELOAD tests red, and that silence is misleading rather
  //   than informative: those guards are phrased `backendRef.current !== backend` — "am I
  //   superseded?" — and a permanently-null ref answers TRUE, i.e. "drop", which is the answer the
  //   guard owes in every scenario they set up. Read that file alone and you will conclude this line
  //   is untestable. It is not. The kill lives wherever a caller asks the OPPOSITE question:
  //   `isBackendCurrent` (`=== backend`) reads a null ref as FALSE, so the LIVE path breaks — and
  //   every `reloadCurrentProject` test breaks too, for the same reason from the other side (a reload
  //   that always drops never applies, never toasts, never reports).
  // ★★ MEASURED, and the breadth is the point: deleting this line turns tests red in
  //   `use-storage-backend.test.tsx` (its `reloadCurrentProject` tests, which lose their apply, their
  //   toast and their report, plus its picker ones), in `use-storage-backend.load-gate.test.tsx`, and in the §588
  //   probe, where the one that dies is "a rebuild during the write still leaves the live backend's
  //   gate open" — its `first.save` precondition stops being reachable once the PICKER guard drops
  //   the pick before the write. (Named, not numbered: the guards in `onPickStorageFile` carry
  //   `stage` labels, and this line said "guard 1" after the renumbering that removed them.) Same ref, same deletion, opposite observability, decided entirely by how each
  //   consumer phrases the comparison.
  // ★ NAMED, NOT COUNTED, ON PURPOSE: an earlier revision said "1 of §588's own 7" and the file
  //   already collected 9 by the time it was committed — stale inside its own round. Re-measure with
  //   `npx vitest run src/app/use-storage-backend.superseded-gate.test.tsx
  //   src/app/use-storage-backend.test.tsx src/app/use-storage-backend.load-gate.test.tsx` after
  //   deleting the write; do not restore a tally here.
  // ★★ SEEDED `null`, NOT `backend`, and the reason is FAIL-CLOSED. The write always runs before any
  //   consumer, so the seed is unobservable at runtime today; what it decides is which way the ref
  //   fails if that ever stops being true. `null` makes every superseded-check DROP, which is safe.
  //   Seeding it with `backend` would freeze the ref at the FIRST instance and tell stale callers
  //   they are still current — which is §588 itself, i.e. fail-OPEN. A seed picked to make the probe
  //   able to kill the mutant was briefly tried and reverted: it bought testability that the picker
  //   suites above already give for free, at the price of the wrong failure direction.
  // ★ A render React DISCARDS would also run this write. Not reachable today — `src/app` has no
  //   `startTransition`, `useTransition`, `useDeferredValue` or Suspense boundary, and this hook is
  //   called once — but that is a property of the app, not of this line, and it can stop being true
  //   without anything here changing. The consequence would be a ref pointing at a backend from a
  //   render that never committed.
  const backendRef = useRef<ReturnType<typeof createBackend> | null>(null);
  backendRef.current = backend;
  // §588 — "the backend THIS closure was built for is no longer the live one". Asked at every point
  // an op resumes after an await: `reloadCurrentProject` after its load resolves and again in its
  // catch, and (as `isBackendCurrent`, the NEGATION — the phrasing the mutation coverage rides on,
  // see above) `onPickStorageFile` after its picker, after it reads the chosen file, after each of
  // its two binds, and again after its write.
  // ★★ NO TALLY ON PURPOSE. This said "Four resumption points" and was already five when it was
  // written — §590's read guard was the one omitted. Re-derive rather than trust:
  //   grep -rnE "isSupersededBackend[(][)]|isBackendCurrent[(][)]" src/app --include=*.ts --include=*.tsx | grep -v "[.]test[.]"
  // ★ The brackets stop the pattern matching THIS comment; the plain spelling does not, which is how
  // a re-derivation quietly counts its own instructions. Read the hits anyway: one is
  // `isBackendCurrent`'s declaration in the deps object, not a resumption point.
  const isSupersededBackend = () => backendRef.current !== backend;

  // ★★★ §591 — WHICH STORAGE TARGET THE IN-SCOPE WORKSPACE BELONGS TO. `applyWorkspaceFromLoad`'s "merge"
  //   unions the loaded activity log and budget history with whatever is in memory, so it is right only
  //   when memory holds THIS target's project. A settings-driven rebuild (a Turso URL/token edit, a
  //   SharePoint target change) leaves the PREVIOUS target's project in scope, and merging it would
  //   carry that project's audit trail into this one. `targetKey` excludes `acquireToken` so that IF
  //   its identity ever changed (a rebuild against the same target), the load would keep merging.
  //   Today `useMsAuth`'s `acquireToken` is a stable `useCallback`, so an M365 sign-in/out does not
  //   rebuild the backend at all.
  // ★ The ref is stamped (1) on the load effect's first hydrated run (the boot workspace holds only
  //   this session's own appends), (2) wherever a load is APPLIED from the current target, and (3) on
  //   the suppress-branch re-stamp after a project op. It is deliberately NOT stamped by the empty-load
  //   refusal or a failed load: scope still holds the previous target there.
  // ★ `targetKey` contains the Turso auth token. Never log it.
  const targetKey = storageTargetKey({
    storageConfig: args.settings.storageConfig,
    tursoDatabaseUrl: tursoUrlForBackend,
    tursoAuthToken: tursoTokenForBackend,
    tursoProjectId,
  });
  const scopeTargetKeyRef = useRef<string | null>(null);
  // ★★★ §548 — THE SCOPE EPOCH. A monotonic counter whose ONLY meaning is: the workspace in scope has
  //   become a DIFFERENT PROJECT since you read this. A writer that awaits Graph or the AI captures it
  //   before its first await and DROPS its write when the value differs at resolution —
  //   `scope-epoch.ts` (`isScopeStale` / `dropStaleScopeWrite`) is the shared guard. `loadPending`
  //   cannot answer this: it is back to FALSE by the time a promise started before the swap resolves.
  // ★★★ THE PREDICATE IS NARROW ON PURPOSE, and the first cut got it wrong: it bumped on every
  //   false→true transition of `loadPending`, which also fires for a same-target reload, a held op the
  //   user CANCELLED at the OS file picker, and a settings-driven rebuild onto the same target. In
  //   each of those the project never changed, so an in-flight result that would have landed in the
  //   RIGHT project was dropped — and for the committee push that costs a permanent orphan plus a
  //   duplicate event (see `useCommitteeOutlookPush`). It now has exactly THREE bump sites — the
  //   same three `scope-epoch.ts`'s header enumerates, and the same three
  //   `grep -rn "bumpScopeEpoch()" src/app --include=*.ts --include=*.tsx | grep -v test` prints:
  //   (a) a load that REPLACES rather than merges — i.e. §591's own rule, decided once in
  //       `resolveLogModeAndStamp` below so there is no second copy of it;
  //   (b) an op that put ANOTHER project's data in scope — `applyWorkspaceForOp`, the wrapper the
  //       two project-op hooks receive as their `applyWorkspace` dep (the six switch/create/load
  //       ops); and
  //   (c) `onOpenStorageFile`'s accept branch, which replaces tasks+raid with another file's
  //       through raw setters and so reaches neither (a) nor (b).
  // ★★ (b) is NOT redundant with (a): `storageTargetKey` keys `browser` and every `local-*` kind on
  //   the KIND ALONE (§591 ruling 3), so a file-mode project switch does not move the key at all.
  // ★★ It is bumped SYNCHRONOUSLY, immediately BEFORE the replacement it announces, so there is no
  //   instant at which the new project's workspace is in scope while the epoch still reads old. A
  //   writer resolving between the bump and React's commit is dropped although scope still holds the
  //   OUTGOING project — the conservative direction, and that write would have been replaced anyway.
  // ★ A FAILED load and the empty-load refusal apply nothing and stamp nothing, so neither bumps:
  //   scope still holds the previous project, and a write landing there is still correct.
  const scopeEpochRef = useRef(0);
  const bumpScopeEpoch = () => { scopeEpochRef.current += 1; };
  // §591 — the one place the "merge onto the same target, else replace" ternary is decided, shared by
  // the load effect's applied branch and reloadCurrentProject (previously duplicated at both sites).
  // Reads the ref BEFORE stamping it to the CURRENT load's target — same order as the duplicated code.
  // ★ §548 clause (a) lives HERE rather than at the two call sites, so "replace" and "the scope epoch
  //   moved" cannot drift apart: a replace IS the in-scope workspace becoming another target's.
  const resolveLogModeAndStamp = (): "merge" | "replace" => {
    const logMode = scopeTargetKeyRef.current === targetKey ? "merge" : "replace";
    scopeTargetKeyRef.current = targetKey;
    if (logMode === "replace") bumpScopeEpoch();
    return logMode;
  };

  // ★★★ IDENTITY, NOT A LATCH (open-followups §77 — full rationale there).
  // Holds the BACKEND the applied workspace came from; the published boolean is
  // derived below. A boolean flag had to be RESET by whoever started the next
  // load and nobody did, so a mid-session switch left the gate open over the
  // PREVIOUS project's data. An inequality cannot be forgotten.
  // ★ Derived in RENDER: `react-hooks/set-state-in-effect` is fatal here.
  // ★ Typed, not `unknown`, so a `loadedBackend === someString` typo cannot compile.
  const [loadedBackend, setLoadedBackend] = useState<ReturnType<typeof createBackend> | null>(null);
  // ★ NOT `storageReady`, which is `backend.isReady()` and is set even on the
  // load-error path where render scope holds no workspace for this backend.
  // ★★ Invariant: render scope holds the workspace that BELONGS to this backend
  // — NOT the narrower "was loaded from it". `onRequestStorageSwitch` never
  // loads, yet scope holds the right data; wording it as "loaded" invites
  // someone to delete the suppress-path re-stamp below. §77 has the seven arm
  // sites and its reproduce grep.
  const workspaceLoaded = loadedBackend !== null && loadedBackend === backend;
  // ★★★ §548 — THE LOAD HOLD'S SIGNAL, and deliberately NOT `workspaceLoaded`. That gate stays shut
  //   after a FAILED load and on the empty-load refusal, which is right for snapshots and saving and
  //   wrong for editing: a hold keyed on it would lock the app for the session after one load error.
  //   This asks a narrower question — is a load still IN FLIGHT for the current backend? — so EVERY
  //   terminal branch of the load effect stamps it: applied, suppressed re-stamp, refused, failed.
  //   Identity, not a latch (§77): a rebuilt backend starts unsettled by construction.
  const [settledBackend, setSettledBackend] = useState<ReturnType<typeof createBackend> | null>(null);
  // ★★ §548 — project-swap ops in flight (see `holdDuring`): each awaits and THEN replaces the
  //   workspace, so an edit made during its await would be discarded exactly like one made during the
  //   first load.
  const [swapsInFlight, setSwapsInFlight] = useState(0);
  // ★★★ §596 — A NARROWER COUNT, NOT A MIRROR OF THE ONE ABOVE, AND THE DIFFERENCE IS THE POINT.
  //   ★★ THIS COMMENT SAID "THE SAME COUNT AS A REF" AND WAS TRUE WHEN WRITTEN — the B1 fix below
  //   then split the two and left the sentence standing. `setSwapsInFlight` counts ALL TEN held
  //   ops; this ref counts only the FOUR `holdDuring(..., "changes-scope")` rows. Do NOT "restore"
  //   the invariant by re-coupling them: that is precisely the B1 regression (a plain Save-As, a
  //   cancelled OS dialog and a same-project Reload silently killing a live AI turn), and the two
  //   counts answer different questions on purpose.
  //   ★★★ WHY A REF AT ALL, which is unchanged: a consumer that must answer "is a swap in flight?"
  //   from an UNMOUNT CLEANUP cannot read any mirror of the render value. React flushes every
  //   passive DESTROY before any passive CREATE, so an effect that copies `loadPending` into a ref
  //   has not run yet when the subtree the hold is unmounting tears down — the mirror still reads
  //   the pre-swap `false`. This ref is written SYNCHRONOUSLY inside `holdDuring`, beside its
  //   `setSwapsInFlight`, exactly as `scopeEpochRef` is written beside the replacement it
  //   announces, so it is already true at that instant.
  // ★★★ DELIBERATELY NARROWER THAN `loadPending`, AND THE FIRST REASON WRITTEN HERE WAS FALSE.
  //   It said `settledBackend !== backend` "needs Settings, which unmounts the chat panel on its
  //   own before the backend can change". It does not. `PanelSkeleton` in `task-manager.tsx` sits
  //   ABOVE the `settings.layout === "classic"` ternary, so CLASSIC unmounts the panel too; and a
  //   storage change committed from the CLASSIC HEADER MENU reaches `StorageConfigSection`'s plain
  //   `onChange` and never touches `onRequestStorageSwitch` (which is itself outside `holdDuring`).
  //   So `isSwapInFlight()` really can read false at a teardown the backend rebuild caused.
  // ★★★ WHAT THAT COSTS, stated as a residual rather than an absence: a turn in flight when the
  //   user swaps the Turso URL/token or SharePoint target from the classic header is NOT cancelled,
  //   its API call is not aborted and is still billed, and its tool write lands in the OUTGOING
  //   project's in-memory workspace — where the arriving load discards it. A LOST write, silently.
  // ★★ WHY THAT IS THE WHOLE RESIDUAL, which is the real argument the old one should have made.
  //   It cannot become a WRONG-SCOPE write, blocked twice over and independently: (1) the §586 save
  //   gate is IDENTITY-based and a rebuilt backend starts shut, so the debounced autosave is
  //   refused and nothing reaches the NEW target; (2) a replacing load bumps the epoch
  //   SYNCHRONOUSLY immediately before it applies, so there is no instant at which the new target's
  //   workspace is in scope while the epoch still reads old. `!hydrated` is pre-mount and has no
  //   turn to cancel at all.
  // ★★ UNCHANGED FROM `main`. The loss predates Task 6, which closed it only as a side effect of an
  //   unconditional cancel that broke ordinary navigation. Narrowing re-opens it behind a five-term
  //   conjunction to close the common case; that trade was made knowingly.
  // ★ Do NOT "fix" it by wrapping `onRequestStorageSwitch` in `holdDuring` — checked, and it does
  //   not cover the direct `onChange` rebuild, which is the reachable path. Any real fix has to
  //   reach the rebuild itself.
  const swapsInFlightRef = useRef(0);
  // ★★ TRUE before hydration (spec revision 2026-09-19): the first load has not even started, so it IS
  //   pending, and ONE signal covers every consumer (the render hold and each background-writer gate)
  //   through that window. The hold therefore relies on `hydrated` always becoming true — bounded in
  //   `useSettings` by `SECRET_MERGE_TIMEOUT_MS`.
  const loadPending = !args.hydrated || settledBackend !== backend || swapsInFlight > 0;
  // §548 — the scope epoch's reader. The counter (`scopeEpochRef`) and `bumpScopeEpoch` are declared
  // beside `scopeTargetKeyRef` above, but only ONE of the THREE bump sites is up there: (a) is inside
  // `resolveLogModeAndStamp`, (b) is `applyWorkspaceForOp` further down THIS file, and (c) is in
  // `use-storage-file-ops.ts` (`onOpenStorageFile`'s accept branch, through the required
  // `bumpScopeEpoch` dep). Re-derive rather than trust this sentence:
  // `grep -rn "bumpScopeEpoch()" src/app --include=*.ts --include=*.tsx | grep -v test`.
  // ★ STABLE for the hook's lifetime, so a consumer can mirror it into a
  // `[]`-dep ref or callback without re-subscribing anything. Deliberately NOT a render value:
  // publishing the number would re-render every consumer on each swap.
  const getScopeEpoch = useCallback(() => scopeEpochRef.current, []);
  // §596 — the swap-in-flight reader, published for the same reason and with the same contract as
  // `getScopeEpoch`: STABLE for the hook's lifetime, reads a synchronously-maintained ref, never a
  // render value.
  // ★★ WHAT IT SELECTS FOR, stated precisely because the first wording was "tell a §548 teardown
  //   from ordinary view navigation" and the B1 fix made that misleading. It does NOT select §548
  //   teardowns: SIX of the ten held ops raise the §548 hold and leave this FALSE. It answers the
  //   narrower question `chat-panel.tsx`'s unmount cleanup actually asks — "is the workspace about
  //   to become another project's?" — so a teardown caused by a Save-As, a cancelled dialog or a
  //   same-project reload reads false and the in-flight AI turn is left alone. Reading the old
  //   wording as a spec is how the flag gets widened back to the B1 regression.
  const isSwapInFlight = useCallback(() => swapsInFlightRef.current > 0, []);
  // ★★★ §586 — THE SAVE GATE: the backend instance render scope may be written to. Before it opens,
  //   the boot workspace is EMPTY, and a save of it is `DELETE FROM` every Turso table, an empty
  //   SharePoint PUT, an overwritten file. The AUTOMATIC writes of the live workspace to the ACTIVE
  //   backend check it: the save effect (no schedule), `doSave` — reached by the debounce timer, by
  //   the flush-on-hide, and since §589 by the cleanup flush a backend rebuild triggers, all three
  //   through the ONE `save` argument `scheduleDebouncedSave` takes — and the pre-switch
  //   `flushCurrent`; a storage-KIND switch
  //   skips its conversion write while it is shut (`loadSucceeded` below). ★ EXPLICIT writes do not:
  //   "Pick storage file" (`guardedWrite`, open follow-up §590), a conversion after a successful load,
  //   create and load-from-file. Identity, like `loadedBackend`, so a rebuilt
  //   backend starts shut and a failed load never opens it.
  //   ★★ That covers a settings-driven REBUILD too (§587): a committed Turso URL/token edit (on Turso storage) or a SharePoint
  //   target change builds a new instance with the PREVIOUS target's workspace still in scope.
  // ★★★ IT OPENS IN EXACTLY THREE PLACES, and only one of them is "a load of THIS instance":
  //   1. `applyWorkspaceFromLoad` — the load effect's applied load, `reloadCurrentProject`, and (through
  //      `applyWorkspaceForOp`) the switch / create / load-from-file ops (those stamp the render-scope,
  //      i.e. OUTGOING, instance);
  //   2. the load effect's suppress-branch RE-STAMP after such an op — the op loaded a SIBLING instance
  //      of the same target, built a fresh workspace, or (a kind conversion) wrote the live one there;
  //      the memo's own instance is never loaded;
  //   3. an explicit "Pick storage file" write — the backend then holds exactly what is in memory.
  //   So it is `workspaceLoaded` plus (3). It stays SHUT after a failed load and after the empty-load
  //   REFUSAL below. ★★★ The refusal is deliberate: it is reachable only when the load effect STARTED
  //   over populated scope (its `currentWorkspace` is that render's closure), i.e. a REBUILD onto an
  //   empty target, and opening there would copy the previous project into it (§587). Both states are
  //   published as `loadPause`, which task-manager mounts on the sticky saving-paused banner.
  // ★ The REF is what `doSave`/`flushCurrent`/`loadSucceeded` read — they run after this render,
  //   possibly much later; the STATE is a save-effect dep so the effect re-runs when the gate opens.
  const [savesAllowedFor, setSavesAllowedFor] = useState<ReturnType<typeof createBackend> | null>(null);
  const savesAllowedForRef = useRef<ReturnType<typeof createBackend> | null>(null);
  const savesAllowed = savesAllowedFor !== null && savesAllowedFor === backend;
  // ★ A `const`, not a `function` declaration: `use-load-truncation.test.ts` keys each `.save(` on the
  // nearest preceding DECLARATION, and one here would rename the `flushCurrent` write's key below.
  const allowSavesTo = (target: ReturnType<typeof createBackend>): void => {
    savesAllowedForRef.current = target;
    setSavesAllowedFor(target);
  };
  // Why saving to an instance is paused: its load FAILED, or it came back EMPTY over a populated
  // project and was refused. STATE, not a ref, because the banner must stay up for as long as the
  // pause holds — a toast alone disappears after seven seconds (review I1). Published only while the
  // gate for the CURRENT instance is shut, so any opener above clears it by construction.
  const [savesPaused, setSavesPaused] = useState<{ backend: ReturnType<typeof createBackend>; reason: "load-failed" | "empty-refused" } | null>(null);
  const loadPause = savesPaused !== null && savesPaused.backend === backend && !savesAllowed ? savesPaused.reason : null;
  // The instance the save-paused toast was already shown for — once per backend, not per refused edit.
  const savePausedAnnouncedForRef = useRef<ReturnType<typeof createBackend> | null>(null);

  // Storage status
  const [storageReady, setStorageReady] = useState(false);
  const [storageDescription, setStorageDescription] = useState<string | null>(null);

  // Suppresses the save effect that fires immediately after a load
  const suppressNextSaveRef = useRef(false);
  // Suppresses the load effect that fires after onRequestStorageSwitch sets new config
  const suppressNextLoadRef = useRef(false);
  // M4: projects whose unsafe-email notice this session already showed (see `FileProjectOpsDeps`).
  const announcedUnsafeEmailsRef = useRef<Set<string>>(new Set());
  // Guards reloadCurrentProject against re-entrant clicks (redundant round-trips)
  const reloadInFlightRef = useRef(false);
  // ★★ The DESTRUCTIVE lockout. Its peer is `useLoadTruncation` directly below;
  // the two cannot be active at once (see that hook's header for why).
  const destructive = useDestructiveSaveGuard();
  const allowDestructiveSave = destructive.allowDestructiveSave;
  // ★★★ THE COUNTS ACTUALLY ON DISK — as of the last COMMITTED save, or the last
  // load/apply the suppress branch folded in. `syncBaselines` advances the guard
  // BEFORE the debounced write, so a REJECTED write would otherwise leave the
  // destroyed counts standing as "last committed". The `.catch` restores THIS.
  const committedBaselineRef = useRef({ collections: 0, records: 0 });
  // ★★ §103 — the STICKY sibling of suppressNextSaveRef above (one-shot, so it cannot protect a truncated load). See use-load-truncation.ts.
  const { truncation, decodeFailureCount, decodeFailureNonce, malformedQuoteCount, malformedQuotesNonce, loadWasIncomplete, allowIncompleteSave, mayCommitAfterIncompleteLoad, truncationOps } = useLoadTruncation(langRef, emitToast, async () => { if (savesAllowedForRef.current === backend) await backend.save(currentWorkspace()); else logDiag("warn", "storage.flushSkippedBeforeLoad", {}); }); // ★ `emitToast`/`currentWorkspace` are hoisted function declarations; the closure is rebuilt every render, so it always writes the LIVE workspace to the CURRENT backend. ★★★ §586: this is `flushCurrent`'s write (the pre-switch flush), so it obeys the save gate too — a switch away from a project whose load failed must not write the empty workspace over it. A skip, not a throw: the flush is best-effort.

  // ── §72: caller-callback teardown guard ─────────────────────────────────────
  // Every callback this hook fires back into the component drives React state up
  // there — and `onStorageOutcome` does more besides, arming the version-history
  // idle checkpoint via `versionNotifyRef`. Suppressing it after unmount skips
  // that too, which is inert only because the whole tree goes down together.
  // Several of them run after an `await`, from promises nobody waits for
  // (the debounced save is fire-and-forget by design). If the component has
  // unmounted by then, React 19 schedules an update, `resolveUpdatePriority`
  // reads `window`, and in a torn-down jsdom that throws — an unhandled
  // rejection that makes vitest exit 1 with the whole suite green
  // (docs/open-followups.md §72).
  //
  // ★★★ This is a MOUNTED ref, NOT the load effect's per-run `cancelled` flag,
  //     and the two are easy to confuse. The save effect's deps include the whole
  //     workspace, so it re-runs on every edit. A per-run flag would suppress the
  //     outcome of a save that was merely SUPERSEDED while still in flight, which
  //     silently swallows real save errors in production. The load effect keeps
  //     its `cancelled` — a superseded load genuinely is irrelevant, a superseded
  //     save is not. Pinned by "does not report a save outcome after unmount"
  //     + "still reports the outcome of a save superseded while in flight" in
  //     use-storage-backend.test.tsx. ★ Grepping `§72` there finds FOUR blocks,
  //     not those two — the other two pin the status-failure path and the
  //     StrictMode mount re-set. Name the test, not the register number.
  const mountedRef = useRef(true);
  useEffect(() => {
    // Re-set on mount, not just cleared on unmount: React StrictMode mounts,
    // unmounts and remounts in development, and a cleanup-only guard would
    // leave every callback permanently suppressed after that first cycle.
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  function emitOutcome(err: unknown | null): void {
    if (!mountedRef.current) return;
    args.onStorageOutcome?.(err);
  }
  function emitToast(kind: "info" | "error" | "success", text: string): void {
    if (!mountedRef.current) return;
    args.showToast(kind, text);
  }
  // ★★ A HELPER, not an inline `args.showToastAction(...)` at the call site.
  // `react-hooks/set-state-in-effect` is BANNED and fatal under
  // `--max-warnings=0`, and the rule is SYNTACTIC — a setState-bearing call
  // reached through this indirection is legal inside the save effect where a
  // bare one is not. That is exactly why `emitToast` above exists at this site.
  function emitToastAction(kind: "info" | "error" | "success", text: string, action: ToastAction): void {
    if (!mountedRef.current) return;
    args.showToastAction(kind, text, action);
  }
  function emitRegistryChange(registry: ProjectsRegistry): void {
    if (!mountedRef.current) return;
    args.onRegistryChange?.(registry);
  }
  function emitStorageConfig(config: StorageConfig): void {
    if (!mountedRef.current) return;
    args.setStorageConfig(config);
  }

  // Fan a loaded workspace into every setter. Shared by the load effect and the
  // project switch / create / load-from-file flows so they apply data the same
  // way. No side-effects beyond the setState calls.
  // ★★★ `logMode` DEFAULTS TO "replace": the CONTAMINATING direction must be asked for EXPLICITLY. A
  // caller that forgets it loses at worst an in-flight local append (bounded, same-project); the other
  // default loses another project's audit trail into this one, unrecoverably once saved.
  // ★ SEPARATE from `seedMode` because the initial load is "reset" + "merge" — one flag cannot carry
  // both ("different id space?" vs "same project I already hold state for?"). See the branch below.
  // ★★★ §548 — NAMED `…FromLoad` ON PURPOSE (round 2, N3). This is the RAW apply, and it does NOT
  //   bump the scope epoch: its two legitimate callers (the load effect's applied branch and
  //   `reloadCurrentProject`) decide by `resolveLogModeAndStamp`, which bumps only on "replace".
  //   Anything that replaces the workspace with ANOTHER PROJECT's must go through
  //   `applyWorkspaceForOp` below instead. The old bare name made the wrong one the obvious one.
  const applyWorkspaceFromLoad = (workspace: Workspace, seedMode: "reset" | "raise" = "reset", logMode: "merge" | "replace" = "replace") => {
    // ★★★ NO MIGRATION HAS EVER BACK-FILLED `Task.resourceId` FOR A REAL
    // PROJECT, on any backend. Two near-misses make it look otherwise and both
    // were written into an earlier version of this comment before being
    // checked: `migrateWorkspaceV9` back-fills Absence / RaidItem / Shift and
    // never touches tasks, and `migrateWorkspaceV5` does stamp task FKs but only
    // inside `if (resources.length === 0)` (`workspace.ts:240`) — the legacy
    // case where the directory is BUILT from the assignee strings. A project
    // that already has a directory falls straight through both.
    // ★ So this is not "the backends the chain misses" (it misses CSV, Markdown
    // and the Turso relational tables, while IndexedDB reaches it directly via
    // `browser-backend.ts:292` and Turso's legacy-blob fallback reaches it via
    // `jsonToWorkspace`) — the gap is the FIELD, everywhere. Which is why this
    // belongs at the one function every backend converges on rather than in the
    // versioned chain. Idempotent and reference-preserving: a workspace needing
    // nothing keeps its array identity.
    setTasks(backfillTaskResourceFks(workspace.resources ?? [], workspace.tasks ?? []));
    setRaid(workspace.raid ?? []); setAbsences(workspace.absences ?? []); setShifts(workspace.shifts ?? []);
    setResources(workspace.resources ?? []); setRoles(workspace.roles ?? []); setDisciplines(workspace.disciplines ?? []); setGrades(workspace.grades ?? []);
    if (workspace.plan) setPlan(workspace.plan);
    setBudgets(workspace.budgets ?? []); setFxRates(workspace.fxRates ?? null); setStatus(workspace.status ?? {});
    setProject(workspace.project); setFieldVisibility(workspace.fieldVisibility); setFeatures(workspace.features);
    setMilestones(workspace.milestones ?? []); setChanges(workspace.changes ?? []); setStakeholders(workspace.stakeholders ?? []);
    setSteeringCommittee(workspace.steeringCommittee);
    setTimelogLinks(workspace.timelogLinks);
    setKnowledgeItems(workspace.knowledgeItems);
    setInsights(workspace.insights); setDocuments(workspace.documents ?? []); setDocumentVersions(workspace.documentVersions ?? []);
    // ★★★ TWO BRANCHES, unlike the always-replace `documents` neighbours above — a later reader WILL try
    // to make it consistent with them. Do NOT, in either direction. MERGE (same-project load/reload): the
    // log is append-only, so replacing drops entries appended locally while the load was in flight;
    // `mergeActivityLogs` unions by id, sorts by timestamp, caps to the newest. REPLACE (switch/create/
    // load-from-file): `prev` is the OUTGOING project's log, so merging carries its entries — including
    // `changes` payloads holding its old/new field values — into the target project, unrecoverably.
    setActivityLog((prev) => (logMode === "merge" ? mergeActivityLogs(prev, workspace.activityLog) : (workspace.activityLog ?? [])));
    // Same two branches for the budget history, but merged by id in stored order and NEVER capped.
    setBudgetHistory((prev) => (logMode === "merge" ? mergeBudgetHistories(prev, workspace.budgetHistory) : (workspace.budgetHistory ?? [])));
    setSettingsOverrides(workspace.settingsOverrides);
    setCalendarEvents(workspace.calendarEvents); setDocumentAssets(workspace.documentAssets);
    // Seed the session id-minter's high-water from the loaded set so the next
    // mint after a delete can never reuse a just-freed id. RESET (default) for a
    // possibly-DIFFERENT loaded workspace — initial load / project switch /
    // create / load-from-file (file + Turso ops), each owning its own id space.
    // reloadCurrentProject passes "raise" so a SAME-project refresh reflecting a
    // locally-deleted max-id row never LOWERS the mark (which would free that id).
    // Side-effecting (mutates module state) — safe here inside the load callback,
    // never a render body.
    seedMintFromWorkspace(workspace, seedMode);
    // Records WHICH backend this workspace came from; the published
    // `workspaceLoaded` above is derived from it. Snapshot capture gates on
    // that: it is the ONLY thing separating a KPI capture from the boot race
    // against this very load (see useSnapshots `workspaceReady`).
    // ★★ Set LAST. Today no consumer can observe it true beside an empty slice
    // whatever the position, because React auto-batches this whole callback into
    // ONE commit — so under the CURRENT code no test can distinguish last from
    // first, and one claiming to would be vacuous.
    // ★★★ Position becomes load-bearing the moment anything above stops being
    // batched, and LAST is the safe end in both such cases. A `flushSync` above
    // commits the setters queued so far with this flag still FALSE — a partial
    // workspace behind a CLOSED gate, which is exactly right. A throw between
    // setters likewise leaves the gate shut. Put this call first and both
    // reverse: the gate opens over a half-applied workspace and snapshot
    // capture writes a null-KPI row that permanently claims its bucket.
    // ★ An earlier revision of this comment asserted the opposite (that a
    // flushSync would defeat the ordering) and invited the first-line move.
    setLoadedBackend(backend);
    setSettledBackend(backend); // §548 — see `settledBackend`; beside the stamp, and late for the same reason.
    allowSavesTo(backend); // §586 — beside the stamp, and LAST for the same reason.
  };

  // ★★★ §548 clause (b) — THE ONLY `applyWorkspace` THE PROJECT OPS SEE. Every call the two op hooks
  //   make (`switchToProject` · `createProject` · `loadProjectFromFile` · `createDemoProject` ·
  //   `switchToTursoProject` · `createTursoProject`) puts ANOTHER project's data in scope, so the bump
  //   belongs at the boundary rather than at those six sites, where it could be forgotten by the next
  //   op. `migrateCurrentProjectToTurso` never calls it — the project is the same, only the backend
  //   moves — and so never bumps, which is correct. ★ An op that REJECTS or is cancelled never reaches
  //   its `applyWorkspace`, so it never bumps either: that is the whole point of the narrow predicate.
  // ★ `applyWorkspaceFromLoad` above stays the load effect's and `reloadCurrentProject`'s, which decide
  //   by `resolveLogModeAndStamp` (clause (a)) instead — its name says so, so this wrapper cannot be
  //   bypassed by reaching for the obvious one.
  const applyWorkspaceForOp = (workspace: Workspace) => { bumpScopeEpoch(); applyWorkspaceFromLoad(workspace); };

  // ★★★ Every setter here is guarded by `mountedRef` — three guards covering
  //     four setters. These are the last §72 setters in this hook that can
  //     escape as an UNHANDLED REJECTION rather than a merely discarded update;
  //     `applyWorkspaceFromLoad`'s 31 setters and `onOpenStorageFile`'s raw ones are
  //     still unguarded, deliberately, because every one of them sits inside a
  //     `try` whose `catch` calls only guarded emitters. Three of the eight
  //     call sites await this function outside any `try`: the load effect's
  //     suppress branch and the last statement of its `catch`, plus the bare
  //     await in `onGrantWriteAccess`. Unguarded, a post-teardown
  //     `setStorageReady` throws, the `catch` below then runs its own
  //     `setStorageReady(false)` — inside the catch, outside any `try` — and
  //     THAT second throw leaves the function and rejects a floating promise.
  //     Mounted-scoped is unambiguously right here (unlike the save outcome):
  //     this is the hook's OWN state, so there is no superseded-run result a
  //     caller still needs. `logDiag` stays OUTSIDE the guard so a teardown-time
  //     status failure is still recorded.
  //     ★ That "31" is the likeliest claim here to rot — it has already read 25, 28,
  //     then 29. Re-derive with the sed commands in `docs/AGENTS/activity-log.md`, NOT in
  //     AGENTS.md. Anchor the START on a LINE-INITIAL two-space `const applyWorkspaceFromLoad`,
  //     spelled short HERE so it cannot match itself. Bare, sed RE-TRIGGERS at every later mention (717 printed lines, 35) — and since the §548 round-2 rename it DOES also start earlier, at the first comment mentioning the name. Re-measure both; do not quote these.
  const refreshBackendStatus = async () => {
    try {
      const ready = await backend.isReady();
      if (!mountedRef.current) return;
      setStorageReady(ready);
      const desc = backend.describe ? await backend.describe() : null;
      if (!mountedRef.current) return;
      setStorageDescription(desc ?? null);
    } catch (err) {
      // A thrown status check is distinct from a clean "not ready" (false) — log
      // it so diagnostics can tell an exception apart from a normal negative.
      logDiag("warn", "storage.statusCheckFailed", { message: err instanceof Error ? err.message : String(err) });
      if (!mountedRef.current) return;
      setStorageReady(false);
      setStorageDescription(null);
    }
  };

  useEffect(() => {
    if (!args.hydrated) return;
    // §591 — the boot workspace holds nothing but this session's own appends for the target being loaded.
    if (scopeTargetKeyRef.current === null) scopeTargetKeyRef.current = targetKey;
    let cancelled = false;
    (async () => {
      if (suppressNextLoadRef.current) {
        suppressNextLoadRef.current = false;
        // ★★★ REQUIRED re-stamp (open-followups §77 — seven arm sites, the
        // reproduce grep and the full argument live there). Every op that arms
        // this ref already put the right workspace in render scope, but does so
        // BEFORE flipping `storageConfig`/`tursoProjectId`; `applyWorkspaceFromLoad` is
        // a plain render-scope function, so it stamped the PREVIOUS backend and
        // the derived gate reads false. Without this the gate strands CLOSED for
        // the session, silently disabling snapshot capture.
        // ★★ The load effect's OTHER two early-returns — the empty-load
        // data-loss guard and the `catch` — deliberately do NOT re-stamp. A cold
        // review read that as a regression; it is not, and §77 says why. Do not
        // "fix" it by re-stamping there.
        setLoadedBackend(backend);
        setSettledBackend(backend); // §548 — nothing is in flight: the op already put this target in scope.
        allowSavesTo(backend); // §586 — the op already loaded or built what scope holds.
        scopeTargetKeyRef.current = targetKey; // §591 — and that workspace belongs to THIS target.
        await refreshBackendStatus();
        return;
      }
      try {
        const workspace = await backend.load();
        if (cancelled) return;
        // ★ DATA-LOSS GUARD (mirrors reloadCurrentProject): never replace a
        // POPULATED in-memory workspace with an EMPTY load. A load returning
        // empty over non-empty state is a transient/edge read (Layer 1 already
        // throws on a malformed/partial read) — applying it wipes the project and
        // autosave then persists the empty. On initial mount the current
        // workspace is empty, so a normal first load is never blocked.
        if (isWorkspaceEmpty(workspace) && !isWorkspaceEmpty(currentWorkspace())) {
          recordDataLossEvent({ path: "load", prevCollections: nonEmptyCollectionCount(currentWorkspace()), nextCollections: 0, refused: true });
          setSettledBackend(backend); // §548 — nothing applied, but nothing is still in flight either.
          emitToast("info", t(langRef.current, "storageKeptCurrentData"));
          setSavesPaused({ backend, reason: "empty-refused" }); // ★★★ §587: the save gate stays SHUT — opening it here copied the previous project into this (empty) target. See `savesAllowedFor`; the save effect announces the pause.
          truncationOps.raiseDecodeFailuresFor(backend); // ★★ Since §587 this refusal also leaves the save gate SHUT for THIS backend, but a later load that lands reopens it, so the flag is still published: a decode failure is a fact about its stored bytes, not about the workspace that stayed live — so the decode half is published while truncation's is not. AFTER the toast above: single-slot surface, see the landmine on `reportFor`. Raise-only; the doc on `raiseDecodeFailuresFor` carries why lowering here would clear a warning that is still true.
          await refreshBackendStatus();
          emitOutcome(null);
          return;
        }
        // §591 — "merge" (keep appends made while this load was in flight) ONLY onto the same target;
        // after a rebuild onto another target, scope holds the previous project, so REPLACE.
        applyWorkspaceFromLoad(workspace, "reset", resolveLogModeAndStamp());
        logDiag("info", "storage.loaded", { records: workspaceRecordCount(workspace) });
        truncationOps.reportFor(backend); // ★ after applyWorkspaceFromLoad only: the empty-load REFUSAL above applies nothing, so neither raising nor lowering the TRUNCATION flag would describe the workspace that is actually live. ★★ That reasoning is TRUNCATION-specific and does NOT extend to the decode cause — the refusal path publishes that one itself, just above.
        suppressNextSaveRef.current = true;
        await refreshBackendStatus();
        emitOutcome(null);
      } catch (err) {
        if (cancelled) return;
        setSettledBackend(backend); // §548 — a FAILED load leaves nothing in flight to overwrite an edit. (`cancelled` above covers teardown.)
        setSavesPaused({ backend, reason: "load-failed" }); // §586: saves stay refused; published as `loadPause` (sticky banner), and the first refused edit toasts once.
        emitOutcome(err);
        logDiag("error", "storage.loadFailed", { kind: settingsRef.current.storageConfig.kind, message: String(err) });
        // Turso connectivity/auth failures surface as the persistent storage
        // banner (via onStorageOutcome) — skip the transient toast for those.
        if (err instanceof StorageNotReadyError) {
          if (settingsRef.current.storageConfig.kind !== "browser" && !tursoErrorKind(err)) {
            const hint = (err as StorageNotReadyError).hint;
            const key =
              hint === "local-file-permission-needed"
                ? "storagePermissionGestureNeeded"
                : hint === "storage-unreachable"
                  ? "storageUnreachable"
                  : "storageNotReady";
            emitToast("error", t(langRef.current, key));
          }
        } else if (!(err instanceof StorageNotImplementedError) && !tursoErrorKind(err)) {
          emitToast("error", t(langRef.current, "storageLoadFailed", String(err)));
        }
        await refreshBackendStatus();
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, args.hydrated]);

  // Save workspace to backend on change (debounced 500ms)
  useEffect(() => {
    // ★★★ §294 — READ THE ONE-SHOT ONCE, HERE, AND CLEAR IT. Every path below
    // therefore spends the arm BY CONSTRUCTION, and the reader's question at a
    // new early return becomes "does this path USE `armed`", which cannot be
    // skipped. Spending it used to be decided by hand at each return: two
    // returns decided it and three left it by accident, and nothing checked
    // either.
    // ★★★ THIS IS A REFACTOR, NOT A FIX — it changes no behaviour on any
    // currently reachable path, and no test can tell the two arrangements
    // apart. The truncation and suppress returns already spent the arm; the
    // refusal branch has nothing to spend (`evaluateSaveGuard` refuses only
    // when `!allowDestructive`, so reaching it implies the arm was false);
    // nothing arms before hydration; a popout returns above the guard. The
    // value is prospective: a return added below this line cannot leak.
    // ★★ TOPMOST IS THE ONLY PLACEMENT WORTH HAVING. `allowDestructiveRef` is
    // read by nothing outside `use-destructive-save-guard.ts` — the other save
    // paths (`guardedWrite`, `flushCurrent` in use-load-truncation.ts) never
    // consult it — so an arm can only ever be consumed HERE. Anywhere lower
    // leaves the returns above it as exactly the hand-decided cases §294 is
    // about.
    const armed = destructive.consumeArm();
    if (!args.hydrated) return;
    // Single-writer rule: the main window owns persistence. ★★★ A popout does
    // NOT save and does NOT forward edits — `canSend = !args.isPopout` below
    // disables every outbound broadcast, so an edit escaping the read-only
    // guards stays popout-LOCAL — the activity log INCLUDED now that it is a
    // workspace slice (it used to escape via `use-activity-log`'s own
    // localStorage write, which had no isPopout check — §91; that writer is
    // gone). `canSend` is the authority, not this prose: two earlier versions of it were wrong in
    // opposite directions and both reached a commit message. Saving from both
    // windows would also race, and popup storage is often blocked
    // ("AbortError: Aborted due to security policy") — skipping fixes both.
    if (args.isPopout) return;
    // ★★★ §586 — NO SAVE BEFORE A LOAD FOR THIS BACKEND SUCCEEDED. Scope still holds the empty boot
    //   workspace (or the PREVIOUS backend's, after a rebuild), and `evaluateSaveGuard` cannot see it:
    //   its baselines start at 0/0. ★★ ABOVE the suppress branch, so an op's one-shot survives until
    //   the gate opens and is spent THEN — below it, the op's suppress would be spent on this closed
    //   run and the re-run the gate's opening triggers (`savesAllowed` is a dep) would re-write the
    //   workspace the op had just loaded.
    if (!savesAllowed) {
      if (loadPause !== null && savePausedAnnouncedForRef.current !== backend) {
        savePausedAnnouncedForRef.current = backend;
        // ★ The SAME shape as the destructive refusal's toast: it names the pause and its action
        // re-shows the sticky banner (the toast itself times out; the banner is the lasting surface).
        emitToastAction("error", t(langRef.current, loadPause === "empty-refused" ? "storageSavePausedEmptyLoad" : "storageSavePausedLoadFailed"), {
          labelKey: "storageSavingPausedAction",
          run: () => args.onRevealSavingPaused(),
        });
      }
      return;
    }
    // ★ ONE object: counted by the guard below AND handed to backend.save. The save used to
    //   re-spell this 28-field literal, so a new Workspace field could be counted here and
    //   never written. ★★ The `: Workspace` annotation (not `as`) only catches a missing
    //   REQUIRED field, and only 9 of the 28 are required — new slices add OPTIONAL ones.
    //   Measured: dropping `activityLog` from this literal keeps tsc GREEN. The single
    //   spelling, NOT tsc, is what protects this; do not re-inline the literal at the save.
    const outgoing: Workspace = { tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status, project, fieldVisibility, features, milestones, changes, stakeholders, steeringCommittee, timelogLinks, knowledgeItems, insights, documents, documentVersions, settingsOverrides, calendarEvents, documentAssets, activityLog, budgetHistory };
    const curCollections = nonEmptyCollectionCount(outgoing);
    const curRecords = workspaceRecordCount(outgoing);
    if (suppressNextSaveRef.current) {
      suppressNextSaveRef.current = false;
      destructive.syncBaselines(curCollections, curRecords); // sync baselines on a load/apply
      // ★★ …and re-point the rejection rollback: without this a save rejecting
      //   after a project SWITCH restores the previous project's counts onto the
      //   new one, and if smaller a genuine wipe of it then passes unrefused.
      committedBaselineRef.current = { collections: curCollections, records: curRecords };
      // ★★★ AND DROP ANY STANDING REFUSAL — a refusal is scoped to the workspace that
      //   raised it. The baselines it was measured against were just replaced one line up,
      //   so it now quotes magnitudes ("847 of 900 records") belonging to a project that is
      //   no longer on screen. Left standing it survives a reload, a project switch, an
      //   opened file and a BRAND-NEW project: the banner claims saving is paused on the new
      //   project while it is not, the sidebar reports the new project as not-ready
      //   (`storageReady` folds in `destructiveRefusal`), and a genuine mass deletion on the
      //   new project is then refused SILENTLY — `refusalWasStanding` below suppresses the
      //   announcement, so the user gets the stale counts instead of theirs and the only
      //   exit they are offered authorises whatever is pending under a banner that describes
      //   something else.
      // ★★★ ONE SITE COVERS ALL LOAD/SWITCH/CREATE PATHS, which is why there is no
      //   per-path obligation to add. `suppressNextSaveRef` is set by every one of them, and
      //   this branch is INSIDE the save effect, so clearing here dominates the lot and a
      //   tenth path cannot forget it. Enumerate them — ★★ the bracket class is LOAD-BEARING:
      //   spelled plainly the pattern matches THIS comment line and its sibling below, and a
      //   recipe that counts its own documentation reads as verified forever (§596 found this
      //   one and the one below doing exactly that, the fourth self-confirming check on this
      //   branch). Re-run it after the prose around it is final, never before:
      //     grep -rn "suppressNextSave[R]ef.current = true" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."
      //   It printed 10 hits across 3 files on 2026-09-20 — 6 in `use-storage-file-ops.ts`,
      //   2 in `use-storage-turso-ops.ts`, 2 here. Read the hits, not the number.
      // ★★ DO NOT "complete the pattern" by copying the PEER lockout's shape — the
      //   asymmetry is real, not an oversight. `use-load-truncation.ts` exposes
      //   `clearForFreshWorkspace` and needs THREE explicit call sites (two in
      //   `use-storage-file-ops.ts`, one in `use-storage-turso-ops.ts`) because its state is
      //   raised by load-REPORTING, outside this effect, which therefore cannot clear it.
      //   Ours is raised and cleared in the same effect. Adding call sites beside those
      //   three would be redundant writes, and a fourth path would still be uncovered.
      // ★★ CLEARING RE-RUNS THIS EFFECT (`destructive.refusal` is a dep, deliberately —
      //   see the deps note), so when a refusal WAS standing the suppressed load is followed
      //   by one ordinary save of the freshly-loaded workspace against the freshly-synced
      //   baselines. That is a redundant write, not a guard bypass: the re-run consumes any
      //   arm at the top and evaluates the loaded counts against themselves. A test asserting
      //   "no save after a suppressed load" is only true when no refusal was standing.
      destructive.clearRefusal();
      // ★★★ SPEND the bypass here too — but NOT for the incomplete-load return's reason,
      //   which an earlier revision of this comment copied. "The save never ran" is true of
      //   BOTH returns, so it distinguishes nothing. There the arm is still NEEDED and
      //   spending it costs a legitimate save (accepted — the user gets a refusal toast and
      //   the data survives). HERE the baselines have just been resynced, so a deletion that
      //   ALREADY landed is folded into the baseline and the arm has nothing left to authorise.
      // ★★★ THAT HOLDS ONLY BECAUSE ARMING AND MUTATING ARE ATOMIC. Every call site arms in
      //   the SAME synchronous block as its mutation, so React commits both together and the
      //   mutation is always already in the counts by the time this branch runs. A future site
      //   that arms, AWAITS, then mutates would have its permission spent here and its
      //   deletion refused. `use-load-truncation.ts`'s `guardedWrite` leans on the same
      //   invariant from the other side — read that comment before adding an arming site.
      //   Enumerate them: grep -rn "allowDestructiveSave" src/app --include=*.ts --include=*.tsx
      // ★ Leaving it armed is the worse trade: a live arm makes `refuse` impossible, so the
      //   NEXT save of any kind spends it — the accident it waves through is whatever saves
      //   FIRST after this branch, never "some later edit". ★★ That is not the same as saying
      //   it is soon: a live arm survives unbounded loads and unbounded idle, so the next save
      //   can be an arbitrary WALL-CLOCK time away. An earlier revision put the phrase "hours
      //   afterwards" in §294's mouth; §294 says neither, and now states both halves itself
      //   (docs/open-followups.md §294, "Consequence").
      // ★ The spend that used to sit here is now at the TOP of this effect, so
      // this branch spends by construction like every other. The resync
      // rationale above is unchanged and still the reason it is SAFE to spend.
      return;
    }
    // ★ DATA-LOSS INVARIANTS at the persistence choke point (all backends): L3 and
    //   Layer B, both decided by the pure `evaluateSaveGuard` (save-guard.ts) — read the
    //   two invariants there, not here. An explicit user bulk-op (clear-all / bulk delete)
    //   arms the destructive-save guard one-shot to bypass them; on refusal the backend keeps the
    //   data, so a reload restores it.
    // ★★ §103: an AUTOMATIC save must never commit a truncated load — the excess documents
    // are still in the source file. Baselines deliberately untouched (use-load-truncation.ts).
    if (!mayCommitAfterIncompleteLoad()) { return; } // ★★★ The bypass is ALREADY SPENT — at the top of this effect, not here. It has to be: this guard is STICKY, so an arm surviving the return would be carried for hours (use-load-truncation.ts). That is why the hoist above is safe for this return and not merely tidier.
    // ★ Read BEFORE `evaluate`, which is what sets the refusal. This is the
    // effect closure's render-time value of the hook's React state, so it
    // answers "was a refusal already standing when this save was attempted?".
    const refusalWasStanding = destructive.refusal !== null;
    const verdict = destructive.evaluate(curCollections, curRecords, armed);
    if (verdict.refuse) {
      // ★★★ NEW magnitude only, never `!refusalWasStanding` — see §303 and the `DestructiveEvaluation` docstring.
      if (verdict.isNewMagnitude) recordDataLossEvent({ path: "save-effect", prevCollections: destructive.readBaselines().collections, nextCollections: curCollections, refused: true });
      // ★★ ONLY on a NEW refusal. The refusal keeps the baselines, so every
      // later save re-refuses; a toast per re-refusal would be one per edit
      // while the banner is already standing and saying the same thing.
      // ★ The action REVEALS the banner rather than carrying the destructive
      // action itself: a toast auto-dismisses and is single-slot, a bad host for
      // an irreversible button.
      if (!refusalWasStanding) {
        emitToastAction("info", t(langRef.current, "storageRefusedWipe"), {
          labelKey: "storageSavingPausedAction",
          run: () => args.onRevealSavingPaused(),
        });
      }
      return; // keep baselines so a later change re-evaluates
    }
    if (verdict.forensic) {
      // A single-collection full-empty L3 lets through — leave a forensic trail.
      recordDataLossEvent({ path: "save-effect", prevCollections: 1, nextCollections: 0, refused: false });
    }
    // ★★★ BOTH RUN BEFORE THE WRITE; DEFERRING EITHER INTO `.then()` IS WRONG — a
    //   rejection is undone in the `.catch` instead. Deferring `syncBaselines`
    //   keeps the PRE-deletion baseline live across the debounce+latency window
    //   (the arm is consumed at the top of this effect), so any edit inside it
    //   re-runs unarmed, refuses, and the debounce cleanup cancels the very save
    //   the user authorised. `clearRefusal` is already a no-op on that path —
    //   `allowDestructiveSaveAnyway` clears the refusal ITSELF to re-run this effect.
    destructive.syncBaselines(curCollections, curRecords);
    destructive.clearRefusal(); // a committed save resolves any standing refusal
    // Fire-and-forget save with the effect's full error handling — the .catch
    // routes every rejection to the storage-outcome/toast path, so a REJECTED
    // save never escapes unhandled.
    // ★★ That is not the same as "this chain cannot produce an unhandled
    //    rejection", which an earlier revision of this comment claimed. The
    //    HANDLERS themselves throw if they run after the component unmounted
    //    (setState -> resolveUpdatePriority -> `window`), which is precisely the
    //    §72 failure. They are routed through emitOutcome/emitToast for that
    //    reason; do not call args.* directly here.
    const doSave = () => {
      // ★★ §586, second check: the debounce timer, flush-on-hide AND — since §589 — the cleanup flush
      // all call this (debounced-save.ts), possibly long after this run, so it re-reads the gate's REF
      // rather than trusting the run above.
      // ★★★ DEFENCE IN DEPTH — NO TEST CAN REACH IT TODAY, and none claims to. A save is scheduled only
      // on a run that passed the effect-level check, and the gate for THAT backend never closes again:
      // the ref moves only when a DIFFERENT backend opens it, i.e. when that backend's own load applies.
      // ★★ §589 TURNED THE CLEANUP INTO A CALLER OF THIS AND STILL DOES NOT REACH IT — but the OLD
      // reason no longer holds and was removed rather than kept: this used to rest on "the cleanup
      // clears the timer and drops both hide listeners first", which is now only what happens when the
      // predicate says no. On a rebuild the cleanup DOES call `doSave` — in the same commit as the
      // render that minted the new backend, long before that backend's load can have applied, so
      // `savesAllowedForRef.current` is still this run's `backend` and the check passes.
      // Measured by mutation: deleting this line alone leaves every load-gate test green; deleting it
      // together with the effect-level check turns (a) (b) (c) (e) (h) (i) red. It is here for a future
      // path that schedules without that check.
      if (savesAllowedForRef.current !== backend) return;
      backend.save(outgoing).then(() => { // ★ the SAME object the guard counted — see the note on `outgoing`; a re-spelled literal here is how a field gets counted and never written
        committedBaselineRef.current = { collections: curCollections, records: curRecords }; // the write landed: these are on disk now
        emitOutcome(null);
      }).catch((err) => {
        // ★★★ PUT THE BASELINES BACK — nothing was written, so the guard must not
        //   believe the destroyed counts are stored. Left adopted they disarm the
        //   lockout for good: the next save compares the destroyed workspace against
        //   itself, cannot refuse, and leaves no banner and unwritten data.
        //   Restoring re-evaluates the next save against what is genuinely on disk,
        //   so the refusal is raised again. ★ NOT re-raised here — that needs a
        //   setState from an async callback (§72) and would cancel any pending save.
        //   ★★ COMPARE-AND-SWAP, since a later run or a load may have re-baselined
        //   mid-flight onto a different workspace.
        //   ★★ RESIDUAL: two saves overlapping in flight can still settle on a
        //   never-written baseline — coordinating them is out of scope here.
        const live = destructive.readBaselines();
        if (live.collections === curCollections && live.records === curRecords) {
          destructive.syncBaselines(committedBaselineRef.current.collections, committedBaselineRef.current.records);
        }
        emitOutcome(err);
        logDiag("error", "storage.saveFailed", { message: String(err) });
        // Turso connectivity/auth failures show the persistent banner — skip the toast.
        if (tursoErrorKind(err)) return;
        if (err instanceof StorageNotReadyError) {
          const hint = (err as StorageNotReadyError).hint;
          const key =
            hint === "local-file-permission-needed" ? "storagePermissionGestureNeeded" :
            hint === "local-file-write-blocked"     ? "storageWriteBlocked" :
                                                      "storageNotReady";
          emitToast("error", t(langRef.current, key));
        } else if (isTursoLockTimeout(err)) {
          // Localized text — the error's own message is English-only.
          emitToast("error", t(langRef.current, "tursoLockTimeout"));
        } else if (!(err instanceof StorageNotImplementedError)) {
          emitToast("error", t(langRef.current, "storageSaveFailed", String(err)));
        }
      });
    };
    // ★ Debounce + flush-on-hide (the double-fire guard, why `pagehide` backs up
    //   `visibilitychange`, and why this may only be reached AFTER the hydrated/
    //   popout/load/suppress gates above) all live in debounced-save.ts. Read it there.
    // ★★★ §589 — FLUSH ON CLEANUP, BUT ONLY WHEN THE SAVE TARGET ITSELF CHANGED. `backend` is a dep
    //   of this effect, so a settings-driven rebuild (a Turso URL/token edit, a SharePoint target
    //   change) runs this cleanup; it used to clear the timer and return, and an edit still inside
    //   the 500 ms window was then written nowhere — the new target's load replaces scope straight
    //   after, so it left memory too. Silent: nothing refuses, nothing pauses, no toast.
    // ★★ THE PREDICATE IS `!==`, NOT `true`, AND THAT IS THE WHOLE DESIGN. Most cleanups here are
    //   an ORDINARY dep change — the next edit, a re-render — and the effect re-schedules against
    //   the newer workspace immediately, so flushing on those would write on every keystroke and
    //   throw away the debounce. Only a BACKEND change leaves nobody to re-schedule.
    // ★★★ CONSEQUENCE ON SIX OF THE TEN `holdDuring` OP PATHS: THEY NOW WRITE THE PENDING EDIT
    //   TWICE — once via the op's own pre-switch flush, then again here, because that flush writes
    //   directly and never cancels this timer. Both writes carry the OUTGOING project and both go to
    //   the OUTGOING backend, so the second is redundant, not wrong.
    // ★★★ SIX, NOT TEN, AND THE SET IS NAMED BECAUSE A COUNT ALONE ROTS — which is exactly what
    //   happened here: this block said SIX OF THE NINE and listed the exclusions for nine, while
    //   §590 had already made it ten and said so at `holdDuring` itself. The CONCLUSION was right
    //   throughout; only the universe and the exclusions were stale. The doubling needs an op to
    //   BOTH flush AND rebuild the backend, and those two sets differ.
    //   Flushing: SEVEN of the ten — all but `onPickStorageFile`, `onOpenStorageFile` and
    //   `reloadCurrentProject`. Re-derive; `use-storage-turso-ops.ts` flushes through the shared
    //   `flushOutgoing`, so a grep for `flushCurrent` alone under-counts it by two:
    //   ★ The glob must include THIS file: `reloadCurrentProject` is declared here, not in a
    //   `use-storage-*-ops.ts`, so a recipe scoped to that glob cannot see it and silently reports
    //   a universe one op short of the ten it is being compared against.
    //   ★★ Bracketed, because widening the glob to `use-storage-*.ts` brought THIS FILE into scope
    //   and the recipe promptly matched its own line — the fifth self-confirming check on this
    //   branch, created by fixing the fourth. Widening a check's universe can poison it.
    //     grep -n "flush[C]urrent()\|flush[O]utgoing()" src/app/use-storage-*.ts
    //   Rebuilding — i.e. reaching this cleanup at all: `switchToProject`, `createProject`,
    //   `loadProjectFromFile`, `createDemoProject` (each calls `deps.setStorageConfig`) and
    //   `switchToTursoProject`, `createTursoProject` (each calls `deps.setTursoProjectId`); both
    //   setters feed the `backend` memo's deps. The intersection is those six. Re-derive that too:
    //     grep -n "deps.setStorageConfig\|deps.setTursoProjectId" src/app/use-storage-*-ops.ts
    // ★★ THE FOUR THAT NEVER REACH THIS CLEANUP, and the last is the one worth knowing:
    //   `onPickStorageFile` commits no handle to a new instance (§590) and `onOpenStorageFile` binds
    //   one to the SAME instance, while `reloadCurrentProject` re-loads it — so none of the three
    //   mints a backend; `migrateCurrentProjectToTurso` ends in `window.location.reload()`
    //   (use-storage-turso-ops.ts), so the whole context goes and no cleanup runs at all.
    //   ★ This note does NOT claim the first three are free of a pending-edit drop of their own —
    //   they change no backend, so they are simply outside §589's premise, and nothing here
    //   investigated them.
    // ★★ WHAT MAKES THE DOUBLING SAFE FOR THOSE SIX, and it is two independent things — do not
    //   remove one on the strength of the other. (1) Each of the six applies the new workspace and
    //   flips its target in ONE synchronous block: in all six the last `await` precedes
    //   `applyWorkspace`, and the `setStorageConfig`/`setTursoProjectId` call follows with no
    //   `await` between. So React commits them together and the cleanup that runs belongs to the
    //   effect from BEFORE the apply — its `outgoing` is the old project by construction. (2) Each
    //   of the six arms `suppressNextSaveRef` in that same block, so even if an apply and a flip
    //   ever landed in SEPARATE commits, the run between them would be suppressed and would
    //   schedule nothing for this cleanup to flush.
    // ★★★ BOTH LEGS ARE SCOPED TO THE SIX ON PURPOSE. As universals over the ten they were FALSE,
    //   and the note said in the same breath that the legs are independent and must be checked —
    //   so it invited exactly the verification it failed. `migrateCurrentProjectToTurso` arms
    //   `suppressNextSaveRef` nowhere (that file arms it only in `switchToTursoProject` and
    //   `createTursoProject`); what carries it is the page reload, not leg 2. Enumerate before
    //   widening either leg — ★★ bracketed AND `.tsx`-inclusive, which this recipe was neither:
    //   spelled plainly it matched its own line and its sibling's, and omitting `--include=*.tsx`
    //   silently narrowed the universe it claims to enumerate (the sibling above already carried
    //   the flag). Both defects made it agree with whatever the reader already believed:
    //     grep -rn "suppressNextSave[R]ef.current = true" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."
    //   Same 10 hits as the sibling above; read them, not the number.
    // ★ AND IT RESCUES SOMETHING: an edit made during an op's own await window used to be dropped —
    //   `flushCurrent` had already run, and the apply's re-render cleared the timer and armed the
    //   suppress. That drop is the shape ruled on as D3 in the 2026-09-19 data-loss plan. It is now
    //   written, because at that commit the backend really has changed.
    // ★★ WHY NO EXTRA GATE CHECK: the flush reaches `doSave`, the same single `save` argument the
    //   timer and the hide listeners use, and `doSave` closes over the `savesAllowed`/`backend` of
    //   THIS render — i.e. the OLD instance. So §586 already covers this exit. A second check here
    //   would be a different question asked in the same words.
    // ★ `backendRef.current` is assigned during RENDER (see its declaration), which is what makes
    //   this readable at all: React runs every cleanup before any effect body, so a ref mirrored in
    //   an effect would still hold the OLD backend here and this would never fire.
    // ★★ SPELLED OUT RATHER THAN REUSING `isSupersededBackend` ABOVE, WHICH IS THE IDENTICAL
    //   EXPRESSION — on purpose. A null ref answers `!==` with TRUE, which for that helper's
    //   consumers means DROP (fail-closed, and the reason its seed is `null`) and here means FLUSH
    //   on an ordinary cleanup (fail-open). Same three tokens, opposite fail direction; one name
    //   covering both would hide that from whoever next revisits the seed. Neither is reachable
    //   today — the render-time write precedes every cleanup — so this is noted, not relied on.
    return scheduleDebouncedSave(doSave, SAVE_DEBOUNCE_MS, () => backendRef.current !== backend);
    // ★ `savesAllowed` is a dep so the gate OPENING re-runs this effect (after an op's re-stamp, it is
    // the only thing that changes) — the run spends that op's suppress, or saves an edit made meanwhile.
    // ★ `loadWasIncomplete` is a dep so LOWERING it (the user's "save anyway") re-runs this effect
    // and the escape actually WRITES — otherwise it no-ops until the next unrelated edit. ★★ Keep
    // the disable directive DIRECTLY below: a comment between it and the deps line silently voids it.
    // ★ `destructive.refusal` is a dep for the SAME reason: clearing it is what
    // `allowDestructiveSaveAnyway` does, and without the dep the authorised save
    // would wait for an unrelated edit — with saving paused, there may not be one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status, project, fieldVisibility, features, milestones, changes, stakeholders, steeringCommittee, timelogLinks, knowledgeItems, insights, documents, documentVersions, settingsOverrides, calendarEvents, documentAssets, activityLog, budgetHistory, args.hydrated, args.isPopout, backend, loadWasIncomplete, destructive.refusal, savesAllowed]);

  const canSend = !args.isPopout;
  useBroadcastSync("tasks", tasks, setTasks, canSend);
  useBroadcastSync("raid", raid, setRaid, canSend);
  useBroadcastSync("absences", absences, setAbsences, canSend);
  useBroadcastSync("shifts", shifts, setShifts, canSend);
  useBroadcastSync("resources", resources, setResources, canSend);
  useBroadcastSync("roles", roles, setRoles, canSend);
  useBroadcastSync("disciplines", disciplines, setDisciplines, canSend);
  useBroadcastSync("grades", grades, setGrades, canSend);
  useBroadcastSync("budgets", budgets, setBudgets, canSend);
  useBroadcastSync("milestones", milestones, setMilestones, canSend);
  useBroadcastSync("changes", changes, setChanges, canSend);
  useBroadcastSync("stakeholders", stakeholders, setStakeholders, canSend);
  useBroadcastSync("documents", documents, setDocuments, canSend); useBroadcastSync("documentVersions", documentVersions, setDocumentVersions, canSend); // ★ PAIRED on one line: written when the size ratchet's LIMIT was 800 and this file sat at it (check-file-sizes.mjs counts split("\n").length = wc -l + 1); the LIMIT is 1600 now. They must also stay in step: the autosave writes the WHOLE workspace, so a tab holding a stale half overwrites the other tab's work — the same reason `documents` is synced. ★ Secondary: `deletedDocumentVersions` derives tombstones from BOTH slices, and `documents-panel.tsx` renders that list (its deleted-documents section and the toolbar count), so a desynced tab produces a WRONG visible list with Restore buttons on it — an observable symptom, not a latent one.
  useBroadcastSync("activityLog", activityLog, setActivityLog, canSend); // ★ Now the WORKSPACE slice, not a per-device arg: the autosave writes the WHOLE workspace, so a tab holding a stale log would overwrite the other tab's entries — the same reason `documents` is synced above. `mergeActivityLogs` cannot cover this; it runs on LOAD, not on a broadcast.
  useBroadcastSync("budgetHistory", budgetHistory, setBudgetHistory, canSend); // ★ Same reason as `activityLog`: the autosave writes the whole workspace, so a tab with a stale history would overwrite the other tab's entries.
  // `project` (ProjectMeta | undefined) so a main-window project switch live-updates
  // the read-only project header in popout windows. The generic handles undefined.
  useBroadcastSync("project", project, setProject, canSend);

  // Snapshot the live workspace from the render-scope closure — same pattern as
  // the file-picker handlers in use-storage-file-ops.ts (onPickStorageFile /
  // onOpenStorageFile / onRequestStorageSwitch), which take it as a dep. Must
  // NOT be memoized or it would capture stale state.
  function currentWorkspace(): Workspace {
    return { tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status, project, fieldVisibility, features, milestones, changes, stakeholders, steeringCommittee, timelogLinks, knowledgeItems, insights, documents, documentVersions, settingsOverrides, calendarEvents, documentAssets, activityLog, budgetHistory };
  }

  // Persist the registry AND surface the change to the caller so its observable
  // copy (task-manager's `registry` state) re-renders. Every project flow that
  // mutates the registry routes through here instead of calling saveRegistry
  // directly, so no update is missed.
  // A failed localStorage write (quota / disabled) is surfaced as a transient
  // toast — like the other one-shot storage failures here — rather than the
  // sticky storage banner, which is reserved for the workspace backend being
  // down. The in-memory copy is still committed so the UI stays consistent for
  // this session; only persistence across reloads is at risk.
  function commitRegistry(next: ProjectsRegistry): void {
    const persisted = saveRegistry(next);
    emitRegistryChange(next);
    if (!persisted) {
      emitToast("error", t(langRef.current, "projectsRegistrySaveFailed"));
    }
  }

  // Build a backend for an arbitrary config using the current deps. Shared by
  // the project flows; mirrors the memo'd `backend` construction.
  function backendFor(config: StorageConfig) {
    return createBackend(config, {
      acquireToken: auth.acquireToken,
      tursoConfig: tursoConfigNow(),
      tursoProjectId,
    });
  }

  // Resolve the live Turso config from the current settings (mirrors how
  // backendFor / the backend memo resolve it). Used by the Turso project flows.
  function tursoConfigNow() {
    return getTursoConfig(
      settingsRef.current.integrations?.turso?.databaseUrl,
      settingsRef.current.integrations?.turso?.authToken,
    );
  }

  // Copy the handle the backend just stored (via pick/open) into the per-project
  // handle store, so switchToProject can re-attach it later. The LocalFileBackend
  // already persisted it under its own kv key; this mirrors it per-project.
  async function persistBackendHandle(backendForProject: ReturnType<typeof backendFor>, id: string): Promise<void> {
    const grant = requestWriteAccessForBackend(backendForProject);
    if (grant) await grant;
    const read = getBackendFileHandle(backendForProject);
    const handle = read ? await read : null;
    if (handle) await saveHandle(id, handle);
  }

  function reportProjectError(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    if (/abort/i.test(msg) || /user activation/i.test(msg)) return;
    if (err instanceof StorageNotReadyError) {
      const hint = (err as StorageNotReadyError).hint;
      const key =
        hint === "local-file-permission-needed"
          ? "storagePermissionGestureNeeded"
          : "storageNotReady";
      emitToast("error", t(langRef.current, key));
    } else if (!(err instanceof StorageNotImplementedError)) {
      emitToast("error", t(langRef.current, "storageLoadFailed", msg));
    }
  }

  const {
    switchToTursoProject,
    createTursoProject,
    migrateCurrentProjectToTurso,
    archiveTursoProject,
    restoreTursoProject,
    hardDeleteTursoProject,
  } = useTursoProjectOps({
    isPopout: args.isPopout,
    showToast: emitToast,
    langRef,
    settingsRef,
    tursoConfigNow,
    tursoProjectId,
    setTursoProjectId,
    truncationOps,
    currentWorkspace,
    applyWorkspace: applyWorkspaceForOp, // §548 clause (b)
    suppressNextLoadRef,
    suppressNextSaveRef,
    reportProjectError,
  });

  const {
    switchToProject,
    createProject,
    loadProjectFromFile,
    createDemoProject,
  } = useFileProjectOps({
    isPopout: args.isPopout,
    showToast: emitToast,
    setStorageConfig: emitStorageConfig,
    langRef,
    settingsRef,
    truncationOps,
    applyWorkspace: applyWorkspaceForOp, // §548 clause (b)
    backendFor,
    commitRegistry,
    persistBackendHandle,
    reportProjectError,
    suppressNextLoadRef,
    suppressNextSaveRef,
    announcedUnsafeEmailsRef,
  });

  const {
    onPickStorageFile,
    onGrantWriteAccess,
    onOpenStorageFile,
    onRequestStorageSwitch,
  } = useStorageFilePickerOps({
    isPopout: args.isPopout,
    backend,
    truncationOps,
    currentWorkspace,
    refreshBackendStatus,
    emitToast,
    langRef,
    settingsRef,
    suppressNextSaveRef,
    suppressNextLoadRef,
    emitStorageConfig,
    allowSavesToActiveBackend: () => allowSavesTo(backend),
    loadSucceeded: () => savesAllowedForRef.current === backend,
    isBackendCurrent: () => !isSupersededBackend(), // §588 — `backend` inside the predicate is THIS render's instance; the ref is the live one.
    acquireToken: auth.acquireToken,
    setTasks,
    setRaid,
    tasks,
    bumpScopeEpoch, // §548 clause (b) — onOpenStorageFile's accept branch only
    applyPickedWorkspace: applyWorkspaceForOp, // §590 — onPickStorageFile's load-instead branch; the wrapper bumps the epoch itself, so that branch must NOT also call `bumpScopeEpoch`.
  });

  // Re-load the CURRENT project's workspace from its backend, discarding the
  // in-memory state. Recovery affordance for when an error (or a partial load)
  // leaves the app unpopulated — unlike switchToProject, which early-returns on
  // the same id, this always re-fetches. Mirrors the load effect's apply path
  // (suppress the save-back the apply would otherwise trigger).
  const reloadCurrentProject = async (): Promise<void> => {
    if (reloadInFlightRef.current) return; // ignore a re-entrant click while loading
    reloadInFlightRef.current = true;
    try {
      const workspace = await backend.load();
      // ★★★ §588 — A SETTINGS-DRIVEN REBUILD MAY HAVE REPLACED THE BACKEND WHILE WE AWAITED, and this
      //   closure still holds the one the click started against. Applying now would (a) stomp the live
      //   project with THIS instance's payload, (b) `setSettledBackend` the superseded instance, which
      //   strands `loadPending` true forever — the §548 skeleton, permanently, since nothing rebuilds
      //   the backend again — and (c) `allowSavesTo` it, moving the save gate OFF the live one, which
      //   then stays shut IN SILENCE: `loadPause` is published only for an instance whose own load
      //   failed or was refused, and a superseded reload is neither, so no banner and no toast appear.
      // ★ ONE guard, placed BEFORE the whole tail, closes all three: they are three consequences of a
      //   single superseded resolution, not three defects. Do not split it into three.
      // ★ Nothing is emitted but the diagnostic: the click's outcome belongs to the backend the user
      //   is no longer on, and the live instance's own load effect owns the screen now.
      if (isSupersededBackend()) {
        logDiag("warn", "storage.supersededLoadDropped", { writer: "reloadCurrentProject", outcome: "resolved" });
        return;
      }
      // ★ DATA-LOSS GUARD: a reload that would EMPTY a populated project is
      // almost always a transient/failed backend read, not intent — applying it
      // wipes the in-memory workspace and autosave then persists the empty (a
      // real loss we hit). Only replace a NON-empty project with an empty load
      // after an explicit confirm; default is to keep the current data untouched.
      if (isWorkspaceEmpty(workspace) && !isWorkspaceEmpty(currentWorkspace())) {
        const confirmed =
          typeof window !== "undefined" &&
          window.confirm(t(langRef.current, "reloadEmptyConfirm"));
        recordDataLossEvent({ path: "reload", prevCollections: nonEmptyCollectionCount(currentWorkspace()), nextCollections: 0, refused: !confirmed });
        if (!confirmed) {
          truncationOps.raiseDecodeFailuresFor(backend); // ★★★ THE CAUTIOUS ANSWER MUST NOT DISARM THE GUARD. Declining keeps the in-memory workspace and leaves autosave pointed at THIS backend, so an undecodable meta blob here is precisely the loss the flag exists to pause — the user picking the SAFE option was what skipped the report and left the next edit free to `DELETE FROM meta` over it. Raise-only, and truncation is deliberately not published: see `raiseDecodeFailuresFor`.
          emitOutcome(null);
          return;
        }
      }
      // RAISE (not reset): this same-project reload may reflect a locally-deleted
      // max-id row; lowering the mark to the reloaded max would free that id.
      // §591 — "merge" (a reload must not drop this device's entries) ONLY while scope holds THIS target's
      // project. After a rebuild onto an EMPTY target the refusal left the previous project in scope, and
      // `reloadEmptyConfirm` promises the user a REPLACE.
      applyWorkspaceFromLoad(workspace, "raise", resolveLogModeAndStamp());
      // Confirm the manual recovery action succeeded (a bare re-render gives no feedback that the reload actually re-read the backend).
      // ★★ BEFORE `reportFor`, not after — single-slot surface, see the landmine there. Safe to hoist past the await: `refreshBackendStatus` swallows every error, so this cannot report success over a status check that blew up.
      emitToast("success", t(langRef.current, "reloadProjectSuccess"));
      truncationOps.reportFor(backend);
      suppressNextSaveRef.current = true;
      await refreshBackendStatus();
      emitOutcome(null);
    } catch (err) {
      // ★★ §588 — A SUPERSEDED REJECTION MUST BE AS QUIET AS A SUPERSEDED RESOLUTION, and the guard
      //   after the await covers only the resolve leg. A load that REJECTS after a rebuild would
      //   otherwise reach `emitOutcome` and the error toast, raising a STICKY storage banner over the
      //   project the user has since switched TO, about a backend they are no longer on — the same
      //   wrong-target visibility §588 is about, wearing an error's clothes, and the banner outlives
      //   the toast. The live instance's own load effect owns the screen now, including its errors.
      // ★ `finally` still clears `reloadInFlightRef`, so a dropped rejection cannot wedge the button.
      if (isSupersededBackend()) {
        logDiag("warn", "storage.supersededLoadDropped", { writer: "reloadCurrentProject", outcome: "rejected" });
        return;
      }
      // onStorageOutcome raises the sticky banner; the toast is the transient
      // acknowledgement of THIS click (reload has no other toast path).
      emitOutcome(err);
      emitToast("error", t(langRef.current, "reloadProjectError"));
    } finally {
      reloadInFlightRef.current = false;
    }
  };

  // ★★ §548 — hold `loadPending` for the WHOLE of an op that awaits and then REPLACES the workspace.
  //   The op flushes the outgoing project BEFORE its await; an edit made during the await would be
  //   replaced in memory when the op applies. `finally`, so a throwing op cannot strand the hold;
  //   `mountedRef`, so a teardown cannot throw (§72).
  // ★★ WHICH ops, not how many — this said "exactly the nine" and §590 made it ten.
  // ★★★ THE RE-DERIVE RECIPE HERE WAS ITSELF A DEFEATED CHECK UNTIL 2026-09-20, in TWO ways, and
  //   both are worth knowing because the shape recurs. It ran `grep -c` for this function's name
  //   followed by an open paren, spelled plainly, and claimed the result "counts the wraps plus this
  //   declaration". (1) THERE IS NO DECLARATION ROW to subtract: the declaration below is spelled
  //   with an open ANGLE bracket, not a paren, so it never matched — the extra hit being attributed
  //   to it was THE RECIPE'S OWN COMMENT LINE, matching the pattern it spelled. (2) `grep -c` counts
  //   LINES, not occurrences, and the wraps are packed several to a line, so its 7 was not the wrap
  //   count either: there are 10 wraps on 6 lines. A self-matching recipe whose miscount is then
  //   explained away by a plausible-sounding subtraction reads as verified forever.
  // ★★ EVERY MENTION BELOW USES THE BRACKET CLASS, INCLUDING THE ONES IN PROSE, and that is not
  //   decoration: the first attempt at this correction spelled the old broken pattern twice while
  //   describing it, which pushed the corrected recipe from 10 back to 12. An explanation of a
  //   self-matching check can re-poison the check. Count OCCURRENCES, never lines:
  //     grep -o "hold[D]uring(" src/app/use-storage-backend.ts | wc -l
  //   It printed 10 on 2026-09-20. Read the hits rather than the number either way —
  //   `grep -n "hold[D]uring(" src/app/use-storage-backend.ts` names each wrapped op.
  // ★★★ §596 — `scope` IS REQUIRED, AND IT GATES ONLY THE REF, NEVER THE HOLD. Every op below
  //   raises `loadPending` exactly as before; what this decides is whether `isSwapInFlight` — read
  //   by ONE caller, `chat-panel.tsx`'s unmount cleanup — also goes true.
  // ★★★ WHY THE SPLIT EXISTS: A COMPOSITION REGRESSION NO PER-TASK REVIEW COULD SEE. §590 put
  //   `onPickStorageFile` under the hold and §596 made an unmount-under-hold cancel the in-flight
  //   AI turn. Each is right alone; composed, a plain Save-As, a CANCELLED OS file dialog and a
  //   same-project Reload each silently killed a turn — and the "stopped" note lands on an unmounted
  //   panel, so the user is not even told. That is the exact silent shape §596 existed to undo,
  //   arriving by another route.
  // ★★★ THE RULE, and it decides every row below: CANCELLING IS A COST OPTIMISATION — do not pay
  //   for tokens on a turn whose project is going away. DROPPING a wrong-scope write is the
  //   CORRECTNESS guarantee and belongs to the scope EPOCH, which runs at resolution and needs no
  //   prediction. So this flag is biased the safe way: `"same-scope"` is the default posture, and an
  //   op earns `"changes-scope"` only when it has NO user-cancellable step between raising the hold
  //   and replacing the workspace. Getting it wrong towards `"same-scope"` costs tokens; getting it
  //   wrong towards `"changes-scope"` destroys the user's work silently.
  // ★★★ "CANCELLABLE" MEANS *THE USER DECLINES*, NOT *THE OP FAILS*, and the distinction is the
  //   whole rule — read it before reclassifying anything. All four `"changes-scope"` ops can still
  //   ABORT: a Turso guard returning null, a save or load throwing, a same-target early return. Each
  //   of those false-cancels a turn too, and that is ACCEPTED, because a failure announces itself —
  //   the user gets a toast and knows something went wrong. A user who backs out of an OS dialog
  //   gets no signal at all, and a turn dying silently beside it is the B1 shape. So the flag
  //   separates "silent" from "loud", not "certain" from "uncertain".
  // ★★ KNOWN RESIDUALS, stated rather than hidden, both of the loud kind: `switchToTursoProject`
  //   early-returns when the target is already current (`deps.tursoProjectId === id`), and both
  //   Turso ops return early when `guardTurso()` finds no config. Neither is reachable from the
  //   project picker, which does not offer the current project, and neither is silent.
  // ★ A `"same-scope"` op that DOES end up moving the target (the user accepts the dialog in
  //   `onOpenStorageFile` or `loadProjectFromFile`) is not a hole: the turn keeps running and the
  //   epoch drops its write at resolution. Only the tokens are spent.
  function holdDuring<A extends unknown[]>(
    op: (...opArgs: A) => Promise<void>,
    scope: "changes-scope" | "same-scope",
  ): (...opArgs: A) => Promise<void> {
    return async (...opArgs: A) => {
      // §596 — for a `"changes-scope"` op the ref moves in the SAME synchronous statement pair as
      // the state, so a cleanup running inside the commit this triggers already sees it.
      // ★★ "UNCONDITIONALLY" USED TO BE THE WORD HERE and the B1 fix falsified it: both arms are
      // now gated on the SAME closure constant, which is what keeps them symmetric — a raise
      // without its matching release would leave `isSwapInFlight` lying forever. What is still
      // unconditional is the STATE setter, and deliberately: `loadPending` must hold for all ten.
      // ★ The release has no `mountedRef` guard, unlike the setter beside it: there is no state to
      // update after a teardown, only a ref that must not stay raised.
      if (scope === "changes-scope") swapsInFlightRef.current += 1;
      setSwapsInFlight((n) => n + 1);
      try {
        await op(...opArgs);
      } finally {
        if (scope === "changes-scope") swapsInFlightRef.current -= 1;
        if (mountedRef.current) setSwapsInFlight((n) => n - 1);
      }
    };
  }

  // Grouped one line per concern — a plain re-export list, and the cheapest block to compress if
  // this file ever approaches the size ratchet's LIMIT. ★★ IT IS NOT NEAR IT AND THIS SAID IT WAS:
  // the LIMIT was doubled to 1600 on 2026-09-03 and the file has hundreds of lines of headroom, so
  // "runs close to" survived the change that falsified it — the same rot as the "sits AT" it had
  // already replaced. A qualitative claim about a threshold decays exactly like a number.
  // ★ Do not quote the length here either; measure both sides instead
  // (`LIMIT` lives in `scripts/check-file-sizes.mjs`).
  // Measure: node -e "console.log(require('fs').readFileSync('src/app/use-storage-backend.ts','utf8').split('\n').length)"
  return {
    storageDescription, storageReady, workspaceLoaded, loadPause, loadPending, getScopeEpoch, isSwapInFlight,
    // ★★★ §590 PUT `onPickStorageFile` UNDER THE HOLD, and it was deliberately outside it before.
    //   The exclusion was right while the op only ever wrote the live workspace OUTWARD — nothing was
    //   replaced, so there was nothing for a background writer to land in the middle of. Its
    //   load-instead branch now replaces the WHOLE workspace with another file's, which is
    //   `holdDuring`'s stated job, and `onOpenStorageFile` beside it already takes the hold across
    //   its own OS picker — so "a dialog would sit behind a skeleton" is not an available objection;
    //   the precedent accepts it. ★ `bumpScopeEpoch` inside `applyWorkspaceForOp` is NOT a substitute:
    //   it drops background writes that honour the epoch, and does nothing about the tree.
    // ★★ THE COST, STATED: the hold covers the WHOLE op, and only ONE of its two branches replaces
    //   anything — so a user doing a plain Save-As, or cancelling the dialog, pays for a skeleton
    //   they never needed, for as long as the OS dialog is open. The alternative considered was
    //   raising the hold INSIDE the load-instead branch only, which is cheaper for the common path
    //   and wrong for the one that matters: the branch is not chosen until AFTER the picker and the
    //   read have both resolved, so a hold raised there starts after the window it exists to cover.
    //   A wrapper that holds too much is a visual cost; a hold that starts late is not a hold.
    // ★★★ §596 — THE SECOND ARGUMENT IS NOT BOILERPLATE, and the four `"changes-scope"` rows are
    //   the ONLY ones that may cancel a live AI turn. Read the rule at `holdDuring` before adding a
    //   row: `"same-scope"` is the safe default, and an op earns `"changes-scope"` only when NOTHING
    //   the user can cancel sits between the hold and the replacement. The six `"same-scope"` rows
    //   each fail that on a stated ground — a picker/dialog that may be cancelled or declined
    //   (`onPickStorageFile`, `onOpenStorageFile`, `loadProjectFromFile`, `createProject`, whose own
    //   comment names "the user cancels the save-file picker"), or a target that cannot move at all
    //   (`reloadCurrentProject` reloads the CURRENT one; `migrateCurrentProjectToTurso` applies
    //   nothing of another project's and never bumps the epoch — `scope-epoch.ts` says so).
    onPickStorageFile: holdDuring(onPickStorageFile, "same-scope"), onGrantWriteAccess, onOpenStorageFile: holdDuring(onOpenStorageFile, "same-scope"), onRequestStorageSwitch,
    reloadCurrentProject: holdDuring(reloadCurrentProject, "same-scope"), allowDestructiveSave, allowDestructiveSaveAnyway: destructive.allowDestructiveSaveAnyway, destructiveRefusal: destructive.refusal, truncation, decodeFailureCount, decodeFailureNonce, malformedQuoteCount, malformedQuotesNonce, loadWasIncomplete, allowIncompleteSave,
    // ★★★ `switchToProject` IS `"same-scope"`, AND IT SHIPPED AS `"changes-scope"` FOR ONE ROUND —
    //   the B1 regression re-opened for four paths by the very fix that closed it. It has abort
    //   paths AFTER the hold is raised: an unknown id (toast + return), the target already being
    //   current, a missing file handle (toast + return), and a write-permission prompt the user can
    //   DENY. On any of those nothing is replaced, so arming the ref cancels a live AI turn for a
    //   switch that never happened.
    // ★★ RAISING THE REF LATER, AFTER THOSE PATHS, IS NOT AN OPTION — it is the one fix that cannot
    //   work here, and it reads like the better one. The ref exists to be TRUE at the §548 teardown,
    //   and that teardown is the commit `setSwapsInFlight` above triggers, i.e. hold ENTRY. Anything
    //   armed after the op's first `await` is armed after the panel is already gone. The decision is
    //   forced to hold entry by the mechanism, which is exactly why the flag is a prediction and why
    //   it is biased safe.
    switchToProject: holdDuring(switchToProject, "same-scope"), createProject: holdDuring(createProject, "same-scope"),
    createDemoProject: holdDuring(createDemoProject, "changes-scope"), loadProjectFromFile: holdDuring(loadProjectFromFile, "same-scope"),
    switchToTursoProject: holdDuring(switchToTursoProject, "changes-scope"), createTursoProject: holdDuring(createTursoProject, "changes-scope"),
    migrateCurrentProjectToTurso: holdDuring(migrateCurrentProjectToTurso, "same-scope"),
    archiveTursoProject, restoreTursoProject, hardDeleteTursoProject,
    tursoProjectId,
  };
}
