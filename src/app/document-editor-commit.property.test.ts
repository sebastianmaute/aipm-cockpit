import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { applyDocMutation } from "./document-mutations";
import { shouldCoalesce } from "./document-editor-commit";
import { MAX_VERSIONS_PER_DOC } from "./document-versions";
import type { ProjectDocument } from "./document-model";
import type { DocVersion } from "./document-versions";

const START = Date.parse("2026-08-18T10:00:00.000Z");

describe("version budget under a hand-editing session", () => {
  it("keeps the pre-session before-image and never exceeds the per-document cap", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), (edits) => {
        let documents: readonly ProjectDocument[] = [
          {
            id: 1,
            title: "D",
            blocks: [{ type: "paragraph", html: "<p>original</p>" }],
            createdAt: "2026-08-18T09:00:00.000Z",
            updatedAt: "2026-08-18T09:00:00.000Z",
          },
        ];
        let versions: readonly DocVersion[] = [];
        let nextVersionId = 1;

        for (let i = 0; i < edits; i++) {
          // Each edit lands 10s after the previous one — one continuous session.
          const now = new Date(START + i * 10_000).toISOString();
          const coalesce = shouldCoalesce(versions, 1, now);
          const result = applyDocMutation(
            { documents, versions },
            {
              kind: "ops",
              id: 1,
              ops: [{ op: "replace", index: 0, block: { type: "paragraph", html: `<p>edit ${i}</p>` } }],
              coalesce,
            },
            {
              now,
              source: "user",
              mintDocId: () => 99,
              mintVersionId: () => nextVersionId++,
            },
          );
          documents = result.documents;
          versions = result.versions;
        }

        const mine = versions.filter((v) => v.documentId === 1);
        // The cap is never breached...
        expect(mine.length).toBeLessThanOrEqual(MAX_VERSIONS_PER_DOC);
        // ...and the session's FIRST before-image — the pre-session state, the
        // thing worth reverting to — is still reachable however long the
        // session ran.
        expect(mine.some((v) => v.blocks[0] && "html" in v.blocks[0] && v.blocks[0].html === "<p>original</p>")).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
