// src/app/document-versions.ts — before-image snapshots of document mutations.
//
// A DocVersion is the state a mutation REPLACED, not a diff — restoring
// writes it back verbatim, so there is no inversion logic anywhere in this
// module or its consumers.
//
// ★★★ DOM-FREE BY CONTRACT, for the same SEPARATION-OF-CONCERNS reason
// document-model.ts states in its own header (read that one before touching
// this): structural validation and HTML sanitization are two different jobs.
// This module owns only the first, delegating block/title shape checks to
// sanitizeProjectDocuments so a version can never accept a shape the live
// document model would reject. It never calls DOMPurify — HTML sanitization
// for rich fields is document-rich-fields.ts's job, composed by the CALLER
// (the mutation engine), never duplicated here.
// ★ Do not cite "the sample generator runs under bare node" as the reason to
// keep this DOM-free — that rationale is stale (document-model.ts's header
// retracts it: the generator installs JSDOM before its dynamic imports, and
// document-rich-fields.ts's own header calls it "obsolete" outright). The
// real reason is that sanitizeProjectDocuments is DOM-free, and folding a
// DOM-bound pass into a module that composes it would let the two drift.
import { sanitizeProjectDocuments, type DocBlock, type ProjectDocument } from "./document-model";

export const MAX_VERSIONS_PER_DOC = 20;
export const MAX_TOTAL_VERSIONS = 500;

export type DocVersionSource = "ai" | "user";
export type DocVersionOp = "update" | "rename" | "delete" | "duplicate";

const SOURCES: readonly DocVersionSource[] = ["ai", "user"];
const OPS: readonly DocVersionOp[] = ["update", "rename", "delete", "duplicate"];

/** A snapshot of the state a mutation REPLACED. Restoring writes it back
 *  verbatim, so there is no inversion logic anywhere. */
export type DocVersion = {
  id: number;
  documentId: number;
  title: string;
  blocks: readonly DocBlock[];
  savedAt: string;
  source: DocVersionSource;
  op: DocVersionOp;
};

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Single entry point. Per-field validation; unknown shapes are DROPPED,
 *  never passed through. Block AND title validation are delegated to
 *  sanitizeProjectDocuments (it already trims/caps the title and drops
 *  unknown block types) so a shape can never be legal in a version and
 *  illegal in a document — one implementation, not two that can drift.
 *
 *  ★★★ `savedAt` is validated HERE, not borrowed from that delegation.
 *  sanitizeProjectDocuments does run `r.savedAt` through its own
 *  `Date.parse`-based check (via `createdAt`/`updatedAt`), but this function
 *  discards `asDoc.createdAt`/`updatedAt` and keeps the caller's raw
 *  `r.savedAt` on the returned DocVersion — so that validation would have
 *  been thrown away. A garbage `savedAt` is not cosmetic: `byNewest` does a
 *  raw string compare, and `trimVersions` picks `sorted[0]` as the tombstone,
 *  so a corrupted timestamp can crown the WRONG version as the one that
 *  survives a delete. Mirrors document-model.ts's private `isoOr`
 *  (Date.parse + Number.isFinite) rather than importing it — that function
 *  isn't exported, and this is the repo's one convention for "is this string
 *  a real timestamp", not a second one invented here. */
export function sanitizeDocumentVersions(raw: unknown): DocVersion[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const out: DocVersion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (!isPositiveInt(r.id) || !isPositiveInt(r.documentId)) continue;
    if (typeof r.savedAt !== "string" || !r.savedAt) continue;
    if (!Number.isFinite(Date.parse(r.savedAt))) continue;
    const [asDoc] = sanitizeProjectDocuments([
      { id: r.documentId, title: r.title, blocks: r.blocks, createdAt: r.savedAt, updatedAt: r.savedAt },
    ]);
    // ★ Dedup mirrors sanitizeProjectDocuments's own `seen` guard
    // (document-model.ts) — same asymmetry risk, same fix, kept in step with
    // its sibling rather than drifting. First occurrence wins.
    if (!asDoc || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({
      id: r.id,
      documentId: r.documentId,
      title: asDoc.title,
      blocks: asDoc.blocks,
      savedAt: r.savedAt,
      source: SOURCES.includes(r.source as DocVersionSource) ? (r.source as DocVersionSource) : "user",
      op: OPS.includes(r.op as DocVersionOp) ? (r.op as DocVersionOp) : "update",
    });
  }
  return out;
}

/** Newest first by savedAt, id as the tie-break so the order is total. */
function byNewest(a: DocVersion, b: DocVersion): number {
  return a.savedAt === b.savedAt ? b.id - a.id : a.savedAt < b.savedAt ? 1 : -1;
}

/**
 * Retention. Newest-first within a document, then newest-first globally —
 * for LIVE documents only.
 *
 * ★★★ A DELETED document (its documentId absent from `liveIds`) is NOT
 * "not yet trimmed" — it is trimmed immediately and hard, the first time
 * trimVersions runs after the delete, regardless of either cap: only its
 * single newest version (the tombstone) is kept AT ALL, every older version
 * is dropped in the same pass. That entry IS the tombstone, and "deleted
 * documents" is derived from its existence (see deletedDocumentVersions
 * below). Drop IT too and the document becomes unrecoverable while every
 * other test still passes.
 *
 * ★ Tombstones are excluded from `keepable` entirely, so they never count
 * against MAX_TOTAL_VERSIONS — and since document ids are never reused
 * (Task 1), every historical delete leaves one permanent row with no cap on
 * how many accumulate. Accepted trade-off, not an oversight.
 *
 * ★ The global cap has no per-document floor: a live document that is rarely
 * touched can, in principle, be starved to zero history if enough OTHER
 * documents are edited more often and fill the 500-row global pool first.
 * Accepted trade-off — at MAX_VERSIONS_PER_DOC=20 it takes 25+ actively-edited
 * documents before this can bite, and reserving a per-document floor inside
 * the global cap would trade a rare edge case for real complexity (the
 * "newest-first globally" ordering would have to become a fairness-
 * constrained allocation instead of a plain sort+slice).
 *
 * Returns the SAME reference when nothing needs dropping — the dirty check
 * on Turso and IndexedDB is reference equality.
 */
export function trimVersions(
  versions: readonly DocVersion[],
  liveIds: readonly number[],
): readonly DocVersion[] {
  const live = new Set(liveIds);
  const byDoc = new Map<number, DocVersion[]>();
  for (const version of versions) {
    const list = byDoc.get(version.documentId);
    if (list) list.push(version);
    else byDoc.set(version.documentId, [version]);
  }

  const protectedIds = new Set<number>();
  const keepable: DocVersion[] = [];
  for (const [documentId, list] of byDoc) {
    const sorted = [...list].sort(byNewest);
    if (!live.has(documentId)) {
      // Deleted: the newest entry is the tombstone and survives everything.
      protectedIds.add(sorted[0].id);
      continue;
    }
    keepable.push(...sorted.slice(0, MAX_VERSIONS_PER_DOC));
  }

  const globallyKept = keepable.sort(byNewest).slice(0, MAX_TOTAL_VERSIONS);
  const keptIds = new Set(globallyKept.map((version) => version.id));
  const next = versions.filter((version) => keptIds.has(version.id) || protectedIds.has(version.id));
  return next.length === versions.length ? versions : next;
}

/** Versions whose document no longer exists — the "deleted documents" list.
 *  DERIVED, never a stored flag: a flag would have to be cleared on restore
 *  and can desync from the documents array. */
export function deletedDocumentVersions(
  versions: readonly DocVersion[],
  documents: readonly ProjectDocument[],
): DocVersion[] {
  const live = new Set(documents.map((d) => d.id));
  const newestByDoc = new Map<number, DocVersion>();
  for (const version of versions) {
    if (live.has(version.documentId)) continue;
    const current = newestByDoc.get(version.documentId);
    if (!current || byNewest(version, current) < 0) newestByDoc.set(version.documentId, version);
  }
  return [...newestByDoc.values()].sort(byNewest);
}
