// src/app/use-conflict-resolution.ts
//
// §4 — the three ways out of a conflict pause (a save refused because another tab or device saved
// first), behind the banner's Reload / Overwrite / Download my version. A deps-object hook called
// unconditionally by use-storage-backend.ts, which also routes every autosave job through
// `runSaveJob` so the Overwrite's force is armed where it belongs.
//
// ★★★ THE FORCE IS ARMED INSIDE A SAVE JOB, NEVER BY THE CLICK. `resolveConflictOverwrite` only reopens
//   the save gate and records the request; the next autosave job arms `forceNextSave()` synchronously
//   right before its write. Armed at the click instead, a write already waiting in the save queue (a
//   flush, a picked-file write) would run first and spend the force on ITS snapshot, and a refused save
//   would leave it armed for whatever autosave came next.
// ★★ A job arms only if it STARTS after the request: the request is consumed by the first job that
//   runs, and a job already running at the click has read no request. A job replaced in the queue
//   never runs, so the newer job that replaced it carries the request instead.
// ★★ A FORCED WRITE THAT FAILS IS DISARMED. The backends clear their force only after a write lands
//   (so a failed one would leave it standing), and the next ordinary autosave would then overwrite the
//   other writer's data again without the user having confirmed it. Re-adopting the instance's own
//   revision clears it (`adoptRevision` drops a pending force on every backend that has one); the next
//   save is checked again and, if the other writer's data still stands, pauses again.

import { useRef } from "react";
import { downloadJson } from "./download-json";
import { filenameStem } from "./filename-stem";
import { workspaceToJson, type StorageBackend, type Workspace } from "./workspace";

export type ConflictResolutionDeps = {
  /** The instance saving is paused on (this render's). */
  backend: StorageBackend;
  /** The LIVE workspace: the user's latest edits, not the refused save's snapshot. */
  currentWorkspace: () => Workspace;
  /** "Reload project" under its hold: it waits for queued saves, applies the stored version, reopens the
   *  save gate and drops this tab's unconfirmed journal copy. Kept slots are not touched. */
  reload: () => Promise<void>;
  /** Reopens the save gate for `backend` while a conflict pause holds on it; false (nothing opened) otherwise. */
  openGate: () => boolean;
  /** Says a download could not be started, naming the file. */
  onDownloadFailed: (fileName: string) => void;
};

/** `aipm-cockpit-<project>-conflict-<UTC time>.json`: the project name slugged by the export rule
 *  (`filenameStem`, which removes what Windows refuses) and a timestamp without colons. */
export function conflictFileName(projectName: string | undefined, now: Date): string {
  const stamp = now.toISOString().slice(0, 19).replace(/:/g, "-");
  return `aipm-cockpit-${filenameStem(projectName ?? "", "project")}-conflict-${stamp}.json`;
}

export function useConflictResolution(deps: ConflictResolutionDeps) {
  // The instance an Overwrite was asked for, until a save job to it arms the force.
  const overwriteForRef = useRef<StorageBackend | null>(null);

  const armOverwrite = (target: StorageBackend): boolean => {
    if (overwriteForRef.current === null || overwriteForRef.current !== target) return false;
    overwriteForRef.current = null;
    target.forceNextSave?.();
    return true;
  };

  return {
    /** Reload: discard the live edits and apply the stored version (the other writer's). */
    resolveConflictReload: async (): Promise<void> => {
      overwriteForRef.current = null;
      await deps.reload();
    },
    /** Overwrite (already confirmed by the banner): reopen the gate so the next autosave writes the live
     *  workspace, and let that save's job arm the force. */
    resolveConflictOverwrite: (): void => {
      if (deps.openGate()) overwriteForRef.current = deps.backend;
    },
    /** Download my version: the live workspace as a JSON file. Resolves nothing; the pause stays. */
    downloadConflictVersion: (): void => {
      const ws = deps.currentWorkspace();
      const fileName = conflictFileName(ws.project?.name, new Date());
      if (!downloadJson(fileName, workspaceToJson(ws))) deps.onDownloadFailed(fileName);
    },
    /** Drops a pending Overwrite: the gate was reopened by a load, which sets a new baseline. */
    cancelOverwrite: (): void => {
      overwriteForRef.current = null;
    },
    /** Runs one queued save job's write: arms the force first when an Overwrite is pending for `target`,
     *  and disarms it again if that write fails. Call it INSIDE the job passed to `enqueueSave`. */
    runSaveJob: async <R>(target: StorageBackend, write: () => Promise<R>): Promise<R> => {
      const forced = armOverwrite(target);
      try {
        return await write();
      } catch (err) {
        const revision = forced ? target.revision?.() : null;
        if (revision != null) target.adoptRevision?.(revision);
        throw err;
      }
    },
  };
}
