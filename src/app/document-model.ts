// src/app/document-model.ts
//
// Canonical model for a project document. A document is JSON at rest; bytes
// (.docx/.pptx/.html/.pdf) are rendered on demand and never stored.
//
// ★★★ DOM-FREE BY CONTRACT, and the reason is SEPARATION OF CONCERNS, not a
// missing DOM. This is the ONE structural validator every load path routes
// through — six backends plus the sample generator — so it must be runnable in
// any environment and must never depend on one. Structural validation (shape,
// bounds, dedupe) and HTML sanitization are two jobs; this module owns the
// first, `document-rich-fields.ts` owns the second, and callers compose them.
// A source scan in the test enforces it: comments may name DOMPurify, code
// may not.
//
// ★★★ DO NOT CITE THIS CONTRACT TO REFUSE ADDING SANITIZATION TO A LOAD PATH.
// The old rationale here said the sample generator "runs under bare node", so a
// DOMPurify call would throw and jsonToWorkspace's catch-all would silently
// write near-empty sample files. BOTH HALVES ARE CLOSED: the generator installs
// JSDOM before its dynamic imports (`generate-sample-workspace.ts`, the
// `new JSDOM(...)` + `Object.assign(globalThis, ...)` pair above the
// `await import("../src/app/storage")`), and it now decodes with
// `{ strict: true }` plus an explicit empty-workspace throw, so a silent
// degrade is no longer reachable. That stale reason is exactly what someone
// would quote to argue a decoder CANNOT be made to sanitize. It can: the fix is
// never to make this module DOM-bound, but for the CALLER to compose the two
// passes — `sanitizeProjectDocuments(raw).map(sanitizeDocumentRichFields)`,
// which is what `turso-schema.ts` and the IndexedDB load already do.

import { EXPORT_SECTION_KEYS, type ExportSectionKey } from "./settings-types";
import { capHtmlText, htmlTextLength } from "./rich-text-plain";
import { sanitizeDocEntityRefs, type DocEntityRef } from "./document-ref";

/** Bounds on what a hostile or corrupt import can force. */
// ★★ Raised 200 -> 1000 in the §103 fix. ONE constant serves TWO doors: the
// load-time truncation in sanitizeProjectDocuments AND the engine's
// create/duplicate/restore refusals in document-mutations.ts. Splitting it into
// separate load/create limits was considered and rejected -- a load cap higher
// than the create cap means a legitimately-loaded project cannot be edited,
// which is the "one door of two" shape that produced six defects in S2.
export const MAX_DOCUMENTS = 1000;
export const MAX_BLOCKS_PER_DOC = 500;
export const MAX_TABLE_ROWS = 500;
export const MAX_TABLE_COLUMNS = 30;
export const MAX_BULLET_ITEMS = 200;
export const MAX_TITLE_CHARS = 200;
export const MAX_TEXT_CHARS = 5_000;
export const MAX_HTML_TEXT_CHARS = 20_000;

export type DocBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; html: string }
  | { type: "bullets"; ordered?: boolean; items: string[] }
  | { type: "table"; caption?: string; columns: string[]; rows: string[][] }
  | { type: "dataSection"; key: ExportSectionKey }
  | { type: "pageBreak" };

export type ProjectDocument = {
  id: number;
  title: string;
  blocks: readonly DocBlock[];
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp. */
  updatedAt: string;
  /** Project entities this document is about. Sparse — omitted when empty, so
   *  an unlinked document serializes byte-identically. See document-ref.ts. */
  linkedEntities?: readonly DocEntityRef[];
};

/** ★★★ READ THE REGISTRY AT CALL TIME, NEVER AT MODULE-EVAL — and do not
 *  "optimize" this back into a module-level `new Set(EXPORT_SECTION_KEYS)`.
 *
 *  There is a runtime import cycle around this module: settings-types.ts imports
 *  the VALUE `defaultStorageConfig` from ./workspace, workspace.ts imports this
 *  file, and this file imports EXPORT_SECTION_KEYS back from ./settings-types.
 *  Entered through ./storage (i.e. how the app actually loads), this module
 *  evaluates while settings-types is still mid-evaluation, so an eval-time
 *  snapshot captured an EMPTY set and froze it for the life of the process —
 *  silently dropping every dataSection block, the one block type that embeds
 *  live project data. Entered directly, settings-types finishes first and the
 *  snapshot was fine, which is why the model's own 28-test suite stayed green.
 *
 *  ★★ A lazily-memoized Set has the SAME failure mode moved to first call: one
 *  early call during module evaluation would memoize an empty set permanently.
 *  Testing the array directly keeps no snapshot to poison, so the bug is
 *  structurally impossible rather than merely unlikely. The list is 15 entries
 *  and this runs only for a dataSection block, so O(n) here is free.
 *
 *  ★ Regression-pinned by document-model.storage-cycle.test.ts, which must
 *  import ./storage FIRST — an assertion in document-model.test.ts cannot fail. */
function isSectionKey(key: string): key is ExportSectionKey {
  return (EXPORT_SECTION_KEYS as readonly string[]).includes(key);
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function isoOr(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const t = Date.parse(v);
  return Number.isFinite(t) ? v : fallback;
}

function sanitizeBlock(raw: unknown): DocBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;

  switch (b.type) {
    case "pageBreak":
      return { type: "pageBreak" };

    case "heading": {
      const text = str(b.text, MAX_TEXT_CHARS).trim();
      if (!text) return null;
      const n = Math.floor(Number(b.level));
      const level = (Number.isFinite(n) ? Math.min(3, Math.max(1, n)) : 1) as 1 | 2 | 3;
      return { type: "heading", level, text };
    }

    case "paragraph": {
      // ★ Measure VISIBLE TEXT, not html.length, and cap with capHtmlText — it
      // backs a truncation off one code unit rather than splitting a surrogate
      // pair (a lone surrogate becomes U+FFFD on CSV/MD but survives on
      // JSON/IDB: a backend-dependent corruption). clipText still has that bug.
      const html = typeof b.html === "string" ? b.html : "";
      if (htmlTextLength(html) === 0) return null;
      return { type: "paragraph", html: capHtmlText(html, MAX_HTML_TEXT_CHARS) };
    }

    case "bullets": {
      if (!Array.isArray(b.items)) return null;
      const items = b.items
        .slice(0, MAX_BULLET_ITEMS)
        .map((i) => str(i, MAX_TEXT_CHARS).trim())
        .filter((i) => i !== "");
      if (items.length === 0) return null;
      return b.ordered === true
        ? { type: "bullets", ordered: true, items }
        : { type: "bullets", items };
    }

    case "table": {
      if (!Array.isArray(b.columns)) return null;
      const columns = b.columns
        .slice(0, MAX_TABLE_COLUMNS)
        .map((c) => str(c, MAX_TEXT_CHARS));
      if (columns.length === 0) return null;
      const rawRows = Array.isArray(b.rows) ? b.rows : [];
      const rows = rawRows.slice(0, MAX_TABLE_ROWS).map((r) => {
        const cells = Array.isArray(r) ? r : [];
        const out = cells.slice(0, columns.length).map((c) => str(c, MAX_TEXT_CHARS));
        while (out.length < columns.length) out.push("");
        return out;
      });
      const caption = str(b.caption, MAX_TEXT_CHARS).trim();
      return caption
        ? { type: "table", caption, columns, rows }
        : { type: "table", columns, rows };
    }

    case "dataSection": {
      const key = typeof b.key === "string" ? b.key : "";
      // Ground the key against the real registry — a hallucinated or stale key
      // must never reach buildExportSections. `isSectionKey` narrows, so the
      // return needs no cast (a cast here would survive the registry going empty).
      if (!isSectionKey(key)) return null;
      return { type: "dataSection", key };
    }

    default:
      return null;
  }
}

function sanitizeDocument(raw: unknown): ProjectDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;

  const id = Math.floor(Number(d.id));
  if (!Number.isFinite(id) || id <= 0) return null;

  const title = str(d.title, MAX_TITLE_CHARS).trim();
  if (!title) return null;

  const rawBlocks = Array.isArray(d.blocks) ? d.blocks : [];
  const blocks = rawBlocks
    .slice(0, MAX_BLOCKS_PER_DOC)
    .map(sanitizeBlock)
    .filter((b): b is DocBlock => b !== null);

  const createdAt = isoOr(d.createdAt, "");
  // ★★★ THIS FUNCTION BUILDS FROM AN EXPLICIT FIELD LIST. A field not named
  // here is dropped on EVERY load path, silently — the shape that erased RAID
  // note logs (open-followups §49). Adding a persisted field means adding it
  // HERE, not only to the type.
  const linkedEntities = sanitizeDocEntityRefs(d.linkedEntities);
  return {
    id,
    title,
    blocks,
    createdAt,
    updatedAt: isoOr(d.updatedAt, createdAt),
    // Sparse: an empty list is an ABSENT field, not `[]` — the goldens pin bytes.
    ...(linkedEntities.length > 0 ? { linkedEntities } : {}),
  };
}

/** Optional accumulator recording what a LOAD-TIME cap silently discarded.
 *  Structurally compatible with `ImportDiag` (csv-codecs-decode.ts) so the
 *  existing CSV/Markdown threading carries it with no extra plumbing, and
 *  declared HERE so this module needs no runtime import of a codec — that
 *  would risk the import cycle recorded in open-followups §92.
 *  ★ `truncatedEntries` counts RAW ARRAY ENTRIES past the cap, not validated
 *  documents. Counting real documents would mean sanitizing the whole tail,
 *  which reintroduces the denial-of-service the cap exists to prevent. It is
 *  therefore an UPPER BOUND — never an undercount — and every user-facing
 *  string says "entries" for that reason.
 *  ★ `truncatedBlocks` is the same shape one level down: raw block entries past
 *  `MAX_BLOCKS_PER_DOC`, written by `sanitizeDocument` here for LIVE documents
 *  and by `sanitizeDocumentVersions` for versions, into ONE accumulator. Blocks
 *  the validator drops as INVALID are deliberately excluded — the count arms a
 *  sticky save guard, and refusing to save cannot recover a block no load will
 *  ever accept (document-versions.ts holds the measurement).
 *  ★ `truncatedBlocks` is written BEFORE the document is known to survive the
 *  dedup below, so a duplicate-id entry contributes its block overflow even
 *  though the document itself is dropped. Upper bound, as declared. */
export interface DocTruncationDiag {
  truncatedEntries?: number;
  truncatedBlocks?: number;
}

/** The SINGLE validator for the persisted documents array. Every load path
 *  routes through this. */
export function sanitizeProjectDocuments(
  raw: unknown,
  diag?: DocTruncationDiag,
): ProjectDocument[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const out: ProjectDocument[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (out.length >= MAX_DOCUMENTS) {
      // Count the untouched tail and stop. `raw.length - i` is O(1) and never
      // understates the loss; sanitizing the tail to get an exact figure is
      // exactly the unbounded work the cap is here to refuse.
      if (diag) diag.truncatedEntries = (diag.truncatedEntries ?? 0) + (raw.length - i);
      break;
    }
    const doc = sanitizeDocument(raw[i]);
    if (!doc || seen.has(doc.id)) continue;
    seen.add(doc.id);
    // ★★★ A LIVE DOCUMENT'S BLOCK LOSS USED TO BE COMPLETELY SILENT. Versions
    // reported theirs (document-versions.ts) but the documents they are versions
    // OF did not, so a 600-block document loaded as 500, the next save wrote 500
    // back over all six write paths, and the 100 were gone with no count, no
    // toast and nothing raised for the §103 save guard to refuse.
    // ★★ Same UPPER-BOUND contract as `truncatedEntries`: RAW entries past the
    // cap, not blocks proven valid. Blocks the validator drops as INVALID are
    // deliberately NOT counted — a count including them arms the sticky guard
    // over a loss that refusing to save cannot recover.
    // ★★★ COUNTED HERE, AFTER THE KEEP DECISION, NOT INSIDE `sanitizeDocument`.
    // It used to sit in there, which ran BEFORE this dedup check — so a
    // duplicate-id document contributed its block overflow while the document
    // itself was discarded, pausing saving over blocks belonging to a document
    // that never loaded. That was the same inconsistency the invalid-block
    // exclusion above exists to avoid: a duplicate is dropped by every future
    // load too, so refusing to save cannot recover it either.
    if (diag) {
      const rawBlocks = (raw[i] as { blocks?: unknown }).blocks;
      const n = Array.isArray(rawBlocks) ? rawBlocks.length : 0;
      if (n > MAX_BLOCKS_PER_DOC) {
        diag.truncatedBlocks = (diag.truncatedBlocks ?? 0) + (n - MAX_BLOCKS_PER_DOC);
      }
    }
    out.push(doc);
  }
  return out;
}
