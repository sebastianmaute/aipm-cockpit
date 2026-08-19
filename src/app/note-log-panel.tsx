"use client";

// The reusable BODY of an entity's note log: the composer block + the
// newest-first list of entries, with inline edit/delete. Extracted verbatim
// from `notes-window.tsx` so the same surface can be mounted BOTH in the
// floating window and inside the task editor modal without a copy-paste clone
// (`dup:check` is a blocking gate).
//
// This component owns ONLY its own composer/edit draft state. Window chrome —
// drag, resize, the dismissal/focus wiring, the `role="dialog"` container —
// stays in `notes-window.tsx`.
//
// ★ The root is a FRAGMENT: the two blocks were direct children of the window's
// flex column and the list relies on `min-h-0 flex-1` from that parent, so
// leaving layout to the consumer keeps the window byte-identical and lets a
// second mount site supply its own container.

import { useCallback, useRef, useState } from "react";
import { INTERACTIVE } from "./interaction-styles";
import { type Lang, t } from "./i18n";
import { RichTextEditor, type RichTextEditorHandle } from "./rich-text-editor-lazy";
import { canEditNote } from "./note-log";
import { htmlToText } from "./sanitize-html";
// A note body renders stored HTML through the shared sanitized sink, which
// re-sanitizes at render as defense in depth (see rich-text-view.tsx).
import { RichTextView } from "./rich-text-view";
import { formatDisplayTimestamp } from "./tz-display";
import { browserTimeZone } from "./timezone";
import { resourceDisplayName } from "./resource-foundation";
import { useDictationMic } from "./dictation-mic";
import { useSettings } from "./use-settings";
import type { Settings } from "./settings-types";
import type { NoteLogEntry, Resource } from "./types";

/** Resolve an entry's display author: an explicit `authorName`, else the live
 *  directory name for `authorResourceId`, else an em-dash. */
export function authorLabel(entry: NoteLogEntry, resources: readonly Resource[]): string {
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
  dictation: Settings["dictation"];
  /** Appended to this row's control names when two surfaces are mounted at
   *  once. Required (open-followups §142): `null` is the explicit "no
   *  suffix" sentinel, so a future third mount site cannot silently collide
   *  by omitting the prop — it must typecheck a real choice. */
  labelSuffix: string | null;
  onStartEdit: (entry: NoteLogEntry) => void;
  onChangeEditHtml: (html: string) => void;
  onCommitEdit: (id: number) => void;
  onCancelEdit: () => void;
  onDelete: (id: number) => void;
}

export /** An editor handle that tolerates not being usable yet.
 *
 *  ★★★ DICTATION CAN OUTRUN THE EDITOR, and the `?.` that used to sit at both
 *  call sites turned that into SILENT DATA LOSS — no throw, no toast, the
 *  transcript simply gone. The mic is a SIBLING of the editor, not a child, so
 *  it paints and is operable immediately; the editor now arrives over the
 *  network behind `rich-text-editor-lazy.tsx`. The gap was always non-zero
 *  (`useEditor` runs with `immediatelyRender: false`) — that change made it a
 *  428 kB fetch wide.
 *
 *  ★★★ "IS THE REF POPULATED?" IS THE WRONG QUESTION, and a first cut of this
 *  hook asked exactly that and lost the text anyway — measured, by the test in
 *  `note-log-panel.dictation.test.tsx`, not reasoned. `useImperativeHandle` in
 *  `rich-text-editor.tsx` has deps `[editor]`, and `editor` is null on the first
 *  render, so React attaches a DEAD handle, then detaches with `null`, then
 *  attaches the live one. Flushing on first attach fires into the no-op; and
 *  clearing the queue on the `null` detach discards it one beat before the
 *  handle that could have taken it. Trust only `appendText`'s RETURN VALUE.
 *
 *  ★★ Buffer rather than disabling the mic: its hold-to-talk registration is
 *  driven by editor focus, so gating the control would need the handle in
 *  STATE, and a mic that looks inert for the length of a chunk fetch trades one
 *  bad outcome for another.
 *
 *  ★ Consequence worth knowing: the queue survives the `key={composerNonce}`
 *  remount that clears the composer after an Add, so a transcript still in
 *  flight lands in the FRESH composer rather than being dropped. That is the
 *  deliberate trade — the alternative is losing it. */
function useBufferedEditorHandle() {
  const handle = useRef<RichTextEditorHandle | null>(null);
  const pending = useRef<string[]>([]);

  const flush = useCallback((h: RichTextEditorHandle) => {
    const queued = pending.current;
    if (queued.length === 0) return;
    pending.current = [];
    for (const txt of queued) if (!h.appendText(txt)) pending.current.push(txt);
  }, []);

  const attach = useCallback(
    (h: RichTextEditorHandle | null) => {
      handle.current = h;
      if (h) flush(h);
    },
    [flush],
  );

  const appendText = useCallback((txt: string) => {
    const h = handle.current;
    if (!h || !h.appendText(txt)) pending.current.push(txt);
  }, []);

  return { attach, appendText };
}

function NoteEntryRow(props: NoteEntryRowProps) {
  const { entry, editing, self, resources, tz, lang, labelSuffix, dictation } = props;
  const canEdit = canEditNote(entry, self);
  const suffix = labelSuffix ? ` – ${labelSuffix}` : "";
  // ★★ ONE expression for the mic AND the editor beside it. They were spelled
  // separately and drifted: the mic carried the suffix, the editor did not, so
  // with two panels mounted both edit surfaces — and both of their toolbars,
  // which take this same string — announced identically (WCAG 2.4.6). Naming
  // them from one const is what stops that recurring.
  const editLabel = `${t(lang, "edit")}${suffix}`;
  const editEditor = useBufferedEditorHandle();
  // The editor owns its own content; append through the handle rather than
  // re-feeding `value`, which Tiptap binds only at mount (see rich-text-editor.tsx).
  const { mic: editMic, registration: editDictationReg } = useDictationMic({
    lang,
    dictation,
    enabled: true,
    // Carries the same `suffix` the Edit/Delete buttons above do: two
    // NoteLogPanels can be mounted at once (the floating notes window and the
    // one inside the task editor), and without it both mics announce
    // identically — WCAG 2.4.6.
    label: editLabel,
    onAppendFinal: editEditor.appendText,
  });

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
          {/* focus/blur bubble from the contenteditable, registering THIS
              field as the active dictation target for the hold-to-talk
              hotkey (mirrors raid-edit-modal.tsx). */}
          <div onFocus={editDictationReg.onFocus} onBlur={editDictationReg.onBlur}>
            <RichTextEditor
              value={entry.html}
              onChange={props.onChangeEditHtml}
              onCommit={() => props.onCommitEdit(entry.id)}
              commitOnEnter
              label={editLabel}
              lang={lang}
              editorRef={editEditor.attach}
            />
          </div>
          <div className="flex justify-end gap-2">
            {editMic}
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
                aria-label={`${t(lang, "edit")} – #${entry.id}${suffix}`}
                className={`rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-ui-dark-blue hover:bg-surface-muted dark:text-ui-light-grey ${INTERACTIVE}`}
              >
                {t(lang, "edit")}
              </button>
              <button
                type="button"
                onClick={() => props.onDelete(entry.id)}
                aria-label={`${t(lang, "delete")} – #${entry.id}${suffix}`}
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

export interface NoteLogPanelProps {
  entries: readonly NoteLogEntry[];
  onAdd: (html: string, text: string) => void;
  onEdit: (id: number, html: string, text: string) => void;
  onDelete: (id: number) => void;
  self: number | null | undefined;
  resources: readonly Resource[];
  lang: Lang;
  /** Appended to the composer/row control names so two mounted surfaces never
   *  announce identical labels. axe cannot see a duplicate accessible name.
   *  Required (open-followups §142): `null` is the explicit "no suffix"
   *  sentinel — see `notes-window.tsx`. */
  labelSuffix: string | null;
}

export function NoteLogPanel(props: NoteLogPanelProps) {
  const { entries, onAdd, onEdit, onDelete, self, resources, lang, labelSuffix } = props;

  const [composerHtml, setComposerHtml] = useState("");
  // Remount nonce: bumping it swaps a fresh (empty) composer NoteEditor in after
  // a commit, since NoteEditor only reads `value` as its mount-time content.
  const [composerNonce, setComposerNonce] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editHtml, setEditHtml] = useState("");

  const tz = browserTimeZone();
  const { settings } = useSettings();
  const composerLabel = labelSuffix
    ? `${t(lang, "noteLogPlaceholder")} – ${labelSuffix}`
    : t(lang, "noteLogPlaceholder");
  const composerEditor = useBufferedEditorHandle();
  // Appended through the imperative handle rather than re-feeding `value` —
  // Tiptap binds `content` only at mount, and Web Speech fires `onFinal`
  // repeatedly per hold, so a value-based push would need to remount the
  // composer mid-sentence and lose the caret each time (see rich-text-editor.tsx).
  const { mic: composerMic, registration: composerDictationReg } = useDictationMic({
    lang,
    dictation: settings.dictation,
    enabled: true,
    // Qualified for the same reason the Add button below is: with both the
    // floating notes window and the task editor's panel open, two composer mics
    // are in the DOM at once and would otherwise share one name (WCAG 2.4.6).
    // ★★ ONE expression for the mic AND the composer beside it — see
    // `editLabel` in NoteEntryRow for what a second spelling of this cost.
    label: composerLabel,
    onAppendFinal: composerEditor.appendText,
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

  // Newest-first: entries are appended oldest-first, so render reversed.
  const ordered = entries.slice().reverse();

  return (
    <>
      <div className="shrink-0 border-b border-line p-3">
        {/* focus/blur bubble from the contenteditable, registering THIS field
            as the active dictation target for the hold-to-talk hotkey
            (mirrors raid-edit-modal.tsx). */}
        <div onFocus={composerDictationReg.onFocus} onBlur={composerDictationReg.onBlur}>
          <RichTextEditor
            key={composerNonce}
            value=""
            onChange={setComposerHtml}
            onCommit={handleAdd}
            commitOnEnter
            label={composerLabel}
            lang={lang}
            editorRef={composerEditor.attach}
          />
        </div>
        <div className="mt-2 flex justify-end gap-2">
          {composerMic}
          <button
            type="button"
            onClick={handleAdd}
            aria-label={labelSuffix ? `${t(lang, "noteLogAdd")} – ${labelSuffix}` : undefined}
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
            dictation={settings.dictation}
            labelSuffix={labelSuffix}
            onStartEdit={startEdit}
            onChangeEditHtml={setEditHtml}
            onCommitEdit={commitEdit}
            onCancelEdit={cancelEdit}
            onDelete={onDelete}
          />
        ))}
      </ul>
    </>
  );
}
