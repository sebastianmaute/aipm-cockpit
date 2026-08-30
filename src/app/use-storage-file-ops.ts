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
  type StorageKind,
  type Workspace,
  createBackend,
  formatFromFileName,
  loadFromHandleForBackend,
  openFileForBackend,
  pickFileForBackend,
  pickOpenFileAny,
  requestWriteAccessForBackend,
  setBackendFileHandle,
  StorageNotReadyError,
} from "./storage";
import { addProject, loadRegistry, saveRegistry, setCurrentProject as setCurrentProjectInRegistry } from "./projects-registry";
import { getHandle } from "./project-file-handles";
import { localKindForFormat, deriveRegistryEntry } from "./use-project-switch";
import { buildNewProjectWorkspace, type NewProjectOpts } from "./new-project-workspace";
import { resetMintState, snapshotMintState, restoreMintState, seedMintFromWorkspace } from "./id-mint-session";
import type { ProjectMeta, RaidItem, Task } from "./types";
import { loadPortfolioMode, savePortfolioMode } from "./portfolio-mode";
import { writeSettings } from "./use-settings";
import type { TruncationOps } from "./use-load-truncation";
import { getTursoConfig } from "./turso-config";
import { isTursoLockTimeout } from "./storage-error";
import { STORAGE_LABEL_KEYS } from "./use-storage-backend-types";
import type { UseMsAuthResult } from "./use-ms-auth";

/** Live closure values the file/local project flows read each render. */
export interface FileProjectOpsDeps {
  isPopout: boolean;
  showToast: (kind: "info" | "error", text: string) => void;
  setStorageConfig: (config: StorageConfig) => void;
  langRef: React.MutableRefObject<Lang>;
  settingsRef: React.MutableRefObject<Settings>;
  /** ★★ The §103 choke points, and the ONLY way this file reaches the
   *  ACTIVE backend. There is deliberately no `backend` dep: every flush here
   *  is a best-effort pre-switch write of the LIVE workspace, which is exactly
   *  the write that must not commit a truncated load. Removing the raw handle
   *  makes the bypass unspellable rather than merely discouraged. Loads still
   *  use their own TARGET backend (a fresh project's data, never the live
   *  workspace) and report through `reportFor`. */
  truncationOps: TruncationOps;
  /** ★ No `currentWorkspace` either — the live workspace only ever left this
   *  file through the four flushes above, and `flushCurrent` now reads it. */
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
      //    ★★ Guarded: this is the flush that used to commit the truncated load
      //    the banner had just told the user was paused — the user switches
      //    project to get away from the problem and the switch itself destroys
      //    the documents. `flushCurrent` skips instead.
      try {
        await deps.truncationOps.flushCurrent();
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
      // ★★ THIS TOAST FIRES BEFORE `reportFor`, NOT AFTER — see the landmine on
      //    `TruncationOps.reportFor`. The surface is single-slot, so whichever of
      //    the two runs LAST is the only one the user ever sees, and this one is
      //    the disposable half (a confirmation with no remedy attached).
      deps.showToast("info", t(deps.langRef.current, "projectSwitchedToast", target.name));
      deps.truncationOps.reportFor(targetBackend);
      // 4. Suppress the auto-load the storageConfig change triggers (we just
      //    loaded), then point the active backend + registry at the target.
      deps.suppressNextLoadRef.current = true;
      deps.suppressNextSaveRef.current = true;
      deps.setStorageConfig(target.storageConfig);
      deps.commitRegistry(setCurrentProjectInRegistry(registry, id));
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
      await deps.truncationOps.flushCurrent();
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
      deps.truncationOps.clearForFreshWorkspace(); // ★★★ §103: createProject BUILDS its workspace, so no load ever reports for it — without this a fresh project inherits the previous one's pause and every edit to it is silently refused.
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
      await deps.truncationOps.flushCurrent();
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
        // ★ Adoption IS the intent on this path — there is no confirm to lose,
        //   so the handle is committed straight away. Contrast
        //   `onOpenStorageFile`, which must wait for the user (§287).
        await setBackendFileHandle(targetBackend, await open);
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
      // ★★ BEFORE `reportFor` — single-slot surface; see the landmine there. This
      //    is the site the inline dropped-rows block used to live at, where it sat
      //    AFTER this toast and therefore survived; centralising it into `reportFor`
      //    silently moved it in FRONT and the count stopped painting.
      deps.showToast("info", t(deps.langRef.current, "projectLoadedToast", entry.name));
      deps.truncationOps.reportFor(targetBackend);
      deps.suppressNextLoadRef.current = true;
      deps.suppressNextSaveRef.current = true;
      deps.setStorageConfig(storageConfig);
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
      await deps.truncationOps.flushCurrent();
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
      deps.truncationOps.clearForFreshWorkspace(); // ★★★ §103: createDemoProject BUILDS its workspace, so no load ever reports for it — without this a fresh project inherits the previous one's pause and every edit to it is silently refused.
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

/** Live closure values the file-picker / storage-backend-switch flows read each render. */
export interface StorageFilePickerDeps {
  isPopout: boolean;
  /** The ACTIVE backend instance — every op here targets it directly (unlike
   *  `FileProjectOpsDeps`, which reaches the active backend only through
   *  `truncationOps`; these four ops call `pickFileForBackend`/
   *  `openFileForBackend`/etc. against it directly, mirroring the inline
   *  declarations this hook replaces). */
  backend: StorageBackend;
  truncationOps: TruncationOps;
  currentWorkspace: () => Workspace;
  refreshBackendStatus: () => Promise<void>;
  emitToast: (kind: "info" | "error" | "success", text: string) => void;
  langRef: React.MutableRefObject<Lang>;
  settingsRef: React.MutableRefObject<Settings>;
  suppressNextSaveRef: React.MutableRefObject<boolean>;
  suppressNextLoadRef: React.MutableRefObject<boolean>;
  emitStorageConfig: (config: StorageConfig) => void;
  acquireToken: UseMsAuthResult["acquireToken"];
  setTasks: React.Dispatch<React.SetStateAction<readonly Task[]>>;
  setRaid: React.Dispatch<React.SetStateAction<readonly RaidItem[]>>;
  tasks: readonly Task[];
}

export function useStorageFilePickerOps(deps: StorageFilePickerDeps) {
  async function onPickStorageFile() {
    if (deps.truncationOps.wouldRefuseWrite()) { deps.truncationOps.refuseWrite(); return; } // ★★★ §103: refuse BEFORE the picker — it creates the file and persists the handle on the ACTIVE backend, so a write-only guard stranded the app on an empty file. See `refuseWrite` (use-load-truncation.ts).
    const promise = pickFileForBackend(deps.backend);
    if (!promise) return;
    await promise;
    try {
      if (!(await deps.truncationOps.guardedWrite(deps.backend, deps.currentWorkspace()))) return; // ★ Kept as the backstop: the pre-check above is the one that matters, but a truncating load landing between them must still not commit.
      await deps.refreshBackendStatus();
      deps.emitToast("info", t(deps.langRef.current, "storageSwitchedToast"));
    } catch (err) {
      deps.emitToast("error", t(deps.langRef.current, "storageSaveFailed", String(err)));
    }
  }

  async function onGrantWriteAccess() {
    const promise = requestWriteAccessForBackend(deps.backend);
    if (!promise) return;
    const granted = await promise;
    await deps.refreshBackendStatus();
    if (granted) {
      deps.emitToast("info", t(deps.langRef.current, "storagePermissionGranted"));
    } else {
      deps.emitToast("error", t(deps.langRef.current, "storagePermissionDenied"));
    }
  }

  async function onOpenStorageFile() {
    const promise = openFileForBackend(deps.backend);
    if (!promise) return;
    const picked = await promise;
    try {
      const load = loadFromHandleForBackend(deps.backend, picked);
      if (!load) throw new StorageNotReadyError("local-file-not-picked"); // Unreachable: `openFileForBackend` returned non-null above, so this IS the LocalFileBackend, and both facade helpers narrow on the same `instanceof` against the same instance. The guard exists only because every facade helper is uniformly nullable. ★★★ A `throw`, NEVER a `return`. BOTH exit above `reportImportFor`, and that is fine here — no load has happened yet, so there are no import diagnostics to report. What differs is SILENCE: a bare `return` makes the user's click do nothing and say nothing, while the throw reaches the catch below and surfaces a real error. Nothing pins that the two helpers' predicates stay in agreement, so if this ever DOES become reachable it must fail loudly. ★★ Its neighbour `setBackendFileHandle` below is nullable for the same reason and is deliberately NOT hardened — do not read the asymmetry as a claim it is safer: a `null` there `await`s to nothing, so the pick would go silently UNBOUND while the apply proceeded, which is the worse failure of the two. It is left alone because a second unreachable guard costs a line this file has no budget for, not because it cannot go wrong.
      const loaded = await load; // ★ `reportImportFor`, NOT `reportFor` — see the report at the end of this try. This path applies tasks+raid ONLY, never the loaded documents, so raising the §103 flag would warn about documents the user still has and lowering it would clear a warning still true of the live ones. That reason is TRUNCATION-specific and never covered the import channel (§152): `droppedRows` is one workspace-wide count bumped at five sites across BOTH codec families, so the rows a malformed CSV *or Markdown* file dropped may be the very tasks and RAID applied below. ★★ COUNT THE CALL SITES, NOT THE INCREMENTS — every bump now routes through one writer, so the obvious `grep -rn "droppedRows++"` reads as a refutation of this sentence: `grep -rn "countDroppedRow(" src/app --include=*.ts | grep -v "\.test\." | grep -v "export function"` returns the five (3 CSV + 2 Markdown).
      // ★★★ A GUARD CLAUSE INVERTED ON PURPOSE, so ONE report below covers BOTH exits OF THE CONFIRM: the decline path needs the import report and the quoting hold every bit as much as the apply path does — a malformed file drops the same rows whichever way the confirm goes — and an early `return` above would have silently exempted it (§152). ★★ The re-point that used to happen on BOTH exits is GONE — `openFileForBackend` commits nothing now, and the handle is bound inside the accept branch below (§287).
      const accepted = deps.tasks.length === 0 || window.confirm(t(deps.langRef.current, "storageConfirmOverwrite", deps.tasks.length));
      if (accepted) {
        await setBackendFileHandle(deps.backend, picked); // ★ commit the pick ONLY now (§287) — before this line the backend still points at the previous file, so a decline leaves nothing to undo.
        deps.suppressNextSaveRef.current = true; // ★★★ AFTER the bind, never before. The flag suppresses the save that the `setTasks` below triggers, and `setTasks` runs after this line either way — but a bind that THROWS jumps to the catch, and an already-armed flag would then swallow the next legitimate save of a workspace nothing had modified. Arming it here means a failed bind leaves no residue.
        // Seed the session minter from the opened file so its (possibly larger)
        // task/raid ids can't be reused after a delete. "raise" never lowers a
        // kind's mark, so the absences/shifts NOT applied below keep their
        // current-project high-water intact.
        seedMintFromWorkspace(loaded, "raise");
        deps.setTasks(loaded.tasks);
        deps.setRaid(loaded.raid);
        // NOTE: absences and shifts intentionally NOT restored here —
        // faithful extraction of original behavior (not a bug fix).
        await deps.refreshBackendStatus();
        deps.emitToast("info", t(deps.langRef.current, "storageOpenedToast", loaded.tasks.length));
      }
      // ★★★ AFTER the toast above, never before: the surface is single-slot and REPLACES, so a diagnostic fired first is created and instantly discarded. The confirmation is the disposable half — it carries no remedy, and a clean import shows nothing here so it still paints. See the landmine on `TruncationOps.reportFor`.
      deps.truncationOps.reportImportFor(deps.backend, accepted); // ★★★ THE SECOND ARGUMENT IS THE DECISION, NOT A FORMALITY: diagnostics fire on BOTH exits OF THE CONFIRM — not on both exits of the function, since a rejecting `setBackendFileHandle` jumps to the catch and never reaches this line, leaving that file's dropped rows unreported (pre-existing, not this branch's) — the quoting HOLD only when a pending save could actually reach the file just read — ACCEPT alone since §287, because DECLINE commits nothing and leaves the backend on the user's previous file. A bare `true` here restores a real regression (autosave of an untouched project halted all session over a file the user refused to open) and no gate would notice. Full reasoning on `TruncationOps.reportImportFor`.
    } catch (err) {
      if (err instanceof StorageNotReadyError) {
        const key =
          (err as StorageNotReadyError).hint === "local-file-permission-needed"
            ? "storagePermissionGestureNeeded"
            : "storageNotReady";
        deps.emitToast("error", t(deps.langRef.current, key));
      } else {
        deps.emitToast("error", t(deps.langRef.current, "storageLoadFailed", String(err)));
      }
    }
  }

  // Reads the current workspace via render-scope closure — same pattern
  // as onPickStorageFile/onOpenStorageFile. Must NOT be memoized by consumers,
  // or it would capture a stale snapshot of tasks/raid/etc. The same applies to
  // the emitters it calls (emitStorageConfig, emitToast): they are re-created
  // each render and read `args.*` live, so memoizing this handler would capture
  // stale versions of those callbacks too — and a stale `mountedRef` with them.
  async function onRequestStorageSwitch(newKind: StorageKind): Promise<void> {
    if (deps.isPopout) return;
    const current = deps.settingsRef.current.storageConfig;
    if (newKind === current.kind) return;
    const newConfig: StorageConfig =
      (newKind === "sp-json" || newKind === "sp-csv") && (current.kind === "sp-json" || current.kind === "sp-csv")
        ? { ...current, kind: newKind }
        // Cast is safe: browser/local-*/turso variants carry no required fields
        // beyond `kind`; only sp-* needs hostname/sitePath/itemPath, handled by
        // the spread branch above.
        : ({ kind: newKind } as StorageConfig);
    const label = t(deps.langRef.current, STORAGE_LABEL_KEYS[newKind]);
    const leavingTurso = current.kind === "turso" && newKind !== "turso";
    const confirmKey = leavingTurso ? "storageTursoLeaveWarn" : "storageConvertConfirm";
    if (!window.confirm(t(deps.langRef.current, confirmKey, deps.tasks.length, label))) return;
    const target = createBackend(newConfig, {
      acquireToken: deps.acquireToken,
      tursoConfig: getTursoConfig(
        deps.settingsRef.current.integrations?.turso?.databaseUrl,
        deps.settingsRef.current.integrations?.turso?.authToken,
      ),
    });
    try {
      const pick = pickFileForBackend(target);
      if (pick) await pick;
      if (!(await deps.truncationOps.guardedWrite(target, deps.currentWorkspace()))) return; // ★★ §103: the conversion writes to a DIFFERENT backend, so the source survives — but `emitStorageConfig` below then repoints the app AT the short copy and the intact original becomes the abandoned one. Refuse loudly instead.
      deps.suppressNextLoadRef.current = true;
      deps.emitStorageConfig(newConfig);
      deps.emitToast("info", t(deps.langRef.current, "storageConvertedToast", label));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/abort/i.test(msg) || /user activation/i.test(msg)) return;
      if (err instanceof StorageNotReadyError) {
        const hint = (err as StorageNotReadyError).hint;
        const key =
          hint === "local-file-permission-needed"
            ? "storagePermissionGestureNeeded"
            : hint === "storage-unreachable"
              ? "storageUnreachable"
              : "storageNotReady";
        deps.emitToast("error", t(deps.langRef.current, key));
      } else if (isTursoLockTimeout(err)) {
        // Conversion target was Turso and the cross-tab write lock timed out.
        deps.emitToast("error", t(deps.langRef.current, "tursoLockTimeout"));
      } else {
        // StorageNotImplementedError also surfaces here — user confirmed a
        // conversion write, so silent failure is wrong.
        deps.emitToast("error", t(deps.langRef.current, "storageSaveFailed", msg));
      }
    }
  }

  return { onPickStorageFile, onGrantWriteAccess, onOpenStorageFile, onRequestStorageSwitch };
}
