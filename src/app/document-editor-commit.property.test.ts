import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { applyDocMutation, type DocMintedVersion } from "./document-mutations";
import { shouldCoalesce, COALESCE_WINDOW_MS } from "./document-editor-commit";
import type { ProjectDocument } from "./document-model";
import type { DocVersion } from "./document-versions";

const START = Date.parse("2026-08-18T10:00:00.000Z");

// Edits land 10s apart; the property generates up to 40 of them, so the
// longest possible session spans (40-1)*10s = 390s of wall time. Coalescing
// mints a new version only once the gap since the last-minted version's own
// timestamp exceeds COALESCE_WINDOW_MS (5min = 300000ms) — see
// document-editor-commit.ts's shouldCoalesce. A session of span S therefore
// mints at most floor(S / COALESCE_WINDOW_MS) + 1 versions for this document:
// one at the first edit, then one more each time the elapsed time since the
// last mint crosses another full window. For S=390000 that is
// floor(390000 / 300000) + 1 = 2 — regardless of how many edits (1..40) land
// inside that span, since more edits packed into the same window only add
// MORE coalesced (unminted) writes, never more minted versions.
const EDIT_SPACING_MS = 10_000;
const MAX_EDITS = 40;
const MAX_SPAN_MS = (MAX_EDITS - 1) * EDIT_SPACING_MS;
const MAX_VERSIONS_MINTED = Math.floor(MAX_SPAN_MS / COALESCE_WINDOW_MS) + 1;

describe("version budget under a hand-editing session", () => {
  it("coalesces a burst into a handful of versions while keeping the pre-session before-image reachable", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: MAX_EDITS }), (edits) => {
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
        // Mirrors use-document-editor.ts's `lastMintedRef`: the property is
        // about the HOOK's behaviour, so the simulation has to carry the same
        // anchor — including its advance RULE — or it is measuring a function
        // no caller uses that way.
        let anchor: DocMintedVersion | null = null;

        for (let i = 0; i < edits; i++) {
          // Each edit lands 10s after the previous one — one continuous session.
          const now = new Date(START + i * 10_000).toISOString();
          const coalesce = shouldCoalesce(versions, 1, now, anchor);
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
          // Advance only on a MINT, never on a coalesced write: exactly the
          // rule in use-document-editor.ts, for the same reason.
          if (result.minted) anchor = result.minted;
        }

        const mine = versions.filter((v) => v.documentId === 1);
        // Coalescing actually collapsed the burst: a session of up to 40
        // hand edits mints at most MAX_VERSIONS_MINTED (2) versions for this
        // document, never one-per-edit. This is the assertion that depends
        // on shouldCoalesce — with coalescing disabled the count would climb
        // to (near) `edits` instead, well past this bound.
        expect(mine.length).toBeLessThanOrEqual(MAX_VERSIONS_MINTED);
        // ...and the session's FIRST before-image — the pre-session state, the
        // thing worth reverting to — is still reachable however long the
        // session ran.
        expect(mine.some((v) => v.blocks[0] && "html" in v.blocks[0] && v.blocks[0].html === "<p>original</p>")).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
