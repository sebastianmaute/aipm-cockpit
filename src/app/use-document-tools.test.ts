import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDocumentTools } from "./use-document-tools";
import { useDocumentEditor } from "./use-document-editor";
import type { DocMutation, DocOp, DocResult } from "./document-mutations";
import type { DocBlock, ProjectDocument } from "./document-model";

const BASE: DocBlock = { type: "heading", level: 1, text: "Charter" };
const DOC: ProjectDocument = {
  id: 1,
  title: "Charter",
  blocks: [BASE, { type: "bullets", items: ["a"] }],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

function okResult(): DocResult {
  return { documents: [DOC], versions: [], changed: true, rejected: [], documentId: 1, minted: null };
}

const mutateDocuments = vi.fn<(m: DocMutation) => DocResult>(() => okResult());

vi.mock("./workspace-context", () => ({
  useWorkspace: () => ({ documents: [DOC], documentVersions: [], mutateDocuments }),
}));

beforeEach(() => {
  mutateDocuments.mockClear();
});

function sentOps(): readonly DocOp[] {
  const call = mutateDocuments.mock.calls[0][0];
  if (call.kind !== "ops") throw new Error(`expected an ops mutation, got ${call.kind}`);
  return call.ops;
}

// ★★★ `keepOp` strips `expect` from EVERY AI op (§187). The tool schema sets no
//  `additionalProperties: false`, so a model can emit the hand editor's
//  concurrency guard; each test below drives a different branch of the loop that
//  funnels into `keepOp`, so a bare `cleanOps.push` at any one site is caught.
describe("useDocumentTools — updateDocument strips the hand editor's `expect`", () => {
  const baseline = { type: "heading", level: 1, text: "stale baseline" } as const;

  it("strips it from a block-less op (delete)", () => {
    const { result } = renderHook(() => useDocumentTools(false));
    const op = { op: "delete", index: 0, expect: baseline } as unknown as DocOp;
    result.current.updateDocument(1, [op]);
    expect(sentOps()).toEqual([{ op: "delete", index: 0 }]);
    expect("expect" in sentOps()[0]).toBe(false);
  });

  it("strips it from a single-block op (replace) while keeping the sanitized block", () => {
    const { result } = renderHook(() => useDocumentTools(false));
    const op = {
      op: "replace",
      index: 0,
      block: { type: "heading", level: 2, text: "New" },
      expect: baseline,
    } as unknown as DocOp;
    result.current.updateDocument(1, [op]);
    expect(sentOps()).toHaveLength(1);
    expect(sentOps()[0]).toMatchObject({ op: "replace", index: 0, block: { type: "heading", text: "New" } });
    expect("expect" in sentOps()[0]).toBe(false);
  });

  it("strips it from a replaceAll op", () => {
    const { result } = renderHook(() => useDocumentTools(false));
    const op = {
      op: "replaceAll",
      blocks: [{ type: "heading", level: 1, text: "Fresh" }],
      expect: baseline,
    } as unknown as DocOp;
    result.current.updateDocument(1, [op]);
    expect(sentOps()).toHaveLength(1);
    expect(sentOps()[0].op).toBe("replaceAll");
    expect("expect" in sentOps()[0]).toBe(false);
  });
});

describe("useDocumentEditor — the hand editor's guarded replace keeps `expect`", () => {
  // The other half of §187: stops a future "just drop expect everywhere".
  it("threads the draft baseline into the replace op", () => {
    const hand = vi.fn<(m: DocMutation) => DocResult>(() => okResult());
    const { result } = renderHook(() =>
      useDocumentEditor({ documentId: 1, versions: [], mutateDocuments: hand, now: () => "2026-10-03T00:00:00.000Z" }),
    );
    result.current.commitBlock(0, { type: "heading", level: 1, text: "Edited" }, BASE);
    const sent = hand.mock.calls[0][0];
    if (sent.kind !== "ops") throw new Error("expected an ops mutation");
    expect(sent.ops).toEqual([
      { op: "replace", index: 0, block: { type: "heading", level: 1, text: "Edited" }, expect: BASE },
    ]);
  });
});
