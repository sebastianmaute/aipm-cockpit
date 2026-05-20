"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ActivityEntry } from "./activity-log";
import { type Lang, t } from "./i18n";
import type { Settings } from "./settings-menu";
import { StorageNotImplementedError, StorageNotReadyError, createBackend } from "./storage";
import { useWorkspace } from "./workspace-context";

export interface UseStorageBackendArgs {
  settings: Settings;
  lang: Lang;
  hydrated: boolean;
  activityLog: ActivityEntry[];
  setActivityLog: React.Dispatch<React.SetStateAction<ActivityEntry[]>>;
  showToast: (kind: "info" | "error", text: string) => void;
}

export function useStorageBackend(args: UseStorageBackendArgs) {
  const { tasks, setTasks, raid, setRaid, absences, setAbsences, shifts, setShifts } = useWorkspace();

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

  const onPickStorageFile = async () => {};
  const onGrantWriteAccess = async () => {};
  const onOpenStorageFile = async () => {};

  return {
    storageDescription,
    storageReady,
    onPickStorageFile,
    onGrantWriteAccess,
    onOpenStorageFile,
  };
}
