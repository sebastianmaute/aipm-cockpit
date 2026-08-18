// Pure decision layer for the hand block editor.
//
// ★★★ DOM-FREE AND i18n-FREE BY CONTRACT. Nothing here may touch `document`,
//  `window`, DOMPurify or a translation. The React layer renders; this module
//  decides. Keeping it pure is what makes the coalescing rule testable at all.
import type { DocVersion } from "./document-versions";
import type { DocBlock } from "./document-model";
import type { DocOp } from "./document-mutations";

/** How long after the previous user edit a further edit is treated as the same
 *  editing session. Deliberately short: long enough that typing through a
 *  document is one session, short enough that coming back after a break
 *  records a fresh before-image. */
export const COALESCE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Is a before-image UNWARRANTED for the edit about to be applied?
 *
 * ★★ The property this preserves is that the FIRST before-image of a session
 *  holds the state before the session started — the thing a user actually
 *  reverts to. Twenty keystroke-shaped snapshots would evict that, and every
 *  AI-authored version with it, against MAX_VERSIONS_PER_DOC (20).
 *
 * ★ Coalescing applies ONLY to a run of consecutive `user`/`update` versions on
 *  the SAME document. An AI write, a rename, a delete or a restore in between
 *  ends the run: those record a different actor's change and are never the
 *  current session's start state.
 */
export function shouldCoalesce(
  versions: readonly DocVersion[],
  documentId: number,
  now: string,
): boolean {
  const newest = newestVersion(versions);
  if (!newest) return false;
  if (newest.documentId !== documentId) return false;
  if (newest.source !== "user" || newest.op !== "update") return false;

  const nowMs = Date.parse(now);
  const savedMs = Date.parse(newest.savedAt);
  // ★ An unparseable timestamp must NOT coalesce. Coalescing on a value we
  //  cannot compare would silently drop a before-image on bad data — the
  //  failure that costs history rather than merely an extra version.
  if (Number.isNaN(nowMs) || Number.isNaN(savedMs)) return false;

  return nowMs - savedMs <= COALESCE_WINDOW_MS && nowMs >= savedMs;
}

/** ★ The caller must not have to pre-sort: this picks by `savedAt`, falling
 *  back to the higher id when two entries share a timestamp (two mutations in
 *  one tick carry an IDENTICAL `savedAt` — ids are minted in order).
 *
 * ★ The `savedAt` comparison below is a plain STRING (lexicographic) compare,
 *  not `Date.parse` — correct only because `DocVersion.savedAt` is guaranteed
 *  canonical `toISOString()` form (fixed-width UTC, millisecond precision),
 *  an invariant enforced by `isCanonicalIso` in `document-versions.ts` and
 *  documented only there. A caller passing an unsanitized/non-canonical
 *  `savedAt` here would silently misorder. */
function newestVersion(versions: readonly DocVersion[]): DocVersion | undefined {
  let best: DocVersion | undefined;
  for (const v of versions) {
    if (!best) { best = v; continue; }
    if (v.savedAt > best.savedAt || (v.savedAt === best.savedAt && v.id > best.id)) best = v;
  }
  return best;
}

/**
 * Does this paragraph's stored HTML contain an image element?
 *
 * ★★★ WHY THIS EXISTS: the shared `RichTextEditor` commits through
 *  `sanitizeRichHtml`, whose allow-list has no `img` — and `img` is a VOID
 *  element, so it does not unwrap to text, it vanishes outright. A document
 *  paragraph CAN hold one today, because model-authored paragraph HTML goes
 *  through `sanitizeDocumentHtml` (DOCUMENT_ALLOWED_TAGS is RICH_ALLOWED_TAGS
 *  plus `img`). So opening such a paragraph in the editor and typing one
 *  character would destroy the image with no error. Those paragraphs render
 *  read-only until S3c makes images first-class.
 *
 * ★ The `\b`-style boundary is load-bearing: without it "imgur" matches and a
 *  paragraph linking to imgur.com becomes uneditable for no reason.
 * ★ Operates on ALREADY-SANITIZED stored HTML, so a tag-shaped string in text
 *  content is escaped (`&lt;img&gt;`) and correctly does not match.
 */
export function paragraphHasImage(html: string): boolean {
  return /<img[\s/>]/i.test(html);
}

/** Did the edited block actually differ from the stored one?
 *
 *  ★ REQUIRED, not an optimisation: without it, focusing a block and leaving it
 *   writes a version whose before-image equals its after-image. */
export function blockChanged(stored: DocBlock, edited: DocBlock): boolean {
  return !deepEqual(stored, edited);
}

/** The single op a block edit produces. Block CONTENT is in scope for this
 *  slice; the SET of blocks is not, so nothing here appends, inserts or
 *  deletes. */
export function replaceBlockOp(index: number, block: DocBlock): DocOp {
  return { op: "replace", index, block };
}

/** ★ An OMITTED optional field and one explicitly set to `undefined` are the
 *  same block — a form control that clears `ordered` must not read as a change. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    if (ao[k] === undefined && bo[k] === undefined) continue;
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}
