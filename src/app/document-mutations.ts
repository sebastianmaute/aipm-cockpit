// src/app/document-mutations.ts — the SINGLE path both the Documents pane and
// the AI tools use to mutate a document. If each mutated documents/versions
// independently, "every mutation snapshots its before-image" would only be
// half-implemented — and that snapshot is the entire safety net, because AI
// chat tool writes bypass the undo stack entirely.
//
// A DocVersion is a before-image: the state a mutation REPLACED. Restore
// writes it back verbatim — there is deliberately no inversion logic here or
// anywhere downstream of it.
//
// ★★★ DOM-FREE BY CONTRACT, same separation-of-concerns reason as
// document-model.ts and document-versions.ts: this module only rearranges
// already-sanitized ProjectDocument/DocBlock values, so it never needs a DOM
// and must stay runnable without one. HTML sanitization is the CALLER's job
// (composed at the load boundary, per document-model.ts's header) — this
// module never touches it.
//
// ★★★ NO CLOCK AND NO MINT. `now` and both id minters are injected via
// DocContext, so applyDocMutation is a pure, deterministic function of its
// inputs — required for Task 10's property test to drive it, and for the
// mutation itself to be replayable/testable without wall-clock coupling.
//
// ★ `changed:false` paths return the caller's OWN `documents`/`versions`
// references, never a rebuilt-but-equal array — workspace-context uses that
// reference identity to decide whether a write is needed at all.

import {
  MAX_BLOCKS_PER_DOC,
  MAX_DOCUMENTS,
  MAX_TITLE_CHARS,
  type DocBlock,
  type ProjectDocument,
} from "./document-model";
import {
  deletedDocumentVersions,
  RESTORED_MARKER_OP,
  trimVersions,
  type DocVersion,
  type DocVersionOp,
  type DocVersionSource,
} from "./document-versions";
import { MAX_LINKS_PER_DOC, refKey, sanitizeDocEntityRefs, type DocEntityRef } from "./document-ref";

export type DocOp =
  | { op: "append"; block: DocBlock }
  | { op: "insert"; index: number; block: DocBlock }
  | { op: "replace"; index: number; block: DocBlock }
  | { op: "delete"; index: number }
  | { op: "replaceAll"; blocks: readonly DocBlock[] };

export type DocMutation =
  | { kind: "create"; title: string; blocks?: readonly DocBlock[] }
  | { kind: "rename"; id: number; title: string }
  | { kind: "duplicate"; id: number; title: string }
  | { kind: "delete"; id: number }
  | { kind: "ops"; id: number; ops: readonly DocOp[]; title?: string }
  | { kind: "restore"; versionId: number }
  | { kind: "link"; id: number; ref: DocEntityRef }
  | { kind: "unlink"; id: number; ref: Pick<DocEntityRef, "kind" | "id"> };

export type DocState = { documents: readonly ProjectDocument[]; versions: readonly DocVersion[] };

export type DocResult = DocState & {
  changed: boolean;
  rejected: readonly string[];
  /** The document the mutation landed on — the caller's tool result needs it.
   *  `null` for delete (nothing survives) and for a rejected/no-op mutation. */
  documentId: number | null;
};

export type DocContext = {
  now: string;
  source: DocVersionSource;
  mintDocId: () => number;
  mintVersionId: () => number;
};

function unchanged(state: DocState, rejected: readonly string[] = []): DocResult {
  return { documents: state.documents, versions: state.versions, changed: false, rejected, documentId: null };
}

/** Cap+trim a title the SAME way document-model.ts's sanitizer does
 *  (slice to MAX_TITLE_CHARS, then trim) — so a title accepted here can never
 *  disagree with what the sanitizer produces the next time this workspace is
 *  loaded. Empty (including whitespace-only) is rejected by every caller
 *  below rather than silently stored, because the sanitizer would drop such
 *  a document/version on the very next load while this module reported
 *  success — exactly the "in-memory state disagrees with reloaded state"
 *  class of bug this module exists to avoid. */
function capTitle(title: string): string {
  return title.slice(0, MAX_TITLE_CHARS).trim();
}

/** ★★★ TITLE UNIQUENESS IS A PROPERTY OF THE DOCUMENT SET, so it is enforced
 *  where the set is — here — and not at each surface that writes one.
 *  `documents-list.tsx` builds every per-row control's accessible name as
 *  `<verb> – <title>` and the row-title button IS the bare title, so two equal
 *  titles give FIVE pairs of identical control names: WCAG 2.4.6, and invisible
 *  to the axe gate, which scans a statically seeded app and never clicks New,
 *  Duplicate or Restore.
 *
 *  ★★ It used to live in `documents-panel.tsx` alone, which meant one of at
 *  least four write surfaces enforced it. The other three did not, and it
 *  showed: `restore` recreates a deleted document with the stored title
 *  VERBATIM, so restoring four times produced four documents all called
 *  "Charter" — and even a single restore collides whenever the user has since
 *  created a replacement under the same name.
 *
 *  ★★★ RESTORE IS TWO PATHS AND ONLY THE RECREATE HALF WAS COVERED — the same
 *  "one door of two" this file keeps producing. The IN-PLACE half went on
 *  writing `version.title` verbatim, measured: rename "Charter"→"Charter v2",
 *  create a new "Charter", restore the rename in place, and the set is
 *  `["Charter","Charter"]` — two live documents, five pairs of identical
 *  per-row accessible names. Both halves call this now.
 *
 *  ★★★ …but the in-place half must EXCLUDE ITS OWN DOCUMENT from the set it
 *  checks against. Most versions differ from the live document only in blocks,
 *  so restoring one usually restores a title the document ALREADY holds; run
 *  against the unfiltered set it collides with itself and a no-op-title restore
 *  comes back as "Charter 2". The recreate half needs no filter — the old id is
 *  gone from `documents`, so there is nothing of its own left to collide with.
 *
 *  ★★★ IDEMPOTENT BY CONSTRUCTION, which is what makes it safe to compose with
 *  the pane's own call (`documents-panel.tsx` computes a title against its
 *  `freshRef` view and passes it in). An already-free title is returned
 *  UNCHANGED, so the normal path cannot double-suffix. When the engine's set is
 *  genuinely fresher and the passed title IS taken, it suffixes again — which
 *  is the correct outcome, because that is a real collision the pane could not
 *  see. Both cases are pinned in document-mutations.test.ts.
 *
 *  ★ RENAME AND THE `ops` TITLE ARE DELIBERATELY EXCLUDED. Those carry a title
 *  the user or model typed for THIS document; silently returning something
 *  other than what was asked for is a worse failure than the collision, and it
 *  would make a rename non-idempotent against itself. That leaves a collision
 *  path open by choice, not by oversight — flagged for the reviewer rather than
 *  closed unilaterally.
 *
 *  Exact string equality, mirroring how the accessible names actually collide;
 *  truncation bites the BASE so `sanitizeProjectDocuments` cannot cut a suffixed
 *  title back to its source's bytes on the next load. */
function uniqueTitle(documents: readonly ProjectDocument[], base: string): string {
  const taken = new Set(documents.map((d) => d.title));
  let candidate = base.slice(0, MAX_TITLE_CHARS);
  for (let n = 2; taken.has(candidate); n++) {
    const suffix = ` ${n}`;
    candidate = base.slice(0, MAX_TITLE_CHARS - suffix.length) + suffix;
  }
  return candidate;
}

/** ★★★ THE ENGINE ENFORCES THE COUNT CAPS, because `sanitizeProjectDocuments`
 *  enforces them only on the way back IN. This module already refuses a title
 *  the sanitizer would reject (see `capTitle`) for exactly one reason: so
 *  in-memory state cannot disagree with reloaded state. The title got that
 *  treatment; `MAX_DOCUMENTS` and `MAX_BLOCKS_PER_DOC` did not.
 *
 *  Measured before these guards: the engine happily built 205 documents and a
 *  510-block document, and the next load cut them to 200 and 500 with no error
 *  anywhere in between. `sanitizeProjectDocuments` `break`s at the cap, so the
 *  documents it drops are the LAST ones in the array — the ones the user just
 *  created. Create a document, see it, reload, it is gone.
 *
 *  ★★ The per-call cap inside `sanitizeAiDocBlocks` cannot cover this: it bounds
 *  ONE call's blocks, so six appends of 100 still land a 600-block document
 *  (measured). The cap has to be tested against the RESULT, which is here.
 *
 *  ★ Over-cap work is REFUSED with a reason rather than truncated, so the tool
 *  layer can surface it — silently dropping the tail is the same "reported
 *  success, lost the content" failure seen from the other end. */
function documentLimitReason(): string {
  return `document limit reached (${MAX_DOCUMENTS})`;
}

function blockLimitReason(count: number): string {
  return `block limit exceeded (${count} > ${MAX_BLOCKS_PER_DOC})`;
}

function linkLimitReason(): string {
  return `link limit reached (${MAX_LINKS_PER_DOC})`;
}

/** Would writing `next` blocks over a document that currently has `current`
 *  break the cap?
 *
 *  ★★★ THE SECOND CLAUSE IS LOAD-BEARING and a plain `next > cap` is wrong: it
 *  would refuse the very `delete` op that brings an over-cap document back
 *  under, so the cap would become a state with no way out. Mutation-proved —
 *  dropping it turns "an ALREADY over-cap document can still shrink" red.
 *
 *  ★★★ ITS JUSTIFICATION USED TO BE WRONG, which is worth more than the clause
 *  itself: the comment said an over-cap document arrives "loaded from a file
 *  that carried more". It cannot. `sanitizeDocument` does
 *  `.slice(0, MAX_BLOCKS_PER_DOC)`, so every load path truncates, and
 *  `sanitizeDocumentVersions` delegates to it, so no loaded VERSION exceeds the
 *  cap either. With the guards below covering create / ops / both restores,
 *  nothing in the app can now produce one at all. The clause is DEFENSIVE — it
 *  keeps a future path that yields an uncapped document recoverable instead of
 *  frozen — not a response to a reachable case.
 *
 *  ★ Related correction, so it does not get carried forward: documents are
 *  dropped by a `break` at MAX_DOCUMENTS (so the NEWEST go), but blocks are
 *  `slice`d (so the TAIL goes). Two different cap mechanics; do not describe
 *  one with the other's wording. */
function exceedsBlockCap(next: number, current: number): boolean {
  return next > MAX_BLOCKS_PER_DOC && next > current;
}

/** The before-image of `doc`, as it stands right now. */
function snapshot(doc: ProjectDocument, op: DocVersionOp, ctx: DocContext): DocVersion {
  return {
    id: ctx.mintVersionId(),
    documentId: doc.id,
    title: doc.title,
    // ★★ A COPY, not the live array. The contract of this module is immutable
    //    rearrangement, and that held only SHALLOWLY: measured, a duplicate left
    //    copy.blocks === source.blocks === version.blocks, one array with three
    //    owners. Nothing mutates blocks in place today (applyOps builds
    //    `[...blocks]`), so this was a structural risk rather than a live bug —
    //    but `toEqual` cannot see aliasing, so a single in-place push added
    //    later would rewrite a document AND its own history together, with no
    //    test able to notice.
    blocks: [...doc.blocks],
    savedAt: ctx.now,
    source: ctx.source,
    op,
  };
}

/** Append `added` (if any) and re-run retention against the CURRENT full live
 *  id set — trimVersions needs the complete list to correctly decide which
 *  OTHER documents' newest versions are (or are not) tombstones; passing
 *  only the touched id would wrongly protect every other document's history
 *  as if it had been deleted. */
function withVersions(
  documents: readonly ProjectDocument[],
  versions: readonly DocVersion[],
  added: DocVersion | undefined,
): readonly DocVersion[] {
  const all = added ? [...versions, added] : versions;
  return trimVersions(all, documents.map((d) => d.id));
}

function findTarget(documents: readonly ProjectDocument[], id: number): ProjectDocument | undefined {
  return documents.find((d) => d.id === id);
}

/** ★★★ AN OMITTED FIELD IS NOT AN EMPTY ONE — the same rule chat-tools-documents.ts
 *  applies to the ops ARRAY, applied one level down to each op's PAYLOAD. That
 *  outer guard checked array-ness and stopped; nothing checked the `blocks` and
 *  `block` fields inside, so the inner door stayed open through two different
 *  failure modes, both measured:
 *
 *  - Through the AI chain, `{op:"replaceAll"}` with no `blocks` reached
 *    use-document-tools' per-op `sanitizeAiDocBlocks(op.blocks)`, which returns
 *    `[]` for a non-array. The engine then saw a well-formed "replace everything
 *    with nothing", wiped every block and reported `changed:true, rejected:[]` —
 *    a refusal that reads as success, the `set_task_dependencies` shape again.
 *  - Reaching the engine directly (the UI path, and any future caller handing it
 *    a raw op) the SAME input threw `TypeError: op.blocks is not iterable` out of
 *    a module whose header promises purity.
 *
 *  ★★ `{op:"append"}` with no `block` was worse than either: it pushed a literal
 *  `undefined` into the array and reported success, so the document carried a
 *  hole that serialises as `null` and that `sanitizeBlock` silently drops on the
 *  next load. Measured — `changed=true`, `blocks=3`, `blocks[2] === undefined`.
 *
 *  ★★★ AN EXPLICIT EMPTY LIST IS LEGAL AND MUST STAY LEGAL. `replaceAll: []` is
 *  a real request ("clear this document"), the caller asked for it, and the
 *  before-image preserves what it replaced. Only a MISSING or non-array field is
 *  the defect. A guard that refused both would break a legitimate operation —
 *  which is exactly why these read the field as `unknown` and test its SHAPE,
 *  rather than testing it for truthiness. */
function opBlockIsMissing(op: DocOp): boolean {
  return !isBlockShaped((op as { block?: unknown }).block);
}

/** ★★★ `typeof x === "object"` IS NOT A BLOCK TEST. The first version of this
 *  guard was `!block || typeof block !== "object"`, which refuses `42`,
 *  `"str"` and `null` but ADMITS `[]` and `{}` — both stored verbatim and
 *  reported as success (measured), then dropped by `sanitizeBlock` on the next
 *  load. That is the same silent-success class the missing-field guard exists
 *  to close, reached with a differently-malformed value instead of an absent
 *  one.
 *
 *  ★★ Every real `DocBlock` is discriminated by a string `type`, so that is the
 *  cheapest test that admits all of them and neither of those two. It
 *  deliberately does NOT check the type against the known set — that is
 *  document-model.ts's `sanitizeBlock`, and duplicating the block registry here
 *  is a second copy that can drift. This only has to establish "shaped like a
 *  block at all". */
function isBlockShaped(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function opBlocksIsNotAnArray(op: DocOp): boolean {
  return !Array.isArray((op as { blocks?: unknown }).blocks);
}

/** Apply ops LEFT TO RIGHT against the evolving array. An index is resolved
 *  against the array as it stands at that step, which is the only reading a
 *  model can act on deterministically — `[delete 0, delete 0]` means "the
 *  first two". Returns null when EVERY op was rejected. */
function applyOps(
  blocks: readonly DocBlock[],
  ops: readonly DocOp[],
  rejected: string[],
): readonly DocBlock[] | null {
  let next: DocBlock[] = [...blocks];
  let applied = 0;
  for (const [i, op] of ops.entries()) {
    switch (op.op) {
      case "append":
        if (opBlockIsMissing(op)) {
          rejected.push(`op ${i}: append requires a block`);
          break;
        }
        next.push(op.block);
        applied++;
        break;
      case "replaceAll":
        if (opBlocksIsNotAnArray(op)) {
          rejected.push(`op ${i}: replaceAll requires a blocks array`);
          break;
        }
        next = [...op.blocks];
        applied++;
        break;
      case "insert":
        if (!Number.isInteger(op.index) || op.index < 0 || op.index > next.length) {
          rejected.push(`op ${i}: insert index ${op.index} out of range 0..${next.length}`);
          break;
        }
        if (opBlockIsMissing(op)) {
          rejected.push(`op ${i}: insert requires a block`);
          break;
        }
        next.splice(op.index, 0, op.block);
        applied++;
        break;
      case "replace":
        if (!Number.isInteger(op.index) || op.index < 0 || op.index >= next.length) {
          rejected.push(`op ${i}: replace index ${op.index} out of range 0..${next.length - 1}`);
          break;
        }
        if (opBlockIsMissing(op)) {
          rejected.push(`op ${i}: replace requires a block`);
          break;
        }
        next[op.index] = op.block;
        applied++;
        break;
      case "delete":
        if (!Number.isInteger(op.index) || op.index < 0 || op.index >= next.length) {
          rejected.push(`op ${i}: delete index ${op.index} out of range 0..${next.length - 1}`);
          break;
        }
        next.splice(op.index, 1);
        applied++;
        break;
      // ★★ An off-enum `op` used to fall straight through this switch: not
      // applied, and — because nothing was pushed — not reported either, so the
      // call came back `changed:false, rejected:[]`, i.e. "I did nothing and
      // have nothing to say about it". The types cannot prevent it (model JSON
      // and stored ops both arrive as `unknown` at runtime), so the arm has to
      // exist. `op` is `never` here, which is precisely why the name has to be
      // read back off it as `unknown`.
      default:
        rejected.push(`op ${i}: unknown op ${JSON.stringify((op as { op?: unknown }).op)}`);
        break;
    }
  }
  // ★★★ A WHOLLY-REFUSED WRITE MUST NOT MUTATE. Writing the (unchanged or
  // empty) result here would destroy the document while the caller reports
  // only "I couldn't do that" — chat tool writes have NO undo capture, so
  // this branch is the only thing standing between a bad model index and
  // real data loss.
  return applied === 0 ? null : next;
}

/** The single mutation path for documents. Pure and deterministic — every
 *  input (clock, ids) is injected via `ctx`. */
export function applyDocMutation(state: DocState, m: DocMutation, ctx: DocContext): DocResult {
  switch (m.kind) {
    case "create": {
      const title = capTitle(m.title);
      if (!title) return unchanged(state, ["title must not be empty"]);
      if (state.documents.length >= MAX_DOCUMENTS) return unchanged(state, [documentLimitReason()]);
      // ★ `undefined` is the ONE legal non-array and means "no blocks" — the
      // field is optional. Every OTHER non-array is refused rather than
      // degraded to `[]`, mirroring how chat-tools-documents.ts reads the `ops`
      // field. Measured before this guard: `blocks: "not an array"` was stored
      // VERBATIM, so the document carried a string where its block list belongs
      // until the next load quietly replaced it with `[]`.
      if (m.blocks !== undefined && !Array.isArray(m.blocks)) {
        return unchanged(state, ["blocks must be an array"]);
      }
      const blocks = m.blocks ?? [];
      if (blocks.length > MAX_BLOCKS_PER_DOC) return unchanged(state, [blockLimitReason(blocks.length)]);
      const doc: ProjectDocument = {
        id: ctx.mintDocId(),
        title: uniqueTitle(state.documents, title),
        // ★ Its OWN array — see snapshot()'s note. This was the last owner-
        //   sharing hole: `duplicate`, both restores and every snapshot copy,
        //   but `create` stored the CALLER's array, so the caller kept a live
        //   handle on a stored document's block list.
        blocks: [...blocks],
        createdAt: ctx.now,
        updatedAt: ctx.now,
      };
      // Nothing was replaced — a create writes no version. Consistent with
      // restore-of-a-deleted-document below, which is also a create (a new
      // id, not a resurrection of the old one) and also writes none.
      return { documents: [...state.documents, doc], versions: state.versions, changed: true, rejected: [], documentId: doc.id };
    }

    case "restore": {
      const version = state.versions.find((v) => v.id === m.versionId);
      if (!version) return unchanged(state, [`version #${m.versionId} not found`]);
      // ★★★ A MARKER IS NOT A SNAPSHOT. `RESTORED_MARKER_OP` records that an id
      // was recovered; it is the one op that is explicitly NOT a before-image
      // (document-versions.ts). Restoring one measured as minting a second copy
      // of the document AND a second marker. `deletedDocumentVersions` filters
      // markers out, so no surface offers this today — but the version-history
      // and deleted-documents surfaces are being built against these version
      // rows right now, and either could hand one back.
      if (version.op === RESTORED_MARKER_OP) {
        return unchanged(state, [`version #${m.versionId} is a restore marker, not a snapshot`]);
      }
      const liveDoc = findTarget(state.documents, version.documentId);
      if (liveDoc) {
        // Restore IN PLACE, snapshotting what it replaced — the restore is
        // itself revertible.
        // ★★★ THE THIRD "ONE DOOR OF TWO". MAX_DOCUMENTS reached create,
        // duplicate AND restore-recreate; MAX_BLOCKS_PER_DOC reached create and
        // ops and stopped there, so BOTH restore paths wrote an uncapped
        // document (measured: 510 blocks, changed:true, rejected:[]). Latent
        // only because every load path caps blocks, so no stored version can
        // currently exceed it — it goes live the moment any path yields one.
        if (exceedsBlockCap(version.blocks.length, liveDoc.blocks.length)) {
          return unchanged(state, [blockLimitReason(version.blocks.length)]);
        }
        const before = snapshot(liveDoc, "update", ctx);
        // ★★★ SELF-EXCLUDED — see uniqueTitle's header. The set this title has
        // to be unique WITHIN is the OTHER live documents; the row being
        // restored is about to stop holding its current title, so counting it
        // would suffix a restore that changed no title at all.
        const others = state.documents.filter((d) => d.id !== liveDoc.id);
        const restoredDoc: ProjectDocument = {
          ...liveDoc,
          title: uniqueTitle(others, version.title),
          blocks: [...version.blocks],
          updatedAt: ctx.now,
        };
        const nextDocuments = state.documents.map((d) => (d.id === liveDoc.id ? restoredDoc : d));
        return {
          documents: nextDocuments,
          versions: withVersions(nextDocuments, state.versions, before),
          changed: true,
          rejected: [],
          documentId: restoredDoc.id,
        };
      }
      // ★★★ RESTORE IS NOT IDEMPOTENT WITHOUT THIS, and the marker alone does
      // not make it so. The marker hides the ROW from `deletedDocumentVersions`;
      // it does nothing to the OPERATION. Measured: restoring the same tombstone
      // versionId four times produced four identical documents, `changed:true`
      // and `rejected:[]` every time. Nothing offers that today only because the
      // deleted-documents list is derived — safety rested entirely on a VIEW.
      //
      // ★★ So the guard asks the derivation itself rather than re-deriving
      // "newest version for this id" here. That ordering rule lives in
      // `byNewest`, which is not exported, and a second copy of it in this file
      // is exactly the drift this codebase keeps getting bitten by. Reusing the
      // function means the guard and the list the user sees cannot disagree.
      //
      // ★ HONEST LIMIT: a marker is subject to ordinary retention once it
      // releases its group's tombstone protection, so a marker that ages out
      // re-opens both this guard and the list together. That is a shared
      // property of the derivation, not a hole this check introduces.
      const stillDeleted = deletedDocumentVersions(state.versions, state.documents).some(
        (v) => v.documentId === version.documentId,
      );
      if (!stillDeleted) {
        return unchanged(state, [`document #${version.documentId} has already been restored`]);
      }
      // ★ The recreate is a create, so it takes the same document cap. Refusing
      // is the kinder failure: allowing a 201st document means the next load
      // drops one silently, and it drops the newest — which would be this one.
      if (state.documents.length >= MAX_DOCUMENTS) return unchanged(state, [documentLimitReason()]);
      // ★ The recreate half of the same gap. Nothing is there to shrink, so the
      // "current" side is 0 and any over-cap version is refused outright.
      if (exceedsBlockCap(version.blocks.length, 0)) {
        return unchanged(state, [blockLimitReason(version.blocks.length)]);
      }
      // The document is gone: recreate under a NEW id (ids are never
      // reused). This is a create, not a replace, so it writes no BEFORE-IMAGE
      // — and the version row that was restored is deliberately NOT consumed.
      const recreated: ProjectDocument = {
        id: ctx.mintDocId(),
        title: uniqueTitle(state.documents, version.title),
        blocks: [...version.blocks],
        createdAt: ctx.now,
        updatedAt: ctx.now,
      };
      // ★★★ …but it DOES write a marker against the OLD id, which is the only
      // thing that stops the tombstone becoming permanent. The old id can
      // never become live again, so without this `deletedDocumentVersions`
      // would report it as deleted forever: the deleted-documents list would
      // show a phantom entry for a document already restored, and each further
      // Restore would mint another copy. The marker also releases the group
      // from tombstone protection in trimVersions, so the rows can age out
      // instead of leaking one unreclaimable entry per delete-restore cycle.
      // It carries the recovered content (not an empty snapshot) so the row
      // still reads as a meaningful history entry rather than a tombstone.
      const marker: DocVersion = {
        id: ctx.mintVersionId(),
        documentId: version.documentId,
        title: version.title,
        blocks: [...version.blocks],
        savedAt: ctx.now,
        source: ctx.source,
        op: RESTORED_MARKER_OP,
      };
      const nextDocuments = [...state.documents, recreated];
      return {
        documents: nextDocuments,
        versions: withVersions(nextDocuments, state.versions, marker),
        changed: true,
        rejected: [],
        documentId: recreated.id,
      };
    }

    case "rename": {
      const target = findTarget(state.documents, m.id);
      if (!target) return unchanged(state, [`document #${m.id} not found`]);
      const title = capTitle(m.title);
      if (!title) return unchanged(state, ["title must not be empty"]);
      if (title === target.title) return unchanged(state);
      const before = snapshot(target, "rename", ctx);
      const renamed: ProjectDocument = { ...target, title, updatedAt: ctx.now };
      const nextDocuments = state.documents.map((d) => (d.id === target.id ? renamed : d));
      return {
        documents: nextDocuments,
        versions: withVersions(nextDocuments, state.versions, before),
        changed: true,
        rejected: [],
        documentId: target.id,
      };
    }

    // ★★★ A REFERENCE IS NOT CONTENT. Both cases below write NO version
    // (content gets versions; references and metadata do not) and both leave
    // `updatedAt` alone — it is a displayed, sortable column, so bumping it on
    // an attach would report a content edit that never happened. Consistent
    // with `create`, which also writes none.
    case "link": {
      const target = findTarget(state.documents, m.id);
      if (!target) return unchanged(state, [`document #${m.id} not found`]);
      const [ref] = sanitizeDocEntityRefs([m.ref]);
      if (!ref) return unchanged(state, ["invalid entity reference"]);
      const current = target.linkedEntities ?? [];
      // Idempotent: the same (kind, id) is a no-op, and a no-op must return the
      // caller's OWN array reference — the documents slice is dirty-checked by
      // REFERENCE equality, so a rebuilt-but-equal array forces a needless save.
      if (current.some((r) => refKey(r.kind, r.id) === refKey(ref.kind, ref.id))) return unchanged(state);
      if (current.length >= MAX_LINKS_PER_DOC) return unchanged(state, [linkLimitReason()]);
      const linked: ProjectDocument = { ...target, linkedEntities: [...current, ref] };
      const nextDocuments = state.documents.map((d) => (d.id === target.id ? linked : d));
      return { documents: nextDocuments, versions: state.versions, changed: true, rejected: [], documentId: target.id };
    }

    case "unlink": {
      const target = findTarget(state.documents, m.id);
      if (!target) return unchanged(state, [`document #${m.id} not found`]);
      const current = target.linkedEntities ?? [];
      const key = refKey(m.ref.kind, m.ref.id);
      const kept = current.filter((r) => refKey(r.kind, r.id) !== key);
      if (kept.length === current.length) return unchanged(state, ["reference not found"]);
      // ★ Removing the LAST reference drops the field rather than storing `[]`
      // — the same sparse rule sanitizeDocument applies on load, applied on
      // write so the two cannot disagree and the goldens stay byte-stable.
      const unlinked: ProjectDocument =
        kept.length > 0
          ? { ...target, linkedEntities: kept }
          : { id: target.id, title: target.title, blocks: target.blocks, createdAt: target.createdAt, updatedAt: target.updatedAt };
      const nextDocuments = state.documents.map((d) => (d.id === target.id ? unlinked : d));
      return { documents: nextDocuments, versions: state.versions, changed: true, rejected: [], documentId: target.id };
    }

    case "duplicate": {
      const target = findTarget(state.documents, m.id);
      if (!target) return unchanged(state, [`document #${m.id} not found`]);
      const title = capTitle(m.title);
      if (!title) return unchanged(state, ["title must not be empty"]);
      if (state.documents.length >= MAX_DOCUMENTS) return unchanged(state, [documentLimitReason()]);
      const copy: ProjectDocument = {
        id: ctx.mintDocId(),
        title: uniqueTitle(state.documents, title),
        // ★ Its OWN array. See snapshot()'s note — the copy, its source and the
        //   version below otherwise shared one array between three owners.
        blocks: [...target.blocks],
        createdAt: ctx.now,
        updatedAt: ctx.now,
      };
      // The version is written AGAINST THE COPY (documentId = the copy's new
      // id), holding the SOURCE's title/blocks. So a revert right after
      // duplicating undoes just the copy's divergence from its source (the
      // given title), returning it to the copied-FROM state rather than to
      // nothing — the copy's documentId stays live, so trimVersions treats
      // this as an ordinary capped-retention entry, never a tombstone.
      const before: DocVersion = {
        id: ctx.mintVersionId(),
        documentId: copy.id,
        title: target.title,
        blocks: [...target.blocks],
        savedAt: ctx.now,
        source: ctx.source,
        op: "duplicate",
      };
      const nextDocuments = [...state.documents, copy];
      return {
        documents: nextDocuments,
        versions: withVersions(nextDocuments, state.versions, before),
        changed: true,
        rejected: [],
        documentId: copy.id,
      };
    }

    case "delete": {
      const target = findTarget(state.documents, m.id);
      if (!target) return unchanged(state, [`document #${m.id} not found`]);
      const before = snapshot(target, "delete", ctx);
      const nextDocuments = state.documents.filter((d) => d.id !== target.id);
      return {
        documents: nextDocuments,
        versions: withVersions(nextDocuments, state.versions, before),
        changed: true,
        rejected: [],
        documentId: null,
      };
    }

    case "ops": {
      const target = findTarget(state.documents, m.id);
      if (!target) return unchanged(state, [`document #${m.id} not found`]);
      const rejected: string[] = [];
      let nextBlocks = applyOps(target.blocks, m.ops, rejected);
      // ★★ Refuse the BLOCK half only, and let a supplied title still land —
      // the same partial-application shape `applyOps` already uses for a bad
      // index, and what `runDocumentTool`'s "rename plus one bad op is not a
      // refusal" clause expects. Rejecting the whole mutation here would turn
      // every over-cap edit that also renamed into a hard failure.
      // ★ Only GROWTH past the cap is refused — see exceedsBlockCap.
      if (nextBlocks !== null && exceedsBlockCap(nextBlocks.length, target.blocks.length)) {
        rejected.push(blockLimitReason(nextBlocks.length));
        nextBlocks = null;
      }
      let nextTitle = target.title;
      let titleChanged = false;
      if (m.title !== undefined) {
        const capped = capTitle(m.title);
        if (!capped) {
          rejected.push("title must not be empty");
        } else if (capped !== target.title) {
          nextTitle = capped;
          titleChanged = true;
        }
      }
      if (nextBlocks === null && !titleChanged) return unchanged(state, rejected);
      const before = snapshot(target, "update", ctx);
      const updated: ProjectDocument = { ...target, title: nextTitle, blocks: nextBlocks ?? target.blocks, updatedAt: ctx.now };
      const nextDocuments = state.documents.map((d) => (d.id === target.id ? updated : d));
      return {
        documents: nextDocuments,
        versions: withVersions(nextDocuments, state.versions, before),
        changed: true,
        rejected,
        documentId: target.id,
      };
    }
  }
}
