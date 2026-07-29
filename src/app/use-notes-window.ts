import { useState, type Dispatch, type SetStateAction } from "react";
import { type Resource, type RaidItem, type Task, type NoteLogEntry } from "./types";
import { type ActivityKind } from "./activity-log";
import { addNote, editNote, deleteNote } from "./note-log";
import { resourceDisplayName } from "./resource-foundation";
import { t } from "./i18n";
import type { Lang } from "./i18n";
import type { NotesWindowProps } from "./notes-window";
import type { NoteLogPanelProps } from "./note-log-panel";

// Live render-scope values the notes-window orchestration reads each render.
// Follows the Phase-3 deps-object hook convention: called unconditionally,
// returns NON-memoized handlers (they read live scope on every call).
export interface NotesWindowDeps {
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  setTasks: Dispatch<SetStateAction<readonly Task[]>>;
  setRaid: Dispatch<SetStateAction<readonly RaidItem[]>>;
  selfResourceId: number | null | undefined;
  resources: readonly Resource[];
  lang: Lang;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
}

export interface UseNotesWindowResult {
  notesTarget: { kind: "task" | "raid"; id: number } | null;
  openTaskNotes: (id: number) => void;
  openRaidNotes: (id: number) => void;
  notesWindowProps: NotesWindowProps;
  /** Panel props for a SECOND, always-mounted surface (the in-editor note log).
   *  `notesWindowProps` can't serve it: its entries derive from `notesTarget`,
   *  which is null unless the floating window is open. Reuses the same
   *  `noteHandlersFor` so both surfaces share ONE write path. */
  notePanelPropsFor: (kind: "task" | "raid", id: number) => NoteLogPanelProps;
}

// Shared floating note-log window orchestration extracted from task-manager.
// A single surface reused by tasks + RAID; CRUD routes back into the live
// workspace state. Never mounted/enabled in popouts (the caller gates the
// mount on !isPopout).
export function useNotesWindow(deps: NotesWindowDeps): UseNotesWindowResult {
  const { tasks, raid, setTasks, setRaid, selfResourceId, resources, lang, logActivity } = deps;

  // which entity's log is open (null = closed).
  const [notesTarget, setNotesTarget] = useState<{ kind: "task" | "raid"; id: number } | null>(null);

  const notesEntries: readonly NoteLogEntry[] =
    notesTarget?.kind === "task"
      ? tasks.find((tk) => tk.id === notesTarget.id)?.noteLog ?? []
      : notesTarget?.kind === "raid"
        ? raid.find((r) => r.id === notesTarget.id)?.noteLog ?? []
        : [];

  const notesSelf = selfResourceId ?? null;
  const notesAuthorName = (() => {
    const r = resources.find((x) => x.id === notesSelf);
    return r ? resourceDisplayName(r) : undefined;
  })();

  const notesEntityLabel =
    notesTarget?.kind === "task"
      ? tasks.find((tk) => tk.id === notesTarget.id)?.taskName ?? t(lang, "noteLogTitle")
      : notesTarget?.kind === "raid"
        ? raid.find((r) => r.id === notesTarget.id)?.title ?? t(lang, "noteLogTitle")
        : t(lang, "noteLogTitle");

  // CRUD handlers for the open note-log target. FUNCTIONAL setters throughout
  // (a note change is a single-item entity edit; the functional form avoids the
  // stale-closure trap). Timestamps are minted inside the event handler (never
  // in render). Each write stamps `localModifiedAt` + logs the entity's own
  // `*.updated` activity kind (no dedicated note kind exists).
  const noteHandlersFor = (kind: "task" | "raid", id: number) => {
    // Resolve the display name from the LIVE closure array (event-handler scope),
    // never from inside the setState updater — reading an updater-assigned var
    // after the setter is the documented stale-read landmine.
    const entityName =
      kind === "task"
        ? tasks.find((tk) => tk.id === id)?.taskName ?? ""
        : raid.find((r) => r.id === id)?.title ?? "";
    return {
      onAdd: (html: string, text: string) => {
        const ts = new Date().toISOString();
        if (kind === "task") {
          setTasks((prev) =>
            prev.map((tk) =>
              tk.id === id
                ? { ...tk, noteLog: addNote(tk.noteLog ?? [], { html, text, timestamp: ts, self: notesSelf, authorName: notesAuthorName }), localModifiedAt: ts }
                : tk,
            ),
          );
          logActivity("task.updated", id, entityName);
        } else {
          setRaid((prev) =>
            prev.map((r) =>
              r.id === id
                ? { ...r, noteLog: addNote(r.noteLog ?? [], { html, text, timestamp: ts, self: notesSelf, authorName: notesAuthorName }), localModifiedAt: ts }
                : r,
            ),
          );
          logActivity("raid.updated", id, entityName);
        }
      },
      onEdit: (noteId: number, html: string, text: string) => {
        const ts = new Date().toISOString();
        if (kind === "task") {
          setTasks((prev) =>
            prev.map((tk) =>
              tk.id === id
                ? { ...tk, noteLog: editNote(tk.noteLog ?? [], noteId, { html, text, editedAt: ts, self: notesSelf, authorName: notesAuthorName }), localModifiedAt: ts }
                : tk,
            ),
          );
          logActivity("task.updated", id, entityName);
        } else {
          setRaid((prev) =>
            prev.map((r) =>
              r.id === id
                ? { ...r, noteLog: editNote(r.noteLog ?? [], noteId, { html, text, editedAt: ts, self: notesSelf, authorName: notesAuthorName }), localModifiedAt: ts }
                : r,
            ),
          );
          logActivity("raid.updated", id, entityName);
        }
      },
      onDelete: (noteId: number) => {
        const ts = new Date().toISOString();
        if (kind === "task") {
          setTasks((prev) =>
            prev.map((tk) => (tk.id === id ? { ...tk, noteLog: deleteNote(tk.noteLog ?? [], noteId), localModifiedAt: ts } : tk)),
          );
          logActivity("task.updated", id, entityName);
        } else {
          setRaid((prev) =>
            prev.map((r) => (r.id === id ? { ...r, noteLog: deleteNote(r.noteLog ?? [], noteId), localModifiedAt: ts } : r)),
          );
          logActivity("raid.updated", id, entityName);
        }
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
    notesWindowProps,
    // ★ `labelSuffix` is REQUIRED here, unlike the floating window (whose dialog
    //   label already names the entity). With both surfaces open on the same
    //   task, un-suffixed names would collide into two identical "Edit – #1"
    //   buttons — axe checks that a name EXISTS, never that it is unique.
    notePanelPropsFor: (kind, id) => {
      const handlers = noteHandlersFor(kind, id);
      const entries =
        kind === "task"
          ? tasks.find((tk) => tk.id === id)?.noteLog ?? []
          : raid.find((r) => r.id === id)?.noteLog ?? [];
      const label =
        kind === "task"
          ? tasks.find((tk) => tk.id === id)?.taskName ?? ""
          : raid.find((r) => r.id === id)?.title ?? "";
      return { entries, ...handlers, self: notesSelf, resources, lang, labelSuffix: label };
    },
  };
}
