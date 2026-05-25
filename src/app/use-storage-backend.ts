"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ActivityEntry } from "./activity-log";
import { useBroadcastSync } from "./broadcast-sync";
import { type Lang, t } from "./i18n";
import type { Settings } from "./settings-menu";
import {
  StorageNotImplementedError,
  StorageNotReadyError,
  createBackend,
  openFileForBackend,
  pickFileForBackend,
  requestWriteAccessForBackend,
} from "./storage";
import { useWorkspace } from "./workspace-context";

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
  } = useWorkspace();

  // Reactive refs — synced via useEffect so effects don't re-register on every render
  const langRef = useRef(args.lang);
  const settingsRef = useRef(args.settings);
  useEffect(() => { langRef.current = args.lang; }, [args.lang]);
  useEffect(() => { settingsRef.current = args.settings; }, [args.settings]);

  // Backend instance — memoised on storageConfig identity
  const backend = useMemo(
    () => createBackend(args.settings.storageConfig),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [args.settings.storageConfig],
  );

  // Storage status
  const [storageReady, setStorageReady] = useState(false);
  const [storageDescription, setStorageDescription] = useState<string | null>(null);

  // Suppresses the save effect that fires immediately after a load
  const suppressNextSaveRef = useRef(false);

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
      try {
        const workspace = await backend.load();
        if (cancelled) return;
        setTasks(workspace.tasks ?? []);
        setRaid(workspace.raid ?? []);
        setAbsences(workspace.absences ?? []);
        setShifts(workspace.shifts ?? []);
        setResources(workspace.resources ?? []);
        setRoles(workspace.roles ?? []);
        setDisciplines(workspace.disciplines ?? []);
        setGrades(workspace.grades ?? []);
        if (workspace.plan) setPlan(workspace.plan);
        suppressNextSaveRef.current = true;
        await refreshBackendStatus();
      } catch (err) {
        if (cancelled) return;
        if (err instanceof StorageNotReadyError) {
          if (settingsRef.current.storageConfig.kind !== "browser") {
            const key = (err as StorageNotReadyError).hint === "local-file-permission-needed"
              ? "storagePermissionGestureNeeded"
              : "storageNotReady";
            args.showToast("error", t(langRef.current, key));
          }
        } else if (!(err instanceof StorageNotImplementedError)) {
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
      backend.save({ tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan }).catch((err) => {
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
  }, [tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, args.hydrated, args.isPopout, backend]);

  useBroadcastSync("tasks", tasks, setTasks);
  useBroadcastSync("raid", raid, setRaid);
  useBroadcastSync("absences", absences, setAbsences);
  useBroadcastSync("shifts", shifts, setShifts);
  useBroadcastSync("resources", resources, setResources);
  useBroadcastSync("roles", roles, setRoles);
  useBroadcastSync("disciplines", disciplines, setDisciplines);
  useBroadcastSync("grades", grades, setGrades);
  useBroadcastSync("activityLog", args.activityLog, args.setActivityLog);

  async function onPickStorageFile() {
    const promise = pickFileForBackend(backend);
    if (!promise) return;
    await promise;
    try {
      await backend.save({ tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan });
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

  return {
    storageDescription,
    storageReady,
    onPickStorageFile,
    onGrantWriteAccess,
    onOpenStorageFile,
  };
}
