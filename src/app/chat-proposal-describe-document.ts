// src/app/chat-proposal-describe-document.ts — the review card's detail for a staged document write (AI-02).
//
// Pure, i18n-free and DOM-free. `create_document` and `update_document` have no `INLINE_DESCRIPTORS` entity, so
// the descriptor engine gives them an empty plan and the card could name only the document. In an untrusted send
// they stage (`stagesWhenUntrusted`), and the card is the control against an injected rewrite, so it must show
// what the write will put into the document: the block count and opening text of a new document, and the op
// kinds and the inserted or replaced text of an update. The card translates the labels.
//
// ★ The blocks are counted after `sanitizeProjectDocuments`, the structure pass the write also runs (through
//  `sanitizeAiDocBlocks`), so a block the write drops is not counted. The text is a plain-text projection
//  (`htmlPlainProjection`) and the card renders it as text, never as markup.
import type { ProposedCall } from "./chat-proposal";
import { sanitizeProjectDocuments, type DocBlock } from "./document-model";
import { htmlPlainProjection, oneLine } from "./rich-text-plain";

/** How much of the written text the card shows. */
export const DOCUMENT_EXCERPT_CHARS = 160;

/** The `update_document` op kinds, in the order the card lists them. */
export const DOC_OP_KINDS = ["append", "insert", "replace", "replaceAll", "move", "delete"] as const;
export type DocOpKind = (typeof DOC_OP_KINDS)[number];

/** What a staged document write puts into the document. `excerpt` is plain text, "" when the write adds none. */
export type DocumentChange =
  | { readonly kind: "create"; readonly blockCount: number; readonly excerpt: string }
  | {
      readonly kind: "update";
      readonly ops: readonly { readonly op: DocOpKind; readonly count: number }[];
      readonly rename: string | null;
      readonly excerpt: string;
    };

/** The blocks of `raw` the write keeps. */
function keptBlocks(raw: unknown): readonly DocBlock[] {
  if (!Array.isArray(raw)) return [];
  const [doc] = sanitizeProjectDocuments([
    { id: 1, title: "x", blocks: raw, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  ]);
  return doc?.blocks ?? [];
}

function blockText(block: DocBlock): string {
  switch (block.type) {
    case "heading":
      return block.text;
    case "paragraph":
      return htmlPlainProjection(block.html);
    case "bullets":
      return block.items.join(" ");
    case "table":
      return [block.caption ?? "", ...block.columns, ...block.rows.flat()].join(" ");
    case "dataSection":
    case "pageBreak":
      return "";
  }
}

function excerptOf(blocks: readonly DocBlock[]): string {
  const text = oneLine(blocks.map(blockText).join(" ")).replace(/\s+/g, " ");
  return text.length > DOCUMENT_EXCERPT_CHARS ? `${text.slice(0, DOCUMENT_EXCERPT_CHARS)}…` : text;
}

/** The blocks one `update_document` op writes. */
function opBlocks(op: Record<string, unknown>): readonly DocBlock[] {
  if (op.op === "replaceAll") return keptBlocks(op.blocks);
  if (op.op === "append" || op.op === "insert" || op.op === "replace") return keptBlocks([op.block]);
  return [];
}

/** What a `create_document` or `update_document` call writes, or null for any other call. */
export function describeDocumentCall(call: ProposedCall): DocumentChange | null {
  if (call.name === "create_document") {
    const blocks = keptBlocks(call.input.blocks);
    return { kind: "create", blockCount: blocks.length, excerpt: excerptOf(blocks) };
  }
  if (call.name !== "update_document") return null;
  const rawOps = Array.isArray(call.input.ops) ? (call.input.ops as unknown[]) : [];
  const ops = rawOps.filter((op): op is Record<string, unknown> => typeof op === "object" && op !== null);
  const counts = DOC_OP_KINDS
    .map((kind) => ({ op: kind, count: ops.filter((op) => op.op === kind).length }))
    .filter((c) => c.count > 0);
  const title = typeof call.input.title === "string" ? call.input.title.trim() : "";
  return { kind: "update", ops: counts, rename: title === "" ? null : title, excerpt: excerptOf(ops.flatMap(opBlocks)) };
}
