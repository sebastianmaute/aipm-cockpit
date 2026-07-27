"use client";

// Draggable, resizable, NON-MODAL floating window: the single CRUD surface for
// an entity's note log (shared by tasks AND raid). Controlled by external
// `open`/`onClose` — it never self-triggers, has no backdrop, and does not trap
// focus, so the app stays interactive underneath. Drag/resize mechanics clone
// `help-menu.tsx`; the composer + inline edit reuse `NoteEditor`.

import { useCallback, useState } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { INTERACTIVE } from "./interaction-styles";
import { type Lang, t } from "./i18n";
import { useResizable } from "./use-resizable";
import { useDraggableWindow, type ComputeInitialPos } from "./use-draggable-window";
import { ResetSizeButton } from "./task-manager-ui";
import { RichTextEditor } from "./rich-text-editor";
import { canEditNote } from "./note-log";
import { useClaimsWhenFocusWithin, useDismissable } from "./use-dismissable";
import { usePanelInitialFocus } from "./use-panel-focus";
import { htmlToText } from "./sanitize-html";
// A note body renders stored HTML through the shared sanitized sink, which
// re-sanitizes at render as defense in depth (see rich-text-view.tsx).
import { RichTextView } from "./rich-text-view";
import { formatDisplayTimestamp } from "./tz-display";
import { browserTimeZone } from "./timezone";
import { resourceDisplayName } from "./resource-foundation";
import type { NoteLogEntry, Resource } from "./types";

const STORAGE_KEY_POS = "aipm-cockpit:notes-window-pos";
const STORAGE_KEY_SIZE = "aipm-cockpit:notes-window-size";

const DEFAULT_X = 96;
const DEFAULT_Y = 96;

// Place the window on first open: saved position, else a default corner gap.
const computeNotesInitialPos: ComputeInitialPos = ({ saved, clamp }) =>
  clamp(saved ?? { x: DEFAULT_X, y: DEFAULT_Y });

/** Resolve an entry's display author: an explicit `authorName`, else the live
 *  directory name for `authorResourceId`, else an em-dash. */
function authorLabel(entry: NoteLogEntry, resources: readonly Resource[]): string {
  if (entry.authorName) return entry.authorName;
  const r = resources.find((x) => x.id === entry.authorResourceId);
  return r ? resourceDisplayName(r) : "—";
}

interface NoteEntryRowProps {
  entry: NoteLogEntry;
  editing: boolean;
  self: number | null | undefined;
  resources: readonly Resource[];
  tz: string;
  lang: Lang;
  onStartEdit: (entry: NoteLogEntry) => void;
  onChangeEditHtml: (html: string) => void;
  onCommitEdit: (id: number) => void;
  onCancelEdit: () => void;
  onDelete: (id: number) => void;
}

function NoteEntryRow(props: NoteEntryRowProps) {
  const { entry, editing, self, resources, tz, lang } = props;
  const canEdit = canEditNote(entry, self);

  return (
    <li className="flex flex-col gap-1 rounded-md border border-line bg-surface p-3">
      <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{authorLabel(entry, resources)}</span>
        <span className="flex items-center gap-1">
          <time dateTime={entry.timestamp}>{formatDisplayTimestamp(entry.timestamp, tz, lang)}</time>
          {entry.editedAt && (
            // No `noteLogEdited` i18n key exists; to keep EN/DE parity without a
            // new string, the edit is disclosed as the edit instant in parens.
            <span className="italic">({formatDisplayTimestamp(entry.editedAt, tz, lang)})</span>
          )}
        </span>
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <RichTextEditor
            variant="lean"
            value={entry.html}
            onChange={props.onChangeEditHtml}
            onCommit={() => props.onCommitEdit(entry.id)}
            commitOnEnter
            label={t(lang, "edit")}
            lang={lang}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={props.onCancelEdit}
              className={`rounded-md border border-line bg-surface px-3 py-1 text-xs font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}
            >
              {t(lang, "cancel")}
            </button>
          </div>
        </div>
      ) : (
        <>
          <RichTextView html={entry.html} />
          {canEdit && (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => props.onStartEdit(entry)}
                aria-label={`${t(lang, "edit")} – #${entry.id}`}
                className={`rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-ui-dark-blue hover:bg-surface-muted dark:text-ui-light-grey ${INTERACTIVE}`}
              >
                {t(lang, "edit")}
              </button>
              <button
                type="button"
                onClick={() => props.onDelete(entry.id)}
                aria-label={`${t(lang, "delete")} – #${entry.id}`}
                className={`rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-ui-pink-strong hover:bg-surface-muted ${INTERACTIVE}`}
              >
                {t(lang, "delete")}
              </button>
            </div>
          )}
        </>
      )}
    </li>
  );
}

export interface NotesWindowProps {
  open: boolean;
  onClose: () => void;
  entries: readonly NoteLogEntry[];
  onAdd: (html: string, text: string) => void;
  onEdit: (id: number, html: string, text: string) => void;
  onDelete: (id: number) => void;
  self: number | null | undefined;
  resources: readonly Resource[];
  lang: Lang;
  entityLabel: string;
}

export function NotesWindow(props: NotesWindowProps) {
  const { open, onClose, entries, onAdd, onEdit, onDelete, self, resources, lang, entityLabel } = props;

  const [composerHtml, setComposerHtml] = useState("");
  // Remount nonce: bumping it swaps a fresh (empty) composer NoteEditor in after
  // a commit, since NoteEditor only reads `value` as its mount-time content.
  const [composerNonce, setComposerNonce] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editHtml, setEditHtml] = useState("");

  const { ref: panelRef, reset: resetSize } = useResizable(STORAGE_KEY_SIZE);
  // Drag/position (shared with help-menu); size stays on useResizable above.
  const { pos, onTitleBarMouseDown } = useDraggableWindow(STORAGE_KEY_POS, {
    open,
    panelRef,
    computeInitialPos: computeNotesInitialPos,
    fallbackWidth: 480,
    fallbackHeight: 560,
  });
  const tz = browserTimeZone();

  // Escape closes — but ONLY while focus is inside this window, or nowhere.
  //
  // ★★ This window is NON-MODAL and mounts at the top level: it stays open
  // while the user works anywhere else, including inside a modal it is not
  // part of. An unconditional claim swallowed every Escape in the app — open
  // notes from a row badge, open the task editor, press Escape to dismiss the
  // editor, and the notes window closed while the editor stayed.
  //
  // ★★ The gate lives in `claims` rather than in a handler, and that is
  // load-bearing: a declining entry that stayed topmost would block every
  // layer beneath it, because each of those asks "am I topmost?" and gets
  // `false`. Escape would become a no-op. The stack walks past a decliner
  // instead, so the editor underneath gets the key.
  // ★★ Move focus INTO the window on open. Without this the trigger that
  // opened it — the "Notes (N)" button INSIDE the task/RAID editor `Modal` —
  // keeps focus, `claimsFocusWithin` reads false, this window declines, and the
  // editor beneath takes the Escape and closes with the user's draft. Opening
  // this window must not arm a keypress that destroys work.
  usePanelInitialFocus(panelRef, open);

  const claimsFocusWithin = useClaimsWhenFocusWithin(panelRef);
  useDismissable({
    open,
    kind: "layer",
    onDismiss: onClose,
    claims: claimsFocusWithin,
  });

  const handleAdd = useCallback(() => {
    const text = htmlToText(composerHtml);
    if (!text) return; // skip blank
    onAdd(composerHtml, text);
    setComposerHtml("");
    setComposerNonce((n) => n + 1);
  }, [composerHtml, onAdd]);

  function startEdit(entry: NoteLogEntry) {
    setEditingId(entry.id);
    setEditHtml(entry.html);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditHtml("");
  }
  function commitEdit(id: number) {
    const text = htmlToText(editHtml);
    if (!text) return; // skip blank
    onEdit(id, editHtml, text);
    setEditingId(null);
    setEditHtml("");
  }

  if (!open) return null;

  // Newest-first: entries are appended oldest-first, so render reversed.
  const ordered = entries.slice().reverse();

  return (
    <div
      ref={panelRef}
      role="dialog"
      // Focus target for `usePanelInitialFocus` — carries no focus ring, and is
      // deliberately not in the tab order.
      tabIndex={-1}
      aria-label={`${t(lang, "noteLogTitle")} — ${entityLabel}`}
      style={{ left: pos?.x ?? DEFAULT_X, top: pos?.y ?? DEFAULT_Y, maxWidth: "100vw", maxHeight: "calc(100vh - 32px)" }}
      className="fixed z-40 flex h-[560px] min-h-72 w-[480px] min-w-[320px] resize flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-[var(--shadow-card)]"
    >
      <div
        onMouseDown={onTitleBarMouseDown}
        className="flex shrink-0 cursor-move select-none items-center justify-between border-b border-line px-4 py-2"
      >
        <h3 className="truncate text-sm font-semibold text-foreground">
          {t(lang, "noteLogTitle")} — {entityLabel}
        </h3>
        <div className="flex items-center gap-1">
          <ResetSizeButton onClick={resetSize} lang={lang} labelKey="modalResetSize" />
          <button
            type="button"
            onClick={onClose}
            aria-label={t(lang, "close")}
            className={`rounded p-1 text-foreground hover:bg-surface-muted hover:text-ui-dark-blue dark:text-muted-foreground dark:hover:text-ui-light-grey ${INTERACTIVE}`}
          >
            <XMarkIcon aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="shrink-0 border-b border-line p-3">
        <RichTextEditor
          key={composerNonce}
          variant="lean"
          value=""
          onChange={setComposerHtml}
          onCommit={handleAdd}
          commitOnEnter
          label={t(lang, "noteLogPlaceholder")}
          lang={lang}
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={handleAdd}
            className={`rounded-md bg-ui-dark-blue px-3 py-1 text-xs font-medium text-white ${INTERACTIVE}`}
          >
            {t(lang, "noteLogAdd")}
          </button>
        </div>
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3 pr-2">
        {ordered.map((entry) => (
          <NoteEntryRow
            key={entry.id}
            entry={entry}
            editing={editingId === entry.id}
            self={self}
            resources={resources}
            tz={tz}
            lang={lang}
            onStartEdit={startEdit}
            onChangeEditHtml={setEditHtml}
            onCommitEdit={commitEdit}
            onCancelEdit={cancelEdit}
            onDelete={onDelete}
          />
        ))}
      </ul>
    </div>
  );
}
