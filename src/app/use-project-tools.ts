// src/app/use-project-tools.ts — the chat dispatcher's project members (§715): `getProjectMeta` and
// `updateProjectMeta`. `chat-tools-project.ts` owns the guards in front of them (token, per-field judge); this file
// owns where the judged record is written.
//
// ★★★ ONE WRITER, THE PROJECT FORM'S. In Turso multi-project mode the record lives in the projects table and the
// workspace save does NOT write it, so a `setProject` here would show the change and lose it on reload. The write
// goes through `handleUpdateCurrentProjectByMode` (use-turso-projects.ts), the one writer the project form uses,
// reached through `projectWriterRef`: task-manager builds the dispatcher before that handler exists and fills the
// ref once it does. The writer resolves false after its own error toast, and that becomes this call's rejection, so
// a failure reaches the card row and the model.
//
// ★★ ONE RECORD for staging and the write. Staging stamps a token-less `update_project` from `ws.project`, and
// `requireToken` re-checks it against `getProjectMeta()`; both are the workspace's `project` slice, read here
// through a ref that a successful write assigns synchronously, so a `get_project` later in the same turn reads it.
//
// ★ A project switch during the write (§548): the scope epoch is captured before the await and checked with
// `dropStaleScopeWrite` after it. A moved epoch rejects and leaves the ref alone, so nothing here is attributed to
// the project now open.
//
// ★ Every write refuses in a read-only popout, with the wording the other write tools use.
//
// ★★ Logged and undoable (owner decision B), and ONLY on success: the `project.updated` row and the one undo entry
// are written after `written === true` AND after the epoch check, never on a refusal, a failure or a switch. The
// undo fragment reverts through the same writer (project-meta-edit.ts).
import { useEffect, useMemo, useRef, type RefObject } from "react";
import type { LogActivityAsFn } from "./activity-log-context";
import type { ProjectToolDispatcher } from "./chat-tools-project";
import { t } from "./i18n";
import { changedProjectFields, logProjectUpdate, projectUndoFragment, type ProjectWriter } from "./project-meta-edit";
import { dropStaleScopeWrite, type ScopeEpochReader } from "./scope-epoch";
import type { Settings } from "./settings-types";
import type { UndoStackApi } from "./undo/use-undo-stack";
import { useWorkspace } from "./workspace-context";

export type { ProjectWriter } from "./project-meta-edit";

export const PROJECT_SAVE_FAILED_MESSAGE = "The project could not be saved; nothing was changed.";
export const PROJECT_SCOPE_MOVED_MESSAGE =
  "The open project changed while this update was being saved; reopen that project to check what was stored.";

export interface ProjectToolsDeps {
  /** True in a popout/mirror window — the write refuses. */
  isReadOnly: boolean;
  /** The `project.updated` row, actor "ai", after a stored write. */
  logActivityAs?: LogActivityAsFn;
  /** Shows an undo or redo whose writer threw; a writer that resolves false has shown its own error. */
  showToast: (kind: "info" | "error", text: string) => void;
  /** Owned by use-chat-dispatcher: `language` for the read-only refusal. */
  settingsRef: RefObject<Settings>;
  /** Owned by use-chat-dispatcher; a stored write is captured through it as one entry. */
  undoRef: RefObject<Pick<UndoStackApi, "captureComposite"> | undefined>;
  /** Filled by task-manager once `handleUpdateCurrentProjectByMode` exists; null before that. */
  projectWriterRef: RefObject<ProjectWriter | null>;
  getScopeEpoch: ScopeEpochReader;
}

export function useProjectTools(deps: ProjectToolsDeps): ProjectToolDispatcher {
  const { isReadOnly, settingsRef, undoRef, projectWriterRef, getScopeEpoch, logActivityAs, showToast } = deps;
  const { project } = useWorkspace();

  const projectRef = useRef(project);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);
  // Ref-routed like the dispatcher's other getters, so a new reader identity never rebuilds the dispatcher.
  const getScopeEpochRef = useRef(getScopeEpoch);
  useEffect(() => {
    getScopeEpochRef.current = getScopeEpoch;
  }, [getScopeEpoch]);
  const sinksRef = useRef({ logActivityAs, showToast });
  useEffect(() => {
    sinksRef.current = { logActivityAs, showToast };
  }, [logActivityAs, showToast]);

  return useMemo<ProjectToolDispatcher>(
    () => ({
      getProjectMeta: () => projectRef.current ?? null,

      updateProjectMeta: async (next) => {
        if (isReadOnly) throw new Error(t(settingsRef.current.language, "popoutReadOnly"));
        const write = projectWriterRef.current;
        if (write === null) throw new Error(PROJECT_SAVE_FAILED_MESSAGE);
        const readEpoch = () => getScopeEpochRef.current();
        const startEpoch = readEpoch();
        const before = projectRef.current;
        const written = await write(next);
        if (dropStaleScopeWrite(readEpoch, startEpoch, "ai.updateProject")) throw new Error(PROJECT_SCOPE_MOVED_MESSAGE);
        if (!written) throw new Error(PROJECT_SAVE_FAILED_MESSAGE);
        projectRef.current = next;
        const fields = before ? changedProjectFields(before, next) : [];
        if (before && fields.length > 0) {
          logProjectUpdate(sinksRef.current.logActivityAs, "ai", fields);
          const onThrow = (err: unknown) => sinksRef.current.showToast(
            "error", t(settingsRef.current.language, "projectUpdateFailed", err instanceof Error ? err.message : String(err)),
          );
          const part = projectUndoFragment({
            getWriter: () => projectWriterRef.current, getLive: () => projectRef.current ?? null, before, next, fields, onThrow,
          });
          undoRef.current?.captureComposite({
            kind: "project.updated", entityKey: "project", primaryCount: 1, name: next.name, parts: [part], readEpoch: startEpoch,
          });
        }
        return next;
      },
    }),
    [isReadOnly, settingsRef, undoRef, projectWriterRef],
  );
}
