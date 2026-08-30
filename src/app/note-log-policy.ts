// src/app/note-log-policy.ts
//
// The note-log validation policy, shared by the canonical validator
// (`sanitizeNoteLog`, note-log.ts) and the template seed's
// (`sanitizeSeedNoteLog`, templates.ts).
//
// ★★★ THIS FILE IS DOM-FREE BY CONTRACT and its test enforces that with a
// comment-stripped source scan. `templates.ts` sits in the sample generator's
// import graph and cannot reach DOMPurify; that is the ONE forced difference
// between the two validators. Every other difference was unforced, and
// open-followups §286 records the six that had accumulated:
//   entry count cap, html cap shape, text/authorName control-char stripping,
//   missing/duplicate id handling, and timestamp validation.
//
// The DOM-dependent steps (clean an html fragment, project it to plain text)
// are injected via `NoteLogHtmlOps`. Everything else — entry cap, byte html
// cap, control-char stripping, timestamp validation, mint-and-dedupe — lives
// here once, carrying the CANONICAL semantics from `sanitizeNoteLog`.

import type { NoteLogEntry } from "./types";

export interface NoteLogHtmlOps {
  /** Clean an html fragment. Canonical: `sanitizeRichHtml`. Seed:
   *  `sanitizeRichText` against `RICH_SINK`. */
  sanitizeHtml: (raw: string) => string;
  /** Project cleaned html to plain text. Canonical: `htmlToText`. Seed:
   *  `htmlPlainProjection`. */
  toText: (html: string) => string;
}

/** Caps — keep a hand-edited or model-supplied blob bounded. Moved here
 *  verbatim from note-log.ts; DO NOT change a value as part of adopting this
 *  core (open-followups §286 is a behaviour-unification slice, not a
 *  cap-tuning one). */
export const MAX_NOTE_ENTRIES = 500;
export const MAX_NOTE_TEXT = 4000;
export const MAX_AUTHOR_NAME = 200;
export const MAX_NOTE_HTML = 20000;

/** Collapse newlines/tabs to a single space FIRST so multi-line pasted note
 *  text degrades to a readable single line (words stay separated) rather than
 *  being jammed together by the raw control-char strip below. Applied to
 *  `text` only — NOT to `authorName`, matching the canonical validator. */
const NEWLINE_TAB = /[\r\n\t]+/g;
/** Strip the remaining control chars — keeps a note-log cell single-line and
 *  free of file-corrupting bytes. Same class as the rationale sanitizer. */
const CONTROL_CHARS = /[\x00-\x1f]/g;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** True for a parseable ISO-ish instant string. Used for both `timestamp`
 *  (required) and `editedAt` (optional) — the canonical validator validates
 *  both the same way. */
function isValidTimestamp(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "" && !Number.isNaN(Date.parse(v));
}

function cleanText(v: unknown, cap: number): string {
  return (typeof v === "string" ? v : "")
    .replace(NEWLINE_TAB, " ")
    .replace(CONTROL_CHARS, "")
    .trim()
    .slice(0, cap);
}

/** `authorName` deliberately skips the NEWLINE_TAB collapse `cleanText`
 *  applies to `text` — a person's name has no multi-line-paste case to
 *  degrade, and the canonical validator never ran that replace over it. */
function cleanAuthorName(v: unknown): string {
  return (typeof v === "string" ? v : "")
    .replace(CONTROL_CHARS, "")
    .trim()
    .slice(0, MAX_AUTHOR_NAME);
}

/** Minimal &/</> escape for wrapping legacy plain text in a synthetic <p> when
 *  upgrading a pre-rich-text entry that has no html of its own. */
function escapeForHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Accept only well-formed note entries from untrusted JSON. An entry with an
 * empty text AND no usable html is dropped. Every returned entry is
 * guaranteed a unique numeric `id` — a legacy entry with no `id` gets one
 * minted (max-seen + 1), so upgrading old data never throws and never
 * collides ids.
 *
 * ★★ A missing or duplicate `id` is MINTED, never dropped. Legacy entries with
 * no id exist — that is what the canonical repair was written for — and the
 * notes window edits and deletes BY id, so two entries sharing one id leave
 * the other unaddressable. §168's heading is "template import drops every
 * register's note log"; dropping here would leave it fixed except for
 * exactly the legacy entries the canonical mint was written for.
 */
export function sanitizeNoteLogWith(raw: unknown, ops: NoteLogHtmlOps): NoteLogEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: NoteLogEntry[] = [];
  const usedIds = new Set<number>();
  let nextMintId = 1;

  for (const entry of raw) {
    if (out.length >= MAX_NOTE_ENTRIES) break;
    if (!isPlainObject(entry)) continue;
    if (!isValidTimestamp(entry.timestamp)) continue;

    let text = cleanText(entry.text, MAX_NOTE_TEXT);

    const htmlSource = typeof entry.html === "string" ? entry.html.trim() : "";
    const hasHtml = htmlSource !== "";
    const html = (hasHtml
      ? ops.sanitizeHtml(htmlSource)
      : ops.sanitizeHtml(`<p>${escapeForHtml(text)}</p>`)
    ).slice(0, MAX_NOTE_HTML);

    // ★★★ THE HTML IS THE SOURCE OF TRUTH WHEN IT PROJECTS TO ANYTHING, so a captured
    // `text` is RE-DERIVED rather than merely defaulted. This is a SEVENTH divergence
    // between the two validators, found by adopting the core rather than by the §286
    // audit, which enumerated six: the canonical validator derived text only when the
    // captured one was empty (`hasHtml && !text`), while the seed validator always
    // re-projected. Here the SEED rule wins — a captured `text` can disagree with its
    // `html` after a hand-edited template, or after a sink change narrowed the html
    // since capture, and a stale projection must not outlive the html it describes.
    //
    // ★★★ BUT ONLY WHEN THE PROJECTION IS NON-EMPTY, AND THAT GUARD IS LOAD-BEARING.
    // The first cut of this line was an unconditional `text = cleanText(toText(html))`,
    // and four lines below it `if (!text) continue` DROPS the entry — so any html that
    // sanitises or projects to nothing deleted the whole entry: its timestamp, its
    // author and the perfectly good captured text with it. Measured against the real
    // `sanitizeRichHtml`/`htmlToText` pair, not reasoned: `<hr>` survives sanitising and
    // projects to ""; `<p><br></p>` likewise; an image-only body sanitises to "" because
    // `img` is not in RICH_ALLOWED_TAGS. All three entries vanished. That is a data-loss
    // regression on the CANONICAL load path — every backend, every load — introduced by a
    // branch whose whole purpose was to close data-loss paths.
    //
    // ★★ THE OLD CANONICAL RULE DID NOT HAVE THIS HOLE: it only ever ASSIGNED text
    // when the captured one was empty, so an empty projection left the captured text
    // standing. Re-deriving only when the projection is non-empty keeps the seed rule's
    // intent (html wins where the two DISAGREE) and restores the old rule's floor (an
    // entry is never destroyed by a projection that says nothing).
    const projected = hasHtml ? cleanText(ops.toText(html), MAX_NOTE_TEXT) : "";
    if (projected) text = projected;

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

    const authorId = typeof entry.authorResourceId === "number" ? entry.authorResourceId : NaN;
    if (Number.isFinite(authorId) && authorId > 0) item.authorResourceId = Math.floor(authorId);

    const name = cleanAuthorName(entry.authorName);
    if (name) item.authorName = name;

    if (isValidTimestamp(entry.editedAt)) item.editedAt = entry.editedAt;

    out.push(item);
  }
  return out;
}
