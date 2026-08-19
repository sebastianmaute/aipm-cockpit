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
      const coalesce = shouldCoalesce(versions, documentId, stamp);
      return mutateDocuments(
        { kind: "ops", id: documentId, ops: [replaceBlockOp(index, block)], coalesce },
        "user",
      );
    },
    [documentId, versions, mutateDocuments, now],
  );

  return { commitBlock };
}
