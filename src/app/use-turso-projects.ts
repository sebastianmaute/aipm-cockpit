// src/app/use-turso-projects.ts
"use client";
//
// Mode-aware portfolio lifecycle handlers (create / update-meta / archive /
// restore / hard-delete) extracted from task-manager.tsx. FILE mode routes to
// the localStorage-registry callbacks; TURSO mode drives turso-portfolio
// operations against the shared multi-tenant DB and refreshes the project
// list afterwards.
//
// Every Turso flow here used to be fire-and-forget (`void (async () => ...)()`
// with no try/catch), so a rejected pipeline call (network down, token
// rejected) vanished silently. Each async block is now wrapped in try/catch
// and failures surface as an error toast with an operation-specific message.

import { useCallback } from "react";
import { t, type Lang } from "./i18n";
import { getTursoConfig } from "./turso-config";
import { listProjects, updateProjectMeta as tursoUpdateMeta } from "./turso-portfolio";
import { savePortfolioMode, type PortfolioMode } from "./portfolio-mode";
import type { ProjectListEntry } from "./turso-tenant-schema";
import type { NewProjectOpts } from "./new-project-workspace";
import type { ProjectMeta } from "./types";

/** File formats the create-project panel offers in FILE mode. */
export type ProjectFileFormat = "json" | "csv" | "md";

export interface UseTursoProjectsArgs {
  portfolioMode: PortfolioMode;
  lang: Lang;
  showToast: (kind: "info" | "error", text: string) => void;
  /** Settings-sourced Turso connection values (env vars may override; see getTursoConfig). */
  tursoDatabaseUrl: string | undefined;
  tursoAuthToken: string | undefined;
  /** Active Turso project id (null when none is selected yet). */
  tursoProjectId: string | null;
  // Turso backend operations (from useStorageBackend / refresh callback).
  switchToTursoProject: (id: string) => Promise<void>;
  createTursoProject: (meta: ProjectMeta, opts?: NewProjectOpts) => Promise<void>;
  archiveTursoProject: (id: string) => Promise<void>;
  restoreTursoProject: (id: string) => Promise<void>;
  hardDeleteTursoProject: (id: string) => Promise<void>;
  /** Re-fetches the project list and sets state; resolves with the fetched
   *  ACTIVE list (null on failure) so callers can reuse it without a 2nd fetch. */
  refreshTursoProjects: () => Promise<ProjectListEntry[] | null>;
  /** Mirror freshly saved meta into the in-memory workspace (Turso mode). */
  setProject: (meta: ProjectMeta) => void;
  // FILE-mode fallbacks — the mode branching lives in the returned handlers.
  createFileProject: (
    meta: ProjectMeta,
    format: ProjectFileFormat,
    opts?: NewProjectOpts,
  ) => void | Promise<void>;
  updateCurrentFileProject: (meta: ProjectMeta) => void;
}

export interface UseTursoProjectsResult {
  handleCreateProjectByMode: (
    meta: ProjectMeta,
    format: ProjectFileFormat,
    opts?: NewProjectOpts,
  ) => void;
  handleUpdateCurrentProjectByMode: (meta: ProjectMeta) => void;
  handleArchiveTursoProject: (id: string) => void;
  handleRestoreTursoProject: (id: string) => void;
  handleHardDeleteTursoProject: (id: string) => void;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useTursoProjects(args: UseTursoProjectsArgs): UseTursoProjectsResult {
  const {
    portfolioMode,
    lang,
    showToast,
    tursoDatabaseUrl,
    tursoAuthToken,
    tursoProjectId,
    switchToTursoProject,
    createTursoProject,
    archiveTursoProject,
    restoreTursoProject,
    hardDeleteTursoProject,
    refreshTursoProjects,
    setProject,
    createFileProject,
    updateCurrentFileProject,
  } = args;

  // Create — the panel/empty-state callback is (meta, format); Turso ignores the
  // file format and refreshes the shared list afterwards.
  const handleCreateProjectByMode = useCallback(
    (meta: ProjectMeta, format: ProjectFileFormat, opts: NewProjectOpts = {}) => {
      // Route to Turso when the portfolio is globally in Turso mode OR the user
      // picked Turso storage for this one project (opts.storage discriminator).
      const useTurso = portfolioMode === "turso" || opts.storage === "turso";
      if (useTurso) {
        const crossMode = portfolioMode !== "turso";
        void (async () => {
          try {
            await createTursoProject(meta, opts);
            await refreshTursoProjects();
            // Cross-mode create (global mode is "file" but the user chose Turso
            // storage for this project): persist the mode switch and reload so the
            // newly created Turso project becomes the active, visible portfolio.
            if (crossMode) {
              savePortfolioMode("turso");
              window.location.reload();
            }
          } catch (err) {
            showToast("error", t(lang, "projectCreateFailed", errorText(err)));
          }
        })();
      } else {
        void createFileProject(meta, format, opts);
      }
    },
    [portfolioMode, createTursoProject, refreshTursoProjects, createFileProject, showToast, lang],
  );

  // Update current project meta — Turso writes the projects-table row, mirrors
  // it into the in-memory workspace, and refreshes the list.
  const handleUpdateCurrentProjectByMode = useCallback(
    (meta: ProjectMeta) => {
      if (portfolioMode === "turso") {
        const cfg = getTursoConfig(tursoDatabaseUrl, tursoAuthToken);
        if (cfg && tursoProjectId) {
          void (async () => {
            try {
              await tursoUpdateMeta(cfg, meta, tursoProjectId);
              setProject(meta);
              await refreshTursoProjects();
            } catch (err) {
              showToast("error", t(lang, "projectUpdateFailed", errorText(err)));
            }
          })();
        }
      } else {
        updateCurrentFileProject(meta);
      }
    },
    [portfolioMode, tursoDatabaseUrl, tursoAuthToken, tursoProjectId, setProject, refreshTursoProjects, updateCurrentFileProject, showToast, lang],
  );

  // Re-point the active project after archiving/hard-deleting it: if the affected
  // id was active and it's now gone from the refreshed active list, switch to the
  // first remaining active project (none remaining → the empty-state takes over).
  // `refreshed` is the active list the preceding refreshTursoProjects() already
  // fetched — reuse it; only fall back to a listProjects fetch of our own when
  // the refresh failed (null) and we have no list to work with.
  const repointAfterRemoval = useCallback(
    (removedId: string, refreshed?: ProjectListEntry[] | null) => {
      if (tursoProjectId !== removedId) return;
      const cfg = getTursoConfig(tursoDatabaseUrl, tursoAuthToken);
      if (!cfg) return;
      void (async () => {
        try {
          const remaining = refreshed ?? (await listProjects(cfg));
          const survivor = remaining.find((p) => p.id !== removedId);
          if (survivor) await switchToTursoProject(survivor.id);
        } catch (err) {
          showToast("error", t(lang, "projectRepointFailed", errorText(err)));
        }
      })();
    },
    [tursoProjectId, tursoDatabaseUrl, tursoAuthToken, switchToTursoProject, showToast, lang],
  );

  const handleArchiveTursoProject = useCallback(
    (id: string) => {
      void (async () => {
        try {
          await archiveTursoProject(id);
          const refreshed = await refreshTursoProjects();
          repointAfterRemoval(id, refreshed);
        } catch (err) {
          showToast("error", t(lang, "projectArchiveFailed", errorText(err)));
        }
      })();
    },
    [archiveTursoProject, refreshTursoProjects, repointAfterRemoval, showToast, lang],
  );

  const handleRestoreTursoProject = useCallback(
    (id: string) => {
      void (async () => {
        try {
          await restoreTursoProject(id);
          await refreshTursoProjects();
        } catch (err) {
          showToast("error", t(lang, "projectRestoreFailed", errorText(err)));
        }
      })();
    },
    [restoreTursoProject, refreshTursoProjects, showToast, lang],
  );

  const handleHardDeleteTursoProject = useCallback(
    (id: string) => {
      void (async () => {
        try {
          await hardDeleteTursoProject(id);
          const refreshed = await refreshTursoProjects();
          repointAfterRemoval(id, refreshed);
        } catch (err) {
          showToast("error", t(lang, "projectHardDeleteFailed", errorText(err)));
        }
      })();
    },
    [hardDeleteTursoProject, refreshTursoProjects, repointAfterRemoval, showToast, lang],
  );

  return {
    handleCreateProjectByMode,
    handleUpdateCurrentProjectByMode,
    handleArchiveTursoProject,
    handleRestoreTursoProject,
    handleHardDeleteTursoProject,
  };
}
