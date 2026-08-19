// Render-scope glue between the block editors and the workspace mutation.
//
// ★ EVERY DECISION HERE IS DELEGATED. The coalescing rule, the dirty check and
//  the image predicate all live in document-editor-commit.ts, which is pure and
//  tested. If logic starts accumulating in this file, move it there instead of
//  testing it here.
import { useCallback, useEffect, useRef } from "react";
import { shouldCoalesce, replaceBlockOp } from "./document-editor-commit";
import type { DocBlock } from "./document-model";
import type { DocMintedVersion, DocMutation, DocResult } from "./document-mutations";
import type { DocVersion } from "./document-versions";

export type UseDocumentEditorDeps = {
  documentId: number;
  versions: readonly DocVersion[];
  /** ★★★ ONE ARGUMENT, DELIBERATELY. This is the PANEL'S FUNNEL, not the raw
   *  workspace mutator: the funnel hardcodes the `"user"` source, clears the
   *  previous refusal, keeps `freshRef` current AND — the reason this is not a
   *  style choice — is the one place a refusal reaches the user. Widening this
   *  back to `(m, source)` is what let a call site be wired straight past it,
   *  so a concurrent delete refused the commit and the typing vanished with
   *  nothing said. Keep the source out of this contract. */
  mutateDocuments: (m: DocMutation) => DocResult;
  /** Injected so the decision is testable without a clock. */
  now?: () => string;
};

export function useDocumentEditor(deps: UseDocumentEditorDeps) {
  const { documentId, versions, mutateDocuments, now } = deps;

  // ★★★ DOCUMENT-SWITCH GUARD — the second half of the fix alongside
  //  document-editor.tsx's doc-id-keyed rows. A block editor's draft can
  //  reach `commitBlock` from a call queued BEFORE the panel switched
  //  documents (a block-list re-render's unmount flush, or any other
  //  delayed caller) — keying makes that the rare case, not the impossible
  //  one, and this hook is the one place that can tell such a call apart
  //  from a live one: unlike the per-document block-editor subtree, THIS
  //  hook never unmounts on a document switch (it runs every render of
  //  documents-panel.tsx), so `currentDocIdRef` always reflects whichever
  //  document is selected NOW, regardless of which document a specific
  //  `commitBlock` closure below was minted for.
  //  ★ react-hooks/refs bans reading OR writing a ref during render, so the
  //  write happens in an effect, never here directly.
  const currentDocIdRef = useRef(documentId);
  useEffect(() => {
    currentDocIdRef.current = documentId;
  }, [documentId]);

  // ★★★ THE COALESCING RUN'S ANCHOR — the `(id, savedAt)` PAIR of the version
  //  THIS hook's last landed commit MINTED, taken from `DocResult.minted`.
  //  `shouldCoalesce` coalesces only while that exact row is still the newest,
  //  so a writer whose row sorts newer (a restore, an AI write, a rename, a
  //  second tab) ends the run and the next edit records a real before-image.
  //  ★★★ TAKE IT FROM THE RESULT, NEVER BY RE-DERIVING "NEWEST" FROM THE LIST.
  //   An earlier cut read the newest row of `result.versions` back, which is
  //   "newest by savedAt globally", not "the row I just minted" — a foreign row
  //   from a skewed clock on a shared project sorts newest and would be adopted
  //   as this run's anchor, so the next edit coalesces onto somebody else's
  //   before-image and suppresses its own.
  //  ★★★ AND IT IS THE PAIR, NOT THE ID — because THIS REF SURVIVES A PROJECT
  //   SWITCH. Nothing here clears it, and `seedMintFromWorkspace(ws, "reset")`
  //   restarts the `documentVersion` high-water per project, so project B can
  //   hold version #7 on document #3 while this ref still says 7 from project
  //   A — and an id-only check would resume the run onto a stranger's row.
  //   `DocMintedVersion`'s own docblock carries both arguments in full.
  //  ★ A ref, not state: it is read and written inside an event handler, never
  //   during render, and a re-render on every commit would buy nothing.
  //  ★★ IT DIES WITH THE PANEL, AND THE PANEL IS TAB-CONDITIONAL.
  //   `workspace-section.tsx` mounts the Documents panel as
  //   `{activeTab === "documents" && <DocumentsTabPanel …/>}`, so this hook —
  //   and this ref with it — unmounts on any TAB switch, not merely a document
  //   switch. Leaving Documents and coming back therefore ALWAYS records a
  //   before-image, where the pre-anchor heuristic would have coalesced within
  //   COALESCE_WINDOW_MS. Defensible (each visit is a fresh session) but not
  //   free: ~20 leave-and-edit cycles evict this document's own history against
  //   MAX_VERSIONS_PER_DOC. Recorded because nothing else states it.
  const lastMintedRef = useRef<DocMintedVersion | null>(null);

  const commitBlock = useCallback(
    (index: number, block: DocBlock, expect?: DocBlock): DocResult | undefined => {
      // Same "abandon rather than clobber" principle as useBlockDraft's
      // concurrent-write guard, one level up: `documentId` is the document
      // THIS closure was built for. If the panel has since moved on to a
      // different document, writing here would land the edit on whichever
      // document happens to be selected now — abandon instead.
      if (documentId !== currentDocIdRef.current) return undefined;
      // ★★ WHICH ARM RUNS WHERE, and an earlier revision of this comment had
      //  it backwards in the half that matters. PRODUCTION always takes the
      //  `new Date()` arm, and structurally so: `UseDocumentEditModeDeps` is
      //  `Omit<UseDocumentEditorDeps, "now">`, so the one caller
      //  (document-edit-mode.tsx) CANNOT pass `now` — a stronger guarantee than
      //  "omits it today". TESTS take the other arm: every `renderHook` in
      //  use-document-editor.test.ts injects `now: () => NOW`, which is what
      //  makes the coalescing assertions deterministic. The old text said "no
      //  test injects `now` either", which would have sent a reader deleting
      //  the injectable parameter as dead.
      //  ★ This file sits in `vitest.config.ts` `coverage.exclude` as
      //  render-scope UI glue, so neither arm is coverage-gated either way.
      const stamp = now ? now() : new Date().toISOString();
      // ★★ Coalesce a RUN of consecutive user edits so a 20-block session
      //  cannot evict this document's history against MAX_VERSIONS_PER_DOC.
      //  The FIRST edit of a session always records, so the pre-session state
      //  stays the revert target.
      const coalesce = shouldCoalesce(versions, documentId, stamp, lastMintedRef.current);
      const result = mutateDocuments({
        kind: "ops",
        id: documentId,
        // ★★ `expect` is the draft's baseline, threaded straight through:
        //  this hook decides nothing about it, and the engine — which reads
        //  live state at call time — is the only layer that can.
        ops: [replaceBlockOp(index, block, expect)],
        coalesce,
      });
      // ★★ ADVANCE ONLY WHEN THIS CALL MINTED A ROW, and otherwise leave the
      //  anchor exactly where it is — do NOT clear it. The three cases:
      //   • minted (`minted` is a pair): that row is this run's new anchor.
      //   • COALESCED (`changed: true`, `minted: null`): the write landed and
      //     deliberately minted nothing, so the run's anchor is still the row it
      //     already points at. Clearing it here would make the NEXT edit see a
      //     null anchor, refuse to coalesce and mint — i.e. every second edit
      //     would mint and coalescing would collapse to a 2× reduction.
      //   • REFUSED (`changed: false`, `minted: null`): nothing happened; the
      //     anchor must not move either.
      //  The last two are the same assignment, which is why this is one guard
      //  on `minted` and not a `changed` check.
      if (result.minted) lastMintedRef.current = result.minted;
      return result;
    },
    [documentId, versions, mutateDocuments, now],
  );

  const appendBlock = useCallback(
    (block: DocBlock): DocResult | undefined => {
      // Same abandon-rather-than-clobber guard as commitBlock: this closure was
      // built for `documentId`, and if the panel has moved on, appending here
      // would add a block to whichever document happens to be selected now.
      if (documentId !== currentDocIdRef.current) return undefined;
      // ★★★ NO `coalesce` FIELD, DELIBERATELY. document-mutations.ts reads
      //  `m.coalesce ? undefined : snapshot(target, "update", ctx)`, so omitting
      //  it writes the before-image unconditionally. Creating a block is a
      //  structural change and the pre-append state is exactly what a user
      //  reverting an accidental add wants back — an append must never fold
      //  into a preceding editing run.
      const result = mutateDocuments({ kind: "ops", id: documentId, ops: [{ op: "append", block }] });
      // ★★ ...but it DOES become the run's anchor, so the typing that follows
      //  folds into it. That is not a special case: the append is one of THIS
      //  hook's own commits, so it advances the anchor for the same reason
      //  every other one does. And it is right — the append's before-image
      //  already IS the pre-session state, so a second version would capture a
      //  half-typed placeholder, which is a revert target nobody wants and one
      //  of only MAX_VERSIONS_PER_DOC (20) slots spent.
      if (result.minted) lastMintedRef.current = result.minted;
      return result;
    },
    [documentId, mutateDocuments],
  );

  return { commitBlock, appendBlock };
}
