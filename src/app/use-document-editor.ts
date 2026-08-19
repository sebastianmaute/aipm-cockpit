// Render-scope glue between the block editors and the workspace mutation.
//
// ★ EVERY DECISION HERE IS DELEGATED. The coalescing rule, the dirty check and
//  the image predicate all live in document-editor-commit.ts, which is pure and
//  tested. If logic starts accumulating in this file, move it there instead of
//  testing it here.
import { useCallback } from "react";
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

  const commitBlock = useCallback(
    (index: number, block: DocBlock): DocResult => {
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
