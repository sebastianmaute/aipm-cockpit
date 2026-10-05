// src/app/use-portfolio-projects.ts
//
// Deps-object hook factory extracted from task-manager.tsx (Phase 3 convention,
// §491). Holds the multi-project (portfolio) wiring task-manager hands to the
// Projects view, the project switcher and the empty state: the empty-state /
// project handlers (edit / new / load-from-file / restore / delete), the mode-aware
// project and archive lists, the per-device key-facts snapshot effect, the
// mode-aware switch, and the create / update / archive / restore / hard-delete
// handlers it composes from `useTursoProjects`. The registry copy, the Turso
// project lists and `refreshTursoProjects` stay in task-manager, which also
// reads them before this point. Called unconditionally with the live closure
// values via a typed `deps` object; the inline `useCallback`/`useMemo` keep
// the exact memoization the code had inline. Move-only: no behaviour change.
// ★ That memoization departs from Extraction convention 1 (non-memoized
// handlers) on purpose: the move keeps the identities the Projects view, the
// switcher and the empty state already received, so re-renders are unchanged.
//
// ★ Coverage-GATED on purpose (not in `coverage.exclude`): the delete handler's
// survivor switch, the mode-aware list mapping and the snapshot gate are real
// logic, not glue. `use-portfolio-projects.test.ts` pins them.
import { useCallback, useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import { t } from "./i18n";
import type { ProjectMeta } from "./types";
import type { AppView } from "./nav-config";
import type { ToastKind } from "./use-toast";
import type { useStorageBackend } from "./use-storage-backend";
import { saveRegistry, removeProject, type ProjectsRegistry, type ProjectRegistryEntry } from "./projects-registry";
import { deleteHandle } from "./project-file-handles";
import { keyFactsSnapshot, removeKeyFactsSnapshot, saveKeyFactsSnapshot } from "./project-key-facts-cache";
import { useTursoProjects, type UseTursoProjectsArgs } from "./use-turso-projects";
import type { ProjectListEntry } from "./turso-tenant-schema";

type StorageBackend = ReturnType<typeof useStorageBackend>;

export interface PortfolioProjectsDeps
  extends Pick<
    UseTursoProjectsArgs,
    | "portfolioMode"
    | "lang"
    | "tursoDatabaseUrl"
    | "tursoAuthToken"
    | "tursoProjectId"
    | "switchToTursoProject"
    | "createTursoProject"
    | "archiveTursoProject"
    | "restoreTursoProject"
    | "hardDeleteTursoProject"
    | "refreshTursoProjects"
  > {
  showToast: (kind: ToastKind, text: string) => void;
  isPopout: boolean;
  setActiveTab: Dispatch<SetStateAction<AppView>>;
  project: ProjectMeta | undefined;
  setProject: Dispatch<SetStateAction<ProjectMeta | undefined>>;
  portfolioCurrentId: string | null;
  registry: ProjectsRegistry;
  setRegistry: Dispatch<SetStateAction<ProjectsRegistry>>;
  tursoProjects: readonly ProjectListEntry[];
  tursoArchived: readonly ProjectListEntry[];
  switchToProject: StorageBackend["switchToProject"];
  createProject: StorageBackend["createProject"];
  loadProjectFromFile: StorageBackend["loadProjectFromFile"];
}

export function usePortfolioProjects(deps: PortfolioProjectsDeps) {
  const {
    portfolioMode,
    lang,
    showToast,
    isPopout,
    setActiveTab,
    project,
    setProject,
    portfolioCurrentId,
    registry,
    setRegistry,
    tursoProjects,
    tursoArchived,
    tursoDatabaseUrl,
    tursoAuthToken,
    tursoProjectId,
    switchToProject,
    createProject,
    loadProjectFromFile,
    switchToTursoProject,
    createTursoProject,
    archiveTursoProject,
    restoreTursoProject,
    hardDeleteTursoProject,
    refreshTursoProjects,
  } = deps;

  // --- Multi-project panel callbacks ----------------------------------
  //
  // Switch / create / load come straight from the storage hook (Task 10). The
  // empty-state / project handlers below are owned here because they wrap
  // those with state task-manager owns (the registry copy, the workspace's
  // `project`, the portfolio mode) and passes in.

  // Edit the current project's metadata. The existing save effect persists the
  // workspace (which carries `project`) — no side effects in the updater.
  const handleUpdateCurrentProject = useCallback(
    (meta: ProjectMeta) => setProject(meta),
    [setProject],
  );

  // Navigate to the Projects view, whose panel hosts the create modal.
  const handleNewProject = useCallback(() => setActiveTab("projects"), [setActiveTab]);

  // Empty-state "Load from file": in Turso mode this also flips the portfolio to
  // file mode (loadProjectFromFile persists the switch + reloads on success), so
  // the loaded project is reachable instead of being re-hidden by the Turso
  // empty-state gate. In file mode it is the plain picker.
  const handleLoadFromFileEmptyState = useCallback(() => {
    void loadProjectFromFile(
      undefined,
      portfolioMode === "turso" ? { switchPortfolioToFileOnSuccess: true } : undefined,
    );
  }, [loadProjectFromFile, portfolioMode]);

  // Empty-state "Restore an archived project": un-archive, refresh the list, and
  // switch to it. The archived project's workspace is still in memory (archive
  // doesn't clear it), so restoring the last-active id needs no reload; restoring
  // a different archived id loads it via switchToTursoProject. Each callee surfaces
  // its own error toast.
  const handleRestoreFromEmptyState = useCallback((id: string) => {
    void (async () => {
      await restoreTursoProject(id);
      await refreshTursoProjects();
      await switchToTursoProject(id);
    })();
  }, [restoreTursoProject, refreshTursoProjects, switchToTursoProject]);

  // De-register a project: drop it from the registry (observable copy updated),
  // best-effort delete its stored file handle. If the deleted project was
  // current and others remain, switch to the new current; if none remain, the
  // empty-state takes over on the next render.
  const handleDeleteProject = useCallback(
    (id: string) => {
      const wasCurrent = registry.currentProjectId === id;
      const next = removeProject(registry, id);
      if (next === registry) return; // unknown id — nothing changed
      void deleteHandle(id);
      // Drop the deleted project's per-device key-facts cache entry so it
      // doesn't keep occupying one of the 50 cached slots forever.
      removeKeyFactsSnapshot(id);
      // removeProject re-points currentProjectId to the first survivor. When the
      // CURRENT project was deleted and a survivor exists, load that survivor's
      // data. switchToProject early-returns if currentProjectId already equals
      // the target, so we persist the registry with currentProjectId cleared and
      // let switchToProject re-point it after loading the survivor's workspace.
      // Persist + update the observable copy; a failed localStorage write
      // (quota / disabled) is surfaced as a toast — the in-memory list stays
      // consistent for this session, only reload persistence is at risk.
      const persist = (reg: ProjectsRegistry) => {
        if (!saveRegistry(reg)) {
          showToast("error", t(lang, "projectsRegistrySaveFailed"));
        }
        setRegistry(reg);
      };
      const survivor = next.currentProjectId;
      if (wasCurrent && survivor) {
        persist({ ...next, currentProjectId: null });
        void switchToProject(survivor);
      } else {
        // Deleted a non-current project (or none remain). Persist as-is; if none
        // remain the empty-state takes over on the next render.
        persist(next);
      }
    },
    [registry, setRegistry, switchToProject, lang, showToast],
  );

  // --- Mode-aware portfolio derivations + handlers --------------------------
  //
  // FILE mode reads the localStorage registry; TURSO mode maps the shared DB's
  // project-list rows into the SAME ProjectRegistryEntry shape the UI expects.

  const portfolioProjects: ProjectRegistryEntry[] =
    portfolioMode === "turso"
      ? tursoProjects.map((e) => ({
          id: e.id,
          name: e.meta.name,
          code: e.meta.code,
          storageConfig: { kind: "turso" as const },
        }))
      : registry.projects;
  // Turso's project list already carries every project's full meta, so the
  // Projects view measures non-current rows' key facts from it rather than from
  // the per-device cache. Kept OFF ProjectRegistryEntry: that shape is persisted
  // in the localStorage registry. File mode has no live meta → undefined.
  const portfolioLiveMetaById = useMemo(
    () => (portfolioMode === "turso" ? new Map(tursoProjects.map((e) => [e.id, e.meta])) : undefined),
    [portfolioMode, tursoProjects],
  );
  const portfolioArchived: ProjectRegistryEntry[] =
    portfolioMode === "turso"
      ? tursoArchived.map((e) => ({
          id: e.id,
          name: e.meta.name,
          code: e.meta.code,
          storageConfig: { kind: "turso" as const },
        }))
      : [];
  // `portfolioCurrentId` is declared once, in task-manager beside the
  // next-actions memo that needs it, and passed in.

  // Per-device key-fact snapshot for the Projects list's NON-current rows
  // (spec §5.3). Side-effect-only localStorage write (no setState); `new Date()`
  // lives in the effect, never the render body; popouts are read-only and must
  // not mutate device state (mirrors use-landing-delta).
  // ★★ This relies on React batching `project` and the id into ONE render.
  // The call order is NOT uniform across paths: switchToProject and the two
  // Turso paths — switchToTursoProject and createTursoProject
  // (use-storage-turso-ops.ts) — both call applyWorkspace(...) BEFORE
  // setTursoProjectId(...). createProject and
  // loadProjectFromFile (use-storage-file-ops.ts) and createDemoProject's
  // non-Turso-portfolio branch (same file — its Turso-portfolio branch reloads
  // the page instead and never reaches this effect) all call commitRegistry(...)
  // BEFORE applyWorkspace(...) — the OPPOSITE order. The real invariant, the one
  // this effect actually depends on, does not care which comes first: on every
  // one of these paths both calls land in the SAME synchronous continuation
  // after the last `await`, so React batches them into one render and this
  // effect never observes the new project's meta filed under the old id (or
  // vice versa). If an `await` is ever inserted between the two calls on ANY of
  // them, one render will hold a mismatched pair and this effect will file the
  // snapshot under the wrong id (bounded: reopening that project overwrites
  // it). A registry name/code guard is NOT a fix: renameProject has no caller,
  // so the registry name does not follow meta edits and such a guard would
  // block every write after a rename.
  useEffect(() => {
    if (isPopout || !project || !portfolioCurrentId) return;
    saveKeyFactsSnapshot(portfolioCurrentId, keyFactsSnapshot(project, new Date().toISOString()));
  }, [isPopout, project, portfolioCurrentId]);

  // Switch — same navigation target ("New project" → projects view) in both
  // modes; the switch itself routes to the active backend's handler.
  const handleSwitchProjectByMode = useCallback(
    (id: string) =>
      portfolioMode === "turso" ? void switchToTursoProject(id) : void switchToProject(id),
    [portfolioMode, switchToTursoProject, switchToProject],
  );

  // Create / update-meta / archive / restore / hard-delete — extracted to
  // use-turso-projects.ts, which also surfaces failed Turso operations as
  // error toasts (they used to vanish silently).
  const {
    handleCreateProjectByMode,
    handleUpdateCurrentProjectByMode,
    handleArchiveTursoProject,
    handleRestoreTursoProject,
    handleHardDeleteTursoProject,
  } = useTursoProjects({
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
    createFileProject: createProject,
    updateCurrentFileProject: handleUpdateCurrentProject,
  });

  return {
    handleNewProject,
    handleLoadFromFileEmptyState,
    handleRestoreFromEmptyState,
    handleDeleteProject,
    portfolioProjects,
    portfolioLiveMetaById,
    portfolioArchived,
    handleSwitchProjectByMode,
    handleCreateProjectByMode,
    handleUpdateCurrentProjectByMode,
    handleArchiveTursoProject,
    handleRestoreTursoProject,
    handleHardDeleteTursoProject,
  };
}
