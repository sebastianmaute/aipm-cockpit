// src/app/note-log.ts
//
// Shared model helpers + lossless JSON-in-cell codec for a task's running note
// log, used by the CSV / Markdown / Turso serializers. Mirrors the
// `document-link.ts` pattern (leaf module — imports only the type). Task has no
// per-entity sanitizer, so validation for untrusted data lives HERE.

import type { NoteLogEntry } from "./types";
import { sanitizeNoteHtml, htmlToText } from "./sanitize-html";

/** Caps — keep a hand-edited or model-supplied blob bounded. */
const MAX_NOTE_ENTRIES = 500;
const MAX_NOTE_TEXT = 4000;
const MAX_AUTHOR_NAME = 200;
const MAX_NOTE_HTML = 20000;
/** Collapse newlines/tabs to a single space FIRST so multi-line pasted note
 *  text degrades to a readable single line (words stay separated) rather than
 *  being jammed together by the raw control-char strip below. */
const NEWLINE_TAB = /[\r\n\t]+/g;
/** Strip the remaining control chars — keeps a note-log cell single-line and
 *  free of file-corrupting bytes. Same class as the rationale sanitizer. */
const CONTROL_CHARS = /[\x00-\x1f]/g;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** True for a parseable ISO-ish instant string. */
function isValidTimestamp(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "" && !Number.isNaN(Date.parse(v));
}

function cleanText(v: unknown): string {
  return (typeof v === "string" ? v : "")
    .replace(NEWLINE_TAB, " ")
    .replace(CONTROL_CHARS, "")
    .trim()
    .slice(0, MAX_NOTE_TEXT);
}

/** Minimal &/</> escape for wrapping legacy plain text in a synthetic <p> when
 *  upgrading a pre-rich-text entry that has no html of its own. */
function escapeForHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Accept only well-formed note entries from untrusted JSON. An entry with an
 *  empty text AND no usable html is dropped. Every returned entry is
 *  guaranteed a unique numeric `id` and a sanitized `html` body — a legacy
 *  text-only entry gets one synthesized from its (escaped) text, and a
 *  legacy entry with no `id` gets one minted (max-seen + 1), so upgrading old
 *  data never throws and never collides ids. */
export function sanitizeNoteLog(raw: unknown): NoteLogEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: NoteLogEntry[] = [];
  const usedIds = new Set<number>();
  let nextMintId = 1;

  for (const entry of raw) {
    if (out.length >= MAX_NOTE_ENTRIES) break;
    if (!isPlainObject(entry)) continue;
    if (!isValidTimestamp(entry.timestamp)) continue;

    let text = cleanText(entry.text);

    const htmlSource = typeof entry.html === "string" ? entry.html.trim() : "";
    const hasHtml = htmlSource !== "";
    const html = (hasHtml
      ? sanitizeNoteHtml(htmlSource)
      : sanitizeNoteHtml(`<p>${escapeForHtml(text)}</p>`)
    ).slice(0, MAX_NOTE_HTML);

    if (hasHtml && !text) text = cleanText(htmlToText(html));

    if (!text) continue;

    const rawId = typeof entry.id === "number" ? entry.id : NaN;
    let id: number;
    if (Number.isFinite(rawId) && rawId > 0 && !usedIds.has(Math.floor(rawId))) {
      id = Math.floor(rawId);
    } else {
      id = nextMintId;
      while (usedIds.has(id)) id++;
    }
    usedIds.add(id);
    nextMintId = Math.max(nextMintId, id + 1);

    const item: NoteLogEntry = { id, timestamp: entry.timestamp, html, text };

    const idNum = typeof entry.authorResourceId === "number" ? entry.authorResourceId : NaN;
    if (Number.isFinite(idNum) && idNum > 0) item.authorResourceId = Math.floor(idNum);

    const name = (typeof entry.authorName === "string" ? entry.authorName : "")
      .replace(CONTROL_CHARS, "")
      .trim()
      .slice(0, MAX_AUTHOR_NAME);
    if (name) item.authorName = name;

    if (isValidTimestamp(entry.editedAt)) item.editedAt = entry.editedAt;

    out.push(item);
  }
  return out;
}

/** Re-sanitize an entity's sanitized-HTML fields (`description` + `noteLog`) at a
 *  load boundary. Used by the whole-object JSON + IndexedDB load paths, which cast
 *  their tasks/raid verbatim with no per-entity sanitizer (unlike CSV/MD/Turso,
 *  which route noteLog through `decodeNoteLog`). Idempotent on already-clean data
 *  (byte-stable goldens/sample stay green). Returns the entity unchanged when it
 *  carries neither field, so tasks/raid with no rich fields keep identity. */
export function sanitizeNoteFields<T extends { description?: string; noteLog?: NoteLogEntry[] }>(
  entity: T,
): T {
  const hasDescription = typeof entity.description === "string";
  const hasNoteLog = Array.isArray(entity.noteLog);
  if (!hasDescription && !hasNoteLog) return entity;
  return {
    ...entity,
    ...(hasDescription ? { description: sanitizeNoteHtml(entity.description as string) } : {}),
    ...(hasNoteLog ? { noteLog: sanitizeNoteLog(entity.noteLog) } : {}),
  };
}

/** Next stable id for a new entry — max-seen id + 1 (1 for an empty log). */
export function nextNoteId(log: readonly NoteLogEntry[]): number {
  return log.reduce((m, n) => Math.max(m, n.id ?? 0), 0) + 1;
}

/** An authorless note (legacy/unattributed) is editable by anyone; an
 *  authored note only by its own author. */
export function canEditNote(note: NoteLogEntry, self: number | null | undefined): boolean {
  return note.authorResourceId == null || note.authorResourceId === self;
}

/** Append a new stamped entry, minting its id and attributing it to `self`
 *  when present (an authorless entry when the user has no linked resource). */
export function addNote(
  log: readonly NoteLogEntry[],
  { html, text, timestamp, self, authorName }:
    { html: string; text: string; timestamp: string; self: number | null | undefined; authorName?: string },
): NoteLogEntry[] {
  const entry: NoteLogEntry = {
    id: nextNoteId(log),
    timestamp,
    html: sanitizeNoteHtml(html),
    text,
    ...(self != null ? { authorResourceId: self } : {}),
    ...(self != null && authorName ? { authorName } : {}),
  };
  return [...log, entry];
}

/** Update a note's body + editedAt stamp. An authorless note is CLAIMED by
 *  `self` on edit (rather than staying anonymous); an already-authored note
 *  keeps its existing author regardless of who edits it (call site gates via
 *  `canEditNote` first). */
export function editNote(
  log: readonly NoteLogEntry[],
  id: number,
  { html, text, editedAt, self, authorName }:
    { html: string; text: string; editedAt: string; self: number | null | undefined; authorName?: string },
): NoteLogEntry[] {
  return log.map((n) => {
    if (n.id !== id) return n;
    const claim = n.authorResourceId == null && self != null;
    return {
      ...n,
      html: sanitizeNoteHtml(html),
      text,
      editedAt,
      ...(claim ? { authorResourceId: self, ...(authorName ? { authorName } : {}) } : {}),
    };
  });
}

/** Remove a note by id. */
export function deleteNote(log: readonly NoteLogEntry[], id: number): NoteLogEntry[] {
  return log.filter((n) => n.id !== id);
}

/** Encode for a single CSV/MD/Turso cell. Empty/undefined -> "" so tasks with
 *  no note log stay byte-identical to legacy serialized data. */
export function encodeNoteLog(log: readonly NoteLogEntry[] | undefined): string {
  return log && log.length ? JSON.stringify(log) : "";
}

/** Inverse of encodeNoteLog; tolerates empty/malformed cells. */
export function decodeNoteLog(cell: string | null | undefined): NoteLogEntry[] {
  if (!cell) return [];
  try {
    return sanitizeNoteLog(JSON.parse(cell));
  } catch {
    return [];
  }
}
