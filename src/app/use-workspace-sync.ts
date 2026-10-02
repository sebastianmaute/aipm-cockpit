// src/app/use-workspace-sync.ts
//
// §4 §642 §643 §645 — the tab-sync wiring of `useStorageBackend`, extracted as a deps-object hook
// (AGENTS.md "Extraction conventions"; final review m7, when that file reached its size LIMIT): the
// scope a main window's messages carry, the adoption of a peer's revision, and one
// `useBroadcastSync` per workspace slice. Called unconditionally from `useStorageBackend`, once per
// render, with live render-scope values; it returns the `SyncContext` the autosave posts revisions with.
import { useCallback, useMemo, useState } from "react";
import { useBroadcastSync, useRevisionSync, type SyncContext } from "./broadcast-sync";
import { whenSaved } from "./save-queue";
import type { PeerRevisionDeferral } from "./peer-revision-deferral";
import type { StorageConfig, Workspace } from "./storage";
import { readPopoutOpenerFromUrl, syncScopeKey } from "./sync-scope";
import { announcedRevision, type StorageBackend } from "./workspace";

/** The live value of every workspace slice, typed as the caller's state holds it. */
type Slices = { readonly [K in keyof Workspace]-?: unknown };

export interface WorkspaceSyncDeps<S extends Slices> {
  isPopout: boolean;
  storageConfig: StorageConfig;
  /** The Turso database URL in use, when the storage is Turso. Never the auth token. */
  tursoDatabaseUrl: string | undefined;
  tursoProjectId: string | null;
  /** The binding of the local file this window is bound to (`LocalFileBackend.fileBinding`); `null` when unknown. */
  fileBinding: string | null;
  getScopeEpoch: () => number;
  isLoadedValue: (value: unknown, kind?: string) => boolean;
  backend: StorageBackend;
  /** Every slice's live value in this render. */
  slices: S;
  /** §666 — where a peer's revision goes when this window's own save is queued or running. */
  peerRevision: PeerRevisionDeferral;
  /** One applier per slice: applies a peer's value through the mirror ledger (`mirrorApply` in `useStorageBackend`). */
  mirrorApply: { readonly [K in keyof Workspace]-?: (value: S[K], fromWindow: string) => void };
}

export function useWorkspaceSync<S extends Slices>(deps: WorkspaceSyncDeps<S>): SyncContext {
  const { isPopout, storageConfig, tursoDatabaseUrl, tursoProjectId, fileBinding, getScopeEpoch, isLoadedValue, backend, slices: ws, mirrorApply, peerRevision } = deps;
  // §645 (final re-review 2 RI2) — what an UNKNOWN local-file binding scopes to: a token of this window's
  // own, so a window that has not learnt its binding (a failed or refused load, an old bare-handle slot,
  // a tab still on old code) syncs with nobody. That errs toward a visible pause, never toward mirroring
  // a window on another file.
  const [isolationToken] = useState(() => `unbound:${crypto.randomUUID()}`);
  // ★★ §642/§643 — the channel is shared by every window of the origin. A main window syncs only
  // with main windows whose `syncScopeKey` equals its own: the storage it WRITES (`sync-scope.ts`),
  // never the registry's current project, which every tab shares through localStorage. Windows on
  // different storage never apply, and then autosave, each other's slices. ★ Browser storage is ONE
  // store for every tab, so its windows exchange slices whatever registry project each shows; a local
  // file is keyed by the file this window is bound to (`fileBinding`, §645). A pop-out follows its opener.
  const syncScope = useMemo(
    () => syncScopeKey({ storageConfig, tursoDatabaseUrl, tursoProjectId, fileBinding, isolationToken }),
    [storageConfig, tursoDatabaseUrl, tursoProjectId, fileBinding, isolationToken],
  );
  const syncContext = useMemo<SyncContext>(
    () => (isPopout ? { role: "popout", openerId: readPopoutOpenerFromUrl() } : { role: "main", scope: syncScope, getEpoch: getScopeEpoch, isLoadedValue }),
    [isPopout, syncScope, getScopeEpoch, isLoadedValue],
  );
  const adoptPeerRevision = useCallback((revision: string, baseRevision: string) => {
    // Adopt only from the revision this window holds: `fromLoad` slices are not mirrored, so a window that missed a reload (or is paused on a real conflict) would otherwise adopt and then save its stale copy over it.
    if (announcedRevision(backend) !== baseRevision) return; // also false for a null revision: `baseRevision` is always a string. §656 m2 — `announcedRevision`, so two windows that loaded a SharePoint file as absent match
    // §666 — not while a save is queued or running: it may have been built without the peer's slices. The revision is DEFERRED instead (peer-revision-deferral.ts), so that save is skipped or retried from a snapshot that holds them, rather than meeting the revision and pausing. Residual: a save released by the 30 s stall timer (`SAVE_STALL_MS`) reads idle while still running — narrow, accepted.
    if (whenSaved(backend) !== null) { peerRevision.defer(backend, revision, baseRevision); return; }
    backend.adoptRevision?.(revision);
  }, [backend, peerRevision]);
  useRevisionSync(syncContext, adoptPeerRevision);
  useBroadcastSync("tasks", ws.tasks, mirrorApply.tasks, syncContext);
  useBroadcastSync("raid", ws.raid, mirrorApply.raid, syncContext);
  useBroadcastSync("absences", ws.absences, mirrorApply.absences, syncContext);
  useBroadcastSync("shifts", ws.shifts, mirrorApply.shifts, syncContext);
  useBroadcastSync("resources", ws.resources, mirrorApply.resources, syncContext);
  useBroadcastSync("roles", ws.roles, mirrorApply.roles, syncContext);
  useBroadcastSync("disciplines", ws.disciplines, mirrorApply.disciplines, syncContext);
  useBroadcastSync("grades", ws.grades, mirrorApply.grades, syncContext);
  useBroadcastSync("budgets", ws.budgets, mirrorApply.budgets, syncContext);
  useBroadcastSync("milestones", ws.milestones, mirrorApply.milestones, syncContext);
  useBroadcastSync("changes", ws.changes, mirrorApply.changes, syncContext);
  useBroadcastSync("stakeholders", ws.stakeholders, mirrorApply.stakeholders, syncContext);
  // ★ `documents` and `documentVersions` must stay in step: the autosave writes the WHOLE workspace, so a tab
  //   holding a stale half overwrites the other tab's work — the same reason `documents` is synced. ★ Secondary:
  //   `deletedDocumentVersions` derives tombstones from BOTH slices, and `documents-panel.tsx` renders that list
  //   (its deleted-documents section and the toolbar count), so a desynced tab produces a WRONG visible list with
  //   Restore buttons on it — an observable symptom, not a latent one.
  useBroadcastSync("documents", ws.documents, mirrorApply.documents, syncContext);
  useBroadcastSync("documentVersions", ws.documentVersions, mirrorApply.documentVersions, syncContext);
  // ★ Now the WORKSPACE slice, not a per-device arg: the autosave writes the WHOLE workspace, so a tab holding a
  //   stale log would overwrite the other tab's entries — the same reason `documents` is synced above.
  //   `mergeActivityLogs` cannot cover this; it runs on LOAD, not on a broadcast.
  useBroadcastSync("activityLog", ws.activityLog, mirrorApply.activityLog, syncContext);
  // ★ Same reason as `activityLog`: the autosave writes the whole workspace, so a tab with a stale history would overwrite the other tab's entries.
  useBroadcastSync("budgetHistory", ws.budgetHistory, mirrorApply.budgetHistory, syncContext);
  // §4 — the remaining workspace parts: the autosave writes the WHOLE workspace, so a window holding a stale copy of any of them would overwrite the other window's edit.
  useBroadcastSync("plan", ws.plan, mirrorApply.plan, syncContext);
  useBroadcastSync("fxRates", ws.fxRates, mirrorApply.fxRates, syncContext);
  useBroadcastSync("status", ws.status, mirrorApply.status, syncContext);
  useBroadcastSync("fieldVisibility", ws.fieldVisibility, mirrorApply.fieldVisibility, syncContext);
  useBroadcastSync("features", ws.features, mirrorApply.features, syncContext);
  useBroadcastSync("steeringCommittee", ws.steeringCommittee, mirrorApply.steeringCommittee, syncContext);
  useBroadcastSync("timelogLinks", ws.timelogLinks, mirrorApply.timelogLinks, syncContext);
  useBroadcastSync("knowledgeItems", ws.knowledgeItems, mirrorApply.knowledgeItems, syncContext);
  useBroadcastSync("insights", ws.insights, mirrorApply.insights, syncContext);
  useBroadcastSync("settingsOverrides", ws.settingsOverrides, mirrorApply.settingsOverrides, syncContext);
  useBroadcastSync("calendarEvents", ws.calendarEvents, mirrorApply.calendarEvents, syncContext);
  useBroadcastSync("documentAssets", ws.documentAssets, mirrorApply.documentAssets, syncContext);
  // `project` (ProjectMeta | undefined) so a main-window project switch live-updates
  // the read-only project header in popout windows. The generic handles undefined.
  useBroadcastSync("project", ws.project, mirrorApply.project, syncContext);
  return syncContext;
}
