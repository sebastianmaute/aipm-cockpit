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
        const cleanBlocks = sanitizeAiDocBlocks(blocks);
        // ★★★ A DROPPED BLOCK MUST NOT BE SILENT, and create has NO channel to
        // say so: its result is `{id, title, blockCount}` (chat-tools-
        // documents.ts's DocumentToolDispatcher) with no `rejected` field, so a
        // shorter array after sanitizing simply produced a document missing a
        // section while the tool resolved and the model told the user it had
        // written the whole thing. Chat tool writes take no undo capture, so
        // "reported success, content gone" is the one outcome this path must
        // not have. THROW BEFORE THE WRITE instead: nothing is created, no
        // version row is minted, and the model gets a reason it can retry
        // against — the same shape as create_document's own "title is required"
        // refusal one layer up. Refusing the whole create is the right trade
        // here and NOT in updateDocument's replaceAll arm below, because every
        // block of a create is model-authored in this same call (there is no
        // pre-existing content to preserve by applying the survivors).
        const sentBlocks = Array.isArray(blocks) ? blocks.length : 0;
        const droppedBlocks = sentBlocks - cleanBlocks.length;
        if (droppedBlocks > 0) {
          throw new Error(
            `${droppedBlocks} of ${sentBlocks} block(s) failed the model-input allow-list; no document was created`,
          );
        }
        const result = mutateDocuments(
          { kind: "create", title, blocks: cleanBlocks },
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
        //
        // ★★★ A block the allow-list DROPPED must REJECT its op, never fall
        // back to the original. sanitizeAiDocBlocks([op.block]) drops a block
        // for two reasons — an unknown/invalid block type, or a paragraph
        // whose html sanitizes down to nothing (e.g. its ENTIRE content was a
        // disallowed element, so nothing survives) — and applyOps
        // (document-mutations.ts) has NO block-content validation of its own:
        // append/insert/replace apply whatever `op.block` they are given
        // unconditionally. Falling back to the unsanitized `op` here would
        // therefore store the model's RAW block verbatim — for the paragraph
        // case, the raw unsanitized HTML — reported as a successful write,
        // silently dropped only on the next load (sanitizeProjectDocuments
        // rejects it then, too late). Collecting a rejection here instead
        // means the op never reaches mutateDocuments at all.
        //
        // ★★ THE SECOND OF THOSE TWO REASONS NEEDS A WRAPPED PAYLOAD TO
        // REPRODUCE, and a test written the obvious way never reaches the
        // branch it claims to cover. A BARE "<script>alert(1)</script>" does
        // not start with a tag in rich-text-plain.ts's HTML_START set, so
        // layer 1 treats it as PLAIN TEXT and ESCAPES it — the block is safe,
        // non-empty, and SURVIVES. "<p><script>alert(1)</script></p>" starts
        // with <p>, so DOMPurify sees real markup and strips the tag AND its
        // content, leaving "<p></p>", which the next sanitizeRichText pass's
        // empty rule collapses to "" — and an empty paragraph then fails
        // document-model.ts's structural check. That is the input that
        // actually gets dropped.
        const selfRejected: string[] = [];
        const cleanOps: DocOp[] = [];
        ops.forEach((op, i) => {
          if (op.op === "replaceAll") {
            // ★★★ A NON-ARRAY `blocks` MUST NOT BECOME AN EMPTY ONE.
            // applyOps has its own `replaceAll requires a blocks array` guard,
            // but it CANNOT fire on this path: sanitizeAiDocBlocks always
            // hands it an array, so a `{op:"replaceAll"}` with no blocks
            // arrived as a well-formed "replace everything with nothing" and
            // wiped the document. chat-tools-documents.ts's requirePayload
            // refuses that at the TOOL boundary, so the model cannot reach it
            // today — this closes the same door for a direct dispatcher
            // caller, which is the only reason the engine's guard exists.
            if (!Array.isArray(op.blocks)) {
              selfRejected.push(`op ${i}: replaceAll requires a blocks array`);
              return;
            }
            // ★★★ THE SAME RULE AS THE SINGLE-BLOCK ARM BELOW, one container
            // deeper — and this arm did not have it. sanitizeAiDocBlocks
            // returns a SHORTER array when it drops blocks, nothing compared
            // the lengths, so a 4-block replaceAll carrying one bad block
            // wrote 3 and reported `changed:true, rejected:[]` (measured). The
            // tool resolved, the model said "I've rewritten the document", and
            // a section was simply absent. The before-image can still restore
            // it — but nothing told the user there was anything to restore,
            // which is what makes this the reported-success-lost-the-content
            // class rather than a cosmetic miscount.
            const sent = op.blocks.length;
            const kept = sanitizeAiDocBlocks(op.blocks);
            // ★★★ AN EXPLICIT EMPTY LIST IS LEGAL AND STAYS LEGAL — `blocks:
            // []` is a real "clear this document" request (document-mutations
            // .ts says so at length) and the before-image preserves what it
            // replaced. But `sent > 0 && kept === 0` is NOT that request: it
            // is a replace whose every block the allow-list voided, and
            // applying it would wipe the document on the strength of content
            // that never survived validation. Reject the op instead, exactly
            // as the single-block arm does. The distinction is `sent`, the
            // length of what the model SUPPLIED — a guard keying on `kept`
            // alone cannot tell the two apart and would break the legitimate
            // clear.
            if (sent > 0 && kept.length === 0) {
              selfRejected.push(
                `op ${i}: all ${sent} block(s) failed the model-input allow-list`,
              );
              return;
            }
            // A PARTIAL drop still applies — the survivors are what the model
            // asked for, minus what it may not store — but it must be named.
            // ★ This message is OP-SCOPED and so must match the `/^op \d+:/`
            // shape the `applied` arithmetic below keys on. It rides
            // `selfRejected`, which that filter never reads, so it cannot move
            // the count either way; the pattern is kept for the reader's sake
            // and for anything downstream that partitions the two kinds.
            const dropped = sent - kept.length;
            if (dropped > 0) {
              selfRejected.push(
                `op ${i}: ${dropped} block(s) failed the model-input allow-list`,
              );
            }
            cleanOps.push({ ...op, blocks: kept });
            return;
          }
          if ("block" in op && op.block) {
            const [block] = sanitizeAiDocBlocks([op.block]);
            if (!block) {
              selfRejected.push(`op ${i}: block failed the model-input allow-list`);
              return;
            }
            cleanOps.push({ ...op, block });
            return;
          }
          cleanOps.push(op);
        });
        const result = mutateDocuments({ kind: "ops", id, ops: cleanOps, title }, "ai");
        documentsRef.current = result.documents;
        versionsRef.current = result.versions;
        const after = result.documents.find((d) => d.id === id);
        const usedReplaceAll = ops.some((o) => o.op === "replaceAll");
        // ★★★ `result.rejected` mixes OP-SCOPED entries ("op N: …", one per
        // rejected op — applyOps prefixes every one, document-mutations.ts)
        // with MUTATION-SCOPED ones (a blank title; a future block-count cap)
        // that describe the WRITE, not any single op. Subtracting the whole
        // array from an op count conflates two different denominators and can
        // go negative the moment both kinds land together — e.g. an
        // out-of-range op alongside a blank title. Count only the op-scoped
        // ones: every op in `cleanOps` contributes at most one such entry, so
        // this can never exceed `cleanOps.length` and needs no clamp.
        const opRejectedCount = result.rejected.filter((r) => /^op \d+:/.test(r)).length;
        return {
          id,
          title: after?.title ?? before.title,
          blockCount: after?.blocks.length ?? before.blocks.length,
          // Derived from what was actually SENT (cleanOps) and what the
          // engine itself reported as rejected AMONG THOSE — never from the
          // caller's raw `ops.length`, which over-counts by exactly the ops
          // this function rejected before the engine ever saw them.
          applied: cleanOps.length - opRejectedCount,
          rejected: [...selfRejected, ...result.rejected],
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
