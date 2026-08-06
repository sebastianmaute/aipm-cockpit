// src/app/document-model.ts
//
// Canonical model for a project document. A document is JSON at rest; bytes
// (.docx/.pptx/.html/.pdf) are rendered on demand and never stored.
//
// ★★★ DOM-FREE BY CONTRACT. This module is in the import graph of
// scripts/generate-sample-workspace.ts, which runs under bare node. DOMPurify
// binds `window` at module-eval, so a call here throws, jsonToWorkspace's
// catch-all swallows it into an EMPTY workspace, and the generator then
// "successfully" writes near-empty sample files. The HTML allow-list runs at
// the render sink and at the whole-object load boundaries instead. A source
// scan in the test enforces this: comments may name the library, code may not.

import { EXPORT_SECTION_KEYS, type ExportSectionKey } from "./settings-types";
import { capHtmlText, htmlTextLength } from "./rich-text-plain";

/** Bounds on what a hostile or corrupt import can force. */
export const MAX_DOCUMENTS = 200;
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

  const blocks = (Array.isArray(d.blocks) ? d.blocks : [])
    .slice(0, MAX_BLOCKS_PER_DOC)
    .map(sanitizeBlock)
    .filter((b): b is DocBlock => b !== null);

  const createdAt = isoOr(d.createdAt, "");
  return {
    id,
    title,
    blocks,
    createdAt,
    updatedAt: isoOr(d.updatedAt, createdAt),
  };
}

/** The SINGLE validator for the persisted documents array. Every load path
 *  routes through this. */
export function sanitizeProjectDocuments(raw: unknown): ProjectDocument[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const out: ProjectDocument[] = [];
  for (const entry of raw) {
    if (out.length >= MAX_DOCUMENTS) break;
    const doc = sanitizeDocument(entry);
    if (!doc || seen.has(doc.id)) continue;
    seen.add(doc.id);
    out.push(doc);
  }
  return out;
}

/** max+1 mint, matching every other entity. */
export function nextDocumentId(docs: readonly ProjectDocument[]): number {
  return docs.reduce((max, d) => Math.max(max, d.id), 0) + 1;
}
