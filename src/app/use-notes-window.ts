import { useState, type Dispatch, type SetStateAction } from "react";
import { type ChangeItem, type Resource, type RaidItem, type Task, type NoteLogEntry } from "./types";
import { type ActivityKind } from "./activity-log";
import { addNote, editNote, deleteNote } from "./note-log";
import { resourceDisplayName } from "./resource-foundation";
import { t } from "./i18n";
import type { Lang } from "./i18n";
import type { NotesWindowProps } from "./notes-window";
import type { NoteLogPanelProps } from "./note-log-panel";

/** Which register the open note log belongs to. Each kind resolves its own
 *  display name field (`taskName` / `title`) and its own `*.updated` activity
 *  kind — there is no dedicated note kind. */
export type NotesTargetKind = "task" | "raid" | "change";

// Live render-scope values the notes-window orchestration reads each render.
// Follows the Phase-3 deps-object hook convention: called unconditionally,
// returns NON-memoized handlers (they read live scope on every call).
export interface NotesWindowDeps {
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  changes: readonly ChangeItem[];
  setTasks: Dispatch<SetStateAction<readonly Task[]>>;
  setRaid: Dispatch<SetStateAction<readonly RaidItem[]>>;
  setChanges: Dispatch<SetStateAction<readonly ChangeItem[]>>;
  selfResourceId: number | null | undefined;
  resources: readonly Resource[];
  lang: Lang;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
}

export interface UseNotesWindowResult {
  notesTarget: { kind: NotesTargetKind; id: number } | null;
  openTaskNotes: (id: number) => void;
  openRaidNotes: (id: number) => void;
  openChangeNotes: (id: number) => void;
  notesWindowProps: NotesWindowProps;
  /** Panel props for a SECOND, always-mounted surface (the in-editor note log).
   *  `notesWindowProps` can't serve it: its entries derive from `notesTarget`,
   *  which is null unless the floating window is open. Reuses the same
   *  `noteHandlersFor` so both surfaces share ONE write path. */
  notePanelPropsFor: (kind: NotesTargetKind, id: number) => NoteLogPanelProps;
}

// Shared floating note-log window orchestration extracted from task-manager.
// A single surface reused by tasks + RAID + changes; CRUD routes back into the
// live workspace state. Never mounted/enabled in popouts (the caller gates the
// mount on !isPopout).
//
// ★★★ WRITE-THROUGH, and it must stay that way. Every handler here commits
// straight into the owning workspace array. The register save handlers take
// `noteLog` from the STORED row (so an editor draft can never clobber a note
// added while it was open) — routing a note commit through one of them would
// therefore read the new note back out and LOSE it.
export function useNotesWindow(deps: NotesWindowDeps): UseNotesWindowResult {
  const { tasks, raid, changes, setTasks, setRaid, setChanges, selfResourceId, resources, lang, logActivity } = deps;

  // which entity's log is open (null = closed).
  const [notesTarget, setNotesTarget] = useState<{ kind: NotesTargetKind; id: number } | null>(null);

  /** The entity's stored log, or [] when the id resolves to nothing. */
  const logOf = (kind: NotesTargetKind, id: number): readonly NoteLogEntry[] =>
    kind === "task"
      ? tasks.find((tk) => tk.id === id)?.noteLog ?? []
      : kind === "raid"
        ? raid.find((r) => r.id === id)?.noteLog ?? []
        : changes.find((c) => c.id === id)?.noteLog ?? [];

  /** The entity's display name, or undefined when the id resolves to nothing.
   *  A change (like a RAID item) is named by `title`; only a task carries
   *  `taskName`. The two consumers differ on the miss — the window label falls
   *  back to the generic title, the handlers/suffix to "" — so the miss stays
   *  distinguishable here rather than being flattened to "". */
  const findName = (kind: NotesTargetKind, id: number): string | undefined =>
    kind === "task"
      ? tasks.find((tk) => tk.id === id)?.taskName
      : kind === "raid"
        ? raid.find((r) => r.id === id)?.title
        : changes.find((c) => c.id === id)?.title;

  const nameOf = (kind: NotesTargetKind, id: number): string => findName(kind, id) ?? "";

  const notesEntries: readonly NoteLogEntry[] = notesTarget ? logOf(notesTarget.kind, notesTarget.id) : [];

  const notesSelf = selfResourceId ?? null;
  const notesAuthorName = (() => {
    const r = resources.find((x) => x.id === notesSelf);
    return r ? resourceDisplayName(r) : undefined;
  })();

  const notesEntityLabel = notesTarget
    ? findName(notesTarget.kind, notesTarget.id) ?? t(lang, "noteLogTitle")
    : t(lang, "noteLogTitle");

  /** ONE write path for all three registers and all three operations. Each
   *  setter is FUNCTIONAL (a note change is a single-item entity edit; the
   *  functional form avoids the stale-closure trap), stamps `localModifiedAt`,
   *  and logs the entity's own `*.updated` activity kind. `activityArgs` are
   *  the message arguments AFTER the id; their COUNT differs per kind, so it is
   *  decided in `noteHandlersFor` and merely forwarded here. */
  const commitNoteLog = (
    kind: NotesTargetKind,
    id: number,
    ts: string,
    activityArgs: readonly (string | number)[],
    next: (log: readonly NoteLogEntry[]) => NoteLogEntry[],
  ) => {
    if (kind === "task") {
      setTasks((prev) =>
        prev.map((tk) => (tk.id === id ? { ...tk, noteLog: next(tk.noteLog ?? []), localModifiedAt: ts } : tk)),
      );
      logActivity("task.updated", id, ...activityArgs);
    } else if (kind === "raid") {
      setRaid((prev) =>
        prev.map((r) => (r.id === id ? { ...r, noteLog: next(r.noteLog ?? []), localModifiedAt: ts } : r)),
      );
      logActivity("raid.updated", id, ...activityArgs);
    } else {
      setChanges((prev) =>
        prev.map((c) => (c.id === id ? { ...c, noteLog: next(c.noteLog ?? []), localModifiedAt: ts } : c)),
      );
      logActivity("change.updated", id, ...activityArgs);
    }
  };

  // CRUD handlers for the open note-log target. Timestamps are minted inside
  // the event handler (never in render).
  const noteHandlersFor = (kind: NotesTargetKind, id: number) => {
    // Resolve the display name from the LIVE closure array (event-handler scope),
    // never from inside the setState updater — reading an updater-assigned var
    // after the setter is the documented stale-read landmine.
    // ★★★ THE RAID ROW IS LOOKED UP ONCE FOR *TWO* FIELDS, AND THE SECOND ONE IS
    //   NOT OPTIONAL. `activityRaidUpdated` is "RAID #{0} updated ({1}): {2}" —
    //   THREE placeholders — and `logActivity` ends in `...args`, so the arity is
    //   untyped and a two-arg call compiles. It shipped: the title landed in the
    //   CATEGORY slot and a literal "{2}" was rendered to the user in the
    //   Activity panel and, since search_history, fed to the model as well. The
    //   canonical order is (id, category, title) — see `use-resource-planner.ts`,
    //   which is where the user-side raid rows are written.
    const raidRow = kind === "raid" ? raid.find((r) => r.id === id) : undefined;
    const entityName = kind === "raid" ? raidRow?.title ?? "" : nameOf(kind, id);
    // ★ `?? ""` mirrors `entityName`'s own fallback rather than dropping the
    //   argument: a row that vanished between opening the notes window and the
    //   write must still log THREE args, or it re-creates the "{2}" defect.
    const raidCategory = raidRow?.category ?? "";
    // ★ The arity lives HERE, in the one place that already knows the kind, so
    //   `commitNoteLog` cannot re-create the defect for a fourth register:
    //   `activityTaskUpdated`/`activityChangeUpdated` are "…: {1}" (ONE arg after
    //   the id), `activityRaidUpdated` is "({1}): {2}" (TWO).
    const activityArgs: readonly (string | number)[] =
      kind === "raid" ? [raidCategory, entityName] : [entityName];
    return {
      onAdd: (html: string, text: string) => {
        const ts = new Date().toISOString();
        commitNoteLog(kind, id, ts, activityArgs, (log) =>
          addNote(log, { html, text, timestamp: ts, self: notesSelf, authorName: notesAuthorName }),
        );
      },
      onEdit: (noteId: number, html: string, text: string) => {
        const ts = new Date().toISOString();
        commitNoteLog(kind, id, ts, activityArgs, (log) =>
          editNote(log, noteId, { html, text, editedAt: ts, self: notesSelf, authorName: notesAuthorName }),
        );
      },
      onDelete: (noteId: number) => {
        const ts = new Date().toISOString();
        commitNoteLog(kind, id, ts, activityArgs, (log) => deleteNote(log, noteId));
      },
    };
  };

  const notesWindowProps: NotesWindowProps = {
    open: notesTarget != null,
    onClose: () => setNotesTarget(null),
    entries: notesEntries,
    onAdd: (h, tx) => notesTarget && noteHandlersFor(notesTarget.kind, notesTarget.id).onAdd(h, tx),
    onEdit: (nid, h, tx) => notesTarget && noteHandlersFor(notesTarget.kind, notesTarget.id).onEdit(nid, h, tx),
    onDelete: (nid) => notesTarget && noteHandlersFor(notesTarget.kind, notesTarget.id).onDelete(nid),
    self: notesSelf,
    resources,
    lang,
    entityLabel: notesEntityLabel,
  };

  return {
    notesTarget,
    openTaskNotes: (id: number) => setNotesTarget({ kind: "task", id }),
    openRaidNotes: (id: number) => setNotesTarget({ kind: "raid", id }),
    openChangeNotes: (id: number) => setNotesTarget({ kind: "change", id }),
    notesWindowProps,
    // ★ `labelSuffix` is REQUIRED here, unlike the floating window (whose dialog
    //   label already names the entity). With both surfaces open on the same
    //   task, un-suffixed names would collide into two identical "Edit – #1"
    //   buttons — axe checks that a name EXISTS, never that it is unique.
    notePanelPropsFor: (kind, id) => ({
      entries: logOf(kind, id),
      ...noteHandlersFor(kind, id),
      self: notesSelf,
      resources,
      lang,
      labelSuffix: nameOf(kind, id),
    }),
  };
}
