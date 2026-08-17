// src/app/note-log.ts
//
// Shared model helpers + lossless JSON-in-cell codec for a task's running note
// log, used by the CSV / Markdown / Turso serializers. Mirrors the
// `document-link.ts` pattern (leaf module — imports only the type). Task has no
// per-entity sanitizer, so validation for untrusted data lives HERE.

import type { NoteLogEntry } from "./types";
import { sanitizeRichHtml, htmlToText } from "./sanitize-html";
import { descriptionHtml } from "./rich-text-plain";
import { RICH_SINK } from "./html-start";

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
      ? sanitizeRichHtml(htmlSource)
      : sanitizeRichHtml(`<p>${escapeForHtml(text)}</p>`)
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

/** Every rich-HTML field name across the entities the whole-object load paths
 *  cast verbatim. A field list lives HERE, per entity, rather than at the call
 *  sites — see the sibling-vs-widen note on `sanitizeRichFields` below. */
type RichFieldName = "description" | "mitigation" | "impactDescription" | "resolutionNotes";

/** The loosest shape the normalizers accept: every rich field optional, so one
 *  generic core serves Task / RaidItem / ChangeItem / Milestone without any of
 *  them having to carry a field the others own. */
type RichFieldCarrier = Partial<Record<RichFieldName, string>> & { noteLog?: NoteLogEntry[] };

const TASK_RICH_FIELDS = ["description"] as const satisfies readonly RichFieldName[];
const RAID_RICH_FIELDS = ["description", "mitigation"] as const satisfies readonly RichFieldName[];
const CHANGE_RICH_FIELDS = [
  "description",
  "impactDescription",
  "resolutionNotes",
] as const satisfies readonly RichFieldName[];
const MILESTONE_RICH_FIELDS = ["description"] as const satisfies readonly RichFieldName[];

/** Re-sanitize an entity's sanitized-HTML fields (the named rich fields +
 *  `noteLog`) at a load boundary. Used by the whole-object JSON + IndexedDB load
 *  paths, which cast their entities verbatim with no per-entity sanitizer (unlike
 *  CSV/MD/Turso, which route noteLog through `decodeNoteLog`). Idempotent on
 *  already-clean data (byte-stable goldens/sample stay green). Returns the entity
 *  BY REFERENCE when it carries none of the requested fields, so an entity with no
 *  rich content keeps identity — several byte-stability tests depend on that.
 *
 *  ★★★ A legacy PLAIN value is UPGRADED (escaped + wrapped) by `descriptionHtml`
 *  BEFORE it is sanitized, and the order is STILL load-bearing — but the damage it
 *  prevents changed size when `sanitizeNoteHtml` was retired, so do not quote the
 *  old wording. That sanitizer ran `KEEP_CONTENT: false` and deleted an unlisted
 *  element TOGETHER WITH ITS TEXT, so sanitizing plain text first erased the WORD:
 *  a stored RAID description of "risk: <b>vendor</b> delay" lost "vendor" on every
 *  JSON/IDB load. `sanitizeRichHtml` unwraps instead, so the word now survives and
 *  what is lost is the literal punctuation the user typed. Measured 2026-08-11 on
 *  that same value: escape-first gives "<p>risk: &lt;b&gt;vendor&lt;/b&gt;
 *  delay</p>" (what the user wrote), sanitize-first gives "<p>risk: vendor
 *  delay</p>" — the "<b>" characters silently gone. ★ The order also protects a
 *  value with no tag in it at all: "cost < 5k" escape-first is "<p>cost &lt;
 *  5k</p>", sanitize-first is "<p>cost &amp;lt; 5k</p>" — double-escaped, and the
 *  user reads "&lt;". Escaping first leaves no tag for DOMPurify to strip; an
 *  already-rich value passes through `descriptionHtml` untouched, so genuinely
 *  dangerous markup is still sanitized exactly as before.
 *
 *  ★★ DOM-BOUND: `sanitizeRichHtml` calls DOMPurify, which binds its `window` at
 *  module-eval. THIS FUNCTION and its four per-entity wrappers must not become
 *  reachable from a codec, an entity sanitizer, or anything under `scripts/` —
 *  the two whole-object load paths are the only legal callers.
 *  ★★★ SCOPED TO THIS FUNCTION, NOT TO THE FILE, and an earlier revision read as
 *  a file-level contract that the file itself violates. `sanitizeNoteLog` (above)
 *  calls `sanitizeRichHtml` and `htmlToText` too, and IS reached from CSV,
 *  Markdown and Turso through the exported `decodeNoteLog` — Turso via
 *  `ENTITY_SPECS.fromObj` reusing `build*FromObj`. It survives that only because
 *  `decodeNoteLog` wraps the call in a `try/catch`, and the catch is not a
 *  guard: measured under bare node with no DOM,
 *  `decodeNoteLog(JSON.stringify([{id:1,timestamp:"2026-01-01T00:00:00.000Z",
 *  html:"<p>hi</p>",text:"hi"}]))` returns `[]` — a well-formed entry SILENTLY
 *  discarded, no throw, no diagnostic. So in the sample generator and the fixture
 *  flow the codecs decode every note log to empty. Recorded, not fixed, under
 *  open-followups §28: widening the catch is the wrong repair (it is what stops a
 *  malformed cell failing a whole load), and telling "malformed JSON" apart from
 *  "no DOM" needs the post-decode hook that entry already owns. */
function sanitizeRichFields<T extends RichFieldCarrier>(
  entity: T,
  fields: readonly RichFieldName[],
): T {
  const patch: Partial<Record<RichFieldName, string>> & { noteLog?: NoteLogEntry[] } = {};
  let touched = false;
  for (const field of fields) {
    const value = entity[field];
    if (typeof value !== "string") continue;
    patch[field] = sanitizeRichHtml(descriptionHtml(value, RICH_SINK));
    touched = true;
  }
  if (Array.isArray(entity.noteLog)) {
    patch.noteLog = sanitizeNoteLog(entity.noteLog);
    touched = true;
  }
  if (!touched) return entity;
  return { ...entity, ...patch };
}

/* ── Per-entity load-boundary normalizers ────────────────────────────────────
 *
 * ★ SIBLINGS, not a widened `sanitizeNoteFields(entity, fields)`. Two reasons:
 *   1. Every call site is an `Array.prototype.map` — `map(sanitizeNoteFields)`
 *      passes the INDEX as the second argument, so a field-list parameter would
 *      be silently fed `0, 1, 2 …` and normalise nothing. A one-argument sibling
 *      keeps the point-free `.map(fn)` shape that is already in use.
 *   2. No caller has to know a field list. Adding a rich field to an entity is
 *      one edit HERE, and every load path picks it up; a widened signature would
 *      spread the same list across `workspace.ts` and `browser-backend.ts`, which
 *      is exactly how `mitigation` came to be normalised on neither.
 * The task path keeps its exact name, arity and behaviour, so it stays
 * byte-identical. */

/** Tasks: `description` + `noteLog`. */
export function sanitizeNoteFields<T extends RichFieldCarrier>(entity: T): T {
  return sanitizeRichFields(entity, TASK_RICH_FIELDS);
}

/** RAID: `description` + `mitigation` + `noteLog`. */
export function sanitizeRaidRichFields<T extends RichFieldCarrier>(entity: T): T {
  return sanitizeRichFields(entity, RAID_RICH_FIELDS);
}

/** Changes: `description` + `impactDescription` + `resolutionNotes` (no noteLog). */
export function sanitizeChangeRichFields<T extends RichFieldCarrier>(entity: T): T {
  return sanitizeRichFields(entity, CHANGE_RICH_FIELDS);
}

/** Milestones: `description` (no noteLog). */
export function sanitizeMilestoneRichFields<T extends RichFieldCarrier>(entity: T): T {
  return sanitizeRichFields(entity, MILESTONE_RICH_FIELDS);
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
    html: sanitizeRichHtml(html),
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
      html: sanitizeRichHtml(html),
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
