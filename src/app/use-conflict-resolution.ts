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
// ★★★ AND IT IS CONDITIONAL, NEVER BLIND (fix round 1). The job arms `forceNextSave(seen)`, where `seen`
//   is the revision the refusal reported, i.e. the version the user was told about: the backend replaces
//   storage wholesale ONLY while it still holds that version, and otherwise refuses as usual, so a
//   request left pending (a destructive refusal, an incomplete load, a queue wait) can never overwrite
//   a version nobody was shown. The backend consumes that one-shot on the attempt whatever its outcome,
//   so nothing needs disarming after a failure. When the refusal could not say what storage holds
//   (`seen` null), there is no Overwrite at all.

import { useRef } from "react";
import { downloadJson } from "./download-json";
import { filenameStem } from "./filename-stem";
import { workspaceToJson, type StorageBackend, type Workspace } from "./workspace";

export type ConflictResolutionDeps = {
  /** The instance saving is paused on (this render's). */
  backend: StorageBackend;
  /** The revision the refusal that raised the pause reported (the version the user was shown), or null. */
  seenRevision: string | null;
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
  // The Overwrite asked for — its instance and the version it may replace — until a save job to it arms it.
  const overwriteForRef = useRef<{ backend: StorageBackend; expected: string } | null>(null);

  return {
    /** Reload: discard the live edits and apply the stored version (the other writer's). */
    resolveConflictReload: async (): Promise<void> => {
      overwriteForRef.current = null;
      await deps.reload();
    },
    /** Overwrite (already confirmed by the banner): reopen the gate so the next autosave writes the live
     *  workspace, and let that save's job arm the force. */
    resolveConflictOverwrite: (): void => {
      const expected = deps.seenRevision;
      if (expected !== null && deps.openGate()) overwriteForRef.current = { backend: deps.backend, expected };
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
    /** Runs one queued save job's write, first arming the conditional overwrite when one is pending for
     *  `target`. Call it INSIDE the job passed to `enqueueSave`, synchronously before the write. */
    runSaveJob: <R>(target: StorageBackend, write: () => Promise<R>): Promise<R> => {
      const pending = overwriteForRef.current;
      if (pending !== null && pending.backend === target) {
        overwriteForRef.current = null;
        target.forceNextSave?.(pending.expected);
      }
      return write();
    },
  };
}
