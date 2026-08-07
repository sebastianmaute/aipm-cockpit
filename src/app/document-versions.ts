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
/** ★ `"restored"` is the one op that is NOT a before-image. It is a MARKER
 *  written against a DELETED document's old id when that document is restored
 *  under a new one, and it exists solely so the tombstone derivation can tell
 *  "still deleted" from "already restored". See RESTORED_MARKER_OP below. */
export type DocVersionOp = "update" | "rename" | "delete" | "duplicate" | "restored";

const SOURCES: readonly DocVersionSource[] = ["ai", "user"];
const OPS: readonly DocVersionOp[] = ["update", "rename", "delete", "duplicate", "restored"];

/**
 * ★★★ The op that closes a tombstone.
 *
 * Restoring a DELETED document mints a NEW id rather than resurrecting the old
 * one (ids are never reused). Without a marker the old id stays absent from
 * `documents` forever, so `deletedDocumentVersions` would keep reporting it as
 * deleted after the user had already restored it — a phantom row whose Restore
 * button spawns yet another copy on every click. A stored boolean was rejected
 * for the usual reason (it has to be cleared, and can desync); a marker VERSION
 * keeps the "derived, never a flag" property intact, because the derivation
 * still reads only the version list.
 *
 * ★★ It also un-protects the group in `trimVersions`. A tombstone is exempt
 * from BOTH caps, so leaving one behind per delete-restore cycle would leak
 * rows that no mechanism could ever reclaim. Once the marker is the newest
 * entry for that id, the group re-enters ordinary retention and ages out.
 */
export const RESTORED_MARKER_OP: DocVersionOp = "restored";

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

/** ★ `new Date(x).toISOString()` THROWS on an unparseable string rather than
 *  returning something comparable, so the round trip is wrapped rather than
 *  guarded by a second `Date.parse` call. See `sanitizeDocumentVersions` below
 *  for why the round trip — and not parseability — is the property that
 *  matters. */
function isCanonicalIso(value: string): boolean {
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

/** Single entry point. Per-field validation; unknown shapes are DROPPED,
 *  never passed through. Block AND title validation are delegated to
 *  sanitizeProjectDocuments (it already trims/caps the title and drops
 *  unknown block types) so a shape can never be legal in a version and
 *  illegal in a document — one implementation, not two that can drift.
 *
 *  ★★★ `savedAt` is validated HERE, not borrowed from that delegation.
 *  sanitizeProjectDocuments does run `r.savedAt` through its own check (via
 *  `createdAt`/`updatedAt`), but this function discards
 *  `asDoc.createdAt`/`updatedAt` and keeps the caller's raw `r.savedAt` on the
 *  returned DocVersion — so that validation would have been thrown away.
 *
 *  ★★★ AND IT CHECKS THE SHAPE, NOT MERELY THAT `Date.parse` ACCEPTS IT.
 *  An earlier revision of this comment claimed a `Date.parse` +
 *  `Number.isFinite` pair prevented a corrupted timestamp from crowning the
 *  wrong survivor. It did not, and the gap was measured: `Date.parse` happily
 *  accepts `"12/25/2026"`, this function then kept it VERBATIM, and every
 *  consumer compares `savedAt` as a RAW STRING — so a December date sorted as
 *  the OLDEST entry in the list. `deletedDocumentVersions` named the wrong
 *  version as the tombstone and `trimVersions` DROPPED the genuinely newest
 *  one, irreversibly. Parseability was never the property the consumers need;
 *  "lexicographic order equals chronological order" is, and only the canonical
 *  ISO form has it.
 *
 *  ★★ So the check is a ROUND TRIP, and mismatches are DROPPED rather than
 *  normalised. Normalising would rewrite stored bytes and put this on the
 *  byte-stability goldens' critical path for no gain; dropping touches nothing
 *  that was already well-formed. Every in-app write is `new Date().toISOString()`,
 *  so only hand-edited files, imports and third-party workspaces can fail it. */
export function sanitizeDocumentVersions(raw: unknown): DocVersion[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const out: DocVersion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (!isPositiveInt(r.id) || !isPositiveInt(r.documentId)) continue;
    if (typeof r.savedAt !== "string" || !isCanonicalIso(r.savedAt)) continue;
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
 * against MAX_TOTAL_VERSIONS. That exemption is BOUNDED by the restored
 * marker: once a deleted id's newest entry is `RESTORED_MARKER_OP`, the
 * document has been recovered, the group is no longer a tombstone, and it
 * re-enters ordinary retention so it can age out. Without that, every
 * delete-restore cycle would leak one permanently unreclaimable row.
 *
 * ★★ AN ID DELETED AND NEVER RESTORED KEEPS ITS TOMBSTONE FOREVER, and an
 * earlier revision of this note called that "one row" — which understates it
 * on both axes and is why it read as a smaller trade-off than it is. It is one
 * row PER DELETED DOCUMENT WITH NO CEILING (tombstones never enter `keepable`,
 * so `MAX_TOTAL_VERSIONS` does not bound them — they accumulate ON TOP of the
 * 500), and each row carries the document's FULL BLOCKS. Measured: 400
 * create-and-delete cycles left 400 tombstones serialising to 4.38 MB, and on
 * the CSV and Markdown paths that whole array is a SINGLE cell
 * (`csv-codecs-config.ts` parses `rows[0][1]`). Still the accepted trade-off —
 * the alternative is discarding the only surviving copy of deleted content —
 * but bounding it is a real data-retention decision, deliberately left to its
 * own scope rather than smuggled in here.
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
    // ★ A restored marker as the NEWEST entry means this id was recovered
    // under a new document id, so the group is no longer a tombstone: it gets
    // ordinary retention and can age out, instead of one row surviving both
    // caps forever. Only the newest entry decides — an older marker under a
    // later delete means the id was deleted AGAIN and is a tombstone once more.
    if (!live.has(documentId) && sorted[0].op !== RESTORED_MARKER_OP) {
      // Deleted: the newest entry is the tombstone and survives everything.
      protectedIds.add(sorted[0].id);
      continue;
    }
    keepable.push(...sorted.slice(0, MAX_VERSIONS_PER_DOC));
  }

  const globallyKept = keepable.sort(byNewest).slice(0, MAX_TOTAL_VERSIONS);
  const keptIds = new Set(globallyKept.map((version) => version.id));
  // ★★ DEDUP BY ID, closing an asymmetry with `sanitizeDocumentVersions`, which
  // already drops a repeated id (first occurrence wins). Without it this filter
  // keeps BOTH copies — `keptIds.has` is true for each — so trim was not
  // idempotent over an array that already carried a duplicate, while its
  // sibling in the same file was.
  // ★ UNREACHABLE THROUGH THE ENGINE: version ids are minted monotonically
  // (id-mint-session) and every load path routes through
  // `sanitizeDocumentVersions`, so only a caller constructing DocState by hand
  // can produce one. Taken anyway because it is provably free on well-formed
  // input — every id is unique, so `emitted` never fires and the array is
  // returned BY REFERENCE exactly as before — and because it costs strictly
  // less than the sort two lines above. Same first-occurrence-wins rule as the
  // sibling, so the two cannot disagree about which copy survives.
  const emitted = new Set<number>();
  const next = versions.filter((version) => {
    if (!keptIds.has(version.id) && !protectedIds.has(version.id)) return false;
    if (emitted.has(version.id)) return false;
    emitted.add(version.id);
    return true;
  });
  return next.length === versions.length ? versions : next;
}

/** Documents that were DELETED — the "deleted documents" list. DERIVED, never
 *  a stored flag: a flag would have to be cleared on restore and can desync
 *  from the documents array.
 *
 *  ★★★ "ABSENT FROM `documents`" IS NOT THE SAME QUESTION AS "WAS DELETED",
 *  and this function used to ask the first one. Every version whose
 *  `documentId` had no live document was reported, whatever it recorded — so
 *  any asymmetry between how the two arrays load surfaced as a phantom
 *  deletion. The reachable one is a cap asymmetry: `sanitizeProjectDocuments`
 *  `break`s at `MAX_DOCUMENTS`, while `sanitizeDocumentVersions` has no count
 *  cap and structurally cannot acquire one (it delegates ONE version at a time,
 *  so the sanitizer's own `out.length >= MAX_DOCUMENTS` is never true there).
 *  Measured on all six write paths: a 205-document file loads as 200 documents
 *  and 205 versions, and five documents that still exist in the file were
 *  listed as deleted — with a Restore button that would mint a duplicate of
 *  each.
 *
 *  ★★★ So the derivation now requires `op === "delete"`, which is what it
 *  always meant. That is sound BY CONSTRUCTION, not by luck: the delete case
 *  writes `snapshot(target, "delete", ctx)` with `savedAt = ctx.now` and a
 *  version id minted last, so it wins both the timestamp comparison and
 *  `byNewest`'s descending-id tie-break; and `trimVersions` keeps exactly that
 *  one entry for a deleted document. Verified against five real mutation
 *  sequences including duplicate-then-delete-the-copy, where the copy's own
 *  `"duplicate"` version sits in the same group and correctly loses to the
 *  later delete. A truncation artifact's newest op is whatever the last real
 *  edit was — `update`, `rename` or `duplicate` — so it drops out.
 *
 *  ★★ THIS SUBSUMES THE OLD `RESTORED_MARKER_OP` EXCLUSION, which is why that
 *  filter is gone rather than merely reordered: a marker is not `"delete"`, so
 *  a restored id fails the new check for the same reason it failed the old one.
 *  The behaviour it protected is unchanged and still tested — an id restored
 *  and then deleted AGAIN reappears, because the check reads only the newest
 *  entry and that entry is once more a delete.
 *
 *  ★ ITS LIMIT: a hand-edited file could still carry `op:"delete"` on a
 *  document the load truncated away, and that would still show as a phantom.
 *  Far narrower than the cap asymmetry, which needed no editing at all.
 *
 *  ★ FIXED HERE rather than deeper on purpose. Not in the six load paths (six
 *  places, and the tenant one is the file this slice's plan already missed
 *  once). Not in `sanitizeDocumentVersions` — it never receives `documents`,
 *  and teaching it to drop versions for truncated documents would destroy the
 *  ONLY surviving copy of that content. The consuming end is one place, and it
 *  makes the function say what it means. */
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
  return [...newestByDoc.values()].filter((version) => version.op === "delete").sort(byNewest);
}
