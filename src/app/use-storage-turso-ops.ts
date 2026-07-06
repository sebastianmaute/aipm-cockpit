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
import { buildNewProjectWorkspace, type NewProjectOpts } from "./new-project-workspace";
import { saveCurrentTursoProjectId, savePortfolioMode } from "./portfolio-mode";
import { TursoBackend } from "./turso-backend";
import {
  createProject as portfolioCreate,
  archiveProject as portfolioArchive,
  restoreProject as portfolioRestore,
  hardDeleteProject as portfolioHardDelete,
} from "./turso-portfolio";
import { writeSettings } from "./use-settings";
import { logDiag } from "./diagnostics";

/** Live closure values the Turso project flows read each render. */
export interface TursoProjectOpsDeps {
  isPopout: boolean;
  showToast: (kind: "info" | "error", text: string) => void;
  langRef: React.MutableRefObject<Lang>;
  settingsRef: React.MutableRefObject<Settings>;
  tursoConfigNow: () => TursoConfig | null;
  tursoProjectId: string | null;
  setTursoProjectId: (id: string | null) => void;
  backend: { save: (ws: Workspace) => Promise<void> };
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
  async function flushOutgoing(ws: Workspace): Promise<void> {
    try {
      await deps.backend.save(ws);
    } catch (err) {
      logDiag("warn", "storage.switchFlushFailed", { message: err instanceof Error ? err.message : String(err) });
      deps.showToast("error", t(deps.langRef.current, "storageSwitchFlushFailed"));
    }
  }

  async function switchToTursoProject(id: string): Promise<void> {
    if (deps.isPopout) return;
    const cfg = deps.tursoConfigNow();
    if (!cfg) {
      deps.showToast("error", t(deps.langRef.current, "projectsTursoUnreachable"));
      return;
    }
    if (deps.tursoProjectId === id) return;
    try {
      // Flush the outgoing project to the active backend before switching.
      await flushOutgoing(deps.currentWorkspace());
      const target = new TursoBackend(cfg, id);
      const loaded = await target.load();
      deps.applyWorkspace(loaded);
      deps.suppressNextLoadRef.current = true;
      deps.suppressNextSaveRef.current = true;
      deps.setTursoProjectId(id);
      saveCurrentTursoProjectId(id);
      deps.showToast("info", t(deps.langRef.current, "projectSwitchedToast", loaded.project?.name ?? id));
    } catch (err) {
      deps.reportProjectError(err);
    }
  }

  async function createTursoProject(meta: ProjectMeta, opts: NewProjectOpts = {}): Promise<void> {
    if (deps.isPopout) return;
    const cfg = deps.tursoConfigNow();
    if (!cfg) {
      deps.showToast("error", t(deps.langRef.current, "projectsTursoUnreachable"));
      return;
    }
    // Flush the outgoing project first (setting suppressNextSaveRef below cancels
    // the pending debounced save). Mirrors the file createProject flush.
    await flushOutgoing(deps.currentWorkspace());
    const id = crypto.randomUUID();
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
      deps.suppressNextLoadRef.current = true;
      deps.suppressNextSaveRef.current = true;
      deps.setTursoProjectId(id);
      saveCurrentTursoProjectId(id);
      deps.showToast("info", t(deps.langRef.current, "projectCreatedToast", meta.name));
    } catch (err) {
      deps.reportProjectError(err);
    }
  }

  // Migrate the CURRENT (file-mode) project into a brand-new Turso project,
  // carrying its full workspace, then switch the portfolio to Turso and reload so
  // the migrated project is the active one. Unlike createTursoProject (which
  // builds a fresh workspace), this copies the live workspace verbatim.
  async function migrateCurrentProjectToTurso(): Promise<void> {
    if (deps.isPopout) return;
    const cfg = deps.tursoConfigNow();
    if (!cfg) {
      deps.showToast("error", t(deps.langRef.current, "projectsTursoUnreachable"));
      return;
    }
    const ws = deps.currentWorkspace();
    const meta = ws.project;
    if (!meta) {
      deps.showToast("error", t(deps.langRef.current, "projectMigrateNoProject"));
      return;
    }
    // Flush the current file project before copying it.
    await flushOutgoing(ws);
    const id = crypto.randomUUID();
    try {
      await portfolioCreate(cfg, meta, id);
      await new TursoBackend(cfg, id).save(ws);
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
    if (deps.isPopout) return;
    const cfg = deps.tursoConfigNow();
    if (!cfg) {
      deps.showToast("error", t(deps.langRef.current, "projectsTursoUnreachable"));
      return;
    }
    try {
      await portfolioArchive(cfg, id);
      deps.showToast("info", t(deps.langRef.current, "projectArchivedToast"));
    } catch (err) {
      deps.reportProjectError(err);
    }
  }

  async function restoreTursoProject(id: string): Promise<void> {
    if (deps.isPopout) return;
    const cfg = deps.tursoConfigNow();
    if (!cfg) {
      deps.showToast("error", t(deps.langRef.current, "projectsTursoUnreachable"));
      return;
    }
    try {
      await portfolioRestore(cfg, id);
      deps.showToast("info", t(deps.langRef.current, "projectRestoredToast"));
    } catch (err) {
      deps.reportProjectError(err);
    }
  }

  async function hardDeleteTursoProject(id: string): Promise<void> {
    if (deps.isPopout) return;
    const cfg = deps.tursoConfigNow();
    if (!cfg) {
      deps.showToast("error", t(deps.langRef.current, "projectsTursoUnreachable"));
      return;
    }
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
