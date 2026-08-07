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

import { MAX_TITLE_CHARS, type DocBlock, type ProjectDocument } from "./document-model";
import {
  RESTORED_MARKER_OP,
  trimVersions,
  type DocVersion,
  type DocVersionOp,
  type DocVersionSource,
} from "./document-versions";

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
  | { kind: "restore"; versionId: number };

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

/** The before-image of `doc`, as it stands right now. */
function snapshot(doc: ProjectDocument, op: DocVersionOp, ctx: DocContext): DocVersion {
  return {
    id: ctx.mintVersionId(),
    documentId: doc.id,
    title: doc.title,
    blocks: doc.blocks,
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
        next.push(op.block);
        applied++;
        break;
      case "replaceAll":
        next = [...op.blocks];
        applied++;
        break;
      case "insert":
        if (!Number.isInteger(op.index) || op.index < 0 || op.index > next.length) {
          rejected.push(`op ${i}: insert index ${op.index} out of range 0..${next.length}`);
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
      const doc: ProjectDocument = {
        id: ctx.mintDocId(),
        title,
        blocks: m.blocks ?? [],
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
      const liveDoc = findTarget(state.documents, version.documentId);
      if (liveDoc) {
        // Restore IN PLACE, snapshotting what it replaced — the restore is
        // itself revertible.
        const before = snapshot(liveDoc, "update", ctx);
        const restoredDoc: ProjectDocument = { ...liveDoc, title: version.title, blocks: version.blocks, updatedAt: ctx.now };
        const nextDocuments = state.documents.map((d) => (d.id === liveDoc.id ? restoredDoc : d));
        return {
          documents: nextDocuments,
          versions: withVersions(nextDocuments, state.versions, before),
          changed: true,
          rejected: [],
          documentId: restoredDoc.id,
        };
      }
      // The document is gone: recreate under a NEW id (ids are never
      // reused). This is a create, not a replace, so it writes no BEFORE-IMAGE
      // — and the version row that was restored is deliberately NOT consumed.
      const recreated: ProjectDocument = {
        id: ctx.mintDocId(),
        title: version.title,
        blocks: version.blocks,
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
        blocks: version.blocks,
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

    case "duplicate": {
      const target = findTarget(state.documents, m.id);
      if (!target) return unchanged(state, [`document #${m.id} not found`]);
      const title = capTitle(m.title);
      if (!title) return unchanged(state, ["title must not be empty"]);
      const copy: ProjectDocument = { id: ctx.mintDocId(), title, blocks: target.blocks, createdAt: ctx.now, updatedAt: ctx.now };
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
        blocks: target.blocks,
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
      const nextBlocks = applyOps(target.blocks, m.ops, rejected);
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
