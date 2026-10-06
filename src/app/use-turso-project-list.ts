// src/app/use-turso-project-list.ts
//
// The Turso portfolio's project lists: the active and archived lists read from
// the shared DB's `projects` table, the flag that says the list has loaded once,
// `refreshTursoProjects`, and the effect that runs it once settings hydrate.
// Extracted from task-manager.tsx (§491); move-only. The two Turso settings
// reads arrive as deps fields (`tursoDatabaseUrl`, `tursoAuthToken`) instead of
// optional chains on `settings`, with the same values in the same dependency array.
//
// ★ `refreshTursoProjects` KEEPS its `useCallback`, against Extraction convention 1,
// because downstream identity matters: the first-load effect below depends on it,
// and use-portfolio-projects.ts / use-turso-projects.ts put it in the dependency
// arrays of their handlers.
//
// ★★ `tursoListLoaded` flips only on SUCCESS. task-manager's empty-state and
// list-loading gates read it, so a failed fetch must leave it false rather than
// show a fresh-install empty state over a project list that merely failed to load.
"use client";
import { useCallback, useEffect, useState } from "react";
import { getTursoConfig } from "./turso-config";
import { listProjects, listArchivedProjects } from "./turso-portfolio";
import type { PortfolioMode } from "./portfolio-mode";
import type { ProjectListEntry } from "./turso-tenant-schema";

export interface TursoProjectListDeps {
  portfolioMode: PortfolioMode;
  hydrated: boolean;
  /** Settings-sourced Turso connection values (env vars may override; see getTursoConfig). */
  tursoDatabaseUrl: string | undefined;
  tursoAuthToken: string | undefined;
  /** task-manager's storage-status bridge: `null` on success, the error on failure. */
  reportStorageOutcome: (err: unknown | null) => void;
}

export function useTursoProjectList(deps: TursoProjectListDeps) {
  const { portfolioMode, hydrated, tursoDatabaseUrl, tursoAuthToken, reportStorageOutcome } = deps;

  const [tursoProjects, setTursoProjects] = useState<ProjectListEntry[]>([]);
  const [tursoArchived, setTursoArchived] = useState<ProjectListEntry[]>([]);
  const [tursoListLoaded, setTursoListLoaded] = useState(false);

  // Refresh the Turso project list (active + archived) from the shared DB. The
  // list is the source of truth in Turso mode; this is called on first load and
  // after every create/archive/restore/hard-delete. Only flips `tursoListLoaded`
  // on success so a transient connectivity failure doesn't flash the empty-state.
  // Returns the fetched ACTIVE list (null on failure/not-applicable) so callers
  // like repointAfterRemoval can reuse it instead of fetching it a second time.
  const refreshTursoProjects = useCallback(async (): Promise<ProjectListEntry[] | null> => {
    if (portfolioMode !== "turso") return null;
    const cfg = getTursoConfig(tursoDatabaseUrl, tursoAuthToken);
    if (!cfg) return null;
    try {
      const [active, archived] = await Promise.all([listProjects(cfg), listArchivedProjects(cfg)]);
      setTursoProjects(active);
      setTursoArchived(archived);
      setTursoListLoaded(true);
      reportStorageOutcome(null);
      return active;
    } catch (err) {
      reportStorageOutcome(err);
      // Do NOT set tursoListLoaded on error (avoids a false empty-state).
      return null;
    }
  }, [portfolioMode, tursoDatabaseUrl, tursoAuthToken, reportStorageOutcome]);

  useEffect(() => {
    if (!hydrated || portfolioMode !== "turso") return;
    // IIFE so the setState calls inside refreshTursoProjects run in a later
    // microtask (after the first await), never synchronously in the effect body.
    void (async () => {
      await refreshTursoProjects();
    })();
  }, [hydrated, portfolioMode, refreshTursoProjects]);

  return { tursoProjects, tursoArchived, tursoListLoaded, refreshTursoProjects };
}
