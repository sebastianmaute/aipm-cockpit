"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ActivityEntry } from "./activity-log";
import { useBroadcastSync } from "./broadcast-sync";
import { type Lang, t } from "./i18n";
import type { Settings } from "./settings-types";
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
import { recordDataLossEvent } from "./dataloss-forensics";
import { logDiag } from "./diagnostics";
import { seedMintFromWorkspace } from "./id-mint-session";
import { saveRegistry, type ProjectsRegistry } from "./projects-registry";
import { saveHandle } from "./project-file-handles";
import { getTursoConfig } from "./turso-config";
import { loadCurrentTursoProjectId } from "./portfolio-mode";
import { isTursoLockTimeout, tursoErrorKind } from "./storage-error";
import { useMsAuth } from "./use-ms-auth";
import { useWorkspace } from "./workspace-context";
import { useTursoProjectOps } from "./use-storage-turso-ops";
import { useFileProjectOps } from "./use-storage-file-ops";

// Hoisted to module scope — static map, no per-render allocation
const STORAGE_LABEL_KEYS: Record<StorageKind, Parameters<typeof t>[1]> = {
  browser: "storageBrowser",
  "local-json": "storageLocalJson",
  "local-csv": "storageLocalCsv",
  "local-md": "storageLocalMd",
  "sp-json": "storageSpJson",
  "sp-csv": "storageSpCsv",
  turso: "storageTurso",
};

export interface UseStorageBackendArgs {
  settings: Settings;
  lang: Lang;
  hydrated: boolean;
  /** True when this window was opened as a popout (`?popout=<tab>`). Popout
   *  windows are mirror views — they receive live state and forward their own
   *  edits via BroadcastChannel, but they must NOT persist. See the save
   *  effect below. */
  isPopout: boolean;
  activityLog: ActivityEntry[];
  setActivityLog: React.Dispatch<React.SetStateAction<ActivityEntry[]>>;
  showToast: (kind: "info" | "error", text: string) => void;
  setStorageConfig: (config: StorageConfig) => void;
  /** Reports the outcome of a load/save so the caller can drive the storage
   *  status bubble + banner. `null` = success (clear any error); an error value
   *  is classified (see storage-error.ts). */
  onStorageOutcome?: (err: unknown | null) => void;
  /** Notifies the caller after the projects registry is persisted (switch /
   *  create / load-from-file). Lets task-manager keep an observable copy of the
   *  registry in React state so the switcher list, empty-state gate, and Projects
   *  panel re-render. Receives the freshly-saved registry. */
  onRegistryChange?: (registry: ProjectsRegistry) => void;
}

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
    setTimelogLinks,
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

  // Fan a loaded workspace into every setter. Shared by the load effect and the
  // project switch / create / load-from-file flows so they apply data the same
  // way. No side-effects beyond the setState calls.
  const applyWorkspace = (workspace: Workspace, seedMode: "reset" | "raise" = "reset") => {
    setTasks(workspace.tasks ?? []);
    setRaid(workspace.raid ?? []);
    setAbsences(workspace.absences ?? []);
    setShifts(workspace.shifts ?? []);
    setResources(workspace.resources ?? []);
    setRoles(workspace.roles ?? []);
    setDisciplines(workspace.disciplines ?? []);
    setGrades(workspace.grades ?? []);
    if (workspace.plan) setPlan(workspace.plan);
    setBudgets(workspace.budgets ?? []);
    setFxRates(workspace.fxRates ?? null);
    setStatus(workspace.status ?? {});
    setProject(workspace.project);
    setFieldVisibility(workspace.fieldVisibility);
    setFeatures(workspace.features);
    setMilestones(workspace.milestones ?? []);
    setChanges(workspace.changes ?? []);
    setStakeholders(workspace.stakeholders ?? []);
    setSteeringCommittee(workspace.steeringCommittee);
    setTimelogLinks(workspace.timelogLinks);
    // Seed the session id-minter's high-water from the loaded set so the next
    // mint after a delete can never reuse a just-freed id. RESET (default) for a
    // possibly-DIFFERENT loaded workspace — initial load / project switch /
    // create / load-from-file (file + Turso ops), each owning its own id space.
    // reloadCurrentProject passes "raise" so a SAME-project refresh reflecting a
    // locally-deleted max-id row never LOWERS the mark (which would free that id).
    // Side-effecting (mutates module state) — safe here inside the load callback,
    // never a render body.
    seedMintFromWorkspace(workspace, seedMode);
  };

  const refreshBackendStatus = async () => {
    try {
      const ready = await backend.isReady();
      setStorageReady(ready);
      const desc = backend.describe ? await backend.describe() : null;
      setStorageDescription(desc ?? null);
    } catch (err) {
      // A thrown status check is distinct from a clean "not ready" (false) — log
      // it so diagnostics can tell an exception apart from a normal negative.
      logDiag("warn", "storage.statusCheckFailed", { message: err instanceof Error ? err.message : String(err) });
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
          args.showToast("info", t(langRef.current, "storageKeptCurrentData"));
          await refreshBackendStatus();
          args.onStorageOutcome?.(null);
          return;
        }
        applyWorkspace(workspace);
        logDiag("info", "storage.loaded", { records: workspaceRecordCount(workspace) });
        suppressNextSaveRef.current = true;
        await refreshBackendStatus();
        args.onStorageOutcome?.(null);
      } catch (err) {
        if (cancelled) return;
        args.onStorageOutcome?.(err);
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
            args.showToast("error", t(langRef.current, key));
          }
        } else if (!(err instanceof StorageNotImplementedError) && !tursoErrorKind(err)) {
          args.showToast("error", t(langRef.current, "storageLoadFailed", String(err)));
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
    // Single-writer rule: the main window owns persistence. A popout is a
    // mirror — it already shows the main window's state and forwards its own
    // edits over BroadcastChannel, which the main window persists. Letting the
    // popout also call backend.save() would mean two windows writing the same
    // backend (a race), and popup-window storage is frequently blocked by the
    // browser's security policy — the blocked IndexedDB write surfaces as
    // "AbortError: Aborted due to security policy". Skipping it here removes
    // both problems.
    if (args.isPopout) return;
    const outgoing = { tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status, project, fieldVisibility, features, milestones, changes, stakeholders } as Workspace;
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
    const fullWipe = curCollections === 0 && prevCollectionCountRef.current >= 2;
    const massDelete = isMassDeletion(prevRecordCountRef.current, curRecords);
    if ((fullWipe || massDelete) && !allowDestructiveRef.current) {
      recordDataLossEvent({ path: "save-effect", prevCollections: prevCollectionCountRef.current, nextCollections: curCollections, refused: true });
      args.showToast("info", t(langRef.current, "storageRefusedWipe"));
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
    // routes every rejection to the storage-outcome/toast path, so neither the
    // timer nor the flush-on-hide below can produce an unhandled rejection.
    const doSave = () => {
      backend.save({ tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status, project, fieldVisibility, features, milestones, changes, stakeholders }).then(() => {
        args.onStorageOutcome?.(null);
      }).catch((err) => {
        args.onStorageOutcome?.(err);
        logDiag("error", "storage.saveFailed", { message: String(err) });
        // Turso connectivity/auth failures show the persistent banner — skip the toast.
        if (tursoErrorKind(err)) return;
        if (err instanceof StorageNotReadyError) {
          const hint = (err as StorageNotReadyError).hint;
          const key =
            hint === "local-file-permission-needed" ? "storagePermissionGestureNeeded" :
            hint === "local-file-write-blocked"     ? "storageWriteBlocked" :
                                                      "storageNotReady";
          args.showToast("error", t(langRef.current, key));
        } else if (isTursoLockTimeout(err)) {
          // Localized text — the error's own message is English-only.
          args.showToast("error", t(langRef.current, "tursoLockTimeout"));
        } else if (!(err instanceof StorageNotImplementedError)) {
          args.showToast("error", t(langRef.current, "storageSaveFailed", String(err)));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status, project, fieldVisibility, features, milestones, changes, stakeholders, args.hydrated, args.isPopout, backend]);

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
  useBroadcastSync("activityLog", args.activityLog, args.setActivityLog, canSend);
  // `project` (ProjectMeta | undefined) so a main-window project switch live-
  // updates the read-only project header in popout windows. The generic handles
  // the undefined case.
  useBroadcastSync("project", project, setProject, canSend);

  async function onPickStorageFile() {
    const promise = pickFileForBackend(backend);
    if (!promise) return;
    await promise;
    try {
      await backend.save({ tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status, project, fieldVisibility, features, milestones, changes, stakeholders });
      await refreshBackendStatus();
      args.showToast("info", t(langRef.current, "storageSwitchedToast"));
    } catch (err) {
      args.showToast("error", t(langRef.current, "storageSaveFailed", String(err)));
    }
  }

  async function onGrantWriteAccess() {
    const promise = requestWriteAccessForBackend(backend);
    if (!promise) return;
    const granted = await promise;
    await refreshBackendStatus();
    if (granted) {
      args.showToast("info", t(langRef.current, "storagePermissionGranted"));
    } else {
      args.showToast("error", t(langRef.current, "storagePermissionDenied"));
    }
  }

  async function onOpenStorageFile() {
    const promise = openFileForBackend(backend);
    if (!promise) return;
    await promise;
    try {
      const loaded = await backend.load();
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
      args.showToast("info", t(langRef.current, "storageOpenedToast", loaded.tasks.length));
    } catch (err) {
      if (err instanceof StorageNotReadyError) {
        const key =
          (err as StorageNotReadyError).hint === "local-file-permission-needed"
            ? "storagePermissionGestureNeeded"
            : "storageNotReady";
        args.showToast("error", t(langRef.current, key));
      } else {
        args.showToast("error", t(langRef.current, "storageLoadFailed", String(err)));
      }
    }
  }

  // Reads the current workspace via render-scope closure — same pattern
  // as onPickStorageFile/onOpenStorageFile. Must NOT be memoized by consumers,
  // or it would capture a stale snapshot of tasks/raid/etc. The same applies
  // to args.setStorageConfig and args.showToast, which are also read from the
  // live args closure — memoizing this handler would capture stale versions of
  // those callbacks too.
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
      await target.save({ tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status, project, fieldVisibility, features, milestones, changes, stakeholders });
      suppressNextLoadRef.current = true;
      args.setStorageConfig(newConfig);
      args.showToast("info", t(langRef.current, "storageConvertedToast", label));
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
        args.showToast("error", t(langRef.current, key));
      } else if (isTursoLockTimeout(err)) {
        // Conversion target was Turso and the cross-tab write lock timed out.
        args.showToast("error", t(langRef.current, "tursoLockTimeout"));
      } else {
        // StorageNotImplementedError also surfaces here — user confirmed a
        // conversion write, so silent failure is wrong.
        args.showToast("error", t(langRef.current, "storageSaveFailed", msg));
      }
    }
  }

  // Snapshot the live workspace from the render-scope closure — same pattern as
  // the file handlers above. Must NOT be memoized or it would capture stale
  // state.
  function currentWorkspace(): Workspace {
    return { tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status, project, fieldVisibility, features, milestones, changes, stakeholders };
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
    args.onRegistryChange?.(next);
    if (!persisted) {
      args.showToast("error", t(langRef.current, "projectsRegistrySaveFailed"));
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
      args.showToast("error", t(langRef.current, key));
    } else if (!(err instanceof StorageNotImplementedError)) {
      args.showToast("error", t(langRef.current, "storageLoadFailed", msg));
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
    showToast: args.showToast,
    langRef,
    settingsRef,
    tursoConfigNow,
    tursoProjectId,
    setTursoProjectId,
    backend,
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
    showToast: args.showToast,
    setStorageConfig: args.setStorageConfig,
    langRef,
    settingsRef,
    backend,
    currentWorkspace,
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
          args.onStorageOutcome?.(null);
          return;
        }
      }
      // RAISE (not reset): this same-project reload may reflect a locally-deleted
      // max-id row; lowering the mark to the reloaded max would free that id.
      applyWorkspace(workspace, "raise");
      suppressNextSaveRef.current = true;
      await refreshBackendStatus();
      args.onStorageOutcome?.(null);
    } catch (err) {
      args.onStorageOutcome?.(err);
    } finally {
      reloadInFlightRef.current = false;
    }
  };

  return {
    storageDescription,
    storageReady,
    onPickStorageFile,
    onGrantWriteAccess,
    onOpenStorageFile,
    onRequestStorageSwitch,
    reloadCurrentProject,
    allowDestructiveSave,
    switchToProject,
    createProject,
    createDemoProject,
    loadProjectFromFile,
    switchToTursoProject,
    createTursoProject,
    migrateCurrentProjectToTurso,
    archiveTursoProject,
    restoreTursoProject,
    hardDeleteTursoProject,
    tursoProjectId,
  };
}
