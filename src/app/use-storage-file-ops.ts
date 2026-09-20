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
import { logDiag } from "./diagnostics";
import type { Lang } from "./i18n";
import { t, tPlural } from "./i18n";
import type { Settings } from "./settings-types";
import {
  type FsHandle,
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
  pickFileHandleForBackend,
  pickOpenFileAny,
  requestWriteAccessForBackend,
  setBackendFileHandle,
  StorageNotReadyError,
} from "./storage";
// ★★ §590 — imported from `./workspace`, NOT through the `./storage` facade that also re-exports
//   them, and that is a TESTABILITY constraint rather than a style choice. Several suites replace the
//   whole facade with a hand-written export list; a name reached through it is `undefined` in every
//   one of them unless each list is extended, and a hand-kept list that misses a name fails as a
//   TypeError inside the op rather than at import. `./workspace` is replaced by none of them. Same
//   module `use-storage-backend.ts` takes these two from.
// ★ Enumerate the suites with a self-match-proof pattern — the obvious literal also matches THIS
//   comment and any prose quoting it, which is how a first cut of this line counted eleven files
//   where there are nine:
//     grep -rln 'vi[.]mock("[.]/storage"' src/app
//   Read the hits rather than counting them: a file that merely MENTIONS the call in prose is a
//   false positive that no pattern can exclude.
import { workspaceRecordCount } from "./workspace";
import { addProject, loadRegistry, saveRegistry, setCurrentProject as setCurrentProjectInRegistry } from "./projects-registry";
import { getHandle } from "./project-file-handles";
import { localKindForFormat, deriveRegistryEntry } from "./use-project-switch";
import { aiSeedUnsafeEmails, buildNewProjectWorkspace, type NewProjectOpts } from "./new-project-workspace";
import { resetMintState, snapshotMintState, restoreMintState, seedMintFromWorkspace } from "./id-mint-session";
import type { ProjectMeta, RaidItem, Task } from "./types";
import { loadPortfolioMode, savePortfolioMode } from "./portfolio-mode";
import { writeSettings } from "./use-settings";
import type { TruncationOps } from "./use-load-truncation";
import { getTursoConfig } from "./turso-config";
import { isTursoLockTimeout } from "./storage-error";
import { STORAGE_LABEL_KEYS } from "./use-storage-backend-types";
import { summarizeUnsafeEmailRecords } from "./sanitize";
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
  /** ★★ M4: registry ids whose unsafe-email notice this SESSION already showed.
   *  An ordinary SWITCH announces a project at most once; an explicit import
   *  (file open, a create with a template or AI seed) always announces and
   *  records its id, so switching back to it later is silent. Owned by
   *  `useStorageBackend` (session lifetime, never shared between instances). */
  announcedUnsafeEmailsRef: React.MutableRefObject<Set<string>>;
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
      // spec Part 2: after the confirmation, before the report. ★ M4: once per project per session on a switch.
      const unsafeEmails = deps.announcedUnsafeEmailsRef.current.has(id) ? null : summarizeUnsafeEmailRecords(loaded);
      if (unsafeEmails) {
        deps.announcedUnsafeEmailsRef.current.add(id);
        deps.showToast("info", t(deps.langRef.current, "importUnsafeEmailsNotice", unsafeEmails.count, unsafeEmails.names));
      }
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
      // ★ M5: a TEMPLATE is a copy source, kept and notice-only; an AI seed's unsafe addresses were left
      //  blank by `buildNewProjectWorkspace`, so its notice is judged on the seed as supplied.
      const seededEmails = opts.template || opts.importedWorkspace ? summarizeUnsafeEmailRecords(ws) : aiSeedUnsafeEmails(opts);
      if (seededEmails) {
        deps.announcedUnsafeEmailsRef.current.add(id); // an explicit import always announces (M4)
        deps.showToast("info", t(deps.langRef.current, "importUnsafeEmailsNotice", seededEmails.count, seededEmails.names));
      }
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
      const unsafeEmails = summarizeUnsafeEmailRecords(loaded); // spec Part 2: after the confirmation, before the report
      if (unsafeEmails) {
        deps.announcedUnsafeEmailsRef.current.add(id); // an explicit import always announces (M4)
        deps.showToast("info", t(deps.langRef.current, "importUnsafeEmailsNotice", unsafeEmails.count, unsafeEmails.names));
      }
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
  /** §586: open the save gate for the ACTIVE backend — it now holds exactly the live workspace. */
  allowSavesToActiveBackend: () => void;
  /** §586: is the ACTIVE backend's save gate open, i.e. does render scope hold its project? */
  loadSucceeded: () => boolean;
  /** §588 — is the backend THIS deps object was built for still the live one? False once a
   *  settings-driven rebuild (a Turso URL/token edit, a SharePoint target change) landed while an op
   *  here was awaiting. `backend` above is the render's instance and is captured in every closure in
   *  this hook, so after such a rebuild an op that resumes is writing to, and opening the gate of, an
   *  instance nobody is using — and the live one's gate stays shut in silence. */
  isBackendCurrent: () => boolean;
  acquireToken: UseMsAuthResult["acquireToken"];
  setTasks: React.Dispatch<React.SetStateAction<readonly Task[]>>;
  setRaid: React.Dispatch<React.SetStateAction<readonly RaidItem[]>>;
  tasks: readonly Task[];
  /** §548 clause (b) — announce that the workspace in scope has become ANOTHER project's, so an
   *  in-flight Graph/AI write that resolves afterwards is dropped (`scope-epoch.ts`). Called ONLY on
   *  `onOpenStorageFile`'s accept branch: that path replaces tasks+raid from another file through raw
   *  setters, never `applyWorkspace`, so the wrapper the project ops get cannot cover it — and
   *  `storageTargetKey` keys every `local-*` kind on the KIND alone (§591 ruling 3), so the load
   *  effect's replace rule cannot either. `onPickStorageFile` deliberately does NOT call it DIRECTLY,
   *  and since §590 that is a statement about ONE of its two branches rather than about the op: the
   *  overwrite branch writes the CURRENT workspace out and leaves the same project in scope, so there
   *  is nothing to announce; the load-instead branch replaces scope with ANOTHER file's project and
   *  does need the bump — it gets it inside `applyPickedWorkspace` below, which is
   *  `applyWorkspaceForOp`, the wrapper whose whole job is to bump. Calling this too would double-bump. */
  bumpScopeEpoch: () => void;
  /** §590 — apply a workspace read from the file the user just picked, when they chose to LOAD it
   *  rather than overwrite it. Wired to `applyWorkspaceForOp` (use-storage-backend.ts), so it bumps
   *  the scope epoch, REPLACES the activity log rather than merging the outgoing project's entries
   *  into it, resets the id minter for a different id space, and opens the §586 save gate for the
   *  active backend on its way out. ★ That last one is why the accept branch does NOT also call
   *  `allowSavesToActiveBackend` — one mechanism, not two. */
  applyPickedWorkspace: (workspace: Workspace) => void;
}

/**
 * Records a USER authored — `workspaceRecordCount` minus the TWO slices the decode chain seeds.
 * (Two, not three: `roles` is the third member of the reference trio and is deliberately NOT
 * subtracted — the ★★★ paragraph below is the argument, and an earlier opening line said "three"
 * while pointing the skimming reader straight at the slice its own body forbids removing.)
 *
 * ★★★ THIS EXISTS BECAUSE `isWorkspaceEmpty` AND THE BARE RECORD COUNT BOTH ANSWER THE WRONG
 * QUESTION HERE, and the first cut of §590 used the former and mis-fired. DECODING ANY VALID
 * WORKSPACE JSON SEEDS REFERENCE DATA: the migration chain inside `jsonToWorkspace` gives an
 * otherwise-record-free file 4 disciplines and 6 grades, and both counters count both. So every
 * parseable file — INCLUDING one this app itself wrote seconds earlier while its workspace was
 * empty, which is exactly what a second pick of the same file meets — read as "already holds a
 * project with 10 records" and would have raised the offer over nothing.
 * Measured, not reasoned. Run it before trusting this paragraph — `vite-node` has NO `-e` flag, so
 * it has to be a file (an earlier revision of this comment documented a `-e` one-liner that cannot
 * run at all, which is the same class of unverified recipe §590's own brief shipped):
 *   printf '%s\n' "import { jsonToWorkspace, workspaceToJson, emptyWorkspace } from './src/app/storage';" \
 *     "const w = jsonToWorkspace(workspaceToJson(emptyWorkspace()));" \
 *     "console.log('disciplines', w.disciplines?.length, 'grades', w.grades?.length, 'roles', w.roles?.length);" > seed-probe.ts
 *   npx vite-node seed-probe.ts; rm -f seed-probe.ts
 * It printed `disciplines 4 grades 6 roles 0` on 2026-09-20. The behaviour is also pinned in the
 * suite, by "writes normally, without asking, when the picked file holds only seeded reference data".
 * ★★★ ONLY WHAT THE MEASUREMENT SHOWED IS SUBTRACTED, and `roles` is deliberately NOT, even though
 * it is the third member of the reference-data trio (resources/roles/disciplines/grades in
 * AGENTS.md's sample-data rule) and an earlier revision subtracted it on that symmetry. It came back
 * 0: nothing seeds it. Subtracting an un-seeded slice buys nothing and costs a FALSE NEGATIVE — a
 * file whose only content is a role set somebody defined would read as "no project" and be
 * overwritten without a word. Counting it cannot produce a false POSITIVE while the count is 0, so
 * the asymmetry is the safe direction, not an oversight.
 * ★ If the chain ever starts seeding roles, subtract it here; the test that goes red is "writes
 * normally, without asking, when the picked file holds only seeded reference data".
 * ★★ `resources` is KEPT for a different reason: it is user-authored in general, and where the
 * decode chain does derive it (`migrateWorkspaceV5` builds a directory from assignee strings) it
 * derives it FROM tasks, which are counted anyway.
 */
function authoredRecordCount(workspace: Workspace): number {
  return workspaceRecordCount(workspace)
    - (workspace.disciplines?.length ?? 0)
    - (workspace.grades?.length ?? 0);
}

export function useStorageFilePickerOps(deps: StorageFilePickerDeps) {
  /**
   * Read what a picked handle ALREADY holds, or null when it holds no project.
   *
   * ★ A brand-new or empty file and an unparseable one are both "no project": the normal write must
   *   proceed, not an offer to load nothing. `showSaveFilePicker` CREATES the file when the user
   *   types a new name, so the zero-byte case is the common one, not an edge case —
   *   `LocalFileBackend.loadFrom` short-circuits it to `emptyWorkspace()`.
   * ★★ `loadFromHandleForBackend` is §287's read half: it reads the EXPLICIT handle and never
   *   consults or touches the backend's stored one, so nothing here re-points anything. The bind
   *   stays the caller's decision, which is the entire point of §590.
   * ★★ It DOES reset and republish the backend's import diagnostics (`resetLoadDiagnostics` plus the
   *   `finally` in `LocalFileBackend.loadFrom`). Harmless on this path because nothing in
   *   `onPickStorageFile` calls `truncationOps.reportFor`, the only reader of those fields — verify
   *   before adding one below, rather than trusting this line:
   *   `grep -rn "reportFor(" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."`.
   */
  async function readPickedProject(
    handle: FsHandle,
  ): Promise<{ workspace: Workspace; records: number } | null> {
    const load = loadFromHandleForBackend(deps.backend, handle);
    if (!load) return null; // not a file backend — unreachable here, since the pick above returned non-null on the same `instanceof`.
    try {
      const workspace = await load;
      return { workspace, records: authoredRecordCount(workspace) };
    } catch {
      return null;
    }
  }

  async function onPickStorageFile() {
    // ★★★ §103: refuse BEFORE the picker — `showSaveFilePicker` CREATES the file on disk the moment
    //   the user confirms a name, so a write-only guard stranded the app on an empty file. See
    //   `refuseWrite` (use-load-truncation.ts).
    // ★★ THE OTHER HALF OF THAT SENTENCE IS NO LONGER TRUE AND USED TO BE STATED HERE: the pick no
    //   longer "persists the handle on the ACTIVE backend" — since §590 the bind happens per branch,
    //   below. The file-creation half is unchanged and is on its own enough to reach the stranded
    //   state, so the pre-check's reason survives; its wording did not.
    if (deps.truncationOps.wouldRefuseWrite()) { deps.truncationOps.refuseWrite(); return; }
    // ★★★ §590 — THE NON-BINDING PICK. `pickFileForBackend` (still used by `createProject` and
    //   `onRequestStorageSwitch` below) `idbSet`s the handle onto the ACTIVE backend before the
    //   caller can ask anything about the chosen file. After a FAILED load the live workspace is the
    //   empty boot one, so the `guardedWrite` further down then wrote THAT into whatever file the
    //   user picked — destroying the project of a user who reached for the picker to recover a file
    //   whose handle or permission had been lost. This one commits nothing; the bind happens below,
    //   per branch, after the decision. Same split `openFileForBackend` already applies to open (§287).
    const promise = pickFileHandleForBackend(deps.backend);
    if (!promise) return;
    let picked: FsHandle;
    try {
      picked = await promise;
    } catch (err) {
      // ★★ §590 — THE CANCELLED DIALOG, which is the single most common path through this code.
      //   `pickSaveFile` PROPAGATES the picker's `AbortError`. Nothing was picked, so there is
      //   nothing to bind, write or undo, and dismissing your own dialog is not an error to report:
      //   the app is left byte-identical to before the click.
      // ★ Its OWN `try`, deliberately above the main one — the catch at the foot speaks
      //   `storageSaveFailed`, and an abort announced as a failed save is a claim about a write that
      //   never started.
      // ★★ BOTH the `name` and the message regex, because they catch different things: a spec
      //   `AbortError` is identified by its NAME (`DOMException`), while `onRequestStorageSwitch`
      //   below has long matched on the MESSAGE for the user-activation variant browsers phrase
      //   differently. Matching only one of the two is how a cancel becomes an error toast.
      const msg = err instanceof Error ? err.message : String(err);
      if ((err instanceof Error && err.name === "AbortError") || /abort/i.test(msg) || /user activation/i.test(msg)) return;
      // ★★ ANYTHING ELSE IS SPOKEN, not swallowed. Today the only other thing `pickSaveFile` throws
      //   is `StorageNotReadyError("file-system-access-unsupported")`, which the UI already gates on
      //   (`fsaSupported` in storage-config.tsx renders the prompt instead of the button), so this is
      //   not reachable through the control. Spoken anyway: both sibling ops in this file speak on
      //   their equivalents, and a silent return on an explicit CLICK is precisely what `refuseWrite`'s
      //   landmine forbids — an unreachable path that goes quiet stays quiet after it becomes
      //   reachable. ★ `storageNotReady`, never `storageSaveFailed`: no write was started.
      deps.emitToast("error", t(deps.langRef.current, "storageNotReady"));
      return;
    }
    // ★★ §588 — GUARD 1 of 3. The picker is the longest await in this file (it waits on a human at an
    //   OS dialog), so a settings-driven rebuild landing inside it is the likeliest instance of the
    //   superseded-caller defect. `deps.backend` is render-#1's instance, and once it is no longer
    //   live, everything past this line is being done on behalf of a backend nobody is on.
    // ★★★ THE GUARDS IN THIS OP ARE NAMED BY THEIR `stage` LABEL, NEVER NUMBERED. They were "guard 1
    //   of 2", then "of 3", and §590's bind guards would have made it "of 5" — every addition
    //   renumbers every comment in this file AND in the two suites that cite them, and the last
    //   renumber left three citations wrong. The label is the thing the diagnostic emits, so it
    //   cannot drift from the code: picker · read · bind · write. Enumerate them with
    //   `grep -n 'supersededPickDropped' src/app/use-storage-file-ops.ts`.
    // ★★★ §590 CHANGED WHAT THE PICKER GUARD IS FOR, AND AN EARLIER VERSION OF THIS COMMENT WENT ON
    //   CLAIMING THE OLD JOB. It used to be the only thing standing between a superseded pick and
    //   `guardedWrite`, and listed three hazards it uniquely stopped: the WRONG-TARGET WRITE
    //   (`guardedWrite` calls `save` on the captured instance), the SPENT ONE-SHOT
    //   (`mayCommitAfterIncompleteLoad()` CONSUMES `allowIncompleteSaveRef`, which is hook-level
    //   state shared with the LIVE backend's save path, so a superseded pick burns the
    //   authorisation the user just gave), and the REFUSAL TOAST (`refuseWrite()` speaking about
    //   the OLD backend inside the new project's UI). ★★ ALL THREE LIVE INSIDE `guardedWrite`, which
    //   the read and bind guards now both sit above — so this guard has NO unique kill among them
    //   any more. Measured, not reasoned: disabling THIS guard alone reds exactly ONE test, named
    //   below, and leaves every other test in both picker suites green.
    // ★★ WHAT IT STILL UNIQUELY PREVENTS is the READ: without it `readPickedProject` runs
    //   `loadFromHandleForBackend` against an instance nobody is on, spending a file read on a dead
    //   backend and resetting and republishing ITS import diagnostics (`resetLoadDiagnostics` plus
    //   the `finally` in `LocalFileBackend.loadFrom`). ★★★ THAT SECOND HALF IS NO LONGER HARMLESS,
    //   and a previous revision of this line said it was on the grounds that "nothing on this path
    //   calls `truncationOps.reportFor`". The §103 fix in the load-instead branch below now does
    //   exactly that — so a read against a dead instance would republish ITS diagnostics under the
    //   live report. Re-check with:
    //   `grep -n "reportFor(" src/app/use-storage-file-ops.ts`.
    // ★ Pinned, so the claim above is checkable: "does not even read the picked file when a rebuild
    //   lands while the picker is open" (use-storage-file-ops.pick-overwrite.test.tsx) is the ONLY
    //   test that reds when this guard alone is disabled.
    if (!deps.isBackendCurrent()) { logDiag("warn", "storage.supersededPickDropped", { stage: "picker" }); return; }
    try {
      // ★★★ §590 — READ BEFORE BINDING. Nothing is committed yet: the handle is still just a value
      //   this function holds, so every exit between here and the two `setBackendFileHandle` calls
      //   below leaves the backend on the file it was already using, with nothing to undo.
      const existing = await readPickedProject(picked);
      // ★★ §588 — THE READ GUARD, a window NEW with §590: the read above is an await that did not
      //   exist before, so the picker guard can no longer see as far as the first commit. It covers
      //   the confirm below too — `window.confirm` blocks the main thread, so no rebuild can land
      //   inside it, which is why this guard is placed once here rather than once per branch.
      // ★★ IT DOES NOT REACH THE COMMITS, and an earlier revision claimed it did ("guard 2 now sits
      //   above `guardedWrite`, so it subsumes every one of them"). `await setBackendFileHandle`
      //   separates it from both branches' tails — added by the very commit that wrote that
      //   sentence. The bind guards below are what close that stretch.
      if (!deps.isBackendCurrent()) { logDiag("warn", "storage.supersededPickDropped", { stage: "read" }); return; }
      // ★★★ §590 — THE OFFER. Both halves of the condition are load-bearing and neither implies the
      //   other. (a) the PICKED file holds records somebody authored, so overwriting it destroys
      //   something; (b) the LIVE workspace holds none, so there is nothing of the user's to lose by
      //   loading instead.
      // ★★★ (b) IS DELIBERATE AND IS NARROWER THAN "NEVER OVERWRITE A NON-EMPTY FILE". DO NOT
      //   "RESTORE" THE BROADER RULE. A user whose workspace holds real work and who points this at
      //   an existing file is doing SAVE-AS, which is legitimate — and `pickFileHandle` goes through
      //   `showSaveFilePicker` (fs-access.ts), an OS SAVE dialog that has ALREADY prompted them
      //   about replacing that file. A second, app-level refusal on top would be redundant, and a
      //   REFUSAL (as opposed to this offer) would remove their ability to overwrite at all, which
      //   is worse than the defect. Worse still, offering to LOAD here would replace the very work
      //   they are trying to save — §590's own harm, pointed the other way.
      // ★★ So the defect being closed is specifically the POST-FAILED-LOAD case: the user who does
      //   not know their workspace is empty, because a load failed, and who reaches for the picker
      //   to recover the file they just lost. That user gets no warning from the OS dialog either —
      //   it asks about replacing a file, not about replacing it with nothing.
      // ★★ ONE predicate, asked of both sides, on purpose: a file is "a project" by exactly the test
      //   that decides whether the live workspace is one. Two different tests here drift, and the
      //   drift is invisible because each side is only ever read on its own branch.
      // ★★ WHAT THAT ONE PREDICATE CANNOT SEE, stated because the symmetry above reads as a stronger
      //   claim than it is: `workspaceRecordCount` sums the entity COLLECTIONS and ignores `plan`,
      //   `project`, `status`, `fieldVisibility`, `features`, `settingsOverrides`, `activityLog`,
      //   `budgetHistory`, `insights`, `timelogLinks`, `steeringCommittee` and `fxRates` — each of
      //   which `applyWorkspaceFromLoad` does set. So a project that is only plan dates, a name and
      //   an activity log reads as EMPTY here, and a Save-As over an existing file offers to load
      //   instead. Not silent (the user must accept, and the dialog says the open project is empty)
      //   and not cheaply fixable — the alternative predicates are worse, see workspace-metrics.ts's
      //   own rule block on why those slices are excluded from the counters. Re-derive the list with
      //   `grep -n "export function workspaceRecordCount" -A 20 src/app/workspace-metrics.ts`.
      // ★★★ It is `authoredRecordCount`, NOT `isWorkspaceEmpty` — read its docstring before changing
      //   this line. The obvious predicate counts auto-seeded reference data and fires over nothing.
      if (existing !== null && existing.records > 0 && authoredRecordCount(deps.currentWorkspace()) === 0) {
        // ★★★ `window.confirm`, NOT the branded `useConfirm()`, and this is measured rather than
        //   preferred: `useStorageBackend` is called in `TaskManagerInner`'s BODY
        //   (task-manager.tsx), while `ConfirmProvider` is rendered in that same component's own
        //   JSX — so a `useConfirm()` here reads the DEFAULT context, which resolves `false`
        //   unconditionally. The offer would then always be declined and this click would do nothing,
        //   for every user, with no test able to see it. `use-activity-log.ts` records the identical
        //   trap for the identical reason. It is also the idiom the two sibling gates in this file
        //   already use (`onOpenStorageFile`, `onRequestStorageSwitch`).
        // ★ OK = load the existing project; Cancel = leave both the file and the app untouched. The
        //   safe answer is the one the dialog's own Cancel gives, so an accidental dismissal
        //   destroys nothing.
        if (!window.confirm(t(deps.langRef.current, "storagePickFileHasProject", picked.name ?? "", existing.records))) return;
        // ★★ ITS OWN try/catch, so a throw here is announced as a failed LOAD. The op's outer catch
        //   speaks `storageSaveFailed`, and this branch performs no write at all — the same reasoning
        //   the abort catch above already applies, and the key `onOpenStorageFile` uses for its own
        //   load path.
        try {
          await setBackendFileHandle(deps.backend, picked); // ★ commit the pick ONLY now — the §287 shape `onOpenStorageFile` already uses.
          // ★★★ §588 — THE BIND GUARD. `setBackendFileHandle` is a REAL resumption point
          //   (`LocalFileBackend.setHandle` awaits `idbSet`), and it was introduced by §590 between
          //   the read guard and this branch's whole tail. Without it `applyPickedWorkspace` runs
          //   `applyWorkspaceFromLoad` on render-#1's instance, whose last three statements are
          //   `setLoadedBackend` / `setSettledBackend` / `allowSavesTo` — §588's three harms verbatim,
          //   reached through §590's new door.
          // ★★ IT CANNOT UNDO THE BIND, and that is accepted rather than overlooked: the handle is
          //   already in the kv slot when this runs, because the await IS the bind. What it saves is
          //   the whole apply — the workspace is NOT replaced and the gate is NOT moved. A bound
          //   handle with no apply is recoverable (re-pick, or the next load); a save gate pointed at
          //   a dead backend is not.
          if (!deps.isBackendCurrent()) { logDiag("warn", "storage.supersededPickDropped", { stage: "bind" }); return; }
          deps.suppressNextSaveRef.current = true; // ★★★ AFTER the bind, never before: a bind that THROWS jumps to the catch, and an already-armed flag would then swallow the next legitimate save of a workspace nothing had modified. Same landmine as `onOpenStorageFile`.
          deps.applyPickedWorkspace(existing.workspace); // bumps the scope epoch, replaces the activity log, and opens the §586 gate — see its doc on `StorageFilePickerDeps`.
          await deps.refreshBackendStatus();
          deps.emitToast("info", t(deps.langRef.current, "storageOpenedToast", existing.workspace.tasks.length));
          // ★★★ §103/§152 — REPORT THE LOAD, and `reportFor`, NOT `reportImportFor`. This branch does
          //   every single thing the import report exists to catch: it READS a file (publishing
          //   `lastLoadTruncation` and the four import fields), APPLIES the decoded rows, BINDS the
          //   handle, and opens the save gate — so the next debounced save writes whatever survived
          //   the decode back OVER that file. Without this, a picked file whose documents exceed the
          //   caps (any format, JSON included) or whose CSV/MD rows were dropped is silently
          //   shortened, which is §590's own harm arriving one branch later.
          // ★★ THE NARROW CALL WOULD NOT DO, and the reason `onOpenStorageFile` uses it does not
          //   transfer: that op applies `loaded.tasks` + `loaded.raid` ONLY, so raising the §103 flag
          //   would warn about documents the user still holds, and `reportImportFor` is therefore
          //   raise-only on the quoting hold and never touches truncation or decode. This branch
          //   replaces the WHOLE workspace through `applyWorkspaceFromLoad`, documents included — so
          //   raising is right AND lowering a stale flag left by the previous project is right, which
          //   is exactly the direction the narrow call refuses. Same shape as
          //   `reloadCurrentProject`'s apply and the load effect, which both call `reportFor`.
          // ★ AFTER the toast, never before: the diagnostic surface is single-slot and REPLACES, so a
          //   report fired first is created and instantly discarded. Both existing callers order it
          //   this way and each says so at its own call site.
          deps.truncationOps.reportFor(deps.backend);
        } catch (err) {
          deps.emitToast("error", t(deps.langRef.current, "storageLoadFailed", String(err)));
        }
        return;
      }
      // The ordinary pick: a new, empty or unreadable file, or a live workspace that is really the
      // user's. Bind, then write — `save()` reads the STORED handle, so the bind cannot follow it.
      await setBackendFileHandle(deps.backend, picked);
      // ★★ §588 — THE BIND GUARD, this branch's copy. Its sibling above is the load-bearing one; this
      //   one restores the one-guard-per-await doctrine over the same new await, and stops a
      //   wrong-target `guardedWrite` one step earlier than the write guard below.
      // ★ Pinned alone by "drops the write when a rebuild lands while the picked handle is being
      //   bound" — measured as a SURVIVOR before that test existed, with its load-instead sibling in
      //   place: the two branches carry separate guards and the branch is chosen before either runs.
      if (!deps.isBackendCurrent()) { logDiag("warn", "storage.supersededPickDropped", { stage: "bind" }); return; }
      if (!(await deps.truncationOps.guardedWrite(deps.backend, deps.currentWorkspace()))) return; // ★ Kept as the backstop: the pre-check above is the one that matters, but a truncating load landing between them must still not commit.
      // ★★ §588 — THE WRITE GUARD, for a DIFFERENT window: `guardedWrite` is itself an await, so a
      //   rebuild can land inside it, after every guard above has already said "current". One guard
      //   per await, because one guard cannot see past the next one. ★ Its hazard set is a STRICT
      //   SUBSET of the picker guard's — the gate alone. By the time we get here `guardedWrite` has already written
      //   and already spent the one-shot, and this cannot undo either; the gate is simply the half
      //   that outlives the tick, since a stray write to a file the user picked themselves is
      //   recoverable while a save gate pointed at a dead backend silently drops every later edit for
      //   the session. ★ Pinned alone by "a rebuild during the write still leaves the live backend's
      //   gate open (the write itself is already gone)".
      if (!deps.isBackendCurrent()) { logDiag("warn", "storage.supersededPickDropped", { stage: "write" }); return; }
      deps.allowSavesToActiveBackend(); // ★★ §586: after a FAILED load autosave is refused; this write put the live workspace on the backend, so it belongs there now. Without it a user who re-picks a lost file would never autosave again this session.
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
        // §548 — SYNCHRONOUSLY before the two setters, so no in-flight Graph/AI write can resolve
        // between the replacement and the announcement. A CANCELLED picker or a declined confirm
        // never reaches this line, which is exactly the false drop the narrow predicate avoids.
        deps.bumpScopeEpoch();
        deps.setTasks(loaded.tasks);
        deps.setRaid(loaded.raid);
        // NOTE: absences and shifts intentionally NOT restored here —
        // faithful extraction of original behavior (not a bug fix).
        await deps.refreshBackendStatus();
        deps.emitToast("info", t(deps.langRef.current, "storageOpenedToast", loaded.tasks.length));
        const openedEmails = summarizeUnsafeEmailRecords({ tasks: loaded.tasks, raid: loaded.raid }); // only what this path applies
        if (openedEmails) deps.emitToast("info", t(deps.langRef.current, "importUnsafeEmailsNotice", openedEmails.count, openedEmails.names));
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
    // ★★★ §586/§587 (user ruling): a conversion copies the LIVE workspace into the new kind. If the
    // current storage's project never reached render scope (its load failed, came back empty over a
    // populated project and was refused, or is still pending), that workspace is the empty boot one or
    // the PREVIOUS target's project — on Turso a `DELETE FROM` every table of the target. So in that
    // state the switch goes ahead WITHOUT the conversion write: nothing is written anywhere, the new
    // backend LOADS its own target (no `suppressNextLoadRef`), and the §586 save gate keeps it shut
    // until that load is applied. ★ No confirm: both confirm texts describe a conversion, and nothing
    // here is written or overwritten. The notice says why nothing was copied.
    if (!deps.loadSucceeded()) {
      deps.emitStorageConfig(newConfig);
      deps.emitToast("info", t(deps.langRef.current, "storageSwitchedWithoutCopy", label));
      return;
    }
    const leavingTurso = current.kind === "turso" && newKind !== "turso";
    const confirmKey = leavingTurso ? "storageTursoLeaveWarn" : "storageConvertConfirm";
    if (!window.confirm(tPlural(deps.langRef.current, confirmKey, deps.tasks.length, deps.tasks.length, label))) return;
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
