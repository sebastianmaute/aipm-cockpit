"use client";

// The BODY of a task's blocker log: a plain-text box with Add, the open
// entries (Edit / Resolve / Delete), and a collapsed "Resolved (N)" section
// (Reopen / Delete). Window chrome lives in `FloatingLogWindow`; the writes
// live in `useBlockersWindow`. This component owns only its own drafts.
//
// ★ Every per-entry control is named `<verb> – #<id>`. The entry id is unique
// within one task's log by construction (`nextBlockerId`), so the names are
// row-unique without a token map, and the window's dialog label already names
// the task — the same scheme the note log's floating window uses.

import { useId, useState } from "react";
import { INTERACTIVE } from "./interaction-styles";
import { type Lang, t } from "./i18n";
import { formatDisplayTimestamp } from "./tz-display";
import { browserTimeZone } from "./timezone";
import { resourceDisplayName } from "./resource-foundation";
import { useConfirm } from "./confirm-dialog";
import { rowLabel } from "./row-tokens";
import { TEXTAREA_MAX } from "./sanitize";
import { normalizeBlockerText } from "./blocker-log";
import type { BlockerEntry, Resource } from "./types";
import { Button } from "./button";
import { Textarea } from "./form-controls";

export interface BlockerLogPanelProps {
  entries: readonly BlockerEntry[];
  onAdd: (text: string) => void;
  onEdit: (id: number, text: string) => void;
  onResolve: (id: number) => void;
  onReopen: (id: number) => void;
  onDelete: (id: number) => void;
  resources: readonly Resource[];
  lang: Lang;
}

/** An entry's author: its stored name, else the live directory name, else none. */
function authorOf(entry: BlockerEntry, resources: readonly Resource[]): string | undefined {
  if (entry.authorName) return entry.authorName;
  const r = resources.find((x) => x.id === entry.authorResourceId);
  return r ? resourceDisplayName(r) : undefined;
}

/** Oldest first, ties by id — the order `blockersText` joins open entries in. */
function byCreated(a: BlockerEntry, b: BlockerEntry): number {
  return (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) || a.id - b.id;
}

const isBlank = (text: string): boolean => normalizeBlockerText(text) === "";

interface OpenRowProps {
  entry: BlockerEntry;
  resources: readonly Resource[];
  tz: string;
  lang: Lang;
  editing: boolean;
  editText: string;
  onStartEdit: (entry: BlockerEntry) => void;
  onChangeEdit: (text: string) => void;
  onCommitEdit: (id: number) => void;
  onCancelEdit: () => void;
  onResolve: (id: number) => void;
  onDelete: (id: number) => void;
}

function OpenRow(props: OpenRowProps) {
  const { entry, resources, tz, lang, editing, editText } = props;
  const token = `#${entry.id}`;
  const author = authorOf(entry, resources);
  return (
    <li className="flex flex-col gap-1 rounded-md border border-line bg-surface p-3">
      <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{author ?? ""}</span>
        <span className="flex items-center gap-1">
          <time dateTime={entry.createdAt}>{formatDisplayTimestamp(entry.createdAt, tz, lang)}</time>
          {entry.editedAt && <span className="italic">({formatDisplayTimestamp(entry.editedAt, tz, lang)})</span>}
        </span>
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea
            value={editText}
            onChange={(e) => props.onChangeEdit(e.target.value)}
            aria-label={rowLabel(t(lang, "edit"), token)}
            maxLength={TEXTAREA_MAX}
            rows={3}
            autoGrow className="w-full"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="xs" onClick={props.onCancelEdit} aria-label={rowLabel(t(lang, "cancel"), token)}>
              {t(lang, "cancel")}
            </Button>
            <Button
              variant="secondary"
              size="xs"
              onClick={() => props.onCommitEdit(entry.id)}
              disabled={isBlank(editText)}
              aria-label={rowLabel(t(lang, "blockerLogSave"), token)}
            >
              {t(lang, "blockerLogSave")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="whitespace-pre-wrap text-sm text-foreground">{entry.text}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="xs" onClick={() => props.onStartEdit(entry)} aria-label={rowLabel(t(lang, "edit"), token)}>
              {t(lang, "edit")}
            </Button>
            <Button variant="secondary" size="xs" onClick={() => props.onResolve(entry.id)} aria-label={rowLabel(t(lang, "blockerLogResolve"), token)}>
              {t(lang, "blockerLogResolve")}
            </Button>
            <Button variant="destructive" size="xs" onClick={() => props.onDelete(entry.id)} aria-label={rowLabel(t(lang, "delete"), token)}>
              {t(lang, "delete")}
            </Button>
          </div>
        </>
      )}
    </li>
  );
}

interface ResolvedRowProps {
  entry: BlockerEntry;
  tz: string;
  lang: Lang;
  onReopen: (id: number) => void;
  onDelete: (id: number) => void;
}

function ResolvedRow({ entry, tz, lang, onReopen, onDelete }: ResolvedRowProps) {
  const token = `#${entry.id}`;
  const resolvedAt = entry.resolvedAt ?? entry.createdAt;
  return (
    <li className="flex flex-col gap-1 rounded-md border border-line bg-surface-muted p-3">
      <div className="flex justify-end text-xs text-muted-foreground">
        <time dateTime={resolvedAt}>{formatDisplayTimestamp(resolvedAt, tz, lang)}</time>
      </div>
      <p className="whitespace-pre-wrap text-sm text-muted-foreground">{entry.text}</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="xs" onClick={() => onReopen(entry.id)} aria-label={rowLabel(t(lang, "blockerLogReopen"), token)}>
          {t(lang, "blockerLogReopen")}
        </Button>
        <Button variant="destructive" size="xs" onClick={() => onDelete(entry.id)} aria-label={rowLabel(t(lang, "delete"), token)}>
          {t(lang, "delete")}
        </Button>
      </div>
    </li>
  );
}

export function BlockerLogPanel(props: BlockerLogPanelProps) {
  const { entries, onAdd, onEdit, onResolve, onReopen, onDelete, resources, lang } = props;
  const confirm = useConfirm();
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [resolvedOpen, setResolvedOpen] = useState(false);
  const openHeadingId = useId();
  const resolvedListId = useId();
  const resolvedToggleId = useId();
  const tz = browserTimeZone();

  const openEntries = entries.filter((e) => e.resolvedAt === undefined).sort(byCreated);
  const resolvedEntries = entries.filter((e) => e.resolvedAt !== undefined).sort(byCreated);
  const resolvedHeading = t(lang, "blockerLogResolvedHeading", resolvedEntries.length);

  function handleAdd() {
    if (isBlank(draft)) return;
    onAdd(draft);
    setDraft("");
  }
  function startEdit(entry: BlockerEntry) {
    setEditingId(entry.id);
    setEditText(entry.text);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditText("");
  }
  function commitEdit(id: number) {
    // A blank edit keeps the old text: nothing is written.
    if (isBlank(editText)) return;
    onEdit(id, editText);
    cancelEdit();
  }
  async function handleDelete(id: number) {
    const ok = await confirm({ message: t(lang, "blockerLogDeleteConfirm"), confirmLabel: t(lang, "delete") });
    if (ok) onDelete(id);
  }

  return (
    <>
      <div className="shrink-0 border-b border-line p-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={t(lang, "blockerLogPlaceholder")}
          placeholder={t(lang, "blockerLogPlaceholder")}
          maxLength={TEXTAREA_MAX}
          rows={3}
          autoGrow className="w-full"
        />
        <div className="mt-2 flex justify-end">
          <Button
            onClick={handleAdd}
            disabled={isBlank(draft)}
            variant="primary" size="xs"
          >
            {t(lang, "blockerLogAdd")}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 pr-2">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(lang, "blockerLogEmpty")}</p>
        ) : (
          <>
            <section className="flex flex-col gap-2">
              <h3 id={openHeadingId} className="text-xs font-semibold uppercase text-muted-foreground">
                {t(lang, "blockerLogOpen")}
              </h3>
              {openEntries.length === 0 && (
                <p className="text-sm text-muted-foreground">{t(lang, "blockerLogNoneOpen")}</p>
              )}
              <ul aria-labelledby={openHeadingId} className="flex flex-col gap-2">
                {openEntries.map((entry) => (
                  <OpenRow
                    key={entry.id}
                    entry={entry}
                    resources={resources}
                    tz={tz}
                    lang={lang}
                    editing={editingId === entry.id}
                    editText={editText}
                    onStartEdit={startEdit}
                    onChangeEdit={setEditText}
                    onCommitEdit={commitEdit}
                    onCancelEdit={cancelEdit}
                    onResolve={onResolve}
                    onDelete={handleDelete}
                  />
                ))}
              </ul>
            </section>
            {resolvedEntries.length > 0 && (
              <section className="flex flex-col gap-2">
                <button
                  type="button"
                  id={resolvedToggleId}
                  aria-expanded={resolvedOpen}
                  aria-controls={resolvedListId}
                  onClick={() => setResolvedOpen((v) => !v)}
                  className={`self-start rounded-md px-1 text-xs font-semibold uppercase text-muted-foreground hover:text-foreground ${INTERACTIVE}`}
                >
                  <span aria-hidden="true">{resolvedOpen ? "▾ " : "▸ "}</span>
                  {resolvedHeading}
                </button>
                {/* ★ Always mounted and `hidden`-toggled so the `aria-controls`
                    target stays in the DOM while collapsed. */}
                <ul id={resolvedListId} aria-labelledby={resolvedToggleId} hidden={!resolvedOpen} className="flex flex-col gap-2">
                  {resolvedEntries.map((entry) => (
                    <ResolvedRow key={entry.id} entry={entry} tz={tz} lang={lang} onReopen={onReopen} onDelete={handleDelete} />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}
