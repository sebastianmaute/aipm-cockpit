"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ActivityEntry } from "./activity-log";
import { useBroadcastSync } from "./broadcast-sync";
import { type Lang, t } from "./i18n";
import type { Settings } from "./settings-menu";
import {
  type LocalStorageFormat,
  type StorageConfig,
  type StorageKind,
  type Workspace,
  StorageNotImplementedError,
  StorageNotReadyError,
  createBackend,
  emptyWorkspace,
  getBackendFileHandle,
  openFileForBackend,
  pickFileForBackend,
  requestWriteAccessForBackend,
  setBackendFileHandle,
} from "./storage";
import {
  addProject,
  loadRegistry,
  saveRegistry,
  setCurrentProject as setCurrentProjectInRegistry,
  type ProjectsRegistry,
} from "./projects-registry";
import { getHandle, saveHandle } from "./project-file-handles";
import { localKindForFormat, deriveRegistryEntry } from "./use-project-switch";
import type { ProjectMeta } from "./types";
import { getTursoConfig } from "./turso-config";
import { tursoErrorKind } from "./storage-error";
import { useMsAuth } from "./use-ms-auth";
import { useWorkspace } from "./workspace-context";

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
    milestones, setMilestones,
    changes, setChanges,
    stakeholders, setStakeholders,
  } = useWorkspace();

  // Reactive refs — synced via useEffect so effects don't re-register on every render
  const langRef = useRef(args.lang);
  const settingsRef = useRef(args.settings);
  useEffect(() => { langRef.current = args.lang; }, [args.lang]);
  useEffect(() => { settingsRef.current = args.settings; }, [args.settings]);

  const m365Enabled = args.settings.integrations?.m365?.enabled ?? false;
  const auth = useMsAuth(m365Enabled);

  // Backend instance — memoised on storageConfig identity
  const backend = useMemo(() => {
    const tursoConfig = getTursoConfig(
      args.settings.integrations?.turso?.databaseUrl,
      args.settings.integrations?.turso?.authToken,
    );
    return createBackend(args.settings.storageConfig, {
      acquireToken: auth.acquireToken,
      tursoConfig,
    });
  }, [
    args.settings.storageConfig,
    auth.acquireToken,
    args.settings.integrations?.turso?.databaseUrl,
    args.settings.integrations?.turso?.authToken,
  ]);

  // Storage status
  const [storageReady, setStorageReady] = useState(false);
  const [storageDescription, setStorageDescription] = useState<string | null>(null);

  // Suppresses the save effect that fires immediately after a load
  const suppressNextSaveRef = useRef(false);
  // Suppresses the load effect that fires after onRequestStorageSwitch sets new config
  const suppressNextLoadRef = useRef(false);

  // Fan a loaded workspace into every setter. Shared by the load effect and the
  // project switch / create / load-from-file flows so they apply data the same
  // way. No side-effects beyond the setState calls.
  const applyWorkspace = (workspace: Workspace) => {
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
    setMilestones(workspace.milestones ?? []);
    setChanges(workspace.changes ?? []);
    setStakeholders(workspace.stakeholders ?? []);
  };

  const refreshBackendStatus = async () => {
    try {
      const ready = await backend.isReady();
      setStorageReady(ready);
      const desc = backend.describe ? await backend.describe() : null;
      setStorageDescription(desc ?? null);
    } catch {
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
        applyWorkspace(workspace);
        suppressNextSaveRef.current = true;
        await refreshBackendStatus();
        args.onStorageOutcome?.(null);
      } catch (err) {
        if (cancelled) return;
        args.onStorageOutcome?.(err);
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
    if (suppressNextSaveRef.current) {
      suppressNextSaveRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      backend.save({ tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status, project, milestones, changes, stakeholders }).then(() => {
        args.onStorageOutcome?.(null);
      }).catch((err) => {
        args.onStorageOutcome?.(err);
        // Turso connectivity/auth failures show the persistent banner — skip the toast.
        if (tursoErrorKind(err)) return;
        if (err instanceof StorageNotReadyError) {
          const hint = (err as StorageNotReadyError).hint;
          const key =
            hint === "local-file-permission-needed" ? "storagePermissionGestureNeeded" :
            hint === "local-file-write-blocked"     ? "storageWriteBlocked" :
                                                      "storageNotReady";
          args.showToast("error", t(langRef.current, key));
        } else if (!(err instanceof StorageNotImplementedError)) {
          args.showToast("error", t(langRef.current, "storageSaveFailed", String(err)));
        }
      });
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status, project, milestones, changes, stakeholders, args.hydrated, args.isPopout, backend]);

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

  async function onPickStorageFile() {
    const promise = pickFileForBackend(backend);
    if (!promise) return;
    await promise;
    try {
      await backend.save({ tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status, project, milestones, changes, stakeholders });
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
      await target.save({ tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status, project, milestones, changes, stakeholders });
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
    return { tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status, project, milestones, changes, stakeholders };
  }

  // Persist the registry AND surface the change to the caller so its observable
  // copy (task-manager's `registry` state) re-renders. Every project flow that
  // mutates the registry routes through here instead of calling saveRegistry
  // directly, so no update is missed.
  function commitRegistry(next: ProjectsRegistry): void {
    saveRegistry(next);
    args.onRegistryChange?.(next);
  }

  // Build a backend for an arbitrary config using the current deps. Shared by
  // the project flows; mirrors the memo'd `backend` construction.
  function backendFor(config: StorageConfig) {
    return createBackend(config, {
      acquireToken: auth.acquireToken,
      tursoConfig: getTursoConfig(
        settingsRef.current.integrations?.turso?.databaseUrl,
        settingsRef.current.integrations?.turso?.authToken,
      ),
    });
  }

  /**
   * Switch the active project to `id`.
   *
   * Flow: save the CURRENT project's data to the active backend → build the
   * target backend, attach its stored file handle (file projects), re-prompt
   * for permission if it was lost → LOAD the target's existing data and apply
   * it → suppress the auto-load that the storageConfig change would trigger →
   * point the active config + registry at the target.
   *
   * Unlike a storage switch, this does NOT migrate current data into the target
   * — it replaces the current workspace with the target's own saved data.
   */
  async function switchToProject(id: string): Promise<void> {
    if (args.isPopout) return;
    const registry = loadRegistry();
    const target = registry.projects.find((p) => p.id === id);
    if (!target) {
      args.showToast("error", t(langRef.current, "projectSwitchNotFound"));
      return;
    }
    if (registry.currentProjectId === id) return;
    try {
      // 1. Persist the outgoing project's data to its own backend (best-effort:
      //    a failing save must not strand the user on the old project).
      try {
        await backend.save(currentWorkspace());
      } catch {
        // Swallow — the outgoing backend may be unconfigured (e.g. no file
        // permission). The switch itself is the user's intent.
      }
      // 2. Build the target backend and attach its stored handle for files.
      const targetBackend = backendFor(target.storageConfig);
      const isFile = target.storageConfig.kind.startsWith("local-");
      if (isFile) {
        const handle = await getHandle(id);
        if (!handle) {
          args.showToast("error", t(langRef.current, "projectSwitchHandleMissing"));
          return;
        }
        const attach = setBackendFileHandle(targetBackend, handle);
        if (attach) await attach;
        // Re-prompt for permission if it was lost across reloads (user gesture
        // context: switching is triggered from a click).
        const grant = requestWriteAccessForBackend(targetBackend);
        if (grant) await grant;
      }
      // 3. Load the target's existing data and apply it.
      const loaded = await targetBackend.load();
      applyWorkspace(loaded);
      // 4. Suppress the auto-load the storageConfig change triggers (we just
      //    loaded), then point the active backend + registry at the target.
      suppressNextLoadRef.current = true;
      suppressNextSaveRef.current = true;
      args.setStorageConfig(target.storageConfig);
      commitRegistry(setCurrentProjectInRegistry(registry, id));
      args.showToast("info", t(langRef.current, "projectSwitchedToast", target.name));
    } catch (err) {
      reportProjectError(err);
    }
  }

  /**
   * Create a new project: pick a file location, write an EMPTY workspace that
   * carries the supplied meta, persist the handle per-project, register +
   * select it, then apply the new (empty) workspace into state.
   */
  async function createProject(meta: ProjectMeta, format: LocalStorageFormat): Promise<void> {
    if (args.isPopout) return;
    // Flush the outgoing project to its OWN backend first (best-effort). Setting
    // suppressNextSaveRef below cancels the pending debounced save, so edits made
    // within the 500ms window before creating another project would otherwise be
    // lost. Mirrors switchToProject's flush; must use the CURRENT active backend.
    try {
      await backend.save(currentWorkspace());
    } catch {
      // Swallow — the outgoing backend may be unconfigured (e.g. no file
      // permission). Creating the new project is the user's intent.
    }
    const id = crypto.randomUUID();
    const storageConfig: StorageConfig = { kind: localKindForFormat(format) };
    const ws: Workspace = { ...emptyWorkspace(), project: meta };
    try {
      const targetBackend = backendFor(storageConfig);
      // Save picker — grants readwrite implicitly when the user picks a file.
      const pick = pickFileForBackend(targetBackend);
      if (pick) await pick;
      await targetBackend.save(ws);
      await persistBackendHandle(targetBackend, id);
      const registry = addProject(
        loadRegistry(),
        { id, name: meta.name, code: meta.code, storageConfig },
        true,
      );
      commitRegistry(registry);
      // Apply the new (empty + meta) workspace and point the active backend at it.
      applyWorkspace(ws);
      suppressNextLoadRef.current = true;
      suppressNextSaveRef.current = true;
      args.setStorageConfig(storageConfig);
      args.showToast("info", t(langRef.current, "projectCreatedToast", meta.name));
    } catch (err) {
      reportProjectError(err);
    }
  }

  /**
   * Load a project from an arbitrary file the user picks. Opens the file,
   * reads its workspace, derives a registry entry (name/code from the loaded
   * project meta, else the file name), persists the handle, registers +
   * selects it, and applies the loaded data.
   */
  async function loadProjectFromFile(format: LocalStorageFormat = "json"): Promise<void> {
    if (args.isPopout) return;
    // Flush the outgoing project to its OWN backend first (best-effort). Setting
    // suppressNextSaveRef below cancels the pending debounced save, so edits made
    // within the 500ms window before opening another project would otherwise be
    // lost. Mirrors switchToProject's flush; must use the CURRENT active backend.
    try {
      await backend.save(currentWorkspace());
    } catch {
      // Swallow — the outgoing backend may be unconfigured (e.g. no file
      // permission). Opening the new project is the user's intent.
    }
    const id = crypto.randomUUID();
    const storageConfig: StorageConfig = { kind: localKindForFormat(format) };
    try {
      const targetBackend = backendFor(storageConfig);
      const open = openFileForBackend(targetBackend);
      if (!open) return;
      await open;
      const loaded = await targetBackend.load();
      const fileName = targetBackend.describe ? await targetBackend.describe() : null;
      await persistBackendHandle(targetBackend, id);
      const entry = deriveRegistryEntry({
        id,
        storageConfig,
        project: loaded.project,
        fileName: fileName ?? undefined,
      });
      commitRegistry(addProject(loadRegistry(), entry, true));
      applyWorkspace(loaded);
      suppressNextLoadRef.current = true;
      suppressNextSaveRef.current = true;
      args.setStorageConfig(storageConfig);
      args.showToast("info", t(langRef.current, "projectLoadedToast", entry.name));
    } catch (err) {
      reportProjectError(err);
    }
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

  return {
    storageDescription,
    storageReady,
    onPickStorageFile,
    onGrantWriteAccess,
    onOpenStorageFile,
    onRequestStorageSwitch,
    switchToProject,
    createProject,
    loadProjectFromFile,
  };
}
