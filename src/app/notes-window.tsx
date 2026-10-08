"use client";

// The note log's floating window: the single CRUD surface for an entity's note
// log (shared by tasks AND raid). The draggable/resizable non-modal chrome lives
// in the shared `FloatingLogWindow`; the composer + entry list live in the
// shared `NoteLogPanel`, so the same body can also be mounted inside the task
// editor. This file only supplies the title, storage keys and help entry.

import { t } from "./i18n";
import { FloatingLogWindow, NOTES_WINDOW_Z } from "./floating-log-window";
import { NoteLogPanel, type NoteLogPanelProps } from "./note-log-panel";
import { MODAL_HELP } from "./help-content";

// Re-exported so the layering test (and any caller) keeps importing it from here.
export { NOTES_WINDOW_Z };

// Saved geometry keys are `${prefix}-pos` / `${prefix}-size` — unchanged.
const STORAGE_KEY_PREFIX = "aipm-cockpit:notes-window";

// The note-log props are shared verbatim with the panel — derived rather than
// restated so the two cannot drift (and so the split introduces no clone).
// `labelSuffix` is deliberately omitted: see the mount below.
export interface NotesWindowProps extends Omit<NoteLogPanelProps, "labelSuffix"> {
  open: boolean;
  onClose: () => void;
  entityLabel: string;
}

export function NotesWindow(props: NotesWindowProps) {
  const { open, onClose, entries, onAdd, onEdit, onDelete, self, resources, lang, entityLabel, aiReadable } = props;

  // ★★ ONE SPELLING, THREE SINKS. This string is the window's accessible name
  // (`aria-label`), its visible heading, and the `dialogTitle` qualifying the
  // help trigger's own name. Spelled separately, an edit to one leaves the
  // trigger announcing "Help – <old name>" while the dialog announces the new
  // one — a WCAG 2.5.3 label-in-name mismatch that NOTHING here can catch:
  // axe's `label-content-name-mismatch` is tagged `experimental` and axe's
  // default `tagExclude` drops it, so the gate never runs it in any view.
  // Deriving all three from one const makes the drift unrepresentable.
  const windowTitle = `${t(lang, "noteLogTitle")} — ${entityLabel}`;

  return (
    <FloatingLogWindow
      open={open}
      onClose={onClose}
      title={windowTitle}
      storageKeyPrefix={STORAGE_KEY_PREFIX}
      helpConceptId={MODAL_HELP.notesWindow}
      lang={lang}
    >
      {/* ★ Explicit `null` sentinel (open-followups §142): this window's
          `role="dialog"` aria-label already announces the entity, so its row
          controls are unambiguous within it — adding a real suffix would
          change every existing accessible name. `labelSuffix` is now a
          required prop specifically so a second mount site (the task
          editor had one until 2026-10-08) cannot omit it and collide silently; this is the "no suffix" case, made
          explicit rather than implicit.

          ★ `aiReadable` is FORWARDED, never defaulted here: this window serves
          tasks, RAID items and changes off one props object, and only a task's
          notes are readable by the model. `useNotesWindow` derives it from the
          OPEN target — a constant in this file would make the disclosure a
          false claim on two of the three registers. */}
      <NoteLogPanel
        entries={entries}
        onAdd={onAdd}
        onEdit={onEdit}
        onDelete={onDelete}
        self={self}
        resources={resources}
        lang={lang}
        labelSuffix={null}
        aiReadable={aiReadable}
      />
    </FloatingLogWindow>
  );
}
