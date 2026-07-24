"use client";

// Draggable, resizable, NON-MODAL floating window: the single CRUD surface for
// an entity's note log (shared by tasks AND raid). Controlled by external
// `open`/`onClose` — it never self-triggers, has no backdrop, and does not trap
// focus, so the app stays interactive underneath. Drag/resize mechanics clone
// `help-menu.tsx`; the composer + inline edit reuse `NoteEditor`.

import { useCallback, useEffect, useRef, useState } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { INTERACTIVE } from "./interaction-styles";
import { type Lang, t } from "./i18n";
import { useResizable } from "./use-resizable";
import { ResetSizeButton } from "./task-manager-ui";
import { RichTextEditor } from "./rich-text-editor";
import { canEditNote } from "./note-log";
import { htmlToText } from "./sanitize-html";
import { formatDisplayTimestamp } from "./tz-display";
import { browserTimeZone } from "./timezone";
import { resourceDisplayName } from "./resource-foundation";
import type { NoteLogEntry, Resource } from "./types";

const STORAGE_KEY_POS = "aipm-cockpit:notes-window-pos";
const STORAGE_KEY_SIZE = "aipm-cockpit:notes-window-size";

const DEFAULT_X = 96;
const DEFAULT_Y = 96;

type Pos = { x: number; y: number };

function clampPos(p: Pos, panelW: number, panelH: number): Pos {
  return {
    x: Math.max(0, Math.min(p.x, window.innerWidth - panelW)),
    y: Math.max(0, Math.min(p.y, window.innerHeight - panelH)),
  };
}

function loadPos(): Pos | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_POS);
    if (!raw) return null;
    const p = JSON.parse(raw) as unknown;
    if (
      p &&
      typeof p === "object" &&
      "x" in p &&
      "y" in p &&
      typeof (p as Pos).x === "number" &&
      typeof (p as Pos).y === "number"
    ) {
      return p as Pos;
    }
  } catch {
    // ignore
  }
  return null;
}

function savePos(p: Pos) {
  try {
    window.localStorage.setItem(STORAGE_KEY_POS, JSON.stringify(p));
  } catch {
    // non-fatal
  }
}

/** Resolve an entry's display author: an explicit `authorName`, else the live
 *  directory name for `authorResourceId`, else an em-dash. */
function authorLabel(entry: NoteLogEntry, resources: readonly Resource[]): string {
  if (entry.authorName) return entry.authorName;
  const r = resources.find((x) => x.id === entry.authorResourceId);
  return r ? resourceDisplayName(r) : "—";
}

/** Render a note's rich body. `entry.html` is ALREADY sanitized at the storage
 *  boundary (`sanitizeNoteHtml` in note-log's addNote/editNote/sanitizeNoteLog),
 *  so injecting it directly is safe — this component never receives raw html. */
function NoteBody({ html }: { html: string }) {
  return (
    <div
      className="text-sm text-foreground [&_a]:text-ui-dark-blue [&_a]:underline [&_li]:ml-4 [&_ol]:list-decimal [&_ul]:list-disc"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
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
          <NoteBody html={entry.html} />
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

  const [pos, setPos] = useState<Pos | null>(null);
  const [composerHtml, setComposerHtml] = useState("");
  // Remount nonce: bumping it swaps a fresh (empty) composer NoteEditor in after
  // a commit, since NoteEditor only reads `value` as its mount-time content.
  const [composerNonce, setComposerNonce] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editHtml, setEditHtml] = useState("");

  const { ref: panelRef, reset: resetSize } = useResizable(STORAGE_KEY_SIZE);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const tz = browserTimeZone();

  // Place the window on first open (saved position, else a default corner gap).
  useEffect(() => {
    if (!open || pos !== null) return;
    const el = panelRef.current;
    const panelW = el?.offsetWidth ?? 480;
    const panelH = el?.offsetHeight ?? 560;
    const saved = loadPos();
    setPos(clampPos(saved ?? { x: DEFAULT_X, y: DEFAULT_Y }, panelW, panelH));
  }, [open, pos, panelRef]);

  // Escape closes (only while open).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const onTitleBarMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!pos) return;
      // Never start a window drag from a control in the bar (reset-size / close).
      if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) return;
      dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };

      function onMove(mv: MouseEvent) {
        if (!dragRef.current) return;
        const el = panelRef.current;
        const panelW = el?.offsetWidth ?? 480;
        const panelH = el?.offsetHeight ?? 560;
        setPos(
          clampPos(
            {
              x: dragRef.current.origX + mv.clientX - dragRef.current.startX,
              y: dragRef.current.origY + mv.clientY - dragRef.current.startY,
            },
            panelW,
            panelH,
          ),
        );
      }

      function onUp() {
        if (dragRef.current) {
          setPos((p) => {
            if (p) savePos(p);
            return p;
          });
          dragRef.current = null;
        }
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [pos, panelRef],
  );

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
