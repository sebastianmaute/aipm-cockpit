// src/app/use-storage-turso-ops.ts
//
// Turso portfolio project operations for useStorageBackend, extracted as a
// plain factory. The six handlers are re-created every render (they were
// unmemoized `function` declarations in the hook body, so consumers never
// relied on stable identity) — `createTursoProjectOps(deps)` is called once per
// render with the live closure values, which is behavior-identical to the
// inline declarations it replaces. Named `use*` and called unconditionally as a
// hook so the react-hooks purity rule permits receiving the hook's refs; it
// holds no state/effects of its own — useStorageBackend still owns all state,
// refs, and the load/save effects.
import type React from "react";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import type { Settings } from "./settings-types";
import type { Workspace } from "./storage";
import type { ProjectMeta } from "./types";
import type { TursoConfig } from "./turso-config";
import { aiSeedUnsafeEmails, buildNewProjectWorkspace, type NewProjectOpts } from "./new-project-workspace";
import { resetMintState, snapshotMintState, restoreMintState } from "./id-mint-session";
import { saveCurrentTursoProjectId, savePortfolioMode } from "./portfolio-mode";
import { TursoBackend } from "./turso-backend";
import { testTursoConnection } from "./turso-pipeline";
import {
  createProject as portfolioCreate,
  archiveProject as portfolioArchive,
  restoreProject as portfolioRestore,
  hardDeleteProject as portfolioHardDelete,
} from "./turso-portfolio";
import { writeSettings } from "./use-settings";
import { summarizeUnsafeEmailRecords } from "./sanitize";
import { logDiag } from "./diagnostics";
import type { TruncationOps } from "./use-load-truncation";

/** Live closure values the Turso project flows read each render. */
export interface TursoProjectOpsDeps {
  isPopout: boolean;
  showToast: (kind: "info" | "error", text: string) => void;
  langRef: React.MutableRefObject<Lang>;
  settingsRef: React.MutableRefObject<Settings>;
  tursoConfigNow: () => TursoConfig | null;
  tursoProjectId: string | null;
  setTursoProjectId: (id: string | null) => void;
  /** ★★ The §103 choke points, and the ONLY way this file reaches the
   *  ACTIVE backend — see the note on `FileProjectOpsDeps.truncationOps`. */
  truncationOps: TruncationOps;
  currentWorkspace: () => Workspace;
  applyWorkspace: (ws: Workspace) => void;
  suppressNextLoadRef: React.MutableRefObject<boolean>;
  suppressNextSaveRef: React.MutableRefObject<boolean>;
  reportProjectError: (err: unknown) => void;
}

export function useTursoProjectOps(deps: TursoProjectOpsDeps) {
  // Flush the outgoing project before switching/creating/migrating away. A
  // failed flush (network blip, auth expiry, lock timeout) was previously
  // discarded silently, losing unsaved edits with no trace. Surface it (warn
  // toast + diagnostics) and proceed — the switch is non-blocking.
  // ★★ Takes no workspace: `flushCurrent` reads the LIVE one and skips entirely
  // while a truncated load is unresolved (see `TruncationOps`). A SKIP is not a
  // failure and must not raise the toast below — the source still holds the
  // documents, which is the whole point of pausing the write.
  async function flushOutgoing(): Promise<void> {
    try {
      await deps.truncationOps.flushCurrent();
    } catch (err) {
      logDiag("warn", "storage.switchFlushFailed", { message: err instanceof Error ? err.message : String(err) });
      deps.showToast("error", t(deps.langRef.current, "storageSwitchFlushFailed"));
    }
  }

  // Shared Turso-guard preamble for every project op: popouts never mutate, and
  // a missing/quarantined Turso config surfaces the same unreachable toast and
  // bails. Returns the live config, or null when the caller should return.
  const guardTurso = (): TursoConfig | null => {
    if (deps.isPopout) return null;
    const cfg = deps.tursoConfigNow();
    if (!cfg) {
      deps.showToast("error", t(deps.langRef.current, "projectsTursoUnreachable"));
      return null;
    }
    return cfg;
  };

  async function switchToTursoProject(id: string): Promise<void> {
    const cfg = guardTurso();
    if (!cfg) return;
    if (deps.tursoProjectId === id) return;
    try {
      // Flush the outgoing project to the active backend before switching.
      await flushOutgoing();
      const target = new TursoBackend(cfg, id);
      const loaded = await target.load();
      deps.applyWorkspace(loaded);
      // ★★ BEFORE `reportFor` — single-slot surface; see the landmine there.
      deps.showToast("info", t(deps.langRef.current, "projectSwitchedToast", loaded.project?.name ?? id));
      deps.truncationOps.reportFor(target);
      deps.suppressNextLoadRef.current = true;
      deps.suppressNextSaveRef.current = true;
      deps.setTursoProjectId(id);
      saveCurrentTursoProjectId(id);
    } catch (err) {
      deps.reportProjectError(err);
    }
  }

  async function createTursoProject(meta: ProjectMeta, opts: NewProjectOpts = {}): Promise<void> {
    const cfg = guardTurso();
    if (!cfg) return;
    // Flush the outgoing project first (setting suppressNextSaveRef below cancels
    // the pending debounced save). Mirrors the file createProject flush.
    await flushOutgoing();
    const id = crypto.randomUUID();
    // Fresh id space for a new project — clear the session minter so seed ids
    // start at #1, not continuing the previously open project's high-water.
    // applyWorkspace(ws) below reseeds from the built data. Snapshot first: a
    // failed create (e.g. Turso save throws) before applyWorkspace reseeds must
    // not wipe the still-active old project's marks — restored in catch.
    const mintSnapshot = snapshotMintState();
    resetMintState();
    const ws = buildNewProjectWorkspace(meta, opts);
    try {
      await portfolioCreate(cfg, meta, id);
      // Persist the new workspace (per-project features / field-visibility / seed)
      // into the new project's Turso tables NOW. The suppressNextSaveRef below
      // cancels the autosave the applyWorkspace setState would otherwise trigger,
      // so without this explicit save those rows would not land until the next
      // user edit. The file path saves explicitly too (targetBackend.save).
      await new TursoBackend(cfg, id).save(ws);
      deps.applyWorkspace(ws);
      deps.truncationOps.clearForFreshWorkspace(); // ★★★ §103: createTursoProject BUILDS its workspace, so no load ever reports for it — without this a fresh project inherits the previous one's pause and every edit to it is silently refused.
      deps.suppressNextLoadRef.current = true;
      deps.suppressNextSaveRef.current = true;
      deps.setTursoProjectId(id);
      saveCurrentTursoProjectId(id);
      deps.showToast("info", t(deps.langRef.current, "projectCreatedToast", meta.name));
      // ★ M5: template = copy source, notice-only; AI seed = unsafe addresses left blank, notice from the seed.
      const seededEmails = opts.template || opts.importedWorkspace ? summarizeUnsafeEmailRecords(ws) : aiSeedUnsafeEmails(opts);
      if (seededEmails) deps.showToast("info", t(deps.langRef.current, "importUnsafeEmailsNotice", seededEmails.count, seededEmails.names));
    } catch (err) {
      // Create aborted before applyWorkspace reseeded — roll the minter back so
      // the still-active old project doesn't lose its high-water marks (which
      // would re-arm freed-id reuse).
      restoreMintState(mintSnapshot);
      deps.reportProjectError(err);
    }
  }

  // Migrate the CURRENT (file-mode) project into a brand-new Turso project,
  // carrying its full workspace, then switch the portfolio to Turso and reload so
  // the migrated project is the active one. Unlike createTursoProject (which
  // builds a fresh workspace), this copies the live workspace verbatim.
  async function migrateCurrentProjectToTurso(): Promise<void> {
    const cfg = guardTurso();
    if (!cfg) return;
    const ws = deps.currentWorkspace();
    const meta = ws.project;
    if (!meta) {
      deps.showToast("error", t(deps.langRef.current, "projectMigrateNoProject"));
      return;
    }
    // ★★★ §103: DECLINE BEFORE `portfolioCreate`, not after it. That call inserts
    // a live, non-archived row into the shared portfolio DB — an irreversible
    // side effect — so refusing only at the write left a PHANTOM project named
    // after the user's, sitting in their Turso list and opening empty forever,
    // while the toast they saw said "nothing is overwritten". This is exactly the
    // case `refuseWrite` exists for, and migrate was the one caller with such a
    // side effect that did not use it.
    if (deps.truncationOps.wouldRefuseWrite()) { deps.truncationOps.refuseWrite(); return; }
    // ★★★ THE CONNECTION GATE LIVES HERE, NOT ON A BUTTON. `guardTurso` above
    // resolves a CONFIG, never a CONNECTION — a URL/token pair that has never
    // been reached passes it. Settings disables its "Move to Turso" until a
    // Test connection has passed and is still current, but that is one of TWO
    // controls bound to this handler: `projects-panel.tsx` renders a second one
    // gated only on `tursoConfigured`, and the Projects view is reachable on a
    // file backend (`projects` is absent from `TURSO_ONLY_VIEWS`). A probe in
    // the ops layer covers both, and any caller added later.
    // ★★★ AND IT SITS WITH THE OTHER DECLINES, ABOVE `portfolioCreate`, for the
    // reason the §103 comment directly above spells out: that call inserts a live,
    // non-archived row into the SHARED portfolio DB, so a refusal after it
    // leaves a phantom project. A probe placed after it would reintroduce
    // exactly that.
    // ★ NOTHING FROM THE THROW REACHES THE TOAST — the same
    // classify-never-interpolate rule `runTursoTest` documents in
    // `settings-sections/integrations-section.tsx`. Every message reachable
    // here is untranslated English and may carry the URL or the token;
    // `projectsTursoUnreachable` is the fixed key `guardTurso` already raises
    // for the sibling "Turso is not usable" decline, and it names both fields.
    try {
      await testTursoConnection(cfg);
    } catch {
      deps.showToast("error", t(deps.langRef.current, "projectsTursoUnreachable"));
      return;
    }
    // Flush the current file project before copying it.
    await flushOutgoing();
    const id = crypto.randomUUID();
    try {
      await portfolioCreate(cfg, meta, id);
      // ★★★ §103 BACKSTOP. Unlike `createTursoProject` above — which writes a
      // freshly-built workspace, so a truncated load is irrelevant to it — THIS
      // one copies the LIVE workspace verbatim (see the note above the
      // function). Untruncated it would write the SHORT copy, repoint the app at
      // it, and reload; after which the Turso project loads cleanly (it is under
      // the cap now), the flag never re-raises, and the missing documents survive
      // only in a file whose project has left the visible list.
      if (!(await deps.truncationOps.guardedWrite(new TursoBackend(cfg, id), ws))) return;
      // Make the migrated project the active Turso project and switch the
      // portfolio to Turso. The reload re-initialises the app in Turso mode.
      saveCurrentTursoProjectId(id);
      savePortfolioMode("turso");
      // Point the workspace storage backend at Turso too, persisted SYNCHRONOUSLY
      // so it survives the reload below. Without this the portfolio flips to Turso
      // while the backend memo still rebuilds a FILE/browser backend (its
      // storageConfig.kind is unchanged) — so the workspace keeps loading the
      // local file and snapshot capture (which reads the Turso config) fails with
      // "Storage not ready". portfolioMode === "turso" must imply storageConfig
      // kind "turso".
      writeSettings({ ...deps.settingsRef.current, storageConfig: { kind: "turso" } });
      window.location.reload();
    } catch (err) {
      deps.reportProjectError(err);
    }
  }

  async function archiveTursoProject(id: string): Promise<void> {
    const cfg = guardTurso();
    if (!cfg) return;
    try {
      await portfolioArchive(cfg, id);
      deps.showToast("info", t(deps.langRef.current, "projectArchivedToast"));
    } catch (err) {
      deps.reportProjectError(err);
    }
  }

  async function restoreTursoProject(id: string): Promise<void> {
    const cfg = guardTurso();
    if (!cfg) return;
    try {
      await portfolioRestore(cfg, id);
      deps.showToast("info", t(deps.langRef.current, "projectRestoredToast"));
    } catch (err) {
      deps.reportProjectError(err);
    }
  }

  async function hardDeleteTursoProject(id: string): Promise<void> {
    const cfg = guardTurso();
    if (!cfg) return;
    try {
      await portfolioHardDelete(cfg, id);
      deps.showToast("info", t(deps.langRef.current, "projectHardDeletedToast"));
    } catch (err) {
      deps.reportProjectError(err);
    }
  }

  return {
    switchToTursoProject,
    createTursoProject,
    migrateCurrentProjectToTurso,
    archiveTursoProject,
    restoreTursoProject,
    hardDeleteTursoProject,
  };
}
