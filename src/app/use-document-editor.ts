// Render-scope glue between the block editors and the workspace mutation.
//
// ★ EVERY DECISION HERE IS DELEGATED. The coalescing rule, the dirty check and
//  the image predicate all live in document-editor-commit.ts, which is pure and
//  tested. If logic starts accumulating in this file, move it there instead of
//  testing it here.
import { useCallback, useEffect, useRef } from "react";
import { shouldCoalesce, replaceBlockOp } from "./document-editor-commit";
import type { DocBlock } from "./document-model";
import type { DocMutation, DocResult } from "./document-mutations";
import type { DocVersion, DocVersionSource } from "./document-versions";

export type UseDocumentEditorDeps = {
  documentId: number;
  versions: readonly DocVersion[];
  mutateDocuments: (m: DocMutation, source: DocVersionSource) => DocResult;
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

  // ★★★ THE COALESCING RUN'S ANCHOR — the id of the version THIS hook's last
  //  landed commit MINTED, taken from `DocResult.versionId`. `shouldCoalesce`
  //  coalesces only while that exact row is still the newest, so a writer whose
  //  row sorts newer (a restore, an AI write, a rename, a second tab) ends the
  //  run and the next edit records a real before-image.
  //  ★★★ TAKE IT FROM THE RESULT, NEVER BY RE-DERIVING "NEWEST" FROM THE LIST.
  //   An earlier cut read the newest row of `result.versions` back, which is
  //   "newest by savedAt globally", not "the row I just minted" — a foreign row
  //   from a skewed clock on a shared project sorts newest and would be adopted
  //   as this run's anchor, so the next edit coalesces onto somebody else's
  //   before-image and suppresses its own. `DocResult.versionId` carries the
  //   minted id, which no clock can influence; its docblock holds the detail.
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
  const lastVersionIdRef = useRef<number | null>(null);

  const commitBlock = useCallback(
    (index: number, block: DocBlock): DocResult | undefined => {
      // Same "abandon rather than clobber" principle as useBlockDraft's
      // concurrent-write guard, one level up: `documentId` is the document
      // THIS closure was built for. If the panel has since moved on to a
      // different document, writing here would land the edit on whichever
      // document happens to be selected now — abandon instead.
      if (documentId !== currentDocIdRef.current) return undefined;
      // ★ A real conditional with an unexercised branch — every caller today
      //  (document-edit-mode.tsx) omits `now`, so only the `new Date()` arm
      //  ever runs, and no test injects `now` either. Left un-covered
      //  deliberately and permanently: this file sits in `vitest.config.ts`
      //  `coverage.exclude` as render-scope UI glue (unlike the structurally
      //  identical `now ?? (() => new Date())` fallback in
      //  `use-scheduled-job-runner.ts`, which IS coverage-gated and whose
      //  tests exercise both arms). Do not chase this branch for coverage.
      const stamp = now ? now() : new Date().toISOString();
      // ★★ Coalesce a RUN of consecutive user edits so a 20-block session
      //  cannot evict this document's history against MAX_VERSIONS_PER_DOC.
      //  The FIRST edit of a session always records, so the pre-session state
      //  stays the revert target.
      const coalesce = shouldCoalesce(versions, documentId, stamp, lastVersionIdRef.current);
      const result = mutateDocuments(
        { kind: "ops", id: documentId, ops: [replaceBlockOp(index, block)], coalesce },
        "user",
      );
      // ★★ ADVANCE ONLY WHEN THIS CALL MINTED A ROW, and otherwise leave the
      //  anchor exactly where it is — do NOT clear it. The three cases:
      //   • minted (`versionId` is a number): that row is this run's new anchor.
      //   • COALESCED (`changed: true`, `versionId: null`): the write landed and
      //     deliberately minted nothing, so the run's anchor is still the row it
      //     already points at. Clearing it here would make the NEXT edit see a
      //     null anchor, refuse to coalesce and mint — i.e. every second edit
      //     would mint and coalescing would collapse to a 2× reduction.
      //   • REFUSED (`changed: false`, `versionId: null`): nothing happened;
      //     the anchor must not move either.
      //  The last two are the same assignment, which is why this is one guard
      //  on `versionId` and not a `changed` check.
      if (result.versionId !== null) lastVersionIdRef.current = result.versionId;
      return result;
    },
    [documentId, versions, mutateDocuments, now],
  );

  return { commitBlock };
}
