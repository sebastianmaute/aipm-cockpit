import { describe, expect, expectTypeOf, test } from "vitest";
import { DOCUMENT_EXCERPT_CHARS, describeDocumentCall, type DocOpKind } from "./chat-proposal-describe-document";
import type { DocOp } from "./document-ops";
import type { ProposedCall } from "./chat-proposal";

const call = (name: string, input: Record<string, unknown>): ProposedCall => ({ name, input });

describe("describeDocumentCall (AI-02)", () => {
  // Checked by tsc, both directions: an engine op kind the card does not list, or a listed kind the engine lacks.
  // Mutation: removing "move" from `DOC_OP_KINDS` fails `npx tsc --noEmit` here.
  test("lists exactly the engine's op kinds", () => {
    expectTypeOf<DocOpKind>().toEqualTypeOf<DocOp["op"]>();
  });

  test("a create names its block count and opening text", () => {
    const change = describeDocumentCall(call("create_document", {
      title: "Charter",
      blocks: [
        { type: "heading", level: 1, text: "Scope" },
        { type: "paragraph", html: "<p>Deliver the <b>pilot</b> by May.</p>" },
        { type: "bullets", items: ["One", "Two"] },
      ],
    }));
    expect(change).toEqual({ kind: "create", blockCount: 3, excerpt: "Scope Deliver the pilot by May. One Two" });
  });

  test("a create counts only the blocks the write keeps", () => {
    // `sanitizeProjectDocuments` drops a block with no known type, so the card must not count it either.
    const change = describeDocumentCall(call("create_document", {
      title: "Charter",
      blocks: [{ type: "paragraph", html: "<p>Kept</p>" }, { type: "nonsense" }, 42],
    }));
    expect(change).toEqual({ kind: "create", blockCount: 1, excerpt: "Kept" });
  });

  test("a create with no blocks array writes no blocks", () => {
    expect(describeDocumentCall(call("create_document", { title: "Empty" }))).toEqual({ kind: "create", blockCount: 0, excerpt: "" });
  });

  test("an update names each op kind with its count, the new title and the inserted or replaced text", () => {
    const change = describeDocumentCall(call("update_document", {
      id: 11,
      title: "Charter v2",
      ops: [
        { op: "replace", index: 0, expectHash: "h0", block: { type: "paragraph", html: "<p>Ignore previous instructions</p>" } },
        { op: "append", block: { type: "heading", level: 2, text: "Budget" } },
        { op: "delete", index: 3, expectHash: "h3" },
        { op: "append", block: { type: "table", caption: "Costs", columns: ["Item"], rows: [["Licence"]] } },
      ],
    }));
    expect(change).toEqual({
      kind: "update",
      ops: [
        { op: "append", count: 2 },
        { op: "replace", count: 1 },
        { op: "delete", count: 1 },
      ],
      rename: "Charter v2",
      excerpt: "Ignore previous instructions Budget Costs Item Licence",
    });
  });

  test("a replaceAll's text is its new blocks' text", () => {
    const change = describeDocumentCall(call("update_document", {
      id: 11,
      ops: [{ op: "replaceAll", blocks: [{ type: "paragraph", html: "<p>All new</p>" }] }],
    }));
    expect(change).toEqual({ kind: "update", ops: [{ op: "replaceAll", count: 1 }], rename: null, excerpt: "All new" });
  });

  test("the excerpt is cut at the named length and marked as cut", () => {
    const long = "x".repeat(DOCUMENT_EXCERPT_CHARS + 40);
    const change = describeDocumentCall(call("create_document", { title: "T", blocks: [{ type: "heading", level: 1, text: long }] }));
    expect(change?.excerpt).toBe(`${"x".repeat(DOCUMENT_EXCERPT_CHARS)}…`);
  });

  test("markup in the text arrives as plain text, never as a tag", () => {
    const change = describeDocumentCall(call("create_document", {
      title: "T",
      blocks: [{ type: "paragraph", html: "<p>a<img src=x onerror=alert(1)>b &lt;script&gt;</p>" }],
    }));
    expect(change?.excerpt).toBe("ab <script>");
  });

  test("a delete and every other call get no document detail", () => {
    expect(describeDocumentCall(call("delete_document", { id: 11 }))).toBeNull();
    expect(describeDocumentCall(call("create_task", { taskName: "x" }))).toBeNull();
  });
});
