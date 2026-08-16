"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useBroadcastSync } from "./broadcast-sync";
import { t } from "./i18n";
import {
  type StorageConfig,
  type StorageKind,
  type Workspace,
  StorageNotImplementedError,
  StorageNotReadyError,
  createBackend,
  getBackendFileHandle,
  openFileForBackend,
  pickFileForBackend,
  requestWriteAccessForBackend,
} from "./storage";
import { isWorkspaceEmpty, nonEmptyCollectionCount, workspaceRecordCount, isMassDeletion } from "./workspace";
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
import { useMsAuth } from "./use-ms-auth";
import { useWorkspace } from "./workspace-context";
import { useTursoProjectOps } from "./use-storage-turso-ops";
import { useFileProjectOps } from "./use-storage-file-ops";
import { useLoadTruncation } from "./use-load-truncation";
import { STORAGE_LABEL_KEYS, type UseStorageBackendArgs } from "./use-storage-backend-types";

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
    setSteeringCommittee,
    timelogLinks, setTimelogLinks,
    knowledgeItems, setKnowledgeItems,
    insights, setInsights, documents, setDocuments, documentVersions, setDocumentVersions, activityLog, setActivityLog,
    settingsOverrides, setSettingsOverrides,
    calendarEvents, setCalendarEvents,
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

  // Backend instance — memoised on storageConfig identity
  const backend = useMemo(() => {
    const tursoConfig = getTursoConfig(
      args.settings.integrations?.turso?.databaseUrl,
      args.settings.integrations?.turso?.authToken,
    );
    return createBackend(args.settings.storageConfig, {
      acquireToken: auth.acquireToken,
      tursoConfig,
      tursoProjectId,
    });
  }, [
    args.settings.storageConfig,
    auth.acquireToken,
    args.settings.integrations?.turso?.databaseUrl,
    args.settings.integrations?.turso?.authToken,
    tursoProjectId,
  ]);

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

  // Storage status
  const [storageReady, setStorageReady] = useState(false);
  const [storageDescription, setStorageDescription] = useState<string | null>(null);

  // Suppresses the save effect that fires immediately after a load
  const suppressNextSaveRef = useRef(false);
  // Suppresses the load effect that fires after onRequestStorageSwitch sets new config
  const suppressNextLoadRef = useRef(false);
  // Guards reloadCurrentProject against re-entrant clicks (redundant round-trips)
  const reloadInFlightRef = useRef(false);
  // Non-empty-collection count of the last observed workspace — drives the
  // Layer-3 persistence guard against a multi-collection simultaneous wipe.
  const prevCollectionCountRef = useRef(0);
  // Total record count of the last observed workspace — drives the Layer-B
  // mass-deletion guard.
  const prevRecordCountRef = useRef(0);
  // One-shot bypass for the L3/B guards, set by an explicit user bulk-op
  // (clear-all / bulk delete) via allowDestructiveSave() and consumed by the
  // next save.
  const allowDestructiveRef = useRef(false);
  /** Arm a one-shot bypass so the NEXT save may destroy data (a confirmed
   *  clear-all / bulk delete). Without this an unexplained mass deletion is
   *  refused by the persistence guard. */
  const allowDestructiveSave = () => { allowDestructiveRef.current = true; };
  // ★★ §103 — the STICKY sibling of suppressNextSaveRef above (one-shot, so it cannot protect a truncated load). See use-load-truncation.ts.
  const { truncation, loadWasTruncated, allowTruncatedSave, mayCommitAfterTruncation, truncationOps } = useLoadTruncation(langRef, emitToast, () => backend.save(currentWorkspace())); // ★ `emitToast`/`currentWorkspace` are hoisted function declarations; the closure is rebuilt every render, so it always writes the LIVE workspace to the CURRENT backend.

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
  const applyWorkspace = (workspace: Workspace, seedMode: "reset" | "raise" = "reset", logMode: "merge" | "replace" = "replace") => {
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
    setSettingsOverrides(workspace.settingsOverrides);
    setCalendarEvents(workspace.calendarEvents);
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
  };

  // ★★★ Every setter here is guarded by `mountedRef` — three guards covering
  //     four setters. These are the last §72 setters in this hook that can
  //     escape as an UNHANDLED REJECTION rather than a merely discarded update;
  //     `applyWorkspace`'s 28 setters and `onOpenStorageFile`'s raw ones are
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
  //     ★ That "28" is the likeliest claim here to rot (it read 25 until a review
  //     measured it) — re-derive it with the sed commands in AGENTS.md's activity-log
  //     bullet. Anchor the START on `const applyWorkspace = `: a bare `applyWorkspace`
  //     match opens 572 lines early and reports 31, silently, with no error.
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
    let cancelled = false;
    (async () => {
      if (suppressNextLoadRef.current) {
        suppressNextLoadRef.current = false;
        // ★★★ REQUIRED re-stamp (open-followups §77 — seven arm sites, the
        // reproduce grep and the full argument live there). Every op that arms
        // this ref already put the right workspace in render scope, but does so
        // BEFORE flipping `storageConfig`/`tursoProjectId`; `applyWorkspace` is
        // a plain render-scope function, so it stamped the PREVIOUS backend and
        // the derived gate reads false. Without this the gate strands CLOSED for
        // the session, silently disabling snapshot capture.
        // ★★ The load effect's OTHER two early-returns — the empty-load
        // data-loss guard and the `catch` — deliberately do NOT re-stamp. A cold
        // review read that as a regression; it is not, and §77 says why. Do not
        // "fix" it by re-stamping there.
        setLoadedBackend(backend);
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
          emitToast("info", t(langRef.current, "storageKeptCurrentData"));
          await refreshBackendStatus();
          emitOutcome(null);
          return;
        }
        applyWorkspace(workspace, "reset", "merge"); // "merge": SAME project — keep appends made while this load was in flight.
        logDiag("info", "storage.loaded", { records: workspaceRecordCount(workspace) });
        truncationOps.reportFor(backend); // ★ after applyWorkspace only: the empty-load REFUSAL above applies nothing, so neither raising nor lowering the flag would describe the workspace that is actually live.
        suppressNextSaveRef.current = true;
        await refreshBackendStatus();
        emitOutcome(null);
      } catch (err) {
        if (cancelled) return;
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
    const outgoing = { tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status, project, fieldVisibility, features, milestones, changes, stakeholders, timelogLinks, knowledgeItems, insights, documents, documentVersions, settingsOverrides, calendarEvents, activityLog } as Workspace;
    const curCollections = nonEmptyCollectionCount(outgoing);
    const curRecords = workspaceRecordCount(outgoing);
    if (suppressNextSaveRef.current) {
      suppressNextSaveRef.current = false;
      prevCollectionCountRef.current = curCollections; // sync baselines on a load/apply
      prevRecordCountRef.current = curRecords;
      return;
    }
    // ★ DATA-LOSS INVARIANTS at the persistence choke point (all backends):
    //   L3 — a full wipe of a >=2-collection project (protects small projects).
    //   B  — an unexplained MASS deletion: >=5 records removed leaving <=10% of the
    //        prior total (protects big projects; catches partial-but-catastrophic
    //        loss L3 misses). An explicit user bulk-op (clear-all / bulk delete)
    //        sets allowDestructiveRef one-shot to bypass. On refusal the backend
    //        keeps the data; a reload restores it.
    // ★★ §103: an AUTOMATIC save must never commit a truncated load — the excess documents
    // are still in the source file. Baselines deliberately untouched (use-load-truncation.ts).
    if (!mayCommitAfterTruncation()) { allowDestructiveRef.current = false; return; } // ★★★ SPEND the bypass here too — a sticky guard would otherwise carry it for hours (use-load-truncation.ts).
    const fullWipe = curCollections === 0 && prevCollectionCountRef.current >= 2;
    const massDelete = isMassDeletion(prevRecordCountRef.current, curRecords);
    if ((fullWipe || massDelete) && !allowDestructiveRef.current) {
      recordDataLossEvent({ path: "save-effect", prevCollections: prevCollectionCountRef.current, nextCollections: curCollections, refused: true });
      emitToast("info", t(langRef.current, "storageRefusedWipe"));
      return; // keep baselines so a later change re-evaluates
    }
    if (curCollections === 0 && prevCollectionCountRef.current === 1) {
      // A single-collection full-empty L3 lets through — leave a forensic trail.
      recordDataLossEvent({ path: "save-effect", prevCollections: 1, nextCollections: 0, refused: false });
    }
    allowDestructiveRef.current = false; // consume the one-shot bypass
    prevCollectionCountRef.current = curCollections;
    prevRecordCountRef.current = curRecords;
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
      backend.save({ tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status, project, fieldVisibility, features, milestones, changes, stakeholders, timelogLinks, knowledgeItems, insights, documents, documentVersions, settingsOverrides, calendarEvents, activityLog }).then(() => {
        emitOutcome(null);
      }).catch((err) => {
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
    // `fired` guards against double-firing: once either the debounce timer or a
    // flush has started the save, later triggers are no-ops. (If the timer
    // already fired and that save is still in flight, skipping the flush is the
    // simple, acceptable choice — the in-flight save carries this effect run's
    // workspace snapshot anyway.)
    let fired = false;
    const timer = setTimeout(() => { fired = true; doSave(); }, 500);
    // Flush-on-hide: a pending debounced save would be silently lost if the
    // user hides or closes the tab within the 500ms window. `visibilitychange`
    // → "hidden" is the primary signal; `pagehide` is the backup for actual
    // unload/navigation (chosen over `beforeunload`, which is unreliable with
    // the back/forward cache and not used elsewhere in this codebase).
    // Listeners are only registered on effect runs that passed the hydrated/
    // popout/suppress gates above, so the flush obeys the exact same gating as
    // the debounced save and never fires when no save is pending.
    const flush = () => {
      if (fired) return;
      fired = true;
      clearTimeout(timer);
      doSave();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", flush);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", flush);
    };
    // ★ `loadWasTruncated` is a dep so LOWERING it (the user's "save anyway") re-runs this effect
    // and the escape actually WRITES — otherwise it no-ops until the next unrelated edit. ★★ Keep
    // the disable directive DIRECTLY below: a comment between it and the deps line silently voids it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status, project, fieldVisibility, features, milestones, changes, stakeholders, timelogLinks, knowledgeItems, insights, documents, documentVersions, settingsOverrides, calendarEvents, activityLog, args.hydrated, args.isPopout, backend, loadWasTruncated]);

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
  useBroadcastSync("documents", documents, setDocuments, canSend); useBroadcastSync("documentVersions", documentVersions, setDocumentVersions, canSend); // ★ PAIRED on one line: this file sits AT the 800-line ratchet (check-file-sizes.mjs counts split("\n").length = wc -l + 1), so splitting these re-breaks the gate. They must also stay in step: the autosave writes the WHOLE workspace, so a tab holding a stale half overwrites the other tab's work — the same reason `documents` is synced. ★ Secondary: `deletedDocumentVersions` derives tombstones from BOTH slices, and `documents-panel.tsx` renders that list (its deleted-documents section and the toolbar count), so a desynced tab produces a WRONG visible list with Restore buttons on it — an observable symptom, not a latent one.
  useBroadcastSync("activityLog", activityLog, setActivityLog, canSend); // ★ Now the WORKSPACE slice, not a per-device arg: the autosave writes the WHOLE workspace, so a tab holding a stale log would overwrite the other tab's entries — the same reason `documents` is synced above. `mergeActivityLogs` cannot cover this; it runs on LOAD, not on a broadcast.
  // `project` (ProjectMeta | undefined) so a main-window project switch live-updates
  // the read-only project header in popout windows. The generic handles undefined.
  useBroadcastSync("project", project, setProject, canSend);

  async function onPickStorageFile() {
    if (truncationOps.wouldRefuseWrite()) { truncationOps.refuseWrite(); return; } // ★★★ §103: refuse BEFORE the picker — it creates the file and persists the handle on the ACTIVE backend, so a write-only guard stranded the app on an empty file. See `refuseWrite` (use-load-truncation.ts).
    const promise = pickFileForBackend(backend);
    if (!promise) return;
    await promise;
    try {
      if (!(await truncationOps.guardedWrite(backend, { tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status, project, fieldVisibility, features, milestones, changes, stakeholders, timelogLinks, knowledgeItems, insights, documents, documentVersions, settingsOverrides, calendarEvents, activityLog }))) return; // ★ Kept as the backstop: the pre-check above is the one that matters, but a truncating load landing between them must still not commit.
      await refreshBackendStatus();
      emitToast("info", t(langRef.current, "storageSwitchedToast"));
    } catch (err) {
      emitToast("error", t(langRef.current, "storageSaveFailed", String(err)));
    }
  }

  async function onGrantWriteAccess() {
    const promise = requestWriteAccessForBackend(backend);
    if (!promise) return;
    const granted = await promise;
    await refreshBackendStatus();
    if (granted) {
      emitToast("info", t(langRef.current, "storagePermissionGranted"));
    } else {
      emitToast("error", t(langRef.current, "storagePermissionDenied"));
    }
  }

  async function onOpenStorageFile() {
    const promise = openFileForBackend(backend);
    if (!promise) return;
    await promise;
    try {
      const loaded = await backend.load(); // ★ NO reportFor: this path applies tasks+raid ONLY, never the loaded documents — raising the flag would warn about documents the user still has, lowering it would clear a warning that is still true of the live ones.
      // ★★ THAT NOW ALSO SUPPRESSES IMPORT DIAGNOSTICS (dropped rows, unbalanced quotes), because both ride `reportFor`. Deliberate, and for the same reason as above: this is not the load whose losses the user is being asked about. (Folded onto one line — this file sits at the 800-line ratchet.)
      if (
        tasks.length > 0 &&
        !window.confirm(t(langRef.current, "storageConfirmOverwrite", tasks.length))
      ) {
        return;
      }
      suppressNextSaveRef.current = true;
      // Seed the session minter from the opened file so its (possibly larger)
      // task/raid ids can't be reused after a delete. "raise" never lowers a
      // kind's mark, so the absences/shifts NOT applied below keep their
      // current-project high-water intact.
      seedMintFromWorkspace(loaded, "raise");
      setTasks(loaded.tasks);
      setRaid(loaded.raid);
      // NOTE: absences and shifts intentionally NOT restored here —
      // faithful extraction of original behavior (not a bug fix).
      await refreshBackendStatus();
      emitToast("info", t(langRef.current, "storageOpenedToast", loaded.tasks.length));
    } catch (err) {
      if (err instanceof StorageNotReadyError) {
        const key =
          (err as StorageNotReadyError).hint === "local-file-permission-needed"
            ? "storagePermissionGestureNeeded"
            : "storageNotReady";
        emitToast("error", t(langRef.current, key));
      } else {
        emitToast("error", t(langRef.current, "storageLoadFailed", String(err)));
      }
    }
  }

  // Reads the current workspace via render-scope closure — same pattern
  // as onPickStorageFile/onOpenStorageFile. Must NOT be memoized by consumers,
  // or it would capture a stale snapshot of tasks/raid/etc. The same applies to
  // the emitters it calls (emitStorageConfig, emitToast): they are re-created
  // each render and read `args.*` live, so memoizing this handler would capture
  // stale versions of those callbacks too — and a stale `mountedRef` with them.
  async function onRequestStorageSwitch(newKind: StorageKind): Promise<void> {
    if (args.isPopout) return;
    const current = settingsRef.current.storageConfig;
    if (newKind === current.kind) return;
    const newConfig: StorageConfig =
      (newKind === "sp-json" || newKind === "sp-csv") && (current.kind === "sp-json" || current.kind === "sp-csv")
        ? { ...current, kind: newKind }
        // Cast is safe: browser/local-*/turso variants carry no required fields
        // beyond `kind`; only sp-* needs hostname/sitePath/itemPath, handled by
        // the spread branch above.
        : ({ kind: newKind } as StorageConfig);
    const label = t(langRef.current, STORAGE_LABEL_KEYS[newKind]);
    const leavingTurso = current.kind === "turso" && newKind !== "turso";
    const confirmKey = leavingTurso ? "storageTursoLeaveWarn" : "storageConvertConfirm";
    if (!window.confirm(t(langRef.current, confirmKey, tasks.length, label))) return;
    const target = createBackend(newConfig, {
      acquireToken: auth.acquireToken,
      tursoConfig: getTursoConfig(
        settingsRef.current.integrations?.turso?.databaseUrl,
        settingsRef.current.integrations?.turso?.authToken,
      ),
    });
    try {
      const pick = pickFileForBackend(target);
      if (pick) await pick;
      if (!(await truncationOps.guardedWrite(target, { tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status, project, fieldVisibility, features, milestones, changes, stakeholders, timelogLinks, knowledgeItems, insights, documents, documentVersions, settingsOverrides, calendarEvents, activityLog }))) return; // ★★ §103: the conversion writes to a DIFFERENT backend, so the source survives — but `emitStorageConfig` below then repoints the app AT the short copy and the intact original becomes the abandoned one. Refuse loudly instead.
      suppressNextLoadRef.current = true;
      emitStorageConfig(newConfig);
      emitToast("info", t(langRef.current, "storageConvertedToast", label));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/abort/i.test(msg) || /user activation/i.test(msg)) return;
      if (err instanceof StorageNotReadyError) {
        const hint = (err as StorageNotReadyError).hint;
        const key =
          hint === "local-file-permission-needed"
            ? "storagePermissionGestureNeeded"
            : hint === "storage-unreachable"
              ? "storageUnreachable"
              : "storageNotReady";
        emitToast("error", t(langRef.current, key));
      } else if (isTursoLockTimeout(err)) {
        // Conversion target was Turso and the cross-tab write lock timed out.
        emitToast("error", t(langRef.current, "tursoLockTimeout"));
      } else {
        // StorageNotImplementedError also surfaces here — user confirmed a
        // conversion write, so silent failure is wrong.
        emitToast("error", t(langRef.current, "storageSaveFailed", msg));
      }
    }
  }

  // Snapshot the live workspace from the render-scope closure — same pattern as
  // the file handlers above. Must NOT be memoized or it would capture stale
  // state.
  function currentWorkspace(): Workspace {
    return { tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status, project, fieldVisibility, features, milestones, changes, stakeholders, timelogLinks, knowledgeItems, insights, documents, documentVersions, settingsOverrides, calendarEvents, activityLog };
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
    applyWorkspace,
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
    applyWorkspace,
    backendFor,
    commitRegistry,
    persistBackendHandle,
    reportProjectError,
    suppressNextLoadRef,
    suppressNextSaveRef,
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
          emitOutcome(null);
          return;
        }
      }
      // RAISE (not reset): this same-project reload may reflect a locally-deleted
      // max-id row; lowering the mark to the reloaded max would free that id.
      applyWorkspace(workspace, "raise", "merge"); // "merge": SAME project — a reload must not drop this device's entries.
      // Confirm the manual recovery action succeeded (a bare re-render gives no feedback that the reload actually re-read the backend).
      // ★★ BEFORE `reportFor`, not after — single-slot surface, see the landmine there. Safe to hoist past the await: `refreshBackendStatus` swallows every error, so this cannot report success over a status check that blew up.
      emitToast("success", t(langRef.current, "reloadProjectSuccess"));
      truncationOps.reportFor(backend);
      suppressNextSaveRef.current = true;
      await refreshBackendStatus();
      emitOutcome(null);
    } catch (err) {
      // onStorageOutcome raises the sticky banner; the toast is the transient
      // acknowledgement of THIS click (reload has no other toast path).
      emitOutcome(err);
      emitToast("error", t(langRef.current, "reloadProjectError"));
    } finally {
      reloadInFlightRef.current = false;
    }
  };

  // Grouped one line per concern — a plain re-export list, and the cheapest block
  // to compress in a file that sits AT the 800-line ratchet.
  return {
    storageDescription, storageReady, workspaceLoaded,
    onPickStorageFile, onGrantWriteAccess, onOpenStorageFile, onRequestStorageSwitch,
    reloadCurrentProject, allowDestructiveSave, truncation, loadWasTruncated, allowTruncatedSave,
    switchToProject, createProject, createDemoProject, loadProjectFromFile,
    switchToTursoProject, createTursoProject, migrateCurrentProjectToTurso,
    archiveTursoProject, restoreTursoProject, hardDeleteTursoProject,
    tursoProjectId,
  };
}
