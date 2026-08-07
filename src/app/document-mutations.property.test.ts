import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  applyDocMutation,
  type DocMutation,
  type DocState,
  type DocContext,
} from "./document-mutations";
import { deletedDocumentVersions } from "./document-versions";
import type { DocBlock } from "./document-model";

// ★ integer ms range, NOT a bare fc.date(): fc.date() can emit an Invalid
// Date whose .toISOString() throws, which passes vitest's type check but
// fails at runtime.
const isoArb = fc
  .integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 0, 1) })
  .map((ms) => new Date(ms).toISOString());

const blockArb: fc.Arbitrary<DocBlock> = fc.oneof(
  fc.record({
    type: fc.constant("heading" as const),
    level: fc.constantFrom(1 as const, 2 as const, 3 as const),
    text: fc.string({ maxLength: 40 }),
  }),
  fc.record({
    type: fc.constant("paragraph" as const),
    html: fc.string({ maxLength: 40 }).map((s) => `<p>${s.replace(/[<>&]/g, "")}</p>`),
  }),
  fc.record({ type: fc.constant("pageBreak" as const) }),
);

function makeContext(now: string): DocContext {
  let nextDocId = 10;
  let nextVersionId = 500;
  return {
    now,
    source: "ai",
    mintDocId: () => nextDocId++,
    mintVersionId: () => nextVersionId++,
  };
}

// The invariant under test: a mutation's before-image, restored, reproduces
// the pre-mutation title and blocks verbatim. document-mutations.ts has no
// inversion logic anywhere — restore writes the snapshot back byte-for-byte
// (see its header) — so this is the one property that can catch a snapshot
// that captured the WRONG state (e.g. the post-mutation one).
describe("mutate then restore returns the prior document state", () => {
  it("holds for rename, delete and ops", () => {
    // ★★ Anti-vacuity counter. `if (!after.changed) return true` is a
    // legitimate early return (a no-op mutation writes no version to
    // restore), but if EVERY generated case took that branch the property
    // would pass having never reached its own assertions. This repo has
    // been bitten by exactly that shape before — the counter proves the
    // restore path was actually exercised, not just declared.
    let exercised = 0;

    fc.assert(
      fc.property(
        fc.array(blockArb, { maxLength: 8 }),
        fc.string({ minLength: 1, maxLength: 30 }),
        isoArb,
        fc.constantFrom<"rename" | "delete" | "ops">("rename", "delete", "ops"),
        (blocks, title, now, kind) => {
          const ctx = makeContext(now);
          const before: DocState = {
            documents: [{ id: 1, title, blocks, createdAt: now, updatedAt: now }],
            versions: [],
          };
          const mutation: DocMutation =
            kind === "rename"
              ? { kind: "rename", id: 1, title: `${title}-changed` }
              : kind === "delete"
                ? { kind: "delete", id: 1 }
                : {
                    kind: "ops",
                    id: 1,
                    ops: [{ op: "replaceAll", blocks: [{ type: "pageBreak" }] }],
                  };

          const after = applyDocMutation(before, mutation, ctx);
          if (!after.changed) return true;

          // `before.versions` started empty and exactly one mutation ran, so
          // the mutation's own before-image is the sole entry — but reach it
          // by "newest", the same way a real caller (version history UI, AI
          // restore tool) would, rather than assuming array position.
          const newest = after.versions[after.versions.length - 1];
          const restored = applyDocMutation(after, { kind: "restore", versionId: newest.id }, ctx);

          // ★★★ Restoring a DELETED document does NOT reuse the old id — it
          // mints a NEW one and reports it via `documentId` (document-mutations.ts's
          // restore branch, "the document is gone" case). Looking the
          // restored doc up by the id=1 constant would be wrong for the
          // delete case; `documentId` is correct for every kind, since
          // rename/ops restore IN PLACE and report the same id back.
          const doc = restored.documents.find((d) => d.id === restored.documentId);
          expect(doc).toBeDefined();
          expect(doc?.title).toEqual(title);
          expect(doc?.blocks).toEqual(blocks);

          exercised++;
          return true;
        },
      ),
      { numRuns: 100 },
    );

    expect(exercised).toBeGreaterThan(50);
  });

  it("restoring a deleted document clears it from the deleted-documents list", () => {
    fc.assert(
      fc.property(
        fc.array(blockArb, { maxLength: 8 }),
        fc.string({ minLength: 1, maxLength: 30 }),
        isoArb,
        (blocks, title, now) => {
          const ctx = makeContext(now);
          const before: DocState = {
            documents: [{ id: 1, title, blocks, createdAt: now, updatedAt: now }],
            versions: [],
          };
          const deleted = applyDocMutation(before, { kind: "delete", id: 1 }, ctx);
          expect(deleted.changed).toBe(true);
          const newest = deleted.versions[deleted.versions.length - 1];

          // Sanity: the delete itself must be visible as a deleted document
          // before restore — otherwise a property proving it's ABSENT after
          // restore would be trivially true.
          expect(
            deletedDocumentVersions(deleted.versions, deleted.documents).some(
              (v) => v.documentId === 1,
            ),
          ).toBe(true);

          const restored = applyDocMutation(deleted, { kind: "restore", versionId: newest.id }, ctx);
          const stillDeleted = deletedDocumentVersions(restored.versions, restored.documents);
          expect(stillDeleted.some((v) => v.documentId === 1)).toBe(false);
          return true;
        },
      ),
      { numRuns: 50 },
    );
  });
});
