import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDocumentEditor } from "./use-document-editor";
import type { DocMutation, DocResult } from "./document-mutations";
import type { DocVersionSource } from "./document-versions";

const NOW = "2026-08-18T10:00:00.000Z";

function result(): DocResult {
  return { documents: [], versions: [], changed: true, rejected: [], documentId: 1, minted: null };
}

// ★ Lint watch (see the plan's T8 note): CI runs `eslint --max-warnings=0`
//  with no `argsIgnorePattern`, so a named-but-unused `(_m, _source)` pair is
//  fatal. Typed explicitly via the generic instead, so `.mock.calls[0][0]`
//  keeps its real tuple shape without the callback needing to name either arg.
function mockMutate() {
  return vi.fn<(m: DocMutation, source: DocVersionSource) => DocResult>(() => result());
}

describe("useDocumentEditor — the document-switch guard", () => {
  // ★★★ THE ONLY TEST THAT CAN KILL THIS GUARD. At the panel level the block
  //  editor's unmount CLEANUP runs before the parent's [documentId] effect, so
  //  `currentDocIdRef` still holds the OLD id and the guard never fires — the
  //  panel test passes with the guard deleted. Driving the hook directly is
  //  what makes a genuinely STALE commitBlock closure reachable: capture it for
  //  document 1, rerender at document 2 (letting the effect run), then call the
  //  closure that document 1 minted.
  it("abandons a commit from a closure minted for a document that is no longer selected", () => {
    const mutateDocuments = mockMutate();
    const { result: hook, rerender } = renderHook(
      ({ documentId }: { documentId: number }) =>
        useDocumentEditor({ documentId, versions: [], mutateDocuments, now: () => NOW }),
      { initialProps: { documentId: 1 } },
    );
    const staleCommit = hook.current.commitBlock;

    rerender({ documentId: 2 });

    expect(staleCommit(0, { type: "heading", level: 1, text: "x" })).toBeUndefined();
    expect(mutateDocuments).not.toHaveBeenCalled();
  });

  it("commits normally through a closure minted for the selected document", () => {
    const mutateDocuments = mockMutate();
    const { result: hook } = renderHook(() =>
      useDocumentEditor({ documentId: 1, versions: [], mutateDocuments, now: () => NOW }),
    );
    hook.current.commitBlock(0, { type: "heading", level: 1, text: "x" });
    expect(mutateDocuments).toHaveBeenCalledTimes(1);
    expect(mutateDocuments.mock.calls[0][0]).toMatchObject({ kind: "ops", id: 1 });
  });
});
