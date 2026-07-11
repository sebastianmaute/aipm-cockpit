// src/app/use-storage-file-ops.ts
//
// File / local (and demo) project operations for useStorageBackend, extracted
// as a hook factory. Like use-storage-turso-ops, the four handlers are
// re-created every render (they were unmemoized `function` declarations reading
// live render-scope state) — `useFileProjectOps(deps)` is called unconditionally
// each render with the live closure values, behavior-identical to the inline
// declarations. Named `use*` so the react-hooks purity rule permits receiving
// the hook's refs; it holds no state/effects — useStorageBackend still owns all
// state, refs, the load/save effects, and the shared helpers passed in via deps.
import type React from "react";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import type { Settings } from "./settings-types";
import {
  type LocalStorageFormat,
  type StorageBackend,
  type StorageConfig,
  type Workspace,
  formatFromFileName,
  openFileForBackend,
  pickFileForBackend,
  pickOpenFileAny,
  requestWriteAccessForBackend,
  setBackendFileHandle,
} from "./storage";
import { addProject, loadRegistry, saveRegistry, setCurrentProject as setCurrentProjectInRegistry } from "./projects-registry";
import { getHandle } from "./project-file-handles";
import { localKindForFormat, deriveRegistryEntry } from "./use-project-switch";
import { buildNewProjectWorkspace, type NewProjectOpts } from "./new-project-workspace";
import { resetMintState, snapshotMintState, restoreMintState } from "./id-mint-session";
import type { ProjectMeta } from "./types";
import { loadPortfolioMode, savePortfolioMode } from "./portfolio-mode";
import { writeSettings } from "./use-settings";

/** Live closure values the file/local project flows read each render. */
export interface FileProjectOpsDeps {
  isPopout: boolean;
  showToast: (kind: "info" | "error", text: string) => void;
  setStorageConfig: (config: StorageConfig) => void;
  langRef: React.MutableRefObject<Lang>;
  settingsRef: React.MutableRefObject<Settings>;
  backend: { save: (ws: Workspace) => Promise<void> };
  currentWorkspace: () => Workspace;
  applyWorkspace: (ws: Workspace) => void;
  backendFor: (config: StorageConfig) => StorageBackend;
  commitRegistry: (next: ReturnType<typeof loadRegistry>) => void;
  persistBackendHandle: (backendForProject: StorageBackend, id: string) => Promise<void>;
  reportProjectError: (err: unknown) => void;
  suppressNextLoadRef: React.MutableRefObject<boolean>;
  suppressNextSaveRef: React.MutableRefObject<boolean>;
}

export function useFileProjectOps(deps: FileProjectOpsDeps) {
  async function switchToProject(id: string): Promise<void> {
    if (deps.isPopout) return;
    const registry = loadRegistry();
    const target = registry.projects.find((p) => p.id === id);
    if (!target) {
      deps.showToast("error", t(deps.langRef.current, "projectSwitchNotFound"));
      return;
    }
    if (registry.currentProjectId === id) return;
    try {
      // 1. Persist the outgoing project's data to its own backend (best-effort:
      //    a failing save must not strand the user on the old project).
      try {
        await deps.backend.save(deps.currentWorkspace());
      } catch {
        // Swallow — the outgoing backend may be unconfigured (e.g. no file
        // permission). The switch itself is the user's intent.
      }
      // 2. Build the target backend and attach its stored handle for files.
      const targetBackend = deps.backendFor(target.storageConfig);
      const isFile = target.storageConfig.kind.startsWith("local-");
      if (isFile) {
        const handle = await getHandle(id);
        if (!handle) {
          deps.showToast("error", t(deps.langRef.current, "projectSwitchHandleMissing"));
          return;
        }
        const attach = setBackendFileHandle(targetBackend, handle);
        if (attach) await attach;
        // Re-prompt for permission if it was lost across reloads (user gesture
        // context: switching is triggered from a click).
        const grant = requestWriteAccessForBackend(targetBackend);
        if (grant) await grant;
      }
      // 3. Load the target's existing data and apply it.
      const loaded = await targetBackend.load();
      deps.applyWorkspace(loaded);
      // 4. Suppress the auto-load the storageConfig change triggers (we just
      //    loaded), then point the active backend + registry at the target.
      deps.suppressNextLoadRef.current = true;
      deps.suppressNextSaveRef.current = true;
      deps.setStorageConfig(target.storageConfig);
      deps.commitRegistry(setCurrentProjectInRegistry(registry, id));
      deps.showToast("info", t(deps.langRef.current, "projectSwitchedToast", target.name));
    } catch (err) {
      deps.reportProjectError(err);
    }
  }

  async function createProject(
    meta: ProjectMeta,
    format: LocalStorageFormat,
    opts: NewProjectOpts = {},
  ): Promise<void> {
    if (deps.isPopout) return;
    // Flush the outgoing project to its OWN backend first (best-effort). Setting
    // suppressNextSaveRef below cancels the pending debounced save, so edits made
    // within the 500ms window before creating another project would otherwise be
    // lost. Mirrors switchToProject's flush; must use the CURRENT active backend.
    try {
      await deps.backend.save(deps.currentWorkspace());
    } catch {
      // Swallow — the outgoing backend may be unconfigured (e.g. no file
      // permission). Creating the new project is the user's intent.
    }
    const id = crypto.randomUUID();
    const storageConfig: StorageConfig = { kind: localKindForFormat(format) };
    // A brand-new project starts a fresh id space — clear the session minter so
    // any template/AI seed ids start at #1 rather than continuing a previously
    // open project's high-water. applyWorkspace(ws) below reseeds from the
    // built data. Snapshot first: if the create fails (e.g. the user cancels
    // the save-file picker) before applyWorkspace reseeds, the STILL-ACTIVE old
    // project must keep its marks — restored in catch.
    const mintSnapshot = snapshotMintState();
    resetMintState();
    // Empty workspace by default; with a template/features opts it applies the
    // template's field-visibility + optional seed and sets per-project features.
    const ws: Workspace = buildNewProjectWorkspace(meta, opts);
    try {
      const targetBackend = deps.backendFor(storageConfig);
      // Save picker — grants readwrite implicitly when the user picks a file.
      const pick = pickFileForBackend(targetBackend);
      if (pick) await pick;
      await targetBackend.save(ws);
      await deps.persistBackendHandle(targetBackend, id);
      const registry = addProject(
        loadRegistry(),
        { id, name: meta.name, code: meta.code, storageConfig },
        true,
      );
      deps.commitRegistry(registry);
      // Apply the new (empty + meta) workspace and point the active backend at it.
      deps.applyWorkspace(ws);
      deps.suppressNextLoadRef.current = true;
      deps.suppressNextSaveRef.current = true;
      deps.setStorageConfig(storageConfig);
      deps.showToast("info", t(deps.langRef.current, "projectCreatedToast", meta.name));
    } catch (err) {
      // Create aborted before applyWorkspace reseeded — roll the minter back so
      // the still-active old project doesn't lose its high-water marks (which
      // would re-arm freed-id reuse).
      restoreMintState(mintSnapshot);
      deps.reportProjectError(err);
    }
  }

  /**
   * Load a project from an arbitrary file the user picks. Opens the file,
   * reads its workspace, derives a registry entry (name/code from the loaded
   * project meta, else the file name), persists the handle, registers +
   * selects it, and applies the loaded data.
   */
  // `format` undefined → auto-detect: a single picker accepts every supported
  // format (JSON/CSV/Markdown) and the format is derived from the picked file's
  // extension. Passing an explicit format keeps the old per-format picker.
  async function loadProjectFromFile(
    format?: LocalStorageFormat,
    opts?: { switchPortfolioToFileOnSuccess?: boolean },
  ): Promise<void> {
    if (deps.isPopout) return;
    // Flush the outgoing project to its OWN backend first (best-effort). Setting
    // suppressNextSaveRef below cancels the pending debounced save, so edits made
    // within the 500ms window before opening another project would otherwise be
    // lost. Mirrors switchToProject's flush; must use the CURRENT active backend.
    try {
      await deps.backend.save(deps.currentWorkspace());
    } catch {
      // Swallow — the outgoing backend may be unconfigured (e.g. no file
      // permission). Opening the new project is the user's intent.
    }
    const id = crypto.randomUUID();
    try {
      // Auto-detect: pick a file across all formats FIRST (still in the click's
      // user-gesture), derive the format from its name, then bind the handle to
      // the matching backend without a second picker. requestWriteAccess is
      // best-effort here so a later save doesn't need a fresh gesture; load only
      // needs read, so a denied upgrade does not block opening the project.
      let resolvedFormat = format;
      let preopenedBackend: StorageBackend | null = null;
      if (resolvedFormat === undefined) {
        const handle = await pickOpenFileAny();
        resolvedFormat = formatFromFileName(handle.name);
        preopenedBackend = deps.backendFor({ kind: localKindForFormat(resolvedFormat) });
        await setBackendFileHandle(preopenedBackend, handle);
        await requestWriteAccessForBackend(preopenedBackend);
      }
      const storageConfig: StorageConfig = { kind: localKindForFormat(resolvedFormat) };
      const targetBackend = preopenedBackend ?? deps.backendFor(storageConfig);
      if (!preopenedBackend) {
        const open = openFileForBackend(targetBackend);
        if (!open) return;
        await open;
      }
      const loaded = await targetBackend.load();
      const fileName = targetBackend.describe ? await targetBackend.describe() : null;
      await deps.persistBackendHandle(targetBackend, id);
      const entry = deriveRegistryEntry({
        id,
        storageConfig,
        project: loaded.project,
        fileName: fileName ?? undefined,
      });
      deps.commitRegistry(addProject(loadRegistry(), entry, true));
      deps.applyWorkspace(loaded);
      deps.suppressNextLoadRef.current = true;
      deps.suppressNextSaveRef.current = true;
      deps.setStorageConfig(storageConfig);
      deps.showToast("info", t(deps.langRef.current, "projectLoadedToast", entry.name));
      const droppedRows = targetBackend.lastImportDroppedRows ?? 0;
      if (droppedRows > 0) {
        deps.showToast("error", t(deps.langRef.current, "importDroppedRowsWarning", droppedRows));
      }
      // Cross-mode load (portfolio is currently Turso, but the user is loading a
      // local file from the empty state): persist the mode switch + file storage
      // config SYNCHRONOUSLY and reload so the app re-initialises in FILE mode
      // with the just-registered project active. Mirrors migrateCurrentProjectToTurso
      // in reverse and keeps the invariant portfolioMode==="turso" ⇔ storageConfig
      // kind "turso" intact (here both become file). Only runs on a SUCCESSFUL load
      // (a cancelled picker throws → the catch below, before this point).
      if (opts?.switchPortfolioToFileOnSuccess) {
        writeSettings({ ...deps.settingsRef.current, storageConfig });
        savePortfolioMode("file");
        window.location.reload();
      }
    } catch (err) {
      deps.reportProjectError(err);
    }
  }

  /**
   * Register the supplied workspace as a REAL local project (empty-state "Explore
   * a demo project" CTA). Mirrors createProject's register → save → apply → point
   * sequence, but takes a FULL workspace (the curated sample) instead of building
   * an empty one, and targets the BROWSER/IndexedDB local backend so there is NO
   * file picker (frictionless first run). Registering a project is what flips the
   * empty-state gate off so the views — and the guided-tour overlay — actually
   * mount; an apply-only path left the registry empty and the demo invisible.
   */
  async function createDemoProject(ws: Workspace): Promise<void> {
    if (deps.isPopout) return;
    // Flush the outgoing project first (best-effort) — mirrors createProject.
    // suppressNextSaveRef below cancels the pending debounced save.
    try {
      await deps.backend.save(deps.currentWorkspace());
    } catch {
      // Swallow — the outgoing backend may be unconfigured. The demo is the intent.
    }
    const id = crypto.randomUUID();
    // Browser/IndexedDB local backend — the default first-run kind. NO file picker
    // and persistBackendHandle is a no-op for it (it stores no FileSystem handle).
    const storageConfig: StorageConfig = { kind: "browser" };
    // Prefer the sample's own project meta (sample-workspace-small.json carries one);
    // synthesize a minimal label only if it is somehow missing.
    const meta: Pick<ProjectMeta, "name" | "code"> = ws.project
      ? { name: ws.project.name, code: ws.project.code }
      : { name: "Demo project", code: "DEMO" };
    try {
      const targetBackend = deps.backendFor(storageConfig);
      await targetBackend.save(ws);
      await deps.persistBackendHandle(targetBackend, id);
      const registry = addProject(
        loadRegistry(),
        { id, name: meta.name, code: meta.code, storageConfig },
        true,
      );
      // Turso portfolio mode: a local (browser-backed) demo project can't flip the
      // Turso-branch empty-state gate (it reads the Turso project LIST), so switch
      // the portfolio to file mode and reload — a portfolio-mode switch requires a
      // reload (mirrors loadProjectFromFile's switchPortfolioToFileOnSuccess).
      // Everything the reloaded app needs is DURABLY persisted before the reload:
      // the workspace to IndexedDB (awaited above) and the registry + settings +
      // portfolio mode to localStorage (synchronous) here. We deliberately SKIP the
      // in-place applyWorkspace/setStorageConfig React updates (the reload discards
      // them) to avoid a flash of the demo mounting then tearing down. After reload
      // showEmptyState is false (the registry now has the demo) and tourSeen is
      // still unset, so the tour auto-launches. The user's Turso DB is untouched
      // (non-destructive detach); switching back to Turso mode restores their list.
      if (loadPortfolioMode() === "turso") {
        saveRegistry(registry);
        writeSettings({ ...deps.settingsRef.current, storageConfig });
        savePortfolioMode("file");
        if (typeof window !== "undefined") window.location.reload();
        return;
      }

      // Default (file/local) mode: apply in place, no reload.
      deps.commitRegistry(registry);
      deps.applyWorkspace(ws);
      deps.suppressNextLoadRef.current = true;
      deps.suppressNextSaveRef.current = true;
      deps.setStorageConfig(storageConfig);
      deps.showToast("info", t(deps.langRef.current, "projectCreatedToast", meta.name));
    } catch (err) {
      deps.reportProjectError(err);
    }
  }

  return { switchToProject, createProject, loadProjectFromFile, createDemoProject };
}
