// src/app/use-document-tools.ts — implementation of the five document tools
// the AI chat calls through DocumentToolDispatcher (chat-tools-documents.ts's
// interface). This is the WRITE PATH: every mutation composes
// document-mutations.ts's single mutation entry point (`mutateDocuments`,
// threaded through from `useWorkspace()`) with the model-input allow-list
// (ai-document-blocks.ts's `sanitizeAiDocBlocks`).
//
// ★★★ NOT coverage-excluded, and deliberately unlike the render-scope UI-glue
// hooks vitest.config.ts's coverage.exclude lists (use-calendar-integrations.ts
// and its siblings, which wire live DOM/render state to user-interaction
// handlers and are validated by task-manager's characterization suites + e2e
// instead). This hook holds real decisions — which mutation kind a tool call
// becomes, what gets sanitized before it reaches storage, and how each tool's
// result is shaped for the model (and, via the chat card, for the user) — so
// it is unit-tested directly through use-chat-dispatcher.test.tsx's existing
// renderDispatcher/runTool harness, the same way use-chat-dispatcher.ts itself
// is tested rather than excluded (verified against vitest.config.ts — it does
// NOT list use-chat-dispatcher.ts, despite an earlier plan draft assuming it
// did).
//
// ★★ Every write refuses in a read-only popout (mirrors use-chat-dispatcher's
// own per-tool `isReadOnly` guards) — chat tool writes have no undo capture,
// so a popout mirror must never be able to reach mutateDocuments at all.
import { useMemo, useRef, useEffect } from "react";
import { sanitizeAiDocBlocks } from "./ai-document-blocks";
import type { DocOp } from "./document-mutations";
import type { DocumentToolDispatcher } from "./chat-tools-documents";
import { useWorkspace } from "./workspace-context";

export function useDocumentTools(isReadOnly: boolean): DocumentToolDispatcher {
  const { documents, documentVersions, mutateDocuments } = useWorkspace();

  // Refs, so the dispatcher identity stays stable (useMemo below never
  // rebuilds on a documents/versions change) and back-to-back tool calls in
  // one turn read each other's writes — the same pattern use-chat-dispatcher
  // already uses for tasks/raid/changes/etc.
  const documentsRef = useRef(documents);
  const versionsRef = useRef(documentVersions);
  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);
  useEffect(() => {
    versionsRef.current = documentVersions;
  }, [documentVersions]);

  const readOnlyError = () =>
    new Error("This window is read-only; open the main window to make changes.");

  return useMemo<DocumentToolDispatcher>(
    () => ({
      listDocuments: () =>
        documentsRef.current.map((d) => ({
          id: d.id,
          title: d.title,
          blockCount: d.blocks.length,
          updatedAt: d.updatedAt,
        })),

      getDocument: (id) => documentsRef.current.find((d) => d.id === id) ?? null,

      createDocument: (title, blocks) => {
        if (isReadOnly) throw readOnlyError();
        // ★★ The model may send either HTML or plain text in a paragraph
        // block. sanitizeAiDocBlocks is the allow-list boundary — the
        // downstream structural sanitizer (document-model.ts) is DOM-free by
        // contract and cannot strip markup, so a <script> the model wrote
        // would otherwise reach storage verbatim. Applied to the model's
        // INPUT here, before it ever reaches mutateDocuments.
        const result = mutateDocuments(
          { kind: "create", title, blocks: sanitizeAiDocBlocks(blocks) },
          "ai",
        );
        documentsRef.current = result.documents;
        versionsRef.current = result.versions;
        const doc = result.documents.find((d) => d.id === result.documentId);
        // Only unreachable if mutateDocuments refused the create (a blank
        // title) — chat-tools-documents.ts already requires a non-blank,
        // trimmed title before calling this, so this is a defensive invariant
        // check, not an expected path.
        if (!doc) throw new Error("title is required");
        return { id: doc.id, title: doc.title, blockCount: doc.blocks.length };
      },

      updateDocument: (id, ops, title) => {
        if (isReadOnly) throw readOnlyError();
        const before = documentsRef.current.find((d) => d.id === id);
        if (!before) return null;
        // Sanitize the blocks the model supplied, op by op — applied to the
        // model's INPUT only, never to the merged/stored document (re-running
        // the allow-list over already-stored bytes would rewrite content the
        // call never asked to touch).
        const cleanOps: DocOp[] = ops.map((op) => {
          if (op.op === "replaceAll") return { ...op, blocks: sanitizeAiDocBlocks(op.blocks) };
          if ("block" in op && op.block) {
            const [block] = sanitizeAiDocBlocks([op.block]);
            return block ? { ...op, block } : op;
          }
          return op;
        });
        const result = mutateDocuments({ kind: "ops", id, ops: cleanOps, title }, "ai");
        documentsRef.current = result.documents;
        versionsRef.current = result.versions;
        const after = result.documents.find((d) => d.id === id);
        const usedReplaceAll = ops.some((o) => o.op === "replaceAll");
        return {
          id,
          title: after?.title ?? before.title,
          blockCount: after?.blocks.length ?? before.blocks.length,
          applied: result.changed ? ops.length - result.rejected.length : 0,
          rejected: result.rejected,
          removed: usedReplaceAll ? Math.max(0, before.blocks.length - (after?.blocks.length ?? 0)) : 0,
        };
      },

      deleteDocument: (id) => {
        if (isReadOnly) throw readOnlyError();
        const result = mutateDocuments({ kind: "delete", id }, "ai");
        documentsRef.current = result.documents;
        versionsRef.current = result.versions;
        const newest = result.versions[result.versions.length - 1];
        return {
          deleted: result.changed,
          restorableVersionId: result.changed && newest ? newest.id : null,
        };
      },
    }),
    [isReadOnly, mutateDocuments],
  );
}
