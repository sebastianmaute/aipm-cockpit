// src/app/note-log.ts
//
// Shared model helpers + lossless JSON-in-cell codec for a task's running note
// log, used by the CSV / Markdown / Turso serializers. Mirrors the
// `document-link.ts` pattern (leaf module — imports only the type). Task has no
// per-entity sanitizer, so validation for untrusted data lives HERE.

import type { NoteLogEntry } from "./types";

/** Caps — keep a hand-edited or model-supplied blob bounded. */
const MAX_NOTE_ENTRIES = 500;
const MAX_NOTE_TEXT = 4000;
const MAX_AUTHOR_NAME = 200;
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

/** Accept only well-formed note entries from untrusted JSON. An entry with an
 *  empty text or an unparseable timestamp is dropped. */
export function sanitizeNoteLog(raw: unknown): NoteLogEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: NoteLogEntry[] = [];
  for (const entry of raw) {
    if (out.length >= MAX_NOTE_ENTRIES) break;
    if (!isPlainObject(entry)) continue;
    if (!isValidTimestamp(entry.timestamp)) continue;
    const text = (typeof entry.text === "string" ? entry.text : "")
      .replace(NEWLINE_TAB, " ")
      .replace(CONTROL_CHARS, "")
      .trim()
      .slice(0, MAX_NOTE_TEXT);
    if (!text) continue;

    const item: NoteLogEntry = { timestamp: entry.timestamp, text };

    const idNum = typeof entry.authorResourceId === "number" ? entry.authorResourceId : NaN;
    if (Number.isFinite(idNum) && idNum > 0) item.authorResourceId = Math.floor(idNum);

    const name = (typeof entry.authorName === "string" ? entry.authorName : "")
      .replace(CONTROL_CHARS, "")
      .trim()
      .slice(0, MAX_AUTHOR_NAME);
    if (name) item.authorName = name;

    out.push(item);
  }
  return out;
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
